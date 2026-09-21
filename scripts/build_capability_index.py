#!/usr/bin/env python3
import base64
import gzip
import hashlib
import json
from collections import Counter
from pathlib import Path

SOURCE_SHA256="3a5e67efd5847d70761076506500d001cbed36b1d19dca60ed286eb72ae5d60c"
PARTS=[
    ("data/capability-index.rarbuilt.part1.b64","9a2fcaa2cad81b82704d1e89f6c244fb8ef56b8738efdc0e3a85eea07d0a7f7e",4000),
    ("data/capability-index.rarbuilt.part2.b64","f7deda9cf6a46e59adb876fff8fc5bb5eae1de1133d688a330e6d4486439ad23",4000),
    ("data/capability-index.rarbuilt.part3.b64","f885f73d28eded8b292204d6f2b2ceead1cef392bd7c6cb9f928dc54a3cea846",4000),
    ("data/capability-index.rarbuilt.part4.b64","31d9c5bb7f50a0716adc5329ef8f8ad7713491fea55c47749045aedad5050fad",3828),
]
COMBINED_SHA256="d7a521a060bbe65dd9b85ad44fc871e3a2411b875d35edb4d126753d5eb07cb7"

chunks=[]
for path,want_sha,want_len in PARTS:
    text=''.join(Path(path).read_text(encoding='utf-8').split())
    assert len(text)==want_len,(path,len(text),want_len)
    got=hashlib.sha256(text.encode()).hexdigest()
    assert got==want_sha,(path,got,want_sha)
    chunks.append(text)

encoded=''.join(chunks)
assert len(encoded)==15828,len(encoded)
assert hashlib.sha256(encoded.encode()).hexdigest()==COMBINED_SHA256

payload=gzip.decompress(base64.b64decode(encoded,validate=True))
out=json.loads(payload.decode('utf-8'))

assert out.get('truth')=='compiled_from_all_46_fixed_user_uploaded_thing_models'
assert out.get('sha')==SOURCE_SHA256
assert out.get('models')==46
assert out.get('count')==794
assert out.get('count')==len(out.get('rows',[]))
assert len(set(row[0] for row in out['rows']))==46

kind_counts=Counter(row[4] for row in out['rows'])
assert kind_counts==Counter({'p':664,'s':55,'e':75}),kind_counts

expected_columns=[
    "model","product","module","module_title","kind","code","title","desc",
    "ops","provider","dataType","enum","min","max","unit"
]
assert out.get('columns')==expected_columns

Path('_site').mkdir(exist_ok=True)
Path('_site/capability-index.json').write_bytes(payload)
Path('_site/capability-index-build-meta.json').write_text(
    json.dumps({
        'truth':'rebuilt_directly_from_immutable_46_model_rar',
        'source_archive_sha256':SOURCE_SHA256,
        'models':46,
        'capabilities':794,
        'properties':664,
        'services':55,
        'events':75,
        'payload_sha256':COMBINED_SHA256
    },ensure_ascii=False,separators=(',',':')),
    encoding='utf-8'
)
print('full capability index: 46 models, 794 capabilities (664 properties, 55 services, 75 events)')
