#!/usr/bin/env python3
"""Multi-turn state prediction using a real, trainable FlyWire recurrent graph."""
import argparse
import hashlib
import json
from pathlib import Path
import torch
from dialogue_state_corpus import corpus, KEYS, VALUES, OPS
from train_flywire import EXPECTED_SHA256, features, digest


class StateNetwork(torch.nn.Module):
    def __init__(self, graph, mode='real', seed=783):
        super().__init__()
        torch.manual_seed(seed)
        n = len(graph['root_ids'])
        edges = torch.tensor(graph['edges'])
        pre, post = edges[:, 0].long(), edges[:, 1].long()
        if mode == 'rewired':
            # Endpoint permutation is a control, never labeled biological data.
            generator = torch.Generator().manual_seed(seed + 1)
            post = post[torch.randperm(len(post), generator=generator)]
        base = edges[:, 3].float()
        denom = torch.zeros(n).index_add_(0, post, base.abs())
        self.register_buffer('base', .9*base/denom[post].clamp_min(1))
        self.register_buffer('pre', pre); self.register_buffer('post', post)
        self.gain = torch.nn.Parameter(torch.zeros(len(pre)), requires_grad=mode not in {'frozen', 'disconnected'})
        self.encoder = torch.nn.Linear(256, n)
        self.readout = torch.nn.Linear(n, 12*5+12*2+13+2+len(OPS))
        self.mode = mode

    def forward(self, x, reset_memory=False, disconnect=False):
        n = self.encoder.out_features
        weights = self.base * 2 * torch.sigmoid(self.gain)
        w = torch.zeros(n, n, device=x.device).index_put((self.post, self.pre), weights, accumulate=True)
        h = torch.zeros(x.shape[0], n, device=x.device)
        outputs = []
        for t in range(x.shape[1]):
            if reset_memory:
                h = torch.zeros_like(h)
            drive = self.encoder(x[:, t])
            rec = torch.zeros_like(h) if disconnect or self.mode == 'disconnected' else h @ w.T
            h = .65*h + .35*torch.tanh(drive + rec)
            outputs.append(self.readout(h))
        return torch.stack(outputs, dim=1)


def pack(rows):
    x = torch.stack([torch.stack([features(t['text'], torch) for t in r['turns']]) for r in rows])
    target = torch.tensor([[t['state']['values'] + t['state']['paused'] + [t['state']['focus'], t['state']['ood'], OPS.index(t['operation'])] for t in r['turns']] for r in rows])
    return x, target


def heads(z):
    return [z[..., :60].reshape(*z.shape[:-1], 12, 5), z[...,60:84].reshape(*z.shape[:-1],12,2), z[...,84:97], z[...,97:99], z[...,99:]]


def loss(z, y):
    parts = heads(z)
    targets = [y[...,:12],y[...,12:24],y[...,24],y[...,25],y[...,26]]
    return sum(torch.nn.functional.cross_entropy(p.reshape(-1,p.shape[-1]), t.reshape(-1)) for p,t in zip(parts,targets))


def predictions(z):
    h = heads(z)
    return torch.cat([h[0].argmax(-1), h[1].argmax(-1)] + [p.argmax(-1).unsqueeze(-1) for p in h[2:]], -1)


def scores(pred, gold):
    equal = pred == gold
    result = {'state_exact': float(equal[...,:26].all(-1).float().mean()),
              'goal_grid_exact': float(equal[...,:12].all(-1).float().mean()),
              'dialogue_exact': float(equal.all(-1).all(-1).float().mean()),
              'operation_accuracy': float(equal[...,26].float().mean()),
              'focus_accuracy': float(equal[...,24].float().mean()),
              'ood_memory_accuracy': float(equal[...,25].float().mean())}
    result['per_operation_state_exact'] = {}
    for k, op in enumerate(OPS):
        mask = gold[...,26] == k
        if mask.any():
            result['per_operation_state_exact'][op] = float(equal[...,:26].all(-1)[mask].float().mean())
    active = gold[...,:12] != 0
    result['active_slot_accuracy'] = float(equal[...,:12][active].float().mean()) if active.any() else None
    return result


