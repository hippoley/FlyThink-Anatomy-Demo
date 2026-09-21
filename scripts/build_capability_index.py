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

parts=[Path('data/capability-index.full.part1.b64'),Path('data/capability-index.full.part2.b64'),Path('data/capability-index.full.part3.b64')]
if all(p.exists() for p in parts):
    try:
        import hashlib
        expected=[
            '171bd000bb52a2ad08d238216ad4834218741d42fe7a02bf3d4fd1f130da2d5f',
            'd49158539bd79cc20a38af7a0277af601cc9c8fbf5e77c07c780393e7e0c06f7',
            'c71ab0d15e2c945cc07073400b68d2e1a9cf0e42eec201ccf5b5f6344e8b76db'
        ]
        chunks=[''.join(p.read_text(encoding='utf-8').split()) for p in parts]
        for i,(chunk,want) in enumerate(zip(chunks,expected),1):
            got=hashlib.sha256(chunk.encode()).hexdigest()
            print('capability payload part',i,'len',len(chunk),'sha256',got,'expected',want)
            assert got==want, f'capability payload part {i} checksum mismatch'
        encoded=''.join(chunks)
        assert len(encoded)==15944
        assert hashlib.sha256(encoded.encode()).hexdigest()=='525b890d69616512dced2651302e90f0164842dabf7f1615d7a688731dd8682b'
        encoded += '=' * (-len(encoded) % 4)
        raw=base64.b64decode(encoded,validate=True)
        data=gzip.decompress(raw)
        out=json.loads(data.decode('utf-8'))
        assert out.get('truth')=='compiled_from_all_46_fixed_user_uploaded_thing_models'
        assert out.get('models')==46
        assert out.get('count')==len(out.get('rows',[]))
        assert out.get('count',0)>=700
        assert len(set(row[0] for row in out.get('rows',[])))>=40
        Path('_site/capability-index.json').write_bytes(data)
        print('full capability index',out['count'],'capabilities from',out['models'],'models','source','3 checksummed parts')
    except Exception as exc:
        raise RuntimeError('invalid full 46-model capability artifact') from exc
else:
    compile_from_registry(reason='full_capability_payload_missing')
