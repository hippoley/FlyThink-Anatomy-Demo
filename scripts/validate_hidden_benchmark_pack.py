#!/usr/bin/env python3
import argparse,hashlib,json,pathlib,re,sys

SHA_RE=re.compile(r"^[0-9a-f]{64}$")
INPUT_VER="benchmark-hidden-input-pack.v1"
GOLD_VER="benchmark-hidden-gold-pack.v1"
PRED_VER="benchmark-hidden-prediction-pack.v1"

def sha256_file(path):
 h=hashlib.sha256()
 with open(path,"rb") as f:
  for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
 return h.hexdigest()

def unique_ids(rows,label):
 ids=[x.get("case_id") for x in rows]
 if any(not isinstance(x,str) or not x for x in ids):raise ValueError(label+"_case_id_invalid")
 if len(ids)!=len(set(ids)):raise ValueError(label+"_case_id_duplicate")
 return ids

def validate_input(x):
 if x.get("schema_version")!=INPUT_VER:raise ValueError("input_schema_version")
 if not x.get("pack_id"):raise ValueError("input_pack_id")
 if not x.get("language"):raise ValueError("input_language")
 src=x.get("source") or {}
 if src.get("kind") not in {"human","independent_generator","external_dataset","fixture"}:raise ValueError("input_source_kind")
 if not src.get("producer_id") or not src.get("generation_system"):raise ValueError("input_source_identity")
 if not isinstance(src.get("independent_of_flythink_generator"),bool):raise ValueError("input_source_independence_flag")
 rows=x.get("cases")
 if not isinstance(rows,list) or not rows:raise ValueError("input_cases")
 unique_ids(rows,"input")
 for row in rows:
  if not isinstance(row.get("text"),str) or not row["text"].strip():raise ValueError("input_text")
  if not isinstance(row.get("initial_runtime"),dict):raise ValueError("input_initial_runtime")
  if not isinstance(row.get("context_seed"),dict):raise ValueError("input_context_seed")
 return True

def validate_gold(x):
 if x.get("schema_version")!=GOLD_VER:raise ValueError("gold_schema_version")
 if not x.get("pack_id"):raise ValueError("gold_pack_id")
 if not SHA_RE.fullmatch(str(x.get("input_pack_sha256",""))):raise ValueError("gold_input_sha")
 rows=x.get("gold")
 if not isinstance(rows,list) or not rows:raise ValueError("gold_rows")
 unique_ids(rows,"gold")
 for row in rows:
  if row.get("decision") not in {"EXECUTE","CLARIFY","BLOCK","INVALID","CANCEL_PENDING","UNDO_EXECUTED"}:
   raise ValueError("gold_decision")
  if not isinstance(row.get("patches"),list):raise ValueError("gold_patches")
 return True

def validate_prediction(x):
 if x.get("schema_version")!=PRED_VER:raise ValueError("prediction_schema_version")
 if not x.get("pack_id"):raise ValueError("prediction_pack_id")
 if not SHA_RE.fullmatch(str(x.get("input_pack_sha256",""))):raise ValueError("prediction_input_sha")
 if not isinstance(x.get("producer"),dict):raise ValueError("prediction_producer")
 rows=x.get("predictions")
 if not isinstance(rows,list) or not rows:raise ValueError("prediction_rows")
 unique_ids(rows,"prediction")
 for row in rows:
  if not isinstance(row.get("decision"),str) or not row["decision"]:raise ValueError("prediction_decision")
  if not isinstance(row.get("patches"),list):raise ValueError("prediction_patches")
 return True

def validate_triplet(input_path,gold_path=None,pred_path=None):
 inp=json.load(open(input_path,encoding="utf8"));validate_input(inp)
 input_sha=sha256_file(input_path)
 out={"input_valid":True,"input_pack_sha256":input_sha,"pack_id":inp["pack_id"],"cases":len(inp["cases"])}
 input_ids=unique_ids(inp["cases"],"input")
 if gold_path:
  gold=json.load(open(gold_path,encoding="utf8"));validate_gold(gold)
  if gold["pack_id"]!=inp["pack_id"]:raise ValueError("gold_pack_id_mismatch")
  if gold["input_pack_sha256"]!=input_sha:raise ValueError("gold_input_sha_mismatch")
  if set(unique_ids(gold["gold"],"gold"))!=set(input_ids):raise ValueError("gold_case_set_mismatch")
  out["gold_valid"]=True
 if pred_path:
  pred=json.load(open(pred_path,encoding="utf8"));validate_prediction(pred)
  if pred["pack_id"]!=inp["pack_id"]:raise ValueError("prediction_pack_id_mismatch")
  if pred["input_pack_sha256"]!=input_sha:raise ValueError("prediction_input_sha_mismatch")
  if set(unique_ids(pred["predictions"],"prediction"))!=set(input_ids):raise ValueError("prediction_case_set_mismatch")
  out["prediction_valid"]=True
 return out

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--input",required=True);ap.add_argument("--gold");ap.add_argument("--predictions")
 a=ap.parse_args()
 print(json.dumps(validate_triplet(a.input,a.gold,a.predictions),ensure_ascii=False))

if __name__=="__main__":
 try:main()
 except Exception as e:
  print(json.dumps({"valid":False,"error":str(e)}),file=sys.stderr);raise

