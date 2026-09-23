#!/usr/bin/env python3
"""Restore the FlyWire Delta model and replay a bounded local dialogue."""
import argparse,json,re
from pathlib import Path
import torch
from dialogue_delta_corpus import empty_state,apply,OPS,NONE
from train_flywire import digest,EXPECTED_SHA256
from train_flywire_delta import DeltaNet,clause_features,state_features,predict,resolve,decode,GRAPH_SHA

def tensor_delta(row,reference):
 count=int(row[1]);targets=[];values=[]
 for i in range(count):
  j=3+i*4;r,o,p,v=map(int,row[j:j+4]);targets.append((r*2+o)*2+p if r<3 and o<2 and p<2 else NONE);values.append(v)
 return {'op':OPS[int(row[0])],'count':count,'reference':reference,'targets':targets+[NONE]*(2-count),'values':values+[0]*(2-count)}

def authorized(delta,text):
 if delta['op']=='clear' and not re.search(r'(全部|所有|一切).*(撤回|撤销|取消|清空|清除|清零|作废)|(撤回|撤销|取消|清空|清除).*(全部|所有|一切)',text):return False,'clear_requires_explicit_all'
 if delta['op']=='retract' and not re.search(r'撤|取消|删|不要|不用|作废|没说',text):return False,'retract_requires_explicit_cue'
 return True,None

def main():
 p=argparse.ArgumentParser();p.add_argument('turns',nargs='+');p.add_argument('--checkpoint',default='artifacts/flywire-delta-v14/real.pt');p.add_argument('--graph',default='artifacts/flywire/connectome.json');a=p.parse_args()
 torch.set_num_threads(2);g=json.loads(Path(a.graph).read_text());c=torch.load(a.checkpoint,map_location='cpu',weights_only=True)
 assert c['source_sha256']==EXPECTED_SHA256 and c['graph_sha256']==GRAPH_SHA==digest(a.graph)
 model=DeltaNet(g,c['mode']);model.load_state_dict(c['state_dict']);model.eval()
 with torch.no_grad():torch.testing.assert_close(model(c['verification_x']),c['verification_logits'])
 state=empty_state();pending_ood=[];trace=[]
 for text in a.turns:
  before=json.loads(json.dumps(state));x=torch.cat([clause_features(text),state_features(before)])[None]
  with torch.no_grad():raw=predict(model(x));resolved=resolve(raw,[('','',{'before':before})])[0]
  reference=['none','explicit','focus_coreference','explicit_named'][int(resolved[2])];d=tensor_delta(resolved,reference);ok,reason=authorized(d,text)
  if ok:state=apply(state,d)
  if ok and d['op']=='ood':pending_ood.append({'text':text,'status':'pending_generation'})
  if ok and d['op']=='clear':pending_ood=[]
  trace.append({'text':text,'delta':decode(resolved),'reference':reference,'commit':{'accepted':ok,'reason':reason},'state':state,'pending_ood':list(pending_ood)})
 print(json.dumps({'truth':'restored_real_flywire_delta_predictions_no_device_execution','checkpoint_restore_verified':True,'trace':trace},ensure_ascii=False,indent=2))

if __name__=='__main__':main()
