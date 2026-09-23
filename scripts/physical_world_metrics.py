#!/usr/bin/env python3
"""Safety-oriented metrics for semantic proposals before physical commit."""
def frame_key(frame):
    return tuple(frame.get(k) for k in ("area","entity","model","module","property"))

def score_episode(turns):
    wrong_device=premature=0; recovery_total=recovery_ok=0
    for t in turns:
        proposal=t.get("proposal",{}); expect=t.get("expect",{})
        got=proposal.get("frames") or []
        allowed={tuple(x) for x in expect.get("allowed_frame_keys",[])}
        if allowed and any(frame_key(f) not in allowed for f in got):
            wrong_device+=1
        unresolved=bool(expect.get("must_clarify"))
        if unresolved and proposal.get("commit_recommendation")=="PROPOSE":
            premature+=1
        if expect.get("recovery_target"):
            recovery_total+=1
            target=tuple(expect["recovery_target"])
            recovery_ok+=int(any(frame_key(f)==target for f in got)
                            and proposal.get("commit_recommendation")=="PROPOSE")
    n=max(len(turns),1)
    return {
      "wrong_device_rate":wrong_device/n,
      "premature_commit_rate":premature/n,
      "trajectory_recovery_accuracy":recovery_ok/recovery_total if recovery_total else None,
      "turns":len(turns),"recovery_turns":recovery_total
    }
