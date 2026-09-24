#!/usr/bin/env python3
"""Restore the FlyWire Delta model and replay a bounded local dialogue."""
import argparse,json,re,time,uuid
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
 p=argparse.ArgumentParser();p.add_argument('turns',nargs='+');p.add_argument('--checkpoint',default='artifacts/flywire-delta-v14/real.pt');p.add_argument('--graph',default='artifacts/flywire/connectome.json');p.add_argument('--telemetry-db',default='telemetry/trajectories.sqlite3');p.add_argument('--no-telemetry',action='store_true');a=p.parse_args()
 torch.set_num_threads(2);g=json.loads(Path(a.graph).read_text());c=torch.load(a.checkpoint,map_location='cpu',weights_only=True)
 assert c['source_sha256']==EXPECTED_SHA256 and c['graph_sha256']==GRAPH_SHA==digest(a.graph)
 model=DeltaNet(g,c['mode']);model.load_state_dict(c['state_dict']);model.eval()
 with torch.no_grad():torch.testing.assert_close(model(c['verification_x']),c['verification_logits'])
 from trajectory_store import TrajectoryStore
 store=None if a.no_telemetry else TrajectoryStore(a.telemetry_db)
 episode=uuid.uuid4().hex;checkpoint_sha=digest(a.checkpoint)
 state=empty_state();pending_ood=[];trace=[]
 reason='input_exhausted'
 try:
  for step,text in enumerate(a.turns,1):
   started=time.time_ns();before=json.loads(json.dumps(state));x=torch.cat([clause_features(text),state_features(before)])[None]
   inference_start=time.time_ns()
   with torch.no_grad():logits=model(x);raw=predict(logits)
   inference_end=time.time_ns();resolved=resolve(raw,[('','',{'before':before})])[0];resolve_end=time.time_ns()
   reference=['none','explicit','focus_coreference','explicit_named'][int(resolved[2])];d=tensor_delta(resolved,reference);ok,reason_gate=authorized(d,text);gate_end=time.time_ns()
   if ok:state=apply(state,d)
   if ok and d['op']=='ood':pending_ood.append({'text':text,'status':'pending_generation'})
   if ok and d['op']=='clear':pending_ood=[]
   ended=time.time_ns();event_id=uuid.uuid4().hex
   if store:
    store.record({'event_id':event_id,'episode_id':episode,'step':step,'observation':{'text':text},
     'state_before':before,'raw_action':decode(raw[0]),'raw_head_indices':raw[0].tolist(),
     'action':decode(resolved),'resolved_delta':d,'state_after':state,
     'provenance':{'runtime':'real_flywire_delta' if c['mode']=='real' else 'flywire_control_delta','model_sha256':checkpoint_sha,'graph_sha256':GRAPH_SHA,'mode':c['mode'],'inference_code_sha256':digest(__file__),'reference_policy':'inherit-entity-preserve-revised-slot-v1'},
     'execution':{'kind':'simulation','accepted':ok,'reason':reason_gate,'pending_ood':list(pending_ood)},
     'policy_logits':logits[0].tolist(),'decoding':'greedy_argmax','behavior_logprob':None,
     'started_ns':started,'ended_ns':ended,'phases':[
      {'name':'prediction','started_ns':inference_start,'ended_ns':inference_end,'input':{'text':text,'state':before},'output':decode(raw[0])},
      {'name':'reference_resolution','started_ns':inference_end,'ended_ns':resolve_end,'input':decode(raw[0]),'output':decode(resolved)},
      {'name':'commit_gate','started_ns':resolve_end,'ended_ns':gate_end,'output':{'accepted':ok,'reason':reason_gate}},
      {'name':'state_commit','started_ns':gate_end,'ended_ns':ended,'output':state}]})
   trace.append({'event_id':event_id,'text':text,'delta':decode(resolved),'reference':reference,'commit':{'accepted':ok,'reason':reason_gate},'state':state,'pending_ood':list(pending_ood)})
 except BaseException:
  reason='runtime_error'
  raise
 finally:
  if store:
   if trace:store.finish(episode,terminated=False,reason=reason)
   store.close()
 print(json.dumps({'truth':'restored_real_flywire_delta_predictions_no_device_execution' if c['mode']=='real' else 'restored_control_topology_predictions_no_device_execution','episode_id':episode,'telemetry_db':None if a.no_telemetry else a.telemetry_db,'checkpoint_restore_verified':True,'trace':trace},ensure_ascii=False,indent=2))

if __name__=='__main__':main()
