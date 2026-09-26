import unittest
from scripts.bind_relative_patch import bind_relative

AC={"area":"客厅","entity":"空调","instance":"default"}
WIN={"area":"客厅","entity":"窗户","instance":"default"}

class RelativeBindingTest(unittest.TestCase):
 def test_explicit_opening_cue_wins(self):
  p=bind_relative("开度收一点",{"op":"PATCH_RELATIVE","delta":-1},{"focused_target":WIN})
  self.assertEqual(p["target"],WIN);self.assertEqual(p["slot"],"opening")
 def test_focus_infers_unique_continuous_slot(self):
  p=bind_relative("这个再降一点",{"op":"PATCH_RELATIVE","delta":-1},{"focused_target":AC})
  self.assertEqual(p["slot"],"temperature")
 def test_no_focus_blocks_execution(self):
  with self.assertRaisesRegex(ValueError,"relative_target_requires_clarification"):
   bind_relative("再低一点",{"op":"PATCH_RELATIVE","delta":-1},{})
 def test_non_relative_unchanged(self):
  p={"op":"PATCH_SLOT","slot":"temperature","value":23}
  self.assertEqual(bind_relative("23度",p,{}),p)
if __name__=="__main__":unittest.main()
