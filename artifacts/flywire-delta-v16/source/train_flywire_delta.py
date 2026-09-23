#!/usr/bin/env python3
"""Train direct GraphDelta heads on the verified FlyWire v783 subgraph."""
import argparse,json,hashlib,re,copy
from pathlib import Path
import torch
from dialogue_delta_corpus import corpus,KEYS,VALUES,OPS,NONE
from train_flywire import features,digest,EXPECTED_SHA256

GRAPH_SHA='73d64a3c9d32fc38b98741fb345b34efd3a678db86f3f195e70e296ec4a7d9d2'
TEXT_DIM=512
STATE_DIM=12*5+12+13+2
REFS=['none','explicit','focus_coreference','explicit_named']

ALIASES=(
 ('设为关闭','关闭'),('关上','关闭'),('关掉','关闭'),
 ('设为开启','打开'),('开启','打开'),('开着','打开'),
 ('调整为','设置'),('调整成','设置'),('调整到','设置'),('调到','设置'),('调成','设置'),('开到','设置'),('提高到','设置'),('降到','设置'),('改成','改为'),('设成','设置'),('设为','设置'),
 ('那边的','的'),('里面的','的'),('里的','的'),
 ('并且','同时'),('另外','同时'),('然后','同时'),('；','，同时'),
 ('前面那个','上一项'),('前一个','上一项'),('刚才那个','上一项'),('刚刚那个','上一项'),('前一项','上一项'),
 ('清空之前的全部要求','全部撤回'),('所有任务都取消','全部撤回'),('所有指令全部取消','全部撤回'),
 ('维持原样','保持不变'),('照旧','保持不变'),('别改','保持不变'),('不要变化','保持不变'),('不变','保持不变'),
 ('冻结','暂停'),('搁置','暂停'),('停下','暂停'),
 ('继续被暂停的','恢复暂停的'),('继续被停下的','恢复暂停的'),('回到先前暂停的','恢复暂停的'),('回到暂停的','恢复暂停的'),
 ('一并撤销','全部撤回'),('全部作废','全部撤回'),('全部清零','全部撤回'),
 ('列出','生成'),('列一份','生成'),('规划','生成'),('撰写','生成'),('写一','生成'),('分析一下','生成'),('分析','生成'),('构思','生成'),('设计','生成'),('讲个','生成'),
)

def normalize_aliases(text):
 s=''.join(str(text).split())
 for source,target in ALIASES:s=s.replace(source,target)
 return s

def text_features(text):
 x=torch.zeros(TEXT_DIM);raw=''.join(str(text).split())
 for channel,s in (('raw:',raw),('alias:',normalize_aliases(raw))):
  for n in (1,2,3):
   for i in range(len(s)-n+1):
    token=channel+s[i:i+n];j=int(hashlib.sha256(token.encode()).hexdigest()[:8],16)%TEXT_DIM;x[j]+=1
 return x/x.norm().clamp_min(1)

def clause_features(text):
 s=text
 if s.startswith('一边'):s=s[2:]
 parts=re.split(r'(?:，(?:同时|然后|另外|并且|一边)|；)',s,maxsplit=1)
 if len(parts)==1 and sum(token in s for token in ['客厅','主卧','书房','灯','窗户'])>=4:
  parts=s.split('，',1)
 parts=(parts+[''])[:2]
 return torch.cat([text_features(text),text_features(parts[0]),text_features(parts[1])])

def state_features(s):
 x=torch.zeros(STATE_DIM);offset=0
 for k,v in enumerate(s['values']):x[k*5+v]=1
 offset=60;x[offset:offset+12]=torch.tensor(s['paused']);offset+=12
 x[offset+s['focus']]=1;offset+=13;x[offset+s['ood']]=1
 return x

