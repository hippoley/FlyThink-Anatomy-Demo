#!/usr/bin/env python3
"""Fail-closed planner with deterministic, single-use authorization binding."""
import hashlib
import json
import uuid
import math
from semantic_capability_map import validate_value

def parse_key(key):
    p=key.split("::")
    if len(p)!=3:
        raise ValueError("invalid_target_key")
    return {"area":p[0],"entity":p[1],"instance":p[2]}

def canonical_value(value):
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("non_finite_authorization_value")
        if value == 0:
            return 0
        if value.is_integer():
            if abs(value) > 9007199254740991:
                raise ValueError("unsafe_authorization_number")
            return int(value)
    if isinstance(value, int) and not isinstance(value, bool) and abs(value) > 9007199254740991:
        raise ValueError("unsafe_authorization_number")
    if isinstance(value, list):
        return [canonical_value(v) for v in value]
    if isinstance(value, dict):
        return {k:canonical_value(v) for k,v in value.items()}
    return value

def canonical_patch(p):
    return {
        "capability":p["capability"],
        "model_id":p["model_id"],
        "slot":p["slot"],
        "target":p["target"],
        "value":canonical_value(p["value"]),
    }

def authorization_digest(patches):
    payload=json.dumps(
        [canonical_patch(p) for p in patches],
        ensure_ascii=False,
        sort_keys=True,
        separators=(",",":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()

def plan(registry,target_keys,slot,value,turn_id=None):
    patches=[]
    rejected=[]
    for key in target_keys:
        try:
            binding=registry.resolve(parse_key(key))
        except (KeyError,ValueError) as e:
            rejected.append({"target":key,"reason":str(e)})
            continue
        validation=validate_value(binding.model_id,slot,value)
        if not validation.get("ok"):
            rejected.append({
                "target":key,
                "model_id":binding.model_id,
                "slot":slot,
                "reason":validation["reason"],
            })
            continue
        patches.append({
            "target":key,
            "model_id":binding.model_id,
            "slot":slot,
            "capability":validation["capability"]["codes"][0],
            "value":value,
        })
    if rejected:
        return {
            "ok":False,
            "patches":[],
            "authorization":None,
            "rejected":rejected,
            "reason":"authorized_set_validation_failed",
        }
    authorization={
        "version":1,
        "authorization_id":str(uuid.uuid4()),
        "turn_id":turn_id,
        "patch_digest":authorization_digest(patches),
        "registry_digest":registry.snapshot_digest(),
    }
    return {"ok":True,"patches":patches,"authorization":authorization,"rejected":[]}
