#!/usr/bin/env python3
from judgement_patch_pipeline import decide_and_compose
L={"area":"客厅","entity":"空调"};B={"area":"主卧","entity":"空调"}
sem={"op":"CLOSE_DEVICE","slot":"power"}
assert decide_and_compose({"decision":"CLARIFY"},sem,{"focused_target":L})["patches"]==[]
a=decide_and_compose({"decision":"EXECUTE"},sem,{"focused_target":L})
b=decide_and_compose({"decision":"EXECUTE"},sem,{"focused_target":B})
assert a["patches"][0]["target"]==L and b["patches"][0]["target"]==B
s=decide_and_compose({"decision":"EXECUTE"},{"op":"PATCH_SLOT","slot":"temperature","value":23,"cardinality":"SET2"},{"referent_set":[L,B]})
assert s["patches"][0]["targets"]==[L,B]
print({"ok":True,"judgement_gate":True,"context_conditioning":True})
