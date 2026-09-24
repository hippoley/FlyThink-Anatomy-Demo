import json, subprocess, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from physical_world_metrics import score_episode

def test_generator_covers_all_46_models(tmp_path):
    out=tmp_path/"bench.json"
    subprocess.run([sys.executable,"scripts/build_physical_world_benchmark.py","--per-model","10","--output",str(out)],check=True)
    data=json.loads(out.read_text(encoding="utf-8"))
    assert data["models"]==46
    assert data["cases"]==460
    assert data["covered_models"]==46\n    assert len({x["model"] for x in data["rows"]})==46\n    assert all(x["capability_candidates"][0]["mode"] in {"property_write","property_read","service","event"} for x in data["rows"])
    assert all(len(x["families"])==4 for x in data["rows"])

def test_physical_metrics_detect_unsafe_proposal():
    turns=[{
      "proposal":{"frames":[],"commit_recommendation":"PROPOSE"},
      "expect":{"must_clarify":True}
    }]
    s=score_episode(turns)
    assert s["premature_commit_rate"]==1.0
