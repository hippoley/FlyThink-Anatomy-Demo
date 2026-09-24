#!/usr/bin/env python3
"""Build 46-model physical-world probes from immutable Thing Model truth."""
import argparse,json,subprocess,sys
from collections import Counter
from pathlib import Path

def load_index():
    p=Path("_site/capability-index.json")
    if not p.exists(): subprocess.run([sys.executable,"scripts/build_capability_index.py"],check=True)
    return json.loads(p.read_text(encoding="utf-8"))

def rows(index):
    return [dict(zip(index["columns"],r)) for r in index["rows"]]

def mode(r):
    ops=r.get("ops") or []
    if r["kind"]=="p": return "property_write" if "write" in ops else "property_read"
    if r["kind"]=="s": return "service"
    if r["kind"]=="e": return "event"
    return "unknown"

def candidate(r):
    m=mode(r)
    return {"model":r["model"],"module":r["module"],"code":r["code"],"property":r["code"] if r["kind"]=="p" else None,
      "kind":r["kind"],"mode":m,"title":r.get("title"),"dataType":r.get("dataType"),
      "enum":r.get("enum"),"min":r.get("min"),"max":r.get("max"),"ops":r.get("ops") or [],
      "writable":m=="property_write"}

def families(m):
    common=[{"name":"explicit_target","risk":"wrong_device"},{"name":"underspecified_reference","risk":"premature_commit"}]
    if m=="property_write":
        return common+[{"name":"correction_after_focus","risk":"trajectory_recovery"},{"name":"negation_or_cancel","risk":"state_tree_loss"}]
    if m=="property_read":
        return common+[{"name":"state_query","risk":"hallucinated_state"},{"name":"cross_room_reference","risk":"wrong_device"}]
    if m=="service":
        return common+[{"name":"service_argument_grounding","risk":"invented_argument"},{"name":"service_confirmation","risk":"premature_commit"}]
    return common+[{"name":"event_attribution","risk":"wrong_event_source"},{"name":"event_temporal_reference","risk":"hallucinated_event"}]

def main():
    ap=argparse.ArgumentParser();ap.add_argument("--per-model",type=int,default=10)
    ap.add_argument("--output",default="artifacts/physical-world-benchmark.json");a=ap.parse_args()
    idx=load_index(); allrows=rows(idx); by={}
    for r in allrows: by.setdefault(r["model"],[]).append(r)
    cases=[]; selected=Counter()
    # Prefer executable writes, then reads, services, events; cycle through every capability class a model actually owns.
    priority={"property_write":0,"property_read":1,"service":2,"event":3,"unknown":4}
    for model in sorted(by):
        pool=sorted(by[model],key=lambda r:(priority[mode(r)],r["module"],r["code"]))
        for i in range(a.per_model):
            r=pool[i%len(pool)]; m=mode(r); selected[m]+=1
            cases.append({"id":f"{model}-probe-{i+1:02d}","model":model,
              "source_capability":f'{model}:{r["module"]}:{r["code"]}',"capability_candidates":[candidate(r)],
              "families":families(m)})
    allm=Counter(mode(r) for r in allrows)
    payload={"truth":idx["truth"],"models":idx["models"],"capabilities":idx["count"],
      "capability_modes":dict(allm),"selected_modes":dict(selected),"cases":len(cases),
      "covered_models":len({x["model"] for x in cases}),"per_model":a.per_model,"rows":cases}
    p=Path(a.output);p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({k:payload[k] for k in ["models","capabilities","capability_modes","selected_modes","cases","covered_models"]},ensure_ascii=False))
if __name__=="__main__":main()
