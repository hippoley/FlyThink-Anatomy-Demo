#!/usr/bin/env python3
import sys
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))

from context_target_resolver import resolve_targets
from context_patch_composer import compose

L={"area":"客厅","entity":"空调"}
B={"area":"主卧","entity":"空调"}
W={"area":"客厅","entity":"窗"}
LAMP={"area":"客厅","entity":"灯"}

REG={
 "客厅::空调::default":{"model_id":"AWGD-ZA01"},
 "主卧::空调::default":{"model_id":"AWGD-ZA01"},
 "书房::空调::default":{"model_id":"AWGD-ZA01"},
 "次卧::空调::default":{"model_id":"AWGD-ZA01"},
 "客厅::灯::default":{"model_id":"LIGHT_GROUP"},
 "主卧::灯::default":{"model_id":"LIGHT_GROUP"},
 "次卧::灯::default":{"model_id":"LIGHT_GROUP"},
 "客厅::窗::default":{"model_id":"CWDS-CA01"},
 "主卧::窗::default":{"model_id":"CWDS-CA01"},
 "书房::窗::default":{"model_id":"CWDS-CA01"},
}

p={"op":"CLOSE_DEVICE","slot":"power"}
assert resolve_targets("关掉它",p,{"focused_target":L})["targets"]==[L]
assert resolve_targets("关掉它",p,{"focused_target":B})["targets"]==[B]
assert resolve_targets("关掉它",p,{"focused_target":W})["targets"]==[W]

s={"op":"PATCH_SLOT","slot":"temperature","value":23,"cardinality":"SET2"}
r=compose(s,{"referent_set":[L,B]})
assert r["decision"]=="EXECUTE" and r["patches"][0]["targets"]==[L,B]

assert compose(p,{})["decision"]=="CLARIFY"

explicit={"op":"CLOSE_DEVICE","slot":"power","target":B}
assert compose(explicit,{"focused_target":L})["patches"][0]["target"]==B

# Current utterance must beat stale referents even when semantic cardinality is wrong.
ctx={"focused_target":LAMP,"referent_set":[LAMP],"device_registry":REG}
r=resolve_targets("客厅空调温度调到23度",s,ctx)
assert r["mode"]=="ONE"
assert r["targets"]==[{"area":"客厅","entity":"空调","instance":"default"}]
assert r["source"]=="explicit_text"

ctx={"focused_target":B,"referent_set":[B],"device_registry":REG}
r=resolve_targets("客厅空调温度调到23度",s,ctx)
assert r["targets"]==[{"area":"客厅","entity":"空调","instance":"default"}]

# Entity aliases are grounded back to the canonical registry entity.
r=resolve_targets(
 "客厅窗户开到20%",
 {"op":"PATCH_SLOT","cardinality":"SET2"},
 {"focused_target":B,"referent_set":[B],"device_registry":REG},
)
assert r["targets"]==[{"area":"客厅","entity":"窗","instance":"default"}]

# Dev/sealed aliases ground to canonical entities.
r=resolve_targets(
 "书房冷气机温度调到23度",
 {"op":"PATCH_SLOT","cardinality":"ONE"},
 {"focused_target":LAMP,"referent_set":[LAMP],"device_registry":REG},
)
assert r["targets"]==[{"area":"书房","entity":"空调","instance":"default"}]

# Explicit correction must resolve the positive target rather than stale/rejected focus.
r=resolve_targets(
 "刚说错了，不要书房，改成次卧冷气机温度27",
 {"op":"PATCH_SLOT","cardinality":"ONE"},
 {"focused_target":{"area":"书房","entity":"空调"},"referent_set":[{"area":"书房","entity":"空调"}],"device_registry":REG},
)
assert r["targets"]==[{"area":"次卧","entity":"空调","instance":"default"}]
assert r["source"]=="explicit_correction_text"

r=resolve_targets(
 "更正一下，目标不是客厅而是主卧照明灯，亮度80",
 {"op":"PATCH_SLOT","cardinality":"ONE"},
 {"focused_target":LAMP,"referent_set":[LAMP],"device_registry":REG},
)
assert r["targets"]==[{"area":"主卧","entity":"灯","instance":"default"}]

# Pronouns/relative follow-ups still use context when no explicit target is named.
r=resolve_targets(
 "再低一点",
 {"op":"PATCH_RELATIVE","cardinality":"ONE"},
 {"focused_target":B,"referent_set":[B],"device_registry":REG},
)
assert r["targets"]==[B]

print({
 "ok":True,
 "same_surface_context_targets":3,
 "set_membership":2,
 "explicit_precedence":True,
 "current_turn_explicit_precedence":True,
})
