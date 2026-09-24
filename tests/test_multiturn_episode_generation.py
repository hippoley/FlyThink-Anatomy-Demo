import json,subprocess,sys

def test_all_models_expand_to_mode_aware_stateful_episodes(tmp_path):
    manifest=tmp_path/"manifest.json"; episodes=tmp_path/"episodes.json"
    subprocess.run([sys.executable,"scripts/build_physical_world_benchmark.py","--per-model","10","--output",str(manifest)],check=True)
    subprocess.run([sys.executable,"scripts/build_multiturn_episodes.py","--manifest",str(manifest),"--output",str(episodes)],check=True)
    data=json.loads(episodes.read_text(encoding="utf-8"))
    assert data["models"]==46 and data["covered_models"]==46
    assert data["episodes"]==460 and data["turns"]==1840
    assert len({e["model"] for e in data["rows"]})==46
    modes={e["mode"] for e in data["rows"]}
    assert "property_write" in modes
    assert all(e["turns"][-1]["expect"].get("recovery_target") for e in data["rows"])
