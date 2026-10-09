#!/usr/bin/env python3
import argparse,json,sys

def main():
 ap=argparse.ArgumentParser();ap.add_argument("path");a=ap.parse_args()
 x=json.load(open(a.path,encoding="utf8"));b=x["baselines"];d=x["discrimination"]
 assert abs(b["gold_oracle"]["full_patch_exact"]-1)<1e-12
 assert abs(b["gold_oracle"]["state_after_turn_exact"]-1)<1e-12
 assert abs(b["gold_oracle"]["strict_trajectory_rate"]-1)<1e-12
 assert d["gold_margin"]>=0.25,f"weak baselines too close to oracle: {d['gold_margin']}"
 assert d["trivial_baseline_strict_max"]<0.5,"trivial baseline passes too many whole trajectories"
 assert b["clarify_only"]["full_patch_exact"]<0.5,"do-nothing/clarify baseline scores suspiciously high"
 print(json.dumps({"valid":True,"discrimination":d,"clarify_only":b["clarify_only"],"surface_direct":b["surface_direct"],"context_rule":b["context_rule"]}))

if __name__=="__main__":main()
