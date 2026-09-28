from scripts.evaluate_semantic_write_set import diff_paths, prf, target_satisfied

def test_transient_unauthorized_mutation_is_visible_even_when_final_state_is_correct():
    s0={
      "客厅::灯::default":{"power":"ON"},
      "主卧::灯::default":{"power":"OFF"},
    }
    s1={
      "客厅::灯::default":{"power":"OFF"},
      "主卧::灯::default":{"power":"OFF"},
    }
    s2={
      "客厅::灯::default":{"power":"OFF"},
      "主卧::灯::default":{"power":"ON"},
    }
    s3={
      "客厅::灯::default":{"power":"ON"},
      "主卧::灯::default":{"power":"ON"},
    }
    gold={"devices.主卧::灯::default.slots.power"}
    actual=set()
    for a,b in [(s0,s1),(s1,s2),(s2,s3)]:
        actual |= diff_paths(a,b)
    assert "devices.客厅::灯::default.slots.power" in actual
    p,r,f=prf(actual,gold)
    assert p < 1.0
    assert r == 1.0
    assert s3=={
      "客厅::灯::default":{"power":"ON"},
      "主卧::灯::default":{"power":"ON"},
    }

def test_target_success_does_not_require_whole_state_correctness():
    final={
      "客厅::灯::default":{"power":"OFF"},
      "主卧::灯::default":{"power":"ON"},
    }
    delta=[{
      "path":"devices.主卧::灯::default.slots.power",
      "before":"OFF","after":"ON"
    }]
    assert target_satisfied(final,delta)
