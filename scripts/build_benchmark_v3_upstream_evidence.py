#!/usr/bin/env python3
"""Build a public-review evidence manifest for a real upstream Benchmark V3 run."""
import argparse,hashlib,json,pathlib,platform,subprocess

def sha256(path):
 h=hashlib.sha256()
 with open(path,"rb") as f:
  for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
 return h.hexdigest()

def git(*args):
 return subprocess.check_output(["git",*args],text=True).strip()

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--benchmark",required=True)
 ap.add_argument("--result",required=True)
 ap.add_argument("--graph",required=True)
 ap.add_argument("--judgement",required=True)
 ap.add_argument("--semantic",required=True)
 ap.add_argument("--judgement-run-id",required=True)
 ap.add_argument("--semantic-run-id",required=True)
 ap.add_argument("--out",required=True)
 a=ap.parse_args()
 benchmark=json.load(open(a.benchmark,encoding="utf8"))
 result=json.load(open(a.result,encoding="utf8"))
 files={
  "benchmark":a.benchmark,"graph":a.graph,
  "judgement_checkpoint":a.judgement,"semantic_checkpoint":a.semantic,
  "evaluation_result":a.result
 }
 evidence={
  "schema_version":"flythink-benchmark-v3-upstream-evidence-v1",
  "claim_scope":{
   "real_upstream_checkpoint_execution":True,
   "real_hardware_execution":False,
   "physical_completion_claimed":False,
   "sealed_split_used":result.get("split")=="sealed"
  },
  "source":{
   "repository":"hippoley/FlyThink-Anatomy-Demo",
   "commit_sha":git("rev-parse","HEAD"),
   "benchmark_release_id":benchmark["manifest"].get("release_id"),
   "benchmark_manifest_sha256":benchmark["manifest"].get("sha256"),
   "judgement_artifact_run_id":str(a.judgement_run_id),
   "semantic_artifact_run_id":str(a.semantic_run_id)
  },
  "runtime":{
   "python":platform.python_version(),
   "platform":platform.platform()
  },
  "artifacts":{k:{"path":v,"sha256":sha256(v)} for k,v in files.items()},
  "result_summary":{
   "trajectories":result.get("trajectories"),
   "total_runs":result.get("total_runs"),
   "overall":result.get("overall"),
   "worst_family_full_patch_exact":result.get("worst_family_full_patch_exact"),
   "strict_trajectory_rate":result.get("strict_trajectory_rate"),
   "pass_pow_k":result.get("pass_pow_k"),
   "unsafe_execute":result.get("unsafe_execute"),
   "wrong_device":result.get("wrong_device"),
   "untouched_state_violation":result.get("untouched_state_violation"),
   "failure_count":len(result.get("failures") or [])
  },
  "verdict":{
   "evidence_complete":True,
   "safety_invariants_preserved":
    result.get("unsafe_execute")==0 and
    result.get("wrong_device")==0 and
    result.get("untouched_state_violation")==0,
   "benchmark_mastered":
    result.get("strict_trajectory_rate")==1 and
    (result.get("pass_pow_k") or {}).get("value")==1
  }
 }
 pathlib.Path(a.out).write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 print(json.dumps(evidence["verdict"],ensure_ascii=False))

if __name__=="__main__":main()
