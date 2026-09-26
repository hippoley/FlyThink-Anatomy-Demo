#!/usr/bin/env python3
"""Ground a semantic Whole-Home Patch against the immutable 46-model registry.

Neural code proposes room/entity/semantic-slot/value. This layer resolves that
proposal to real capabilities and refuses ambiguity or missing writable schema.
It never invents a capability.
"""
import argparse, json, subprocess
from pathlib import Path

ALIASES={
 "power":["power","switch","onoff","status","state"],
 "temperature":["temperature","temp","target_temperature","set_temperature"],
 "mode":["mode","work_mode","operation_mode"],
 "opening":["opening","position","percent","percentage","open_percent"],
}

def load_index(path=Path("_site/capability-index.json")):
    if not path.exists():
        subprocess.run(["python","scripts/build_capability_index.py"],check=True)
    data=json.loads(path.read_text(encoding="utf-8"))
    assert data["truth"]=="compiled_from_all_46_fixed_user_uploaded_thing_models"
    return data,[dict(zip(data["columns"],row)) for row in data["rows"]]

def score(slot,cap):
    terms=[slot,*ALIASES.get(slot,[])]
    hay=" ".join(str(cap.get(k,"")).lower() for k in ("code","title","desc","module","module_title"))
    s=0
    for term in terms:
        t=term.lower()
        if str(cap.get("code","")).lower()==t:s+=20
        if t in hay:s+=3
    if cap.get("kind")=="p":s+=2
    if "write" in (cap.get("ops") or []):s+=4
    return s

def ground_patch(patch,rows):
    if patch.get("op") not in {"ADD_DEVICE","PATCH_SLOT","CLOSE_DEVICE","REPLACE_TARGET"}:
        return {"status":"NOT_REQUIRED","patch":patch}
    slot=patch.get("slot")
    if not slot:
        slots=list((patch.get("slots") or {}).keys())
        if len(slots)==1:slot=slots[0]
    if not slot:return {"status":"AMBIGUOUS","reason":"patch_has_multiple_or_no_semantic_slots","patch":patch}
    candidates=[]
    for cap in rows:
        if cap.get("kind")!="p" or "write" not in (cap.get("ops") or []):continue
        s=score(slot,cap)
        if s>0:candidates.append((s,cap))
    candidates.sort(key=lambda x:(-x[0],x[1]["model"],x[1]["module"],x[1]["code"]))
    if not candidates:return {"status":"BLOCKED","reason":"no_writable_capability","semantic_slot":slot}
    best=candidates[0][0];ties=[c for s,c in candidates if s==best]
    if len(ties)!=1:
        return {"status":"AMBIGUOUS","reason":"capability_not_uniquely_grounded","semantic_slot":slot,
                "candidate_count":len(ties),"candidates":[{"model":c["model"],"module":c["module"],"code":c["code"]} for c in ties[:20]]}
    c=ties[0]
    return {"status":"GROUNDED","semantic_slot":slot,
            "capability":{"model":c["model"],"module":c["module"],"code":c["code"],"kind":c["kind"],"dataType":c["dataType"],"enum":c["enum"],"min":c["min"],"max":c["max"],"unit":c["unit"]},
            "source_truth":"compiled_from_all_46_fixed_user_uploaded_thing_models"}

def main():
    p=argparse.ArgumentParser();p.add_argument("--patch-json");a=p.parse_args()
    _,rows=load_index()
    if a.patch_json:print(json.dumps(ground_patch(json.loads(a.patch_json),rows),ensure_ascii=False,indent=2))
    else:
        report={}
        for slot in ALIASES:report[slot]=ground_patch({"op":"PATCH_SLOT","target":{"area":"test","entity":"test"},"slot":slot,"value":1},rows)
        print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=="__main__":main()
