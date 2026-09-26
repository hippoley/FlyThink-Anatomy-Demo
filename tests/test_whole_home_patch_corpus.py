import json, subprocess, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from whole_home_patch_corpus import build

OPS={"ADD_DEVICE","PATCH_SLOT","CLOSE_DEVICE","REMOVE_DEVICE","REPLACE_TARGET","CANCEL_PENDING","UNDO_EXECUTED","PROTECT"}

def test_frozen_suite_covers_distinct_whole_home_semantics():
    data=build()
    assert data["families"] >= 10
    assert data["hard_invariant"] == "untouched_state_preservation_100_percent"
    seen={p["op"] for e in data["episodes"] for t in e["turns"] for p in t["gold_patches"]}
    assert OPS <= seen

def test_additive_also_never_labels_replacement():
    data=build()
    e=next(x for x in data["episodes"] if x["family"]=="additive_also")
    second=e["turns"][1]["gold_patches"]
    assert [x["op"] for x in second] == ["ADD_DEVICE"]
    assert second[0]["target"]["area"] == "主卧"

def test_replacement_requires_explicit_replacement_family():
    data=build()
    replacements=[(e["family"],t["text"]) for e in data["episodes"] for t in e["turns"] if any(p["op"]=="REPLACE_TARGET" for p in t["gold_patches"])]
    assert replacements == [("explicit_replace","不是客厅，是卧室")]

def test_generator_writes_public_evidence(tmp_path):
    out=tmp_path/"acceptance.json"
    subprocess.run([sys.executable,"scripts/whole_home_patch_corpus.py","--output",str(out)],check=True)
    data=json.loads(out.read_text(encoding="utf-8"))
    assert data["semantic_unit"]=="minimal_patch_not_full_state_regeneration"
