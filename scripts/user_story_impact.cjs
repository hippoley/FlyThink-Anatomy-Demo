"use strict";
const fs=require("fs");
const cp=require("child_process");
const path=require("path");

const DEFAULT_GRAPH=path.join(__dirname,"..","contracts","user-story-impact.v1.json");

function wildcardToRegExp(pattern){
  const escaped=String(pattern).replace(/[.+^$(){}|\\]/g,"\\$&");
  return new RegExp("^"+escaped.replace(/\*\*/g,"§§").replace(/\*/g,"[^/]*").replace(/§§/g,".*")+"$");
}
function matches(pattern,file){return wildcardToRegExp(pattern).test(file)}
function loadGraph(file=DEFAULT_GRAPH){
  const graph=JSON.parse(fs.readFileSync(file,"utf8"));
  if(graph.schema_version!=="user-story-impact.v1")throw new Error("user_story_impact_schema_invalid");
  if(!graph.stories||typeof graph.stories!=="object")throw new Error("user_story_impact_stories_required");
  return graph;
}
function directStories(graph,changedFiles){
  const out=new Set();
  for(const [id,story] of Object.entries(graph.stories)){
    const patterns=Array.isArray(story.paths)?story.paths:[];
    if(changedFiles.some(file=>patterns.some(pattern=>matches(pattern,file))))out.add(id);
  }
  return out;
}
function expandDependents(graph,seed){
  const impacted=new Set(seed);
  let changed=true;
  while(changed){
    changed=false;
    for(const [id,story] of Object.entries(graph.stories)){
      if(impacted.has(id))continue;
      const deps=Array.isArray(story.depends_on)?story.depends_on:[];
      if(deps.some(dep=>impacted.has(dep))){
        impacted.add(id);changed=true;
      }
    }
  }
  return impacted;
}
function impact(graph,changedFiles){
  const direct=directStories(graph,changedFiles);
  const all=expandDependents(graph,direct);
  const suites=new Set();
  for(const id of all){
    for(const suite of graph.stories[id].suites||[])suites.add(suite);
  }
  return {
    schema_version:"user-story-impact-result.v1",
    changed_files:[...changedFiles].sort(),
    direct_stories:[...direct].sort(),
    impacted_stories:[...all].sort(),
    regression_suites:[...suites].sort()
  };
}
function runSuites(graph,suites){
  const results=[];
  for(const name of suites){
    const spec=graph.suites[name];
    if(!Array.isArray(spec)||spec.length<2)throw new Error("user_story_suite_invalid:"+name);
    const [cmd,...args]=spec;
    const r=cp.spawnSync(cmd,args,{stdio:"inherit",encoding:"utf8"});
    results.push({suite:name,status:r.status});
    if(r.status!==0)throw new Error("user_story_regression_failed:"+name);
  }
  return results;
}
function parseArgs(argv){
  const out={graph:DEFAULT_GRAPH,run:false,files:[]};
  for(let i=0;i<argv.length;i++){
    if(argv[i]==="--graph"){out.graph=argv[++i];continue}
    if(argv[i]==="--run"){out.run=true;continue}
    if(argv[i]==="--file"){out.files.push(argv[++i]);continue}
    if(argv[i]==="--files-from"){
      const src=argv[++i];
      out.files.push(...fs.readFileSync(src,"utf8").split(/\r?\n/).map(x=>x.trim()).filter(Boolean));
      continue;
    }
    throw new Error("unknown_argument:"+argv[i]);
  }
  return out;
}
if(require.main===module){
  const args=parseArgs(process.argv.slice(2));
  const graph=loadGraph(args.graph);
  const result=impact(graph,args.files);
  if(args.run)result.regression_results=runSuites(graph,result.regression_suites);
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
}
module.exports={wildcardToRegExp,matches,loadGraph,directStories,expandDependents,impact,runSuites,parseArgs};
