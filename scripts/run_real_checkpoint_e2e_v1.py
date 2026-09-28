#!/usr/bin/env python3
"""Score actual checkpoint decisions/proposals without gold substitution."""
import argparse,json,subprocess,sys
from real_checkpoint_trajectory_v1 import build
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--graph",required=True);ap.add_argument("--judgement",required=True);ap.add_argument("--semantic",required=True);a=ap.parse_args()
 rows=build()[0]["turns"];payload="".join(json.dumps({"turn_id":i,**r},ensure_ascii=False)+"\n" for i,r in enumerate(rows))
 p=subprocess.run([sys.executable,"scripts/real_checkpoint_e2e_predictor.py","--graph",a.graph,"--judgement",a.judgement,"--semantic",a.semantic],input=payload,text=True,capture_output=True,check=True)
 preds=[json.loads(x) for x in p.stdout.splitlines() if x.strip()];correct=0;target_correct=0;target_total=0;fam={};errors=[]
 for r,q in zip(rows,preds):
  ok=q["decision"]==r["gold_decision"];correct+=ok;fam.setdefault(r["family"],[]).append(ok)
  if not ok:errors.append({"text":r["text"],"gold":r["gold_decision"],"pred":q["decision"]})
  if r.get("gold_target") and q.get("decision")=="EXECUTE":
   target_total+=1;patch=(q.get("patches") or [{}])[0];pt=patch.get("target");tok=pt==r["gold_target"];target_correct+=tok
   if not tok:errors.append({"text":r["text"],"kind":"wrong_target","gold_target":r["gold_target"],"pred_target":pt})
 rep={"truth":"real_checkpoint_natural_language_e2e_v1","turns":len(rows),"decision_accuracy":correct/len(rows),"target_accuracy":target_correct/target_total if target_total else None,"wrong_device":target_total-target_correct,"family":{k:sum(v)/len(v) for k,v in fam.items()},"errors":errors,"predictions":preds}
 print(json.dumps(rep,ensure_ascii=False))
if __name__=="__main__":main()
