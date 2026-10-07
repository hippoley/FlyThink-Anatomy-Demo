#!/usr/bin/env python3
"""Zero-dependency resolver vocabulary shared by neural training and runtime."""
ROOMS=("客厅","主卧","书房","次卧","NONE")
ENTITIES=("空调","灯","窗户","窗帘","NONE")
DECISIONS=("EXECUTE","CLARIFY","BLOCK","NOOP","CANCEL_PENDING","UNDO_EXECUTED")
SLOTS=("power","temperature","brightness","opening","mode","NONE")
TARGETS=tuple(f"{r}::{e}::default" for r in ROOMS[:-1] for e in ENTITIES[:-1])
