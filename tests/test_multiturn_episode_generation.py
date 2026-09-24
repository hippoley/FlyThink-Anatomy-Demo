import json,subprocess,sys
from pathlib import Path

def test_460_probes_expand_to_stateful_episodes(tmp_path):
    manifest=tmp_path/"manifest.json"; episodes=tmp_path/"episodes.json"
    subprocess.run([sys.executable,"scripts/build_physical_world_benchmark.py","--per-model","10","--output",str(manifest)],check=True)
    subprocess.run([sys.executable,"scripts/build_multiturn_episodes.py","--manifest",str(manifest),"--output",str(episodes)],check=True)
    data=json.loads(episodes.read_text(encoding="utf-8"))
    assert data["models"]==46
    assert data["episodes"]==460
    assert data["turns"]==1840
    phases={t["phase"] for e in data["rows"] for t in e["turns"]}
    assert phases=={"underspecified","focus_resolution","negation","trajectory_recovery"}
    assert all(e["turns"][-1]["expect"].get("recovery_target") for e in data["rows"])