def pack(rows):
 examples=[]
 for dialogue in rows:
  for turn in dialogue['turns']:
   d=turn['delta']
   def parts(k):return (3,2,2) if k==NONE else (k//4,(k%4)//2,k%2)
   a=parts(d['targets'][0]);b=parts(d['targets'][1])
   y=[OPS.index(d['op']),d['count'],REFS.index(d['reference']),*a,d['values'][0],*b,d['values'][1]]
   examples.append((torch.cat([clause_features(turn['text']),state_features(turn['before'])]),torch.tensor(y),turn))
 return torch.stack([e[0] for e in examples]),torch.stack([e[1] for e in examples]),examples

class DeltaNet(torch.nn.Module):
 def __init__(self,g,mode='real',seed=1783):
  super().__init__();torch.manual_seed(seed);n=len(g['root_ids']);e=torch.tensor(g['edges']);pre=e[:,0].long();post=e[:,1].long()
  if mode=='rewired':
   post=post[torch.randperm(len(post),generator=torch.Generator().manual_seed(seed+1))]
  base=e[:,3].float();den=torch.zeros(n).index_add_(0,post,base.abs())
  self.register_buffer('pre',pre);self.register_buffer('post',post);self.register_buffer('base',.9*base/den[post].clamp_min(1))
  self.gain=torch.nn.Parameter(torch.zeros(len(pre)),requires_grad=mode not in {'frozen','disconnected'})
  self.global_encoder=torch.nn.Linear(TEXT_DIM+STATE_DIM,n)
  self.clause_encoder=torch.nn.Linear(TEXT_DIM+STATE_DIM,n)
  self.operation_reference_readout=torch.nn.Linear(n,8+4)
  self.count_readout=torch.nn.Linear(n*2,3)
  self.target_readout=torch.nn.Linear(n,4+3+3+5)
  self.mode=mode
 def propagate(self,encoded,w,disconnect):
  h=torch.tanh(encoded)
  for _ in range(4):
   rec=torch.zeros_like(h)
   if not disconnect and self.mode!='disconnected':rec.index_add_(1,self.post,h[:,self.pre]*w)
   h=.45*h+.55*torch.tanh(encoded+rec)
  return h
 def forward(self,x,disconnect=False):
  state=x[:,TEXT_DIM*3:]
  global_input=torch.cat([x[:,:TEXT_DIM],state],1)
  clause1_input=torch.cat([x[:,TEXT_DIM:TEXT_DIM*2],state],1)
  clause2_input=torch.cat([x[:,TEXT_DIM*2:TEXT_DIM*3],state],1)
  w=self.base*2*torch.sigmoid(self.gain)
  hg=self.propagate(self.global_encoder(global_input),w,disconnect)
  h1=self.propagate(self.clause_encoder(clause1_input),w,disconnect)
  h2=self.propagate(self.clause_encoder(clause2_input),w,disconnect)
  operation_reference=self.operation_reference_readout(hg)
  count=self.count_readout(torch.cat([hg,h2],1))
  return torch.cat([operation_reference[:,:8],count,operation_reference[:,8:],self.target_readout(h1+.25*hg),self.target_readout(h2+.25*hg)],1)

def heads(z):
 sizes=[8,3,4,4,3,3,5,4,3,3,5];out=[];start=0
 for size in sizes:out.append(z[:,start:start+size]);start+=size
 return out
def objective(z,y,op_weight,count_weight):
 h=heads(z);loss=2*torch.nn.functional.cross_entropy(h[0],y[:,0],weight=op_weight)+torch.nn.functional.cross_entropy(h[1],y[:,1],weight=count_weight)
 loss+=torch.nn.functional.cross_entropy(h[2],y[:,2])
 target=y[:,1]>0
 if target.any():loss+=sum(torch.nn.functional.cross_entropy(h[j][target],y[target,j]) for j in (3,4,5))
 valued=(y[:,0]==OPS.index('add'))|(y[:,0]==OPS.index('revise'))
 if valued.any():loss+=torch.nn.functional.cross_entropy(h[6][valued],y[valued,6])
 second=y[:,1]>1
 if second.any():loss+=sum(torch.nn.functional.cross_entropy(h[j][second],y[second,j]) for j in (7,8,9,10))
 return loss
def predict(z):return torch.stack([p.argmax(1) for p in heads(z)],1)

def resolve(pred,examples):
 pred=pred.clone()
 for i,e in enumerate(examples):
  before=e[2]['before'];ref=int(pred[i,2])
  if ref==REFS.index('focus_coreference') and before['focus']<NONE:
   k=before['focus'];pred[i,3]=k//4;pred[i,4]=(k%4)//2
   if OPS[int(pred[i,0])] not in {'add','revise'}:pred[i,5]=k%2
  elif ref==REFS.index('explicit_named'):
   r,o=int(pred[i,3]),int(pred[i,4])
   if r<3 and o<2:
    active=[k for k,v in enumerate(before['values']) if v and k//4==r and (k%4)//2==o]
    if len(active)==1 and OPS[int(pred[i,0])] not in {'add','revise'}:pred[i,5]=active[0]%2
 return pred

def metrics(pred,gold,examples):
 eq=pred==gold;target_mask=gold[:,1]>0;value_mask=(gold[:,0]==OPS.index('add'))|(gold[:,0]==OPS.index('revise'));second=gold[:,1]>1
 target1=eq[:,3:6].all(1);target2=eq[:,7:10].all(1)
 delta=eq[:,0]&eq[:,1]
 delta &= torch.where(target_mask,target1,torch.ones_like(target1))
 delta &= torch.where(value_mask,eq[:,6],torch.ones_like(eq[:,6]))
 delta &= torch.where(second,target2&eq[:,10],torch.ones_like(target2))
 def mean(mask,values):return float(values[mask].float().mean()) if mask.any() else None
 refs=torch.tensor([e[2]['delta']['reference']=='focus_coreference' for e in examples])
 retract=gold[:,0]==OPS.index('retract');multi=second;ood=gold[:,0]==OPS.index('ood')
 return {'operation_accuracy':float(eq[:,0].float().mean()),'reference_accuracy':float(eq[:,2].float().mean()),'target_accuracy':mean(target_mask,target1),
  'room_accuracy':mean(target_mask,eq[:,3]),'object_accuracy':mean(target_mask,eq[:,4]),'property_accuracy':mean(target_mask,eq[:,5]),
  'value_accuracy':mean(value_mask,eq[:,6]),'delta_exact':float(delta.float().mean()),
  'coreference_target_accuracy':mean(refs,target1),'retraction_delta_exact':mean(retract,delta),
  'multi_intent_exact':mean(multi,delta),'ood_route_accuracy':mean(ood,eq[:,0]),
  'count_accuracy':float(eq[:,1].float().mean()),'examples':len(gold)}

def delta_exact_rows(pred,gold):
 eq=pred==gold;target=gold[:,1]>0;valued=(gold[:,0]==OPS.index('add'))|(gold[:,0]==OPS.index('revise'));second=gold[:,1]>1
 exact=eq[:,0]&eq[:,1]
 exact &= torch.where(target,eq[:,3:6].all(1),torch.ones_like(exact))
 exact &= torch.where(valued,eq[:,6],torch.ones_like(exact))
 exact &= torch.where(second,eq[:,7:10].all(1)&eq[:,10],torch.ones_like(exact))
 return exact

def selection_score(m):
 """Development-only checkpoint selection; blind suites are never consulted."""
 required=[m[k] for k in ('operation_accuracy','reference_accuracy','target_accuracy','room_accuracy','object_accuracy','property_accuracy','value_accuracy','delta_exact','coreference_target_accuracy','retraction_delta_exact','multi_intent_exact','ood_route_accuracy','count_accuracy')]
 return (min(required),m['delta_exact'],m['multi_intent_exact'],sum(required)/len(required))

def decode(row):
 count=int(row[1]);deltas=[]
 for i in range(count):
  j=3+i*4;r,o,p,v=map(int,row[j:j+4]);key=KEYS[(r*2+o)*2+p] if r<3 and o<2 and p<2 else None
  deltas.append({'node':('/'.join(key.split('/')[:2]) if key else None),'slot':(key.split('/')[-1] if key else None),'value':VALUES[v]})
 return {'operation':OPS[int(row[0])],'deltas':deltas}

def main():
 p=argparse.ArgumentParser();p.add_argument('--graph',default='artifacts/flywire/connectome.json');p.add_argument('--epochs',type=int,default=35)
 p.add_argument('--modes',nargs='+',default=['real','frozen','rewired','disconnected']);p.add_argument('--out',type=Path,default=Path('artifacts/flywire-delta'));p.add_argument('--augment',action='store_true');a=p.parse_args()
 torch.set_num_threads(2);g=json.loads(Path(a.graph).read_text());assert g['source_sha256']==EXPECTED_SHA256 and digest(a.graph)==GRAPH_SHA
 data=corpus(augment=a.augment);train,test,sealed=[pack(data[k]) for k in ['train','test','sealed']];a.out.mkdir(parents=True,exist_ok=True)
 op_counts=torch.bincount(train[1][:,0],minlength=len(OPS)).float();count_counts=torch.bincount(train[1][:,1],minlength=3).float()
 op_weight=(op_counts.sum()/op_counts.clamp_min(1));op_weight/=op_weight.mean()
 count_weight=(count_counts.sum()/count_counts.clamp_min(1));count_weight/=count_weight.mean()
 report={'truth':'direct_graph_delta_training_on_verified_real_flywire_subgraph','source_sha256':EXPECTED_SHA256,'graph_sha256':GRAPH_SHA,'neurons':512,'edges':9692,'epochs':a.epochs,'runs':{},'limits':['bounded 3 rooms / 2 object types / 2 properties','OOD routing only; no generation','subgraph rate model; not whole-brain LIF','sealed set fixed before this training run but locally visible and small']}
 report.update({'augmentation':a.augment,'development_used_for_checkpoint_selection':True,'corpus_sha256':hashlib.sha256(json.dumps(data,sort_keys=True,ensure_ascii=False).encode()).hexdigest(),'code_sha256':{str(p):digest(p) for p in (Path(__file__),Path(__file__).with_name('dialogue_delta_corpus.py'))}})
 for mode in a.modes:
  model=DeltaNet(g,mode);opt=torch.optim.Adam(model.parameters(),lr=.005);logs=[];best=None
  for epoch in range(a.epochs):
   order=torch.randperm(len(train[1]));total=0
   for idx in order.split(64):
    opt.zero_grad();loss=objective(model(train[0][idx]),train[1][idx],op_weight,count_weight);loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),1);opt.step();total+=float(loss.detach())*len(idx)
   logs.append(total/len(order))
   with torch.no_grad():
    dev_pred=resolve(predict(model(test[0])),test[2]);dev_metrics=metrics(dev_pred,test[1],test[2]);score=selection_score(dev_metrics)
   if best is None or score>best['score']:
    best={'score':score,'epoch':epoch+1,'metrics':dev_metrics,'state_dict':copy.deepcopy(model.state_dict())}
   print(json.dumps({'mode':mode,'epoch':epoch+1,'loss':logs[-1],'development_delta_exact':dev_metrics['delta_exact'],'development_minimum':score[0]}),flush=True)
  model.load_state_dict(best['state_dict'])
  with torch.no_grad():
   tp=resolve(predict(model(test[0])),test[2]);sp=resolve(predict(model(sealed[0])),sealed[2]);ab=resolve(predict(model(test[0],disconnect=True)),test[2])
   semantic_exact=delta_exact_rows(sp,sealed[1])
   run={'development_templates':metrics(tp,test[1],test[2]),'heldout_templates':metrics(tp,test[1],test[2]),'sealed_v2':metrics(sp,sealed[1],sealed[2]),'disconnect_at_inference':metrics(ab,test[1],test[2]),'selected_epoch':best['epoch'],'selection_score':list(best['score']),'changed_internal_gains':int((model.gain.abs()>1e-7).sum()),'loss':logs,
    'sealed_trace':[{'text':e[2]['text'],'predicted':decode(sp[i]),'expected':decode(sealed[1][i]),'exact':bool(semantic_exact[i])} for i,e in enumerate(sealed[2])]}
   torch.save({'state_dict':model.state_dict(),'mode':mode,'graph_sha256':GRAPH_SHA,'source_sha256':EXPECTED_SHA256,'verification_x':sealed[0],'verification_logits':model(sealed[0])},a.out/f'{mode}.pt')
   restored=DeltaNet(g,mode);c=torch.load(a.out/f'{mode}.pt',weights_only=True);restored.load_state_dict(c['state_dict']);torch.testing.assert_close(restored(c['verification_x']),c['verification_logits']);run['restore_verified']=True;run['checkpoint_sha256']=digest(a.out/f'{mode}.pt')
  report['runs'][mode]=run;(a.out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({'mode':mode,'heldout':run['heldout_templates'],'sealed':run['sealed_v2']},ensure_ascii=False),flush=True)

if __name__=='__main__':main()
