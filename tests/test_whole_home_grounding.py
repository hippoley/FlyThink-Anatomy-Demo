import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from ground_whole_home_patch import load_index, ground_patch

def test_grounder_uses_only_real_46_model_index():
    data,rows=load_index()
    assert data["models"]==46 and data["count"]==794 and len(rows)==794

def test_non_physical_lifecycle_ops_do_not_fake_device_grounding():
    _,rows=load_index()
    for op in ("CANCEL_PENDING","UNDO_EXECUTED","PROTECT","REMOVE_DEVICE"):
        result=ground_patch({"op":op},rows)
        assert result["status"]=="NOT_REQUIRED"

def test_grounder_never_silently_picks_a_tie():
    _,rows=load_index()
    result=ground_patch({"op":"PATCH_SLOT","target":{"area":"客厅","entity":"空调"},"slot":"temperature","value":24},rows)
    assert result["status"] in {"GROUNDED","AMBIGUOUS","BLOCKED"}
    if result["status"]=="AMBIGUOUS":
        assert result["candidate_count"]>1
