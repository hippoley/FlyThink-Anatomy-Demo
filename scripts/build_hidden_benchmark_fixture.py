#!/usr/bin/env python3
"""Build a synthetic fixture ONLY to test the Hidden Gold protocol itself."""
import argparse,datetime,json,pathlib
from validate_hidden_benchmark_pack import sha256_file

def main():
 ap=argparse.ArgumentParser();ap.add_argument("--dir",required=True);a=ap.parse_args()
 out=pathlib.Path(a.dir);out.mkdir(parents=True,exist_ok=True)
 runtime={"devices":{
  "客厅::窗::default":{"key":"客厅::窗::default","area":"客厅","entity":"窗","instance":"default","status":"mounted","slots":{"power":"OFF","opening":0}}
 }}
 inp={
  "schema_version":"benchmark-hidden-input-pack.v1","pack_id":"fixture-hidden-v1","language":"zh-CN",
  "source":{"kind":"fixture","producer_id":"flythink-protocol-test","generation_system":"handwritten protocol fixture",
   "independent_of_flythink_generator":False,"license":None,"upstream_revision":None},
  "cases":[
   {"case_id":"fx-001","text":"客厅窗开度调到40","initial_runtime":runtime,"context_seed":{}},
   {"case_id":"fx-002","text":"那个再调一点","initial_runtime":runtime,"context_seed":{}}
  ]
 }
 ip=out/"input.json";ip.write_text(json.dumps(inp,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 sha=sha256_file(ip)
 gold={"schema_version":"benchmark-hidden-gold-pack.v1","pack_id":inp["pack_id"],"input_pack_sha256":sha,
  "gold":[
   {"case_id":"fx-001","decision":"EXECUTE","patches":[{"op":"PATCH_SLOT","target":{"area":"客厅","entity":"窗","instance":"default"},"slot":"opening","value":40}]},
   {"case_id":"fx-002","decision":"CLARIFY","patches":[]}
  ]}
 gp=out/"gold.json";gp.write_text(json.dumps(gold,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 commitment={
  "schema_version":"benchmark-hidden-gold-commitment.v1",
  "pack_id":inp["pack_id"],
  "input_pack_sha256":sha,
  "gold_pack_sha256":sha256_file(gp),
  "created_at":"2026-10-09T00:00:00Z"
 }
 cp=out/"commitment.json";cp.write_text(json.dumps(commitment,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 pred={"schema_version":"benchmark-hidden-prediction-pack.v1","pack_id":inp["pack_id"],"input_pack_sha256":sha,
  "producer":{"kind":"fixture-oracle","revision":"fixture"},
  "predictions":[
   {"case_id":"fx-001","decision":"EXECUTE","patches":[{"op":"PATCH_SLOT","target":{"area":"客厅","entity":"窗","instance":"default"},"slot":"opening","value":40}]},
   {"case_id":"fx-002","decision":"CLARIFY","patches":[]}
  ]}
 pp=out/"predictions.json";pp.write_text(json.dumps(pred,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 print(json.dumps({"input":str(ip),"input_sha256":sha,"gold":str(gp),"commitment":str(cp),"predictions":str(pp)}))

if __name__=="__main__":main()

