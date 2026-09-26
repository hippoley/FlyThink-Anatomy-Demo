import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from whole_home_patch_corpus import build

OPS={"ADD_DEVICE","PATCH_SLOT","CLOSE_DEVICE","REMOVE_DEVICE","REPLACE_TARGET","CANCEL_PENDING","UNDO_EXECUTED","PROTECT"}

def turns():
    return [t for e in build()["episodes"] for t in e["turns"]]

def test_predictor_supervision_is_patch_not_snapshot():
    rows=turns()
    assert rows and all(t["must_preserve_untouched_state"] for t in rows)
    seen={p["op"] for t in rows for p in t["gold_patches"]}
    assert OPS <= seen

def test_additive_also_and_explicit_replace_have_distinct_operation_labels():
    by={(r["family"],r["turn"]):r for r in turns()}
    assert by[("additive_also",2)]["gold_patches"][0]["op"]=="ADD_DEVICE"
    assert by[("explicit_replace",2)]["gold_patches"][0]["op"]=="REPLACE_TARGET"

def test_multi_device_set_keeps_two_patches_and_referent_set():
    row=next(r for r in turns() if r["family"]=="set_operation" and r["turn"]==2)
    assert len(row["gold_patches"])==2
    assert len(row["lifecycle"]["referent_set"])==2

def test_lifecycle_context_distinguishes_cancel_from_undo():
    by={(r["family"],r["turn"]):r for r in turns()}
    assert by[("cancel_pending",2)]["lifecycle"]["pending_ids"]
    assert not by[("cancel_pending",2)]["lifecycle"]["executed_ids"]
    assert by[("undo_executed",2)]["lifecycle"]["executed_ids"]
