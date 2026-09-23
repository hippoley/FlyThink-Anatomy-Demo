#!/usr/bin/env python3
"""Build physical-world benchmark cases from the immutable 46-model capability index."""
import argparse, json, subprocess, sys
from pathlib import Path

def load_index():
    target=Path("_site/capability-index.json")
    if not target.exists():
        subprocess.run([sys.executable,"scripts/build_capability_index.py"],check=True)
    return json.loads(target.read_text(encoding="utf-8"))

def rows(index):
    cols=index["columns"]
    return [dict(zip(cols,r)) for r in index["rows"]]

def writable_props(index):
    out=[]
    for r in rows(index):
        if r["kind"]=="p" and "write" in (r.get("ops") or []):
            out.append(r)
    return out

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--per-model",type=int,default=10)
    ap.add_argument("--output",default="artifacts/physical-world-benchmark.json")
    a=ap.parse_args()
    idx=load_index(); props=writable_props(idx)
    by_model={}
    for p in props: by_model.setdefault(p["model"],[]).append(p)
    cases=[]
    for model in sorted(by_model):
        ps=by_model[model]
        for i in range(a.per_model):
            p=ps[i%len(ps)]
            cid=f'{model}:{p["module"]}:{p["code"]}'
            cases.append({
              "id":f"{model}-probe-{i+1:02d}",
              "model":model,
              "source_capability":cid,
              "capability_candidates":[{
                "model":model,"module":p["module"],"property":p["code"],
                "title":p.get("title"),"dataType":p.get("dataType"),
                "enum":p.get("enum"),"min":p.get("min"),"max":p.get("max"),
                "writable":True
              }],
              "families":[
                {"name":"explicit_target","risk":"wrong_device"},
                {"name":"underspecified_reference","risk":"premature_commit"},
                {"name":"correction_after_focus","risk":"trajectory_recovery"},
                {"name":"negation_or_cancel","risk":"state_tree_loss"}
              ]
            })
    payload={
      "truth":idx["truth"],"models":idx["models"],"capabilities":idx["count"],
      "writable_properties":len(props),"cases":len(cases),
      "per_model":a.per_model,"rows":cases
    }
    out=Path(a.output);out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({k:payload[k] for k in ["models","capabilities","writable_properties","cases","per_model"]},ensure_ascii=False))
if __name__=="__main__": main()
