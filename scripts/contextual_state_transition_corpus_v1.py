#!/usr/bin/env python3
"""Contextual State Transition Corpus V1: controlled interventions, not paraphrase bags."""
import copy,json
AC_L=("客厅","空调","default");AC_B=("主卧","空调","default");LIGHT=("客厅","灯","default")
def k(x):return "::".join(x)
BASE={k(AC_L):{"power":"ON","temperature":24},k(AC_B):{"power":"OFF","temperature":25},k(LIGHT):{"power":"ON","brightness":70}}
def ex(group,text,before,context,delta):
 after=copy.deepcopy(before);write=[]
 for dev,slot,val in delta:
  after[dev][slot]=val;write.append(f"{dev}.{slot}")
 all_slots={f"{d}.{s}" for d,v in before.items() for s in v}
 return {"contrast_group":group,"text":text,"before_state":before,"context":context,"gold_delta":delta,"after_state":after,"write_set":write,"invariant_set":sorted(all_slots-set(write))}
def build():
 out=[]
 # Same text, target intervention: resolver must follow focus; semantic relation stays invariant.
 for target in [AC_L,AC_B]:
  b=copy.deepcopy(BASE);old=b[k(target)]["temperature"]
  out.append(ex("relative_focus","再低一点",b,{"focused_target":{"area":target[0],"entity":target[1],"instance":target[2]}},[(k(target),"temperature",old-1)]))
 # Additive must preserve prior device.
 b=copy.deepcopy(BASE);out.append(ex("additive_vs_replace","卧室的也打开",b,{"focused_target":{"area":"客厅","entity":"空调","instance":"default"},"add_target":{"area":"主卧","entity":"空调","instance":"default"}},[(k(AC_B),"power","ON")]))
 # Irrelevant-state intervention: changing light must not change AC transition.
 for bright in [20,90]:
  b=copy.deepcopy(BASE);b[k(LIGHT)]["brightness"]=bright
  out.append(ex("irrelevant_invariance","客厅空调调到22度",b,{"focused_target":{"area":"客厅","entity":"空调","instance":"default"}},[(k(AC_L),"temperature",22)]))
 return {"truth":"contextual_state_transition_v1","examples":out}
if __name__=="__main__":print(json.dumps(build(),ensure_ascii=False,indent=2))
