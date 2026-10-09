#!/usr/bin/env python3
import copy,json,pathlib,subprocess,sys,tempfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
from validate_hidden_benchmark_pack import validate_triplet
from score_hidden_benchmark import score

with tempfile.TemporaryDirectory(prefix="hidden-gold-test-") as td:
 d=pathlib.Path(td)
 subprocess.run([sys.executable,str(ROOT/"scripts/build_hidden_benchmark_fixture.py"),"--dir",str(d)],check=True,cwd=ROOT)
 inp=d/"input.json";gold=d/"gold.json";commitment=d/"commitment.json";pred=d/"predictions.json"
 v=validate_triplet(inp,gold,pred,commitment)
 assert v["input_valid"] and v["gold_valid"] and v["commitment_valid"] and v["prediction_valid"]
 receipt=score(inp,gold,pred,commitment)
 assert receipt["metrics"]=={"cases":2,"decision_exact":1.0,"patch_exact":1.0,"full_exact":1.0}
 assert receipt["claim_scope"]["blind_input_gold_separation_verified"] is True
 assert receipt["claim_scope"]["gold_content_matches_commitment_verified"] is True
 assert receipt["claim_scope"]["commitment_pre_prediction_publication_externally_verified"] is False
 assert receipt["claim_scope"]["source_independence_externally_verified"] is False
 assert receipt["claim_scope"]["external_generalization_claim_eligible"] is False
 assert receipt["source"]["kind"]=="fixture"

 # Mutating visible input after gold creation must invalidate the hidden binding.
 tampered=json.load(open(inp,encoding="utf8"))
 tampered["cases"][0]["text"]="被篡改的输入"
 tp=d/"input-tampered.json";tp.write_text(json.dumps(tampered,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 try:
  validate_triplet(tp,gold,pred,commitment)
  raise AssertionError("tampered input unexpectedly accepted")
 except ValueError as e:
  assert str(e)=="gold_input_sha_mismatch"

 # Missing a case from predictions must fail; no denominator gaming.
 bad=json.load(open(pred,encoding="utf8"));bad["predictions"]=bad["predictions"][:-1]
 bp=d/"pred-missing.json";bp.write_text(json.dumps(bad,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 try:
  validate_triplet(inp,gold,bp,commitment)
  raise AssertionError("missing prediction unexpectedly accepted")
 except ValueError as e:
  assert str(e)=="prediction_case_set_mismatch"

 # Duplicate case IDs must fail independently of case-set equality.
 dup=json.load(open(pred,encoding="utf8"));dup["predictions"][1]["case_id"]=dup["predictions"][0]["case_id"]
 dp=d/"pred-dup.json";dp.write_text(json.dumps(dup,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 try:
  validate_triplet(inp,gold,dp,commitment)
  raise AssertionError("duplicate prediction unexpectedly accepted")
 except ValueError as e:
  assert str(e)=="prediction_case_id_duplicate"

 # Gold mutation after commitment must be rejected even if input binding remains valid.
 changed=json.load(open(gold,encoding="utf8"));changed["gold"][0]["decision"]="CLARIFY";changed["gold"][0]["patches"]=[]
 cg=d/"gold-changed.json";cg.write_text(json.dumps(changed,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 try:
  validate_triplet(inp,cg,pred,commitment)
  raise AssertionError("post-commit gold mutation unexpectedly accepted")
 except ValueError as e:
  assert str(e)=="commitment_gold_sha_mismatch"

 print(json.dumps({"ok":True,"contract":"hidden gold is input-bound, precommitted, case-complete, post-reveal scored, and fixture cannot promote external evidence"}))
