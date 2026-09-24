#!/usr/bin/env python3
"""Expand capability probes into deterministic multi-turn Chinese dialogue episodes."""
import argparse,json,subprocess,sys
from pathlib import Path

def ensure_manifest(path):
    if not Path(path).exists():
        subprocess.run([sys.executable,"scripts/build_physical_world_benchmark.py","--per-model","10","--output",path],check=True)

def episode(row):
    c=row["capability_candidates"][0]; label=c.get("title") or c["property"]
    key=[None,None,c["model"],c["module"],c["property"]]
    return {
      "id":row["id"]+"-trajectory",
      "model":row["model"],"source_capability":row["source_capability"],
      "turns":[
        {"utterance":f"把{label}调一下","phase":"underspecified",
         "expect":{"must_clarify":True,"allowed_frame_keys":[key]}},
        {"utterance":f"就是这个{label}","phase":"focus_resolution",
         "expect":{"must_clarify":False,"allowed_frame_keys":[key]}},
        {"utterance":"不对，刚才那个先别动","phase":"negation",
         "expect":{"must_clarify":False,"allowed_frame_keys":[]}},
        {"utterance":f"还是刚才那个{label}，继续","phase":"trajectory_recovery",
         "expect":{"must_clarify":False,"allowed_frame_keys":[key],"recovery_target":key}}
      ]
    }

def main():
    ap=argparse.ArgumentParser();ap.add_argument("--manifest",default="artifacts/physical-world-benchmark.json")
    ap.add_argument("--output",default="artifacts/multiturn-episodes.json");a=ap.parse_args()
    ensure_manifest(a.manifest); data=json.loads(Path(a.manifest).read_text(encoding="utf-8"))
    episodes=[episode(r) for r in data["rows"]]
    out={"truth":data["truth"],"models":data["models"],"episodes":len(episodes),
         "turns":sum(len(e["turns"]) for e in episodes),"rows":episodes}
    p=Path(a.output);p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({k:out[k] for k in ("models","episodes","turns")},ensure_ascii=False))
if __name__=="__main__":main()
