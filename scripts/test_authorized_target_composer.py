#!/usr/bin/env python3
from authorized_target_composer import compose
mounted={"客厅::空调::default","主卧::空调::default","书房::灯::default"}
# Two-room AC set: exact Cartesian composition, no independent target head.
assert compose([9,8,1,0],[7,1,0,0],2,1,mounted)==["客厅::空调::default","主卧::空调::default"]
# Registry intersection is fail-closed: an unmounted high-score target is removed.
assert compose([9,1,0,8],[7,1,0,0],2,1,mounted)==["客厅::空调::default"]
# Cardinality zero means no authorized target.
assert compose([9,8,1,0],[7,1,0,0],0,1,mounted)==[]
print("authorized target composer: PASS")
