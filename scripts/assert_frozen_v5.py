#!/usr/bin/env python3
"""Hard guard for the frozen V5 corpus. Any corpus change must become V6."""
import hashlib,json,sys
from contextual_state_transition_corpus_v5 import build
EXPECTED="57543a97e8ece5555a8937c74f790e0379095d8aa086910357780b1a93a41863"
payload=json.dumps(build(),ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()
actual=hashlib.sha256(payload).hexdigest()
print(json.dumps({"truth":build()["truth"],"expected":EXPECTED,"actual":actual,"match":actual==EXPECTED},ensure_ascii=False))
if actual!=EXPECTED:sys.exit("Frozen V5 corpus changed; create V6 instead.")
