#!/usr/bin/env python3
"""Emit canonical V5 corpus digest before first model evaluation."""
import hashlib,json
from contextual_state_transition_corpus_v5 import build
payload=json.dumps(build(),ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()
print(json.dumps({"truth":build()["truth"],"examples":len(build()["examples"]),"sha256":hashlib.sha256(payload).hexdigest()},ensure_ascii=False))
