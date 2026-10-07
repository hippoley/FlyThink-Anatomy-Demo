"use strict";

const fs=require("fs");
const path=require("path");
const {
  loadSceneContext
}=require("./spatialruntime_world_context.cjs");

function parseArgs(argv){
  const args=[...argv];
  const worldPath=args.shift();
  const receiptPath=args.shift();
  if(!worldPath||!receiptPath){
    throw new Error(
      "usage: node scripts/build_spatialruntime_scene_context.cjs WORLD RECEIPT [OUT] [--handoff HANDOFF] [--expected-source-repo REPO] [--expected-source-commit SHA] [--out OUT]"
    );
  }

  let outPath=null;
  let handoffPath=null;
  let expectedSourceRepo=null;
  let expectedSourceCommit=null;

  // Preserve the original three-positional-argument form.
  if(args[0]&&!String(args[0]).startsWith("--")){
    outPath=args.shift();
  }
  while(args.length){
    const flag=args.shift();
    const value=args.shift();
    if(!value)throw new Error("missing value for "+String(flag));
    if(flag==="--handoff")handoffPath=value;
    else if(flag==="--expected-source-repo")expectedSourceRepo=value;
    else if(flag==="--expected-source-commit")expectedSourceCommit=value;
    else if(flag==="--out")outPath=value;
    else throw new Error("unknown argument: "+String(flag));
  }
  return {
    worldPath,receiptPath,outPath,handoffPath,
    expectedSourceRepo,expectedSourceCommit
  };
}

function main(argv=process.argv.slice(2)){
  const args=parseArgs(argv);
  const context=loadSceneContext(
    args.worldPath,
    args.receiptPath,
    {
      handoffPath:args.handoffPath,
      expectedSourceRepo:args.expectedSourceRepo,
      expectedSourceCommit:args.expectedSourceCommit
    }
  );
  const rendered=JSON.stringify(context,null,2)+"\n";
  if(args.outPath){
    fs.mkdirSync(path.dirname(path.resolve(args.outPath)),{recursive:true});
    fs.writeFileSync(args.outPath,rendered,"utf8");
  }else{
    process.stdout.write(rendered);
  }
  process.stderr.write(JSON.stringify({
    schema:context.schema,
    case_id:context.case_id,
    context_sha256:context.context_sha256,
    exterior_window_keys:context.exterior_window_keys,
    handoff_evidence:context.handoff_evidence||null,
    output:args.outPath||null
  })+"\n");
  return context;
}

if(require.main===module){
  try{main()}
  catch(e){
    console.error(e&&e.stack||e);
    process.exit(1);
  }
}

module.exports={parseArgs,main};
