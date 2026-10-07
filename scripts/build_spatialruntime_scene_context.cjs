"use strict";

const fs=require("fs");
const path=require("path");
const {
  loadSceneContext
}=require("./spatialruntime_world_context.cjs");

function main(argv=process.argv.slice(2)){
  const [worldPath,receiptPath,outPath]=argv;
  if(!worldPath||!receiptPath){
    throw new Error(
      "usage: node scripts/build_spatialruntime_scene_context.cjs WORLD RECEIPT [OUT]"
    );
  }
  const context=loadSceneContext(worldPath,receiptPath);
  const rendered=JSON.stringify(context,null,2)+"\n";
  if(outPath){
    fs.mkdirSync(path.dirname(path.resolve(outPath)),{recursive:true});
    fs.writeFileSync(outPath,rendered,"utf8");
  }else{
    process.stdout.write(rendered);
  }
  process.stderr.write(JSON.stringify({
    schema:context.schema,
    case_id:context.case_id,
    context_sha256:context.context_sha256,
    exterior_window_keys:context.exterior_window_keys,
    output:outPath||null
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

module.exports={main};
