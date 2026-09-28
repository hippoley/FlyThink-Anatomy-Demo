#!/usr/bin/env python3
from semantic_patch_materializer import materialize
assert materialize({"op":"PATCH_SLOT","cardinality":"ONE","direction":"ZERO","has_value":True},"调到23度")["value"]==23
assert materialize({"op":"PATCH_RELATIVE","cardinality":"ONE","direction":"NEG","has_value":False},"低一点")["delta"]==-1
p=materialize({"op":"CLOSE_DEVICE","cardinality":"ONE","direction":"ZERO","has_value":False},"关掉它")
assert "target" not in p and "slot" not in p
print({"ok":True,"neural_target_guess":False,"neural_slot_guess":False})
