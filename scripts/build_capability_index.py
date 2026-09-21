#!/usr/bin/env python3
import json,re
from pathlib import Path
r=json.loads(Path('_site/real-home-thing-model-registry.json').read_text())
full=r.get('full_models',{})
rows=[]
def add(x): x['capability_id']=f"{x['model_code']}::{x['module_code']}::{x['kind']}::{x['code']}"; rows.append(x)
for m in r.get('model_index',[]):
  mc=m['model_code']; title=m.get('title','')
  fm=full.get(mc)
  if fm:
    for modc,mod in fm.get('modules',{}).items():
      for pc,p in mod.get('properties',{}).items():
        add({'model_code':mc,'product_title':title,'module_code':modc,'module_title':mod.get('title'),'kind':'property','code':pc,'title':p.get('title'),'desc':p.get('desc'),'ops':p.get('op',[]),'dataType':p.get('dataType'),'enum':p.get('enum') or p.get('sceneConstraints',{}).get('enum',[]),'minimum':p.get('minimum'),'maximum':p.get('maximum'),'unit':p.get('unit'),'detail':'full_schema'})
      for sc,s in mod.get('services',{}).items(): add({'model_code':mc,'product_title':title,'module_code':modc,'module_title':mod.get('title'),'kind':'service','code':sc,'title':s.get('title'),'desc':s.get('desc'),'ops':['execute'],'detail':'full_schema'})
      for ec,e in mod.get('events',{}).items(): add({'model_code':mc,'product_title':title,'module_code':modc,'module_title':mod.get('title'),'kind':'event','code':ec,'title':e.get('title'),'desc':e.get('desc'),'ops':['notify'],'detail':'full_schema'})
  else:
    for w in m.get('writable',[]):
      modc,_,pc=w.partition('.')
      add({'model_code':mc,'product_title':title,'module_code':modc,'module_title':None,'kind':'property','code':pc,'title':pc,'desc':None,'ops':['write'],'detail':'summary_schema'})
out={'truth':'compiled_from_46_fixed_user_uploaded_thing_models','source_archive_sha256':r.get('source_archive_sha256'),'model_count':r.get('model_count'),'capability_count':len(rows),'full_schema_models':len(full),'capabilities':rows}
Path('_site/capability-index.json').write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')))
assert out['model_count']==46
print('capability index',len(rows),'models',out['model_count'],'full',len(full))
