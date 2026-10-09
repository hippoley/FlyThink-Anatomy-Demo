#!/usr/bin/env python3
"""Join stateful and teacher-forced V3 results into a first-failure ledger."""
import argparse,collections,json,pathlib

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--stateful",required=True)
 ap.add_argument("--teacher-forced",required=True)
 ap.add_argument("--out",required=True)
 a=ap.parse_args()
 s=json.load(open(a.stateful,encoding="utf8"))
 t=json.load(open(a.teacher_forced,encoding="utf8"))
 tf={(x["trajectory"],x["turn"]):x for x in t.get("failures",[])}
 first={}
 for x in s.get("failures",[]):
  k=x["trajectory"]
  if k not in first or x["turn"]<first[k]["turn"]:first[k]=x
 rows=[];taxonomy=collections.Counter();families=collections.Counter()
 for traj,x in sorted(first.items()):
  local=tf.get((traj,x["turn"]))
  if local:
   kind="local_capability_failure"
   primary=local["primary_failure"]
  else:
   kind="stateful_only_failure"
   primary="cascade_or_runtime_context"
  taxonomy[primary]+=1;families[x.get("family","unknown")]+=1
  rows.append({
   "trajectory":traj,"turn":x["turn"],"text":x["text"],
   "family":x.get("family"),"difficulty":x.get("difficulty"),
   "stateful_outcome":x.get("outcome"),"stateful_error":x.get("error"),
   "failure_kind":kind,"primary_failure":primary,
   "teacher_forced_failure":local
  })
 out={
  "schema_version":"benchmark-v3-first-failure-ledger-v1",
  "trajectories_with_failure":len(rows),
  "primary_failure_taxonomy":dict(taxonomy),
  "first_failure_families":dict(families),
  "rows":rows
 }
 pathlib.Path(a.out).write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 print(json.dumps({k:out[k] for k in ("trajectories_with_failure","primary_failure_taxonomy","first_failure_families")},ensure_ascii=False))

if __name__=="__main__":main()
