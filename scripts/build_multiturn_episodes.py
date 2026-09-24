#!/usr/bin/env python3
"""Expand real capabilities into mode-aware deterministic Chinese multi-turn episodes."""
import argparse,json,subprocess,sys
from pathlib import Path

def ensure(path):
    if not Path(path).exists(): subprocess.run([sys.executable,"scripts/build_physical_world_benchmark.py","--per-model","10","--output",path],check=True)

def episode(row):
    c=row["capability_candidates"][0]; label=c.get("title") or c["code"]; mode=c["mode"]
    key=[None,None,c["model"],c["module"],c["code"]]
    if mode=="property_write":
        turns=[("把%s调一下"%label,"underspecified",True,[]),("就是这个%s"%label,"focus_resolution",False,[key]),
          ("不对，刚才那个先别动","negation",False,[]),("还是刚才那个%s，继续"%label,"trajectory_recovery",False,[key])]
    elif mode=="property_read":
        turns=[("%s现在是什么状态？"%label,"state_query",False,[key]),("我说刚才那个","reference_resolution",False,[key]),
          ("不是别的设备，就这个","correction",False,[key]),("再确认一下它现在的状态","trajectory_recovery",False,[key])]
    elif mode=="service":
        turns=[("执行一下%s"%label,"service_request",True,[]),("就是这个设备的%s"%label,"service_resolution",False,[key]),
          ("先等等，别执行","negation",False,[]),("继续刚才那个%s"%label,"trajectory_recovery",False,[key])]
    else:
        turns=[("刚才%s触发了吗？"%label,"event_query",False,[key]),("我说这个设备的","reference_resolution",False,[key]),
          ("不是别的事件，就是%s"%label,"correction",False,[key]),("再确认一下刚才那个事件","trajectory_recovery",False,[key])]
    out=[]
    for utter,phase,clarify,keys in turns:
        exp={"must_clarify":clarify,"allowed_frame_keys":keys}
        if phase=="trajectory_recovery": exp["recovery_target"]=key
        out.append({"utterance":utter,"phase":phase,"expect":exp})
    return {"id":row["id"]+"-trajectory","model":row["model"],"mode":mode,
      "source_capability":row["source_capability"],"turns":out}

def main():
    ap=argparse.ArgumentParser();ap.add_argument("--manifest",default="artifacts/physical-world-benchmark.json")
    ap.add_argument("--output",default="artifacts/multiturn-episodes.json");a=ap.parse_args();ensure(a.manifest)
    d=json.loads(Path(a.manifest).read_text(encoding="utf-8")); eps=[episode(r) for r in d["rows"]]
    out={"truth":d["truth"],"models":d["models"],"covered_models":len({e["model"] for e in eps}),
      "episodes":len(eps),"turns":sum(len(e["turns"]) for e in eps),"rows":eps}
    p=Path(a.output);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({k:out[k] for k in ("models","covered_models","episodes","turns")},ensure_ascii=False))
if __name__=="__main__":main()
