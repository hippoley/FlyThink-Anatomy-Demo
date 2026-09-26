#!/usr/bin/env python3
"""Semantic expert routing contract for patch decoding."""
EXPERTS={
 "lifecycle":{"CANCEL_PENDING","UNDO_EXECUTED","REMOVE_DEVICE","PROTECT"},
 "relative":{"PATCH_RELATIVE"},
 "set":{"PATCH_SLOT"},
 "target":{"ADD_DEVICE","CLOSE_DEVICE","REPLACE_TARGET"},
}
def route_expert(op,cardinality="ONE"):
 if op=="PATCH_SLOT" and cardinality!="ONE": return "set"
 for name,ops in EXPERTS.items():
  if op in ops:return name
 raise ValueError("unsupported_patch_operation")
def validate_expert_output(expert,patch):
 op=patch["op"]
 if expert=="set" and not patch.get("targets"):raise ValueError("set_requires_targets")
 if expert=="relative" and "delta" not in patch:raise ValueError("relative_requires_delta")
 if expert=="lifecycle" and op not in EXPERTS["lifecycle"]:raise ValueError("lifecycle_op_mismatch")
 return True
