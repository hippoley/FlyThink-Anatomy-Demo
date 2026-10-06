#!/usr/bin/env python3
import sys
sys.path.insert(0,"scripts")
from three_layer_accuracy import report
rows=[
 {"semantic_ok":True,"resolution_ok":True,"judgement_ok":True,"gold_decision":"EXECUTE","state_exact":True,"untouched_state_violation":False},
 {"semantic_ok":True,"resolution_ok":False,"judgement_ok":True,"gold_decision":"CLARIFY","state_exact":True,"untouched_state_violation":False},
 {"semantic_ok":False,"resolution_ok":False,"judgement_ok":False,"gold_decision":"EXECUTE","state_exact":False,"untouched_state_violation":True,"wrong_device":1},
]
r=report(rows)
assert r["semantic"]=={"accuracy":2/3,"n":3}
assert r["resolution"]=={"accuracy":0.5,"n":2} # CLARIFY row must not poison resolver.
assert r["judgement"]=={"accuracy":2/3,"n":3}
assert r["state_transition"]["accuracy"]==2/3
assert r["state_transition"]["no_drift"]==2/3
assert r["state_transition"]["wrong_device"]==1
print(r)
