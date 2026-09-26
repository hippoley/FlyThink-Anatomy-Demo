import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from train_flywire_whole_home_patch import examples, OPS, ROOMS, ENTITIES, SLOTS

def test_predictor_supervision_is_patch_not_snapshot():
    rows=examples()
    assert rows
    assert all(t[2]["must_preserve_untouched_state"] for t in rows)
    assert "REPLACE_TARGET" in OPS and "CANCEL_PENDING" in OPS and "UNDO_EXECUTED" in OPS
    assert "客厅" in ROOMS and "主卧" in ROOMS
    assert "空调" in ENTITIES and "窗户" in ENTITIES
    assert "temperature" in SLOTS and "*" in SLOTS

def test_additive_also_and_explicit_replace_have_distinct_operation_labels():
    rows=examples()
    by={(r[2]["family"],r[2]["turn"]):r for r in rows}
    add=by[("additive_also",2)][1]
    replace=by[("explicit_replace",2)][1]
    assert OPS[int(add[1])] == "ADD_DEVICE"
    assert OPS[int(replace[1])] == "REPLACE_TARGET"

def test_multi_device_set_keeps_two_patches():
    rows=examples()
    row=next(r for r in rows if r[2]["family"]=="set_operation" and r[2]["turn"]==2)
    assert int(row[1][0]) == 2
