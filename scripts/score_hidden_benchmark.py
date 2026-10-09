#!/usr/bin/env python3
import argparse,hashlib,json,pathlib
from validate_hidden_benchmark_pack import validate_triplet,sha256_file

def canon(v):
 if isinstance(v,dict):return {k:canon(v[k]) for k in sorted(v)}
 if isinstance(v,list):return [canon(x) for x in v]
 return v

def exact(a,b):return canon(a)==canon(b)

def score(input_path,gold_path,pred_path,commitment_path):
 validation=validate_triplet(input_path,gold_path,pred_path,commitment_path)
 inp=json.load(open(input_path,encoding="utf8"))
 gold=json.load(open(gold_path,encoding="utf8"))
 pred=json.load(open(pred_path,encoding="utf8"))
 gm={x["case_id"]:x for x in gold["gold"]}
 pm={x["case_id"]:x for x in pred["predictions"]}
 decision=patch=full=0;rows=[]
 for case in inp["cases"]:
  cid=case["case_id"];g=gm[cid];p=pm[cid]
  d=p["decision"]==g["decision"];px=exact(p["patches"],g["patches"])
  decision+=d;patch+=px;full+=(d and px)
  rows.append({"case_id":cid,"decision_exact":d,"patch_exact":px,"full_exact":bool(d and px)})
 n=len(rows);src=inp["source"]
 return {
  "schema_version":"benchmark-hidden-score-receipt.v1",
  "pack_id":inp["pack_id"],
  "input_pack_sha256":validation["input_pack_sha256"],
  "gold_pack_sha256":sha256_file(gold_path),
  "gold_commitment_sha256":sha256_file(commitment_path),
  "prediction_pack_sha256":sha256_file(pred_path),
  "source":{
   "kind":src["kind"],
   "producer_id":src["producer_id"],
   "generation_system":src["generation_system"],
   "declared_independent_of_flythink_generator":src["independent_of_flythink_generator"],
   "license":src.get("license"),
   "upstream_revision":src.get("upstream_revision")
  },
  "metrics":{
   "cases":n,
   "decision_exact":decision/n,
   "patch_exact":patch/n,
   "full_exact":full/n
  },
  "claim_scope":{
   "blind_input_gold_separation_verified":True,
   "gold_content_matches_commitment_verified":True,
   "commitment_pre_prediction_publication_externally_verified":False,
   "source_independence_externally_verified":False,
   "external_generalization_claim_eligible":False,
   "reason":"protocol verifies byte binding and gold-content commitment, but not external publication timing or producer independence; both require separately governed provenance"
  },
  "rows":rows
 }

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--input",required=True);ap.add_argument("--gold",required=True);ap.add_argument("--commitment",required=True);ap.add_argument("--predictions",required=True);ap.add_argument("--out",required=True)
 a=ap.parse_args();r=score(a.input,a.gold,a.predictions,a.commitment)
 pathlib.Path(a.out).write_text(json.dumps(r,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 print(json.dumps({"pack_id":r["pack_id"],"metrics":r["metrics"],"claim_scope":r["claim_scope"]},ensure_ascii=False))

if __name__=="__main__":main()

