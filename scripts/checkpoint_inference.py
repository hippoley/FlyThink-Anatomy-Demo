#!/usr/bin/env python3
"""Load real FlyWire judgement and semantic checkpoints for inference."""
import json,torch
from pathlib import Path
from train_context_judgement_v3 import Judge,DECISIONS,ctx_features
from train_semantic_patch_v1 import Net,OPS,CARD,DIR
from train_flywire_delta import text_features
from train_flywire_whole_home_patch import context_features
class Inference:
 def __init__(self,graph,judgement_ckpt,semantic_ckpt):
  g=json.loads(Path(graph).read_text())
  j=torch.load(judgement_ckpt,map_location="cpu",weights_only=True);self.judge=Judge(g);self.judge.load_state_dict(j["state_dict"]);self.judge.eval()
  s=torch.load(semantic_ckpt,map_location="cpu",weights_only=True);self.semantic=Net(g);self.semantic.load_state_dict(s["state_dict"]);self.semantic.eval()
 def judgement(self,text,background):
  x=torch.cat([text_features(text),ctx_features(background)]).unsqueeze(0)
  with torch.no_grad():z=self.judge(x);p=torch.softmax(z,1)[0];i=int(p.argmax())
  return {"decision":DECISIONS[i],"confidence":float(p[i])}
 def patch(self,text,context):
  x=torch.cat([text_features(text),context_features({"text":text,**context})]).unsqueeze(0)
  with torch.no_grad():zs=self.semantic(x);ids=[int(z.argmax(1)[0]) for z in zs]
  return {"op":OPS[ids[0]],"cardinality":CARD[ids[1]],"direction":DIR[ids[2]],"has_value":bool(ids[3])}
