#!/usr/bin/env python3
from context_target_resolver import resolve_targets
from context_patch_composer import compose
L={"area":"客厅","entity":"空调"};B={"area":"主卧","entity":"空调"};W={"area":"客厅","entity":"窗户"}
p={"op":"CLOSE_DEVICE","slot":"power"}
assert resolve_targets("关掉它",p,{"focused_target":L})["targets"]==[L]
assert resolve_targets("关掉它",p,{"focused_target":B})["targets"]==[B]
assert resolve_targets("关掉它",p,{"focused_target":W})["targets"]==[W]
s={"op":"PATCH_SLOT","slot":"temperature","value":23,"cardinality":"SET2"}
r=compose(s,{"referent_set":[L,B]});assert r["decision"]=="EXECUTE" and r["patches"][0]["targets"]==[L,B]
assert compose(p,{})["decision"]=="CLARIFY"
explicit={"op":"CLOSE_DEVICE","slot":"power","target":B}
assert compose(explicit,{"focused_target":L})["patches"][0]["target"]==B
print({"ok":True,"same_surface_context_targets":3,"set_membership":2,"explicit_precedence":True})
