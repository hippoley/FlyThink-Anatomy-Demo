#!/usr/bin/env python3
"""Property-based tests for Benchmark V3 using Hypothesis."""
import copy,importlib.util,pathlib,random,re

from hypothesis import given,settings,strategies as st

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("benchgen",ROOT/"scripts/generate_long_trajectory_benchmark_v3.py")
g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)

release_ids=st.tuples(
 st.integers(min_value=2026,max_value=2032),
 st.integers(min_value=1,max_value=12)
).map(lambda x:f"{x[0]:04d}-{x[1]:02d}-r2")

@settings(max_examples=60,deadline=None)
@given(release_ids)
def test_release_seed_deterministic(release_id):
 assert g.release_seed(release_id)==g.release_seed(release_id)

@settings(max_examples=60,deadline=None)
@given(release_ids,release_ids)
def test_distinct_release_ids_have_distinct_seed(a,b):
 if a!=b: assert g.release_seed(a)!=g.release_seed(b)

@settings(max_examples=80,deadline=None)
@given(st.integers(min_value=60,max_value=360))
def test_split_partition_is_total_and_balanced(count):
 xs=[g.split_for(i,count) for i in range(count)]
 assert set(xs)=={"train","dev","sealed"}
 assert len(xs)==count
 dev=xs.count("dev");sealed=xs.count("sealed")
 assert abs(dev-sealed)<=1
 assert xs.count("train")>dev

@settings(max_examples=35,deadline=None)
@given(release_ids,st.integers(min_value=60,max_value=90))
def test_generated_gold_write_set_matches_state_delta(release_id,count):
 rng=random.Random(g.release_seed(release_id))
 for i in range(count):
  tr=g.make(i,count,rng,g.semantic_profile(release_id))
  prev={k:copy.deepcopy(v["slots"]) for k,v in tr["initial_runtime"]["devices"].items()}
  for turn in tr["turns"]:
   after={k:{"slots":copy.deepcopy(v)} for k,v in turn["gold_state"].items()}
   before={k:{"slots":copy.deepcopy(v)} for k,v in prev.items()}
   assert sorted(g.changed_paths(before,after))==sorted(turn["gold_write_set"])
   if turn["gold_decision"]!="EXECUTE":
    assert turn["gold_write_set"]==[]
    assert turn["gold_state"]==prev
   prev=copy.deepcopy(turn["gold_state"])

@settings(max_examples=25,deadline=None)
@given(release_ids)
def test_corrected_profiles_do_not_use_add_device_for_existing_power_on(release_id):
 rng=random.Random(g.release_seed(release_id))
 rows=[g.make(i,60,rng,g.semantic_profile(release_id)) for i in range(60)]
 for tr in rows:
  existing=set(tr["initial_runtime"]["devices"])
  for turn in tr["turns"]:
   if turn["gold_decision"]=="EXECUTE" and turn.get("gold_op")=="ADD_DEVICE" and turn.get("gold_target"):
    t=turn["gold_target"];k=f"{t['area']}::{t['entity']}::{t.get('instance','default')}"
    assert k not in existing,("existing device incorrectly labeled ADD_DEVICE",release_id,turn)

if __name__=="__main__":
 for name,value in sorted(globals().items()):
  if name.startswith("test_") and callable(value): value()
 print("benchmark-v3-hypothesis-properties PASS")
