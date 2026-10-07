"use strict";

const crypto=require("crypto");
const fs=require("fs");
const {validateReceipt}=require("./acoustic_windowpilot_evidence.cjs");

function arg(name){
  const i=process.argv.indexOf(name);
  return i>=0?process.argv[i+1]:null;
}
function flag(name){return process.argv.includes(name)}
function sha256File(path){
  return crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex");
}

const receiptPath=arg("--receipt");
const wavPath=arg("--wav");
const manifestPath=arg("--fixture-manifest");
const requireHuman=flag("--require-human-fixture");
const requireSpatialRuntime=flag("--require-spatialruntime-authorization");
const requireSpatialRuntimeScene=flag("--require-spatialruntime-scene-evidence");

if(!receiptPath)throw new Error("--receipt is required");
if(requireHuman&&(!wavPath||!manifestPath)){
  throw new Error("--require-human-fixture requires --wav and --fixture-manifest");
}
if((wavPath&&!manifestPath)||(!wavPath&&manifestPath)){
  throw new Error("--wav and --fixture-manifest must be supplied together");
}

const receipt=JSON.parse(fs.readFileSync(receiptPath,"utf8"));
const report=validateReceipt(receipt,{
  requireHumanFixture:requireHuman,
  requireSpatialRuntimeAuthorization:requireSpatialRuntime,
  requireSpatialRuntimeSceneEvidence:requireSpatialRuntimeScene
});
const reasons=[...report.reasons];

if(wavPath&&manifestPath){
  const manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8"));
  const fixture=receipt.acoustic_fixture||{};
  const actualWavSha=sha256File(wavPath);
  const actualManifestSha=sha256File(manifestPath);

  if(manifest.schema!=="flythink.acoustic_fixture.v1"){
    reasons.push("fixture manifest schema mismatch");
  }
  if(requireHuman&&manifest.source_kind!=="human_recording"){
    reasons.push("fixture manifest is not human_recording");
  }
  if(!manifest.wav||manifest.wav.sha256!==actualWavSha){
    reasons.push("fixture manifest WAV SHA256 mismatch");
  }
  if(fixture.wav_sha256!==actualWavSha){
    reasons.push("receipt acoustic fixture WAV SHA256 mismatch");
  }
  if(fixture.manifest_sha256!==actualManifestSha){
    reasons.push("receipt acoustic fixture manifest SHA256 mismatch");
  }
  if(fixture.source_kind!==manifest.source_kind){
    reasons.push("receipt acoustic fixture source kind mismatch");
  }
  if(String(fixture.expected_text||"")!==String(manifest.expected_text||"")){
    reasons.push("receipt acoustic fixture expected text mismatch");
  }
  const manifestMaxCer=Number(
    manifest.acceptance&&manifest.acceptance.max_cer
  );
  if(!Number.isFinite(manifestMaxCer)||
     Number(fixture.max_cer)!==manifestMaxCer){
    reasons.push("receipt acoustic fixture max CER mismatch");
  }
}

const out={...report,valid:reasons.length===0,reasons};
console.log(JSON.stringify(out,null,2));
if(!out.valid)process.exitCode=2;