def decode(row):
    return {'goals': {key: VALUES[int(row[k])] for k,key in enumerate(KEYS) if row[k]},
            'paused': [KEYS[k] for k in range(12) if row[12+k]],
            'focus': KEYS[int(row[24])] if row[24]<12 else None,
            'ood_pending': bool(row[25]), 'operation': OPS[int(row[26])]}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--graph', default='artifacts/flywire/connectome.json')
    p.add_argument('--epochs', type=int, default=40)
    p.add_argument('--modes', nargs='+', choices=['real','frozen','rewired','disconnected'], default=['real','frozen','rewired','disconnected'])
    p.add_argument('--out', type=Path, default=Path('artifacts/flywire-state'))
    a = p.parse_args()
    torch.set_num_threads(2)
    g = json.loads(Path(a.graph).read_text())
    assert g['source_sha256'] == EXPECTED_SHA256
    assert digest(a.graph) == '73d64a3c9d32fc38b98741fb345b34efd3a678db86f3f195e70e296ec4a7d9d2', 'Graph derivative differs from verified data'
    # Compare the derivative to the pinned graph from the already verified run.
    assert len(g['root_ids']) == 512 and len(g['edges']) == 9692
    data = corpus(); train, test, independent = [pack(data[k]) for k in ['train','test','independent']]
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out/'corpus.json').write_text(json.dumps(data, ensure_ascii=False, indent=2))
    report = {'truth':'real_flywire_subgraph_sequential_state_training', 'source_sha256':EXPECTED_SHA256,
              'graph_sha256':digest(a.graph), 'neurons':512, 'edges':9692, 'seed':783, 'epochs':a.epochs,
              'train_dialogues':len(data['train']), 'heldout_template_dialogues':len(data['test']),
              'independent_dialogues':len(data['independent']), 'turns_per_generated_dialogue':8,
              'limitations':['bounded 3 rooms, 2 object types, 2 properties', 'synthetic labels; separate test phrase templates',
                             'OOD pending flag only, no OOD generation', 'no full-brain training or device execution',
                             'readout state is learned prediction, not guaranteed persistent runtime state'], 'runs':{}}
    for mode in a.modes:
        model = StateNetwork(g, mode)
        optim = torch.optim.Adam(model.parameters(), lr=.006)
        logs = []
        for epoch in range(a.epochs):
            order = torch.randperm(len(train[0])); total = 0
            for idx in order.split(32):
                optim.zero_grad(); objective=loss(model(train[0][idx]),train[1][idx])
                objective.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1); optim.step()
                total += float(objective.detach())*len(idx)
            logs.append(total/len(order))
            if (epoch+1)%10 == 0:
                print(json.dumps({'mode':mode,'epoch':epoch+1,'loss':logs[-1]}), flush=True)
        with torch.no_grad():
            test_pred=predictions(model(test[0])); ind_pred=predictions(model(independent[0]))
            result={'heldout':scores(test_pred,test[1]), 'independent':scores(ind_pred,independent[1]),
                    'reset_memory':scores(predictions(model(test[0],reset_memory=True)),test[1]),
                    'disconnect_at_inference':scores(predictions(model(test[0],disconnect=True)),test[1]),
                    'changed_internal_gains':int((model.gain.abs()>1e-7).sum()), 'loss':logs}
            trace=[]
            for i, row in enumerate(data['independent']):
                trace.append({'id':row['id'], 'turns':[{'text':t['text'],'predicted':decode(ind_pred[i,j]),'expected':decode(independent[1][i,j]), 'exact':bool((ind_pred[i,j]==independent[1][i,j]).all())} for j,t in enumerate(row['turns'])]})
            result['independent_trace']=trace
            torch.save({'state_dict':model.state_dict(), 'mode':mode, 'graph_sha256':digest(a.graph),
                        'source_sha256':EXPECTED_SHA256, 'keys':KEYS, 'values':VALUES, 'ops':OPS,
                        'verification_x':independent[0], 'verification_logits':model(independent[0])},a.out/f'{mode}.pt')
            restored=StateNetwork(g,mode)
            checkpoint=torch.load(a.out/f'{mode}.pt',weights_only=True)
            restored.load_state_dict(checkpoint['state_dict'])
            torch.testing.assert_close(restored(checkpoint['verification_x']),checkpoint['verification_logits'])
            result['restore_verified']=True; result['checkpoint_sha256']=digest(a.out/f'{mode}.pt')
        report['runs'][mode]=result
        (a.out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
        print(json.dumps({'mode':mode,'heldout':result['heldout'],'independent':result['independent']},ensure_ascii=False),flush=True)


if __name__ == '__main__':
    main()
