#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json
from pathlib import Path
import numpy as np

SEED=400
DIM=216
KEYS=(
'stack_depth','active_task','paused_task','pending_condition',
'clarification_pending','tool_failed','tool_value_available','world_triggered',
'speaker_authority','focus_owner_authority','authority_conflict','concept_known',
'episodic_available','accumulation_mode','entity_ambiguous')

def seed_for(name:str)->int:
    h=hashlib.blake2b(f'{SEED}:{name}'.encode(),digest_size=8).digest()
    return int.from_bytes(h,'little') & 0xffffffff

rng=np.random.default_rng(SEED)
mask=(rng.random((DIM,DIM))<0.025).astype(np.float32)
wr=rng.normal(0,1,(DIM,DIM)).astype(np.float32)*mask
norm=max(1e-6,float(np.max(np.sum(np.abs(wr),axis=1))))
wr=wr/norm
edges=[]
for i in range(DIM):
    for j in np.nonzero(wr[i])[0]:
        edges.append([int(j),int(i),float(wr[i,j])])

templates={}
for key in KEYS:
    rr=np.random.default_rng(seed_for(key))
    v=np.zeros(DIM,np.float32)
    idx=rr.choice(DIM,size=max(8,DIM//14),replace=False)
    v[idx]=rr.uniform(.65,1.0,len(idx)).astype(np.float32)
    templates[key]=[[int(i),float(v[i])] for i in idx]

rr=np.random.default_rng(seed_for('authority_delta'))
v=np.zeros(DIM,np.float32)
idx=rr.choice(DIM,size=max(8,DIM//12),replace=False)
v[idx]=rr.choice([-1.,1.],len(idx))
authority=[[int(i),float(v[i])] for i in idx]

training=json.loads(Path('data/semantic-training.json').read_text(encoding='utf-8'))
examples=[]
semantic_templates={}
for label,texts in training.get('paraphrases',{}).items():
    for text in texts:
        examples.append({'label':label,'text':text})
    rr=np.random.default_rng(seed_for('semantic:'+label))
    sv=np.zeros(DIM,np.float32)
    sidx=rr.choice(DIM,size=24,replace=False)
    sv[sidx]=rr.uniform(.55,1.0,len(sidx)).astype(np.float32)
    semantic_templates[label]=[[int(i),float(sv[i])] for i in sidx]

# Public corpus lab: deterministic, label-preserving mutations derived only from train seeds.
# These are evaluation/playground cases, never fed back into the semantic training exemplars.
prefixes=['','请','帮我','麻烦','现在','先']
suffixes=['','一下','吧','，完成后告诉我','，执行完确认一下']
swap_pairs=[
    ('关掉','关闭'),('关上','关好'),('打开','开启'),('弄开','打开'),
    ('顶灯','主灯'),('主灯','灯'),('窗户','外窗'),('开窗器','窗户')
]
mutation_cases=[]
case_id=0
for label,texts in training.get('paraphrases',{}).items():
    variants=[]
    seen=set()
    for seed_text in texts:
        bases=[(seed_text,[])]
        for a,b in swap_pairs:
            if a in seed_text:
                bases.append((seed_text.replace(a,b),[f'slot_alias:{a}->{b}']))
        for base,chain in bases:
            for prefix in prefixes:
                for suffix in suffixes:
                    text=(prefix+base+suffix).strip()
                    if text in seen:
                        continue
                    seen.add(text)
                    variants.append((text,chain+([f'prefix:{prefix}'] if prefix else [])+([f'suffix:{suffix}'] if suffix else []),seed_text))
    # Keep the public payload compact and balanced across labels.
    for text,chain,seed_text in variants[:160]:
        case_id+=1
        mutation_cases.append({
            'case_id':f'mut-{case_id:04d}',
            'text':text,
            'expected_label':label,
            'mutation_chain':chain or ['identity'],
            'seed_text':seed_text,
            'truth':'derived_from_train_only_seed_label_preserving'
        })

out={
 'truth':'developmental_fly_inspired_product_runtime_not_measured_flywire',
 'contract':'NeuralDialogueState.v4-compatible',
 'config':{'dim':DIM,'n_pop':18,'units_per_pop':12,'seed':SEED,'decay':.84,'recurrent_gain':.16,'input_gain':.95},
 'keys':list(KEYS),
 'recurrent_edges':edges,
 'templates':templates,
 'authority_delta':authority,
 'semantic_templates':semantic_templates,
 'training':{
   'source':training.get('source'),
   'split':training.get('split'),
   'selection':training.get('selection'),
   'example_count':len(examples),
   'examples':examples,
 },
 'mutation_pool':{
   'truth':'train_derived_public_eval_mutations_not_training',
   'count':len(mutation_cases),
   'cases':mutation_cases,
 }
}
Path('_site/neural-substrate.json').write_text(json.dumps(out,separators=(',',':')),encoding='utf-8')
Path('_site/semantic-training.json').write_text(json.dumps(training,separators=(',',':')),encoding='utf-8')
assert len(mutation_cases)>=300
print('neural dim',DIM,'recurrent edges',len(edges),'training examples',len(examples),'mutation cases',len(mutation_cases))
