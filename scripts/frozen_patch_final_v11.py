#!/usr/bin/env python3
"""Deterministic unseen compositional final. Never import into training."""
import hashlib,json,random
SEED=20260928
SURFACES={
 "focus":["麻烦把当前这个停掉","眼前这个先关了","正在说的这个关闭"],
 "relative_down":["稍微往回调一些","再收一点点","往低处挪一下"],
 "relative_up":["稍微往上调一些","再放一点点","往高处挪一下"],
 "set":["刚提到的两个一起设成23","那一组两个都改成23","这俩统一23"],
 "add":["另一个房间也来一个","另一间也同样开启","再补一个到卧室"],
}
TARGETS=[{"area":"客厅","entity":"空调"},{"area":"主卧","entity":"空调"},{"area":"客厅","entity":"窗户"}]
def build():
 rng=random.Random(SEED);rows=[]
 for i in range(180):
  fam=["focus","relative","set","additive"][i%4]
  if fam=="focus":
   t=TARGETS[i%3];rows.append({"family":fam,"text":SURFACES["focus"][i%3],"lifecycle":{"focused_target":t},"gold":{"op":"CLOSE_DEVICE","target":t,"slot":"power"}})
  elif fam=="relative":
   t=TARGETS[i%3];slot="opening" if t["entity"]=="窗户" else "temperature";d=-1 if (i//4)%2==0 else 1;k="relative_down" if d<0 else "relative_up"
   rows.append({"family":fam,"text":SURFACES[k][i%3],"lifecycle":{"focused_target":t},"gold":{"op":"PATCH_RELATIVE","target":t,"slot":slot,"delta":d}})
  elif fam=="set":
   ts=TARGETS[:2];rows.append({"family":fam,"text":SURFACES["set"][i%3],"lifecycle":{"referent_set":ts},"gold":{"op":"PATCH_SLOT","targets":ts,"slot":"temperature","value":23}})
  else:
   rows.append({"family":fam,"text":SURFACES["add"][i%3],"lifecycle":{"focused_target":TARGETS[0]},"gold":{"op":"ADD_DEVICE","target":TARGETS[1],"slots":{"power":"ON"}}})
 rng.shuffle(rows)
 manifest=json.dumps(rows,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()
 return {"truth":"frozen_unseen_compositional_final_v11","seed":SEED,"sha256":hashlib.sha256(manifest).hexdigest(),"rows":rows}
if __name__=="__main__":print(json.dumps(build(),ensure_ascii=False))
