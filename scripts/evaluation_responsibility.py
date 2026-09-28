#!/usr/bin/env python3
"""Responsibility map: do not optimize one subsystem against another subsystem's labels."""
SEMANTIC_FIELDS=("op","cardinality","direction","has_value")
RESOLUTION_FIELDS=("target","targets","slot")
STATE_FIELDS=("state_exact","no_drift","wrong_device")

FAMILY_OWNER={
 "focus":"resolution",
 "additive":"resolution+semantic",
 "relative":"semantic+resolution",
 "contextual_relative":"semantic+resolution",
 "contextual_slot":"semantic+resolution",
 "slot_absolute":"semantic+resolution",
 "cancel":"judgement",
 "undo":"judgement",
 "set":"semantic+resolution",
 "remove":"semantic+resolution",
 "replace":"semantic+resolution",
 "protect":"semantic+resolution",
}
def owner(family):return FAMILY_OWNER.get(family,"semantic")
