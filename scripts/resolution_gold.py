#!/usr/bin/env python3
"""Resolution gold: explicit annotation first; legacy inference only for observed V1."""
def target_from_device_key(k):
    a, e, i = k.split("::", 2)
    return {"area": a, "entity": e, "instance": i}

def gold_resolution(row):
    explicit = row.get("gold_resolution")
    if explicit is not None:
        return {
            "targets": list(explicit.get("targets", [])),
            "slot": explicit.get("slot", "NONE"),
            "applicable": bool(explicit.get("applicable", False)),
        }
    if row.get("gold_decision", "EXECUTE") != "EXECUTE":
        return {"targets": [], "slot": "NONE", "applicable": False}
    sem = row.get("gold_semantic", {})
    ctx = row.get("context", {})
    if sem.get("cardinality") == "SET" and ctx.get("referent_set"):
        return {"targets": ctx["referent_set"], "slot": sem.get("slot", "NONE"), "applicable": True}
    seen, slot = [], "NONE"
    for d, s, _ in row.get("gold_delta", []):
        t = target_from_device_key(d)
        if t not in seen:
            seen.append(t)
        if slot == "NONE":
            slot = s
    return {"targets": seen, "slot": slot, "applicable": bool(seen)}
