#!/usr/bin/env python3
"""Evaluate a frozen checkpoint on an explicitly named external suite."""
import argparse,json
from pathlib import Path
import torch
from train_flywire_delta import DeltaNet,pack,predict,resolve,metrics,decode,delta_exact_rows,GRAPH_SHA
from train_flywire import EXPECTED_SHA256

def load_suite(name):
 if name=='v3':
  from dialogue_delta_blind_v3 import blind_v3
  return blind_v3()
 if name=='v4':
  from dialogue_delta_blind_v4 import blind_v4
  return blind_v4()
 if name=='v5':
  from dialogue_delta_blind_v5 import blind_v5
  return blind_v5()
 raise ValueError(name)

def main():
 p=argparse.ArgumentParser();p.add_argument('--suite',required=True,choices=['v3','v4','v5']);p.add_argument('--checkpoint',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--truth',required=True);a=p.parse_args()
 graph=json.loads(Path('artifacts/flywire/connectome.json').read_text());checkpoint=torch.load(a.checkpoint,map_location='cpu',weights_only=True)
 assert checkpoint['graph_sha256']==GRAPH_SHA and checkpoint['source_sha256']==EXPECTED_SHA256
 model=DeltaNet(graph,checkpoint['mode']);model.load_state_dict(checkpoint['state_dict']);model.eval();x,y,examples=pack(load_suite(a.suite))
 with torch.no_grad():pred=resolve(predict(model(x)),examples)
 exact=delta_exact_rows(pred,y)
 out={'truth':a.truth,'suite':a.suite,'checkpoint':str(a.checkpoint),'metrics':metrics(pred,y,examples),
      'trace':[{'text':e[2]['text'],'predicted':decode(pred[i]),'expected':decode(y[i]),'exact':bool(exact[i])} for i,e in enumerate(examples)]}
 a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(out,ensure_ascii=False,indent=2));print(json.dumps(out['metrics'],ensure_ascii=False,indent=2))

if __name__=='__main__':main()
