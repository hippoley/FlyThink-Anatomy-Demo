import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))

from kernel_conformance import coverage_at_precision, run

def row(i,confidence,exact,**kw):
    return {"id":str(i),"confidence":confidence,"exact":exact,**kw}

def test_calibration_selects_largest_real_threshold_group():
    rows=[row(1,.99,True),row(2,.95,True),row(3,.95,True),row(4,.5,False)]
    gate=coverage_at_precision(rows,.99)
    assert gate["coverage"]==.75
    assert gate["precision"]==1.0
    assert abs(gate["threshold"]-.95)<1e-9

def test_equal_confidence_tie_cannot_be_split():
    rows=[row(1,.9,True),row(2,.9,False),row(3,.8,True)]
    gate=coverage_at_precision(rows,.99)
    assert gate["threshold"] is None
    assert gate["coverage"]==0.0

def test_sealed_uses_frozen_calibration_threshold():
    calibration=[row(1,.9,True),row(2,.8,True)]
    sealed=[
        row(3,.95,True,wrong_target=False,untouched_state_corruption=False),
        row(4,.85,False,wrong_target=True,untouched_state_corruption=False),
        row(5,.79,True,wrong_target=False,untouched_state_corruption=True),
    ]
    report=run(calibration,sealed,.99)
    assert report["threshold_source"]=="calibration_only"
    assert report["calibration"]["threshold"]==.8
    assert report["sealed"]["committed"]==2
    assert report["sealed"]["precision"]==.5
    assert report["sealed"]["wrong_target_rate"]==.5
    assert report["sealed"]["untouched_state_corruption_rate"]==0.0
