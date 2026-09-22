import copy
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from dialogue_state_corpus import corpus, initial, transition
from intent_state_commit import empty_tree, commit


class StateSupervision(unittest.TestCase):
    def test_neural_omission_cannot_delete_an_existing_intent(self):
        s=empty_tree();s['goals']={'客厅/灯/power':'on','主卧/窗户/power':'on'}
        s['focus']='主卧/窗户/power'
        for op in ['retain','add','ood']:
            after,_=commit(s,{'operation':op,'goals':{'主卧/窗户/power':'on'},'focus':s['focus']},'好的我知道了')
            self.assertEqual(after['goals'],s['goals'])

    def test_unprompted_clear_is_rejected_and_explicit_clear_works(self):
        s=empty_tree();s['goals']={'客厅/灯/power':'on'}
        after,decision=commit(s,{'operation':'clear'},'如果我说全部撤回会怎样')
        self.assertEqual(after,s);self.assertEqual(decision['status'],'clarify')
        after,_=commit(s,{'operation':'clear'},'全部撤回')
        self.assertEqual(after['goals'],{})

    def test_local_retraction_preserves_other_goals_and_ood(self):
        s=empty_tree();s['goals']={'客厅/灯/power':'on','主卧/窗户/power':'on'}
        s['focus']='主卧/窗户/power';s['ood_pending']=True
        after,_=commit(s,{'operation':'retract'},'刚才那条当我没说')
        self.assertEqual(after['goals'],{'客厅/灯/power':'on'});self.assertTrue(after['ood_pending'])

    def test_unmentioned_slots_and_ood_persist(self):
        s=transition(initial(),'add',[(0,2),(6,1)])
        s=transition(s,'ood'); before=copy.deepcopy(s)
        self.assertEqual(transition(s,'retain'),before)
        after=transition(s,'revise',[(6,2)])
        self.assertEqual(after['values'][0],2); self.assertEqual(after['ood'],1)

    def test_pause_resume_retract_and_clear_have_distinct_scope(self):
        s=transition(initial(),'add',[(0,2),(6,1)])
        paused=transition(s,'pause'); self.assertEqual(paused['values'],s['values'])
        self.assertEqual(paused['paused'][6],1)
        self.assertEqual(transition(paused,'resume'),s)
        cancelled=transition(paused,'retract')
        self.assertEqual(cancelled['values'][0],2); self.assertEqual(cancelled['values'][6],0)
        self.assertEqual(transition(cancelled,'clear'),initial())

    def test_corpus_never_exposes_supervision_as_text(self):
        d=corpus()
        for split, rows in d.items():
            for row in rows:
                for turn in row['turns']:
                    self.assertIsInstance(turn['text'],str)
                    self.assertNotIn('values',turn['text'])
                    for value,paused in zip(turn['state']['values'],turn['state']['paused']):
                        self.assertFalse(value==0 and paused)

    def test_network_state_is_causal(self):
        import torch
        from train_flywire_state import StateNetwork
        torch.set_num_threads(2)
        g=json.loads(Path('artifacts/flywire/connectome.json').read_text())
        m=StateNetwork(g); x=torch.randn(2,4,256)
        a=m(x); changed=x.clone(); changed[:,3]=0
        torch.testing.assert_close(a[:,:3],m(changed)[:,:3])
        a.sum().backward()
        self.assertGreater(float(m.gain.grad.abs().sum()),0)
        self.assertEqual(m.gain.numel(),len(g['edges']))


if __name__=='__main__':
    unittest.main()
