#!/usr/bin/env python3
from __future__ import annotations
import json, math, random
from pathlib import Path
from build_dialogue_capability_slice import build

DIM=2048
EPOCHS=32
SEED=20260922

def fnv1a(s:str)->int:
    h=2166136261
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0xffffffff
    return h

def feats(text:str):
    s=''.join(str(text).split())
    out=set()
    chars=list(s)
    for n in (1,2,3):
        for i in range(len(chars)-n+1):
            out.add(fnv1a(''.join(chars[i:i+n])) % DIM)
    return sorted(out)

def unpack(row):
    src=json.loads(row['source'])
    tgt=json.loads(row['target'])
    frames=tgt.get('frames') or []
    primary=(frames[0].get('intent') if frames else 'None') or 'None'
    context=tgt.get('context_operation') or 'no_change'
    family=row['scenario_type']
    tm=(row.get('metadata') or {}).get('thing_model_fixed','none')
    device='window' if tm=='CWDS-CA01' else ('light' if tm=='DQDZ-Y15R' else 'none')
    return src.get('utterance',''), {
        'family':family,
        'context_operation':context,
        'primary_intent':primary,
        'device':device,
    }

class Perceptron:
    def __init__(self, labels):
        self.labels=sorted(set(labels)); self.li={v:i for i,v in enumerate(self.labels)}
        self.w=[[0.0]*DIM for _ in self.labels]; self.b=[0.0]*len(self.labels)
    def logits(self, idx):
        scale=1/math.sqrt(max(1,len(idx)))
        return [self.b[c]+sum(self.w[c][j] for j in idx)*scale for c in range(len(self.labels))]
    def predict(self, idx):
        z=self.logits(idx); k=max(range(len(z)),key=z.__getitem__); return self.labels[k],z
    def update(self, idx, gold, lr):
        pred,_=self.predict(idx); 
        if pred==gold:return 0
        g=self.li[gold]; p=self.li[pred]; scale=lr/math.sqrt(max(1,len(idx)))
        for j in idx:
            self.w[g][j]+=scale; self.w[p][j]-=scale
        self.b[g]+=lr; self.b[p]-=lr
        return 1
    def export(self):
        sparse=[]
        for row in self.w:
            sparse.append([[i,round(v,6)] for i,v in enumerate(row) if abs(v)>1e-9])
        return {'labels':self.labels,'bias':[round(x,6) for x in self.b],'weights':sparse}

def softmax(z):
    m=max(z); ex=[math.exp(min(30,x-m)) for x in z]; s=sum(ex) or 1
    return [x/s for x in ex]

def evaluate(model, rows, field):
    ok=0; conf=[]; errors=[]
    for row in rows:
        text,y=unpack(row); pred,z=model.predict(feats(text)); prob=softmax(z); c=max(prob)
        ok+=pred==y[field]; conf.append(c)
        if pred!=y[field] and len(errors)<12:errors.append({'text':text,'gold':y[field],'pred':pred,'confidence':round(c,4)})
    return {'accuracy':ok/max(1,len(rows)),'mean_confidence':sum(conf)/max(1,len(conf)),'errors':errors}

def main():
    train=build(seed=17,variants_per_family=120)
    dev=build(seed=29,variants_per_family=35)
    fields=('family','context_operation','primary_intent','device')
    models={}
    rng=random.Random(SEED)
    prepared=[(feats(unpack(r)[0]),unpack(r)[1]) for r in train]
    for field in fields:
        m=Perceptron([y[field] for _,y in prepared])
        best=None
        for ep in range(EPOCHS):
            order=list(range(len(prepared))); rng.shuffle(order)
            mistakes=0
            lr=.8*(1-ep/EPOCHS)+.08
            for i in order:
                idx,y=prepared[i]; mistakes+=m.update(idx,y[field],lr)
            if mistakes==0: break
        models[field]=m
    metrics={f:evaluate(models[f],dev,f) for f in fields}
    family_acc=metrics['family']['accuracy']
    ctx_acc=metrics['context_operation']['accuracy']
    print(json.dumps({k:{'accuracy':round(v['accuracy'],4),'mean_confidence':round(v['mean_confidence'],4)} for k,v in metrics.items()},ensure_ascii=False))
    if family_acc < .80 or ctx_acc < .78:
        raise SystemExit(f'quality gate failed family={family_acc:.3f} context={ctx_acc:.3f}')
    out={
      'truth':'learned_compact_dialogue_decision_model',
      'version':'flythink-browser-decision-v1',
      'feature':{'type':'char_ngram_hash','ngrams':[1,2,3],'dim':DIM,'hash':'fnv1a32','normalize':'sqrt_feature_count'},
      'training':{
        'generator':'dialogue_capability_slice',
        'train_seed':17,'dev_seed':29,
        'train_rows':len(train),'dev_rows':len(dev),
        'families':sorted({r['scenario_type'] for r in train}),
        'epochs_max':EPOCHS,
        'note':'dev uses a distinct generator seed; no dev rows are used for weight updates'
      },
      'heads':{f:models[f].export() for f in fields},
      'metrics':metrics,
    }
    Path('_site').mkdir(exist_ok=True)
    Path('_site/learned-dialogue-model.json').write_text(json.dumps(out,separators=(',',':'),ensure_ascii=False),encoding='utf-8')
    Path('_site/learned-dialogue-metrics.json').write_text(json.dumps(metrics,indent=2,ensure_ascii=False),encoding='utf-8')

if __name__=='__main__':
    main()
