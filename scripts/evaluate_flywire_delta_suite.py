#!/usr/bin/env python3
"""Evaluate a frozen checkpoint on an explicitly named external suite."""
import argparse,json
from pathlib import Path
import torch
from train_flywire_delta import DeltaNet,pack,predict,resolve,metrics,decode,delta_exact_rows,GRAPH_SHA
from train_flywire import EXPECTED_SHA256,digest
from dialogue_delta_corpus import empty_state,apply
from infer_flywire_delta import tensor_delta,authorized

def rollout(model,rows):
 """Feed predicted committed states back into the next turn, including errors."""
 trace=[];predictions=[];labels=[];examples=[]
 for dialogue in rows:
  state=empty_state()
  for turn in dialogue['turns']:
   actual={**turn,'before':state}
   x,y,e=pack([{'turns':[actual]}])
   with torch.no_grad():p=resolve(predict(model(x)),e)
   d=tensor_delta(p[0],'predicted');ok,reason=authorized(d,turn['text'])
   if ok:state=apply(state,d)
   predictions.append(p);labels.append(y);examples.extend(e)
   trace.append({'dialogue':dialogue['id'],'text':turn['text'],'before':actual['before'],'after':state,'expected_after':turn['after'],'predicted':decode(p[0]),'expected':decode(y[0]),'commit_accepted':ok,'commit_reason':reason,'state_exact':state==turn['after']})
 return {'metrics':metrics(torch.cat(predictions),torch.cat(labels),examples),'state_exact':sum(t['state_exact'] for t in trace)/len(trace),'trace':trace}

def load_suite(name):
 if name=='v6':
  from dialogue_delta_probe_v6 import probe_v6
  return probe_v6()
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
 p=argparse.ArgumentParser();p.add_argument('--suite',required=True,choices=['v3','v4','v5','v6']);p.add_argument('--checkpoint',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--truth',required=True);a=p.parse_args()
 torch.set_num_threads(2)
 graph=json.loads(Path('artifacts/flywire/connectome.json').read_text());checkpoint=torch.load(a.checkpoint,map_location='cpu',weights_only=True)
 assert digest('artifacts/flywire/connectome.json')==GRAPH_SHA
 assert checkpoint['graph_sha256']==GRAPH_SHA and checkpoint['source_sha256']==EXPECTED_SHA256
 model=DeltaNet(graph,checkpoint['mode']);model.load_state_dict(checkpoint['state_dict']);model.eval();x,y,examples=pack(load_suite(a.suite))
 with torch.no_grad():raw=predict(model(x));pred=resolve(raw,examples)
 exact=delta_exact_rows(pred,y)
 raw_exact=delta_exact_rows(raw,y)
 out={'truth':a.truth,'suite':a.suite,'evaluation_mode':'gold_previous_state_plus_separate_autoregressive_rollout','checkpoint':str(a.checkpoint),'checkpoint_sha256':digest(a.checkpoint),'metrics':metrics(pred,y,examples),'raw_model_metrics':metrics(raw,y,examples),'rollout':rollout(model,load_suite(a.suite)),
      'trace':[{'text':e[2]['text'],'before':e[2]['before'],'expected_after':e[2]['after'],'raw_predicted':decode(raw[i]),'raw_exact':bool(raw_exact[i]),'predicted':decode(pred[i]),'expected':decode(y[i]),'exact':bool(exact[i])} for i,e in enumerate(examples)]}
 a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(out,ensure_ascii=False,indent=2));print(json.dumps(out['metrics'],ensure_ascii=False,indent=2))

if __name__=='__main__':main()
