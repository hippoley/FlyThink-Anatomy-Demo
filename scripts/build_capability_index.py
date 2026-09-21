#!/usr/bin/env python3
import base64,gzip,json
from pathlib import Path

def compile_from_registry(reason=None):
    r=json.loads(Path('_site/real-home-thing-model-registry.json').read_text(encoding='utf-8'))
    full=r.get('full_models',{})
    rows=[]
    def add(x):
        x['capability_id']=f"{x['model_code']}::{x['module_code']}::{x['kind']}::{x['code']}"
        rows.append(x)

    for m in r.get('model_index',[]):
        mc=m['model_code']; title=m.get('title',''); fm=full.get(mc)
        if fm:
            for modc,mod in fm.get('modules',{}).items():
                for pc,p in mod.get('properties',{}).items():
                    add({
                        'model_code':mc,'product_title':title,'module_code':modc,'module_title':mod.get('title'),
                        'kind':'property','code':pc,'title':p.get('title'),'desc':p.get('desc'),
                        'ops':p.get('op',[]),'dataType':p.get('dataType'),
                        'enum':p.get('enum') or p.get('sceneConstraints',{}).get('enum',[]),
                        'minimum':p.get('minimum'),'maximum':p.get('maximum'),'unit':p.get('unit'),
                        'detail':'full_schema'
                    })
                for sc,s in mod.get('services',{}).items():
                    add({
                        'model_code':mc,'product_title':title,'module_code':modc,'module_title':mod.get('title'),
                        'kind':'service','code':sc,'title':s.get('title'),'desc':s.get('desc'),
                        'ops':['execute'],'detail':'full_schema'
                    })
                for ec,e in mod.get('events',{}).items():
                    add({
                        'model_code':mc,'product_title':title,'module_code':modc,'module_title':mod.get('title'),
                        'kind':'event','code':ec,'title':e.get('title'),'desc':e.get('desc'),
                        'ops':['notify'],'detail':'full_schema'
                    })
        else:
            for w in m.get('writable',[]):
                modc,_,pc=w.partition('.')
                add({
                    'model_code':mc,'product_title':title,'module_code':modc,'module_title':None,
                    'kind':'property','code':pc,'title':pc,'desc':None,'ops':['write'],
                    'detail':'summary_schema'
                })

    out={
        'truth':'compiled_from_46_fixed_user_uploaded_thing_models_registry_fallback',
        'source_archive_sha256':r.get('source_archive_sha256'),
        'model_count':r.get('model_count'),
        'capability_count':len(rows),
        'full_schema_models':len(full),
        'fallback_reason':reason,
        'capabilities':rows
    }
    assert out['model_count']==46, out['model_count']
    assert out['capability_count']>0
    Path('_site/capability-index.json').write_text(
        json.dumps(out,ensure_ascii=False,separators=(',',':')),encoding='utf-8'
    )
    print('registry fallback capability index',len(rows),'models',out['model_count'],'full',len(full),'reason',reason)

full_payload=Path('data/capability-index.full.b64')
parts=[Path('data/capability-index.full.part1.b64'),Path('data/capability-index.full.part2.b64'),Path('data/capability-index.full.part3.b64')]

def validate_payload(encoded):
    cleaned=''.join(encoded.split())
    padded=cleaned + '=' * (-len(cleaned) % 4)
    raw=base64.b64decode(padded,validate=True)
    data=gzip.decompress(raw)
    out=json.loads(data.decode('utf-8'))
    assert out.get('truth')=='compiled_from_all_46_fixed_user_uploaded_thing_models'
    assert out.get('models')==46
    assert out.get('count')==len(out.get('rows',[]))
    assert out.get('count',0)>=700
    assert len(set(row[0] for row in out.get('rows',[])))>=40
    return cleaned,data,out

sources=[]
if full_payload.exists():
    sources.append(('full',''.join(full_payload.read_text(encoding='utf-8').split())))
if all(p.exists() for p in parts):
    sources.append(('parts',''.join(''.join(p.read_text(encoding='utf-8').split()) for p in parts)))

valid=None
errors=[]
for name,encoded in sources:
    try:
        cleaned,data,out=validate_payload(encoded)
        valid=(name,cleaned,data,out)
        break
    except Exception as exc:
        errors.append((name,repr(exc)))

if valid is None and len(sources)>=2:
    import difflib,itertools
    (name_a,a),(name_b,b)=sources[:2]
    ops=difflib.SequenceMatcher(None,a,b,autojunk=False).get_opcodes()
    diffs=[op for op in ops if op[0]!='equal']
    print('capability payload diff blocks',diffs)
    if len(diffs)<=16:
        blocks=[]
        for tag,i1,i2,j1,j2 in ops:
            if tag=='equal':
                blocks.append([a[i1:i2]])
            else:
                choices=[]
                for v in (a[i1:i2],b[j1:j2]):
                    if v not in choices:
                        choices.append(v)
                blocks.append(choices)
        variable=[i for i,x in enumerate(blocks) if len(x)>1]
        for bits in itertools.product((0,1),repeat=len(variable)):
            candidate=''.join(blocks[i][bits[variable.index(i)]] if i in variable else blocks[i][0] for i in range(len(blocks)))
            try:
                cleaned,data,out=validate_payload(candidate)
                valid=('hybrid:'+''.join(map(str,bits)),cleaned,data,out)
                break
            except Exception:
                pass

if valid is None:
    diagnostics=[]
    for name,encoded in sources:
        d={'source':name,'chars':len(encoded)}
        try:
            cleaned=''.join(encoded.split())
            padded=cleaned + '=' * (-len(cleaned) % 4)
            raw=base64.b64decode(padded,validate=True)
            d['base64']='ok';d['compressed_bytes']=len(raw);d['magic']=raw[:8].hex()
            try:
                data=gzip.decompress(raw)
                d['gzip']='ok';d['json_bytes']=len(data)
                try:
                    out=json.loads(data.decode('utf-8'))
                    d.update({'json':'ok','truth':out.get('truth'),'models':out.get('models'),'count':out.get('count'),'rows':len(out.get('rows',[])),'columns':out.get('columns')})
                except Exception as exc:
                    d['json_error']=repr(exc)
            except Exception as exc:
                d['gzip_error']=repr(exc)
        except Exception as exc:
            d['base64_error']=repr(exc)
        diagnostics.append(d)
    Path('_site/capability-index-debug.json').write_text(json.dumps({'diagnostics':diagnostics,'errors':errors},ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    compile_from_registry(reason='diagnostic_full_payload_invalid')
else:

    source_name,cleaned,data,out=valid
    Path('_site/capability-index.json').write_bytes(data)
    Path('_site/capability-index.repaired.b64').write_text(cleaned,encoding='utf-8')
    Path('_site/capability-index-build-meta.json').write_text(json.dumps({
        'source':source_name,
        'models':out['models'],
        'count':out['count'],
        'truth':out['truth'],
        'input_errors':errors
    },ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print('full capability index',out['count'],'capabilities from',out['models'],'models','source',source_name)
