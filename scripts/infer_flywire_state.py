#!/usr/bin/env python3
"""CPU dialogue replay with learned state predictions, never device execution."""
import argparse
import json
from pathlib import Path
import torch
from train_flywire import features, digest, EXPECTED_SHA256
from train_flywire_state import StateNetwork, predictions, decode
from intent_state_commit import empty_tree, commit


def main():
    p=argparse.ArgumentParser()
    p.add_argument('turns', nargs='+', help='Ordered utterances in one dialogue')
    p.add_argument('--checkpoint', default='artifacts/flywire-state/real.pt')
    p.add_argument('--graph', default='artifacts/flywire/connectome.json')
    a=p.parse_args(); torch.set_num_threads(2)
    c=torch.load(a.checkpoint,map_location='cpu',weights_only=True)
    assert c['source_sha256']==EXPECTED_SHA256 and c['graph_sha256']==digest(a.graph)
    g=json.loads(Path(a.graph).read_text()); model=StateNetwork(g,c['mode']); model.load_state_dict(c['state_dict'])
    with torch.no_grad():
        torch.testing.assert_close(model(c['verification_x']),c['verification_logits'])
        x=torch.stack([features(t,torch) for t in a.turns])[None]
        pred=predictions(model(x))[0]
    tree=empty_tree(); turns=[]
    for i,t in enumerate(a.turns):
        proposal=decode(pred[i]); tree,decision=commit(tree,proposal,t)
        turns.append({'text':t,'neural_prediction':proposal,'persistent_tree':tree,'commit':decision})
    print(json.dumps({'truth':'neural_proposals_plus_deterministic_persistence_no_device_execution','mode':c['mode'],
                      'turns':turns},ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
