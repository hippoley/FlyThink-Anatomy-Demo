from scripts.build_commitbench_home_v0 import build_state_integrity

def test_before_after_chain():
    src={"manifest":{"truth":"x","sha256":"y","trajectories":1},"trajectories":[{
      "id":"t0",
      "initial_runtime":{"devices":{"客厅::灯::default":{"slots":{"power":"OFF","brightness":50}}}},
      "turns":[
        {"text":"打开客厅灯","gold_op":"ADD_DEVICE",
         "gold_target":{"area":"客厅","entity":"灯","instance":"default"},
         "gold_write_set":["devices.客厅::灯::default.slots.power"],
         "gold_state":{"客厅::灯::default":{"power":"ON","brightness":50}}},
        {"text":"亮度调到80%","gold_op":"PATCH_SLOT",
         "gold_target":{"area":"客厅","entity":"灯","instance":"default"},
         "gold_write_set":["devices.客厅::灯::default.slots.brightness"],
         "gold_state":{"客厅::灯::default":{"power":"ON","brightness":80}}}
      ]
    }]}
    rows=build_state_integrity(src)
    assert rows[0]["before_state"]["客厅::灯::default"]["power"]=="OFF"
    assert rows[1]["before_state"]==rows[0]["gold"]["after_state"]
    assert rows[1]["gold"]["delta"][0]["before"]==50
    assert rows[1]["gold"]["delta"][0]["after"]==80
