#!/usr/bin/env python3
"""Cross-split near-duplicate scanner using RapidFuzz.

Exact overlap is already forbidden by the canonical validator. This adds a
surface-similarity check after masking room/entity/value tokens so superficial
substitutions cannot hide template leakage.
"""
import argparse,json,re
from collections import defaultdict
from rapidfuzz import fuzz,process

ROOMS=("客厅","主卧","书房","次卧")
ENTITIES=("空调设备","冷气机","空调机","冷气","照明灯","玻璃窗","窗户","灯光","照明","灯具","窗子","外窗","空调","灯","窗")
NUM=re.compile(r"-?\d+(?:\.\d+)?")

def canonical_surface(text):
 s=re.sub(r"\s+","",str(text)).lower()
 for r in ROOMS:s=s.replace(r,"<ROOM>")
 for e in sorted(ENTITIES,key=len,reverse=True):s=s.replace(e,"<ENTITY>")
 s=NUM.sub("<NUM>",s)
 return s

def collect(data):
 unique=defaultdict(dict)
 for tr in data["trajectories"]:
  for t in tr["turns"]:
   surface=canonical_surface(t["text"])
   if not surface: continue
   k=(t.get("scenario_family"),surface)
   unique[tr["split"]].setdefault(k,{
    "trajectory":tr["id"],"turn_id":t.get("turn_id"),
    "family":t.get("scenario_family"),"text":t["text"],
    "surface":surface
   })
 return {split:list(items.values()) for split,items in unique.items()}

def scan(a,b,threshold):
 hits=[];best=0.0;best_pair=None
 bsurfaces=[x["surface"] for x in b]
 for x in a:
  for match,score,idx in process.extract(x["surface"],bsurfaces,scorer=fuzz.ratio,score_cutoff=threshold,limit=20):
   y=b[idx]
   if score>best:best=score;best_pair=(x,y)
   hits.append({
    "score":score,
    "family_a":x["family"],"family_b":y["family"],
    "text_a":x["text"],"text_b":y["text"],
    "surface_a":x["surface"],"surface_b":y["surface"],
    "turn_a":x["turn_id"],"turn_b":y["turn_id"]
   })
 # Compute actual best even when threshold has no hits.
 if not hits and a and b:
  for x in a:
   m=process.extractOne(x["surface"],bsurfaces,scorer=fuzz.ratio)
   if m and m[1]>best:
    y=b[m[2]];best=m[1];best_pair=(x,y)
 return best,best_pair,hits

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("path")
 ap.add_argument("--threshold",type=float,default=92.0)
 ap.add_argument("--report",default=None)
 a=ap.parse_args()
 d=json.load(open(a.path,encoding="utf8"));by=collect(d)
 pairs=(("train","dev"),("train","sealed"),("dev","sealed"))
 report={"schema_version":"benchmark-v3-fuzzy-leakage-v1","threshold":a.threshold,"pairs":{},"violations":[]}
 for x,y in pairs:
  best,best_pair,hits=scan(by[x],by[y],a.threshold)
  report["pairs"][f"{x}:{y}"]={
   "max_similarity":best,
   "best_pair":None if not best_pair else {
    "text_a":best_pair[0]["text"],"text_b":best_pair[1]["text"],
    "surface_a":best_pair[0]["surface"],"surface_b":best_pair[1]["surface"]
   },
   "violations":len(hits)
  }
  report["violations"].extend({"split_a":x,"split_b":y,**h} for h in hits)
 if a.report:
  open(a.report,"w",encoding="utf8").write(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
 print(json.dumps({k:v for k,v in report.items() if k!="violations"},ensure_ascii=False))
 if report["violations"]:
  print(json.dumps({"examples":report["violations"][:20]},ensure_ascii=False))
  raise SystemExit(2)

if __name__=="__main__":main()
