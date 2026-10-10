#!/usr/bin/env python3
import argparse,pathlib,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
from sklearn_checkpoint_inference import SklearnInference

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--judgement",required=True)
 ap.add_argument("--semantic",required=True)
 a=ap.parse_args()
 inf=SklearnInference(a.judgement,a.semantic)

 j=inf.judgement("客厅空调温度调到22",{
  "focused_target":{"area":"客厅","entity":"空调","instance":"default"},
  "device_keys":["客厅::空调::default"],
  "device_registry":{"客厅::空调::default":{"model_id":"AWGD-ZA01"}}
 })
 assert j["decision"] in {"EXECUTE","CLARIFY","BLOCK","NOOP","CANCEL_PENDING","UNDO_EXECUTED"}
 assert 0.0<=j["confidence"]<=1.0

 p=inf.patch("客厅空调温度调到22",{
  "focused_target":{"area":"客厅","entity":"空调","instance":"default"}
 })
 assert set(p)=={"op","cardinality","direction","has_value"}
 assert isinstance(p["has_value"],bool)
 print({"judgement":j,"semantic":p,"runtime_adapter":"PASS"})

if __name__=="__main__":main()
