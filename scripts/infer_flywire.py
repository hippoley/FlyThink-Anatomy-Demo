#!/usr/bin/env python3
"""Restore real-connectome checkpoint. Outputs diagnostic family scores only."""
import argparse
import json
import torch
from train_flywire import features, EXPECTED_SHA256


def forward(checkpoint, x, ablate=False):
    w = checkpoint['state_dict']
    drive = torch.nn.functional.linear(x, w['encoder.weight'], w['encoder.bias'])
    h = torch.zeros_like(drive)
    weights = checkpoint['base'] * 2 * torch.sigmoid(w['edge_gain'])
    for _ in range(checkpoint['steps']):
        rec = torch.zeros_like(h)
        if not ablate:
            rec.index_add_(1, checkpoint['post'], h[:, checkpoint['pre']] * weights)
        h = .5 * h + .5 * torch.tanh(drive + rec)
    return torch.nn.functional.linear(h, w['readout.weight'], w['readout.bias'])


def main():
    p = argparse.ArgumentParser()
    p.add_argument('utterance')
    p.add_argument('--history', default='')
    p.add_argument('--checkpoint', default='artifacts/flywire/checkpoint.pt')
    a = p.parse_args()
    torch.set_num_threads(2)
    c = torch.load(a.checkpoint, map_location='cpu', weights_only=True)
    assert c['source_sha256'] == EXPECTED_SHA256
    with torch.no_grad():
        torch.testing.assert_close(forward(c, c['verification_input']), c['verification_logits'])
        text = ('[H]' + a.history + ' ' if a.history else '') + '[U]' + a.utterance
        probs = forward(c, features(text, torch)[None]).softmax(1)[0]
    print(json.dumps({'scope': 'diagnostic_family_scores_not_device_commands',
                      'checkpoint_restore_verified': True,
                      'scores': dict(sorted(zip(c['labels'], probs.tolist()), key=lambda x: -x[1]))}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
