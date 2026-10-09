"use strict";

const fs=require("fs");

const CURRENT_DRAFT="draft-ietf-oauth-transaction-tokens-11";
const REQUIRED_BASE_CLAIMS=["iat","aud","exp","txn","sub","scope","req_wl"];
const FLYTHINK_PROFILE_REQUIRED=["tctx"];

function claimLiteralPresent(source,name){
  const quoted=new RegExp(`["']${name}["']\\\\s*:`);
  return quoted.test(source);
}

function inspectTokenetesSource(source,{upstreamCommit=null}={}){
  const claims={};
  for(const name of [...REQUIRED_BASE_CLAIMS,"tctx","rctx","purp","azd"]){
    claims[name]=claimLiteralPresent(source,name);
  }
  const typTxntokenJwt=/TOKEN_JWT_HEADER\s*=\s*["']txntoken\+jwt["']/.test(source)||
    /["']typ["']\s*[^\n]*["']txntoken\+jwt["']/.test(source);
  const typLegacyTxnToken=/TOKEN_JWT_HEADER\s*=\s*["']txn_token["']/.test(source);

  const missingRequired=REQUIRED_BASE_CLAIMS.filter(x=>!claims[x]);
  const missingFlyThink=FLYTHINK_PROFILE_REQUIRED.filter(x=>!claims[x]);

  const draft11SurfaceReady=typTxntokenJwt&&missingRequired.length===0;
  const flythinkBindingProfileReady=draft11SurfaceReady&&missingFlyThink.length===0;

  return {
    schema_version:"flythink.tokenetes-draft11-admission-probe.v1",
    current_draft:CURRENT_DRAFT,
    upstream:{
      repository:"tokenetes/tokenetes",
      commit:upstreamCommit
    },
    observed:{
      typ_txntoken_jwt:typTxntokenJwt,
      typ_legacy_txn_token:typLegacyTxnToken,
      claims
    },
    missing_required_current_draft_claims:missingRequired,
    missing_flythink_profile_claims:missingFlyThink,
    draft11_surface_ready:draft11SurfaceReady,
    flythink_trust_adapter_candidate:flythinkBindingProfileReady,
    legacy_shape_detected:
      typLegacyTxnToken||claims.purp||claims.azd,
    verdict:flythinkBindingProfileReady
      ?"READY_FOR_EXTERNAL_VALIDATOR_INTEGRATION"
      :"BLOCKED_CURRENT_DRAFT_SURFACE",
    claim_boundary:[
      "This probe checks the pinned issuer source surface needed by FlyThink; it is not a complete Transaction Tokens conformance test.",
      "A blocked verdict does not mean Tokenetes is unusable or insecure.",
      "FlyThink must not promote an implementation label into current-draft compatibility without executable evidence.",
      "Even a ready issuer surface would not authenticate a token inside FlyThink until a real external consumer-side validator is executed."
    ]
  };
}

if(require.main===module){
  const args=process.argv.slice(2);
  const file=args[0];
  if(!file)throw new Error("usage: node probe_tokenetes_draft11.cjs <service.go> [upstream_commit]");
  const source=fs.readFileSync(file,"utf8");
  process.stdout.write(JSON.stringify(inspectTokenetesSource(source,{upstreamCommit:args[1]||null}),null,2)+"\n");
}

module.exports={inspectTokenetesSource};
