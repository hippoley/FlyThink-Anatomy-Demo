#!/usr/bin/env python3
"""Train a topology-constrained rate RNN on a real FAFB v783 induced subgraph.

This is an engineered language transfer experiment, not a biological LIF replica.
No random recurrent edges and no synthetic fallback are allowed.
"""
import argparse
import csv
import gzip
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
import urllib.request

SOURCE = 'https://storage.googleapis.com/flywire-data/codex/data/fafb/783/connections_princeton.csv.gz'
EXPECTED_SHA256 = '445f996bf6c4b1803b9ba186189138a3061ff8623aa94c0abcf38af30a5bd48b'


def features(text, torch):
    x = torch.zeros(256)
    for n in (1, 2, 3):
        for i in range(len(text) - n + 1):
            j = int(hashlib.sha256(text[i:i+n].encode()).hexdigest()[:8], 16) % 256
            x[j] += 1
    return x / x.norm().clamp_min(1)


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def graph(path, limit):
    degree = Counter()
    rows = 0
    with gzip.open(path, 'rt') as f:
        for r in csv.DictReader(f):
            count = int(r['syn_count'])
            if count <= 0:
                raise ValueError('Nonpositive synapse count')
            degree[r['pre_root_id']] += count
            degree[r['post_root_id']] += count
            rows += 1
    roots = sorted(degree, key=lambda r: (-degree[r], r))[:limit or None]
    ids = {r: i for i, r in enumerate(roots)}
    pairs = defaultdict(Counter)
    with gzip.open(path, 'rt') as f:
        for r in csv.DictReader(f):
            if r['pre_root_id'] in ids and r['post_root_id'] in ids:
                pairs[(ids[r['pre_root_id']], ids[r['post_root_id']])][r['nt_type']] += int(r['syn_count'])
    edges = []
    for (pre, post), nts in sorted(pairs.items()):
        # GABA/GLUT inhibitory is a modeling assumption, not a measured weight.
        signed = sum((-1 if nt in {'GABA', 'GLUT'} else 1) * n for nt, n in nts.items())
        edges.append([pre, post, sum(nts.values()), signed])
    if not edges:
        raise ValueError('Selected graph has no edges')
    return dict(dataset='FlyWire FAFB v783', source=SOURCE, source_sha256=digest(path),
                source_rows=rows, source_connected_neurons=len(degree), root_ids=roots,
                edges=edges, selection='highest total incident synapse count; induced directed subgraph',
                scope='all connected neurons' if not limit else 'induced subgraph',
                weight_assumption='synapse count; GABA/GLUT negative, other types positive; incoming L1 normalized')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--connections', type=Path, default=Path('data/flywire/connections_princeton.csv.gz'))
    p.add_argument('--download', action='store_true')
    p.add_argument('--neurons', type=int, default=512, help='0 loads all connected neurons; needs substantial RAM')
    p.add_argument('--epochs', type=int, default=30)
    p.add_argument('--out', type=Path, default=Path('artifacts/flywire'))
    a = p.parse_args()
    if a.neurons < 0 or a.epochs < 1:
        p.error('neurons must be nonnegative and epochs positive')
    if a.download and not a.connections.exists():
        a.connections.parent.mkdir(parents=True, exist_ok=True)
        temp = a.connections.with_suffix('.partial')
        urllib.request.urlretrieve(SOURCE, temp)
        temp.replace(a.connections)
    if not a.connections.exists():
        p.error('Real connectivity required. Use --download. No synthetic fallback.')
    if digest(a.connections) != EXPECTED_SHA256:
        p.error('Connectivity checksum differs from the verified v783 source; review the data version before training.')
    import torch
    from build_dialogue_capability_slice import build
    from train_browser_dialogue_model import unpack
    torch.set_num_threads(2)
    torch.manual_seed(783)
    g = graph(a.connections, a.neurons)
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / 'connectome.json').write_text(json.dumps(g, ensure_ascii=False))
    print(json.dumps({k: v for k, v in g.items() if k not in {'edges', 'root_ids'}}, ensure_ascii=False), flush=True)
    print('selected', len(g['root_ids']), 'neurons', len(g['edges']), 'directed edges', flush=True)
    samples = {}
    for row in build(seed=783, variants_per_family=80):
        text, labels = unpack(row)
        if text in samples and samples[text] != labels['family']:
            raise ValueError('Conflicting supervision for identical input')
        samples[text] = labels['family']
    labels = sorted(set(samples.values()))
    splits = [[], []]
    for text, label in sorted(samples.items()):
        # Exact inputs are disjoint; templates are shared, so this is NOT an OOD benchmark.
        split = int(hashlib.sha256(text.encode()).hexdigest()[:8], 16) % 5 == 0
        x = features(text, torch)
        splits[split].append((x, labels.index(label), text))
    train, test = [(torch.stack([r[0] for r in s]), torch.tensor([r[1] for r in s])) for s in splits]
    e = torch.tensor(g['edges'])
    pre, post = e[:, 0].long(), e[:, 1].long()
    base = e[:, 3].float()
    denom = torch.zeros(len(g['root_ids'])).index_add_(0, post, base.abs())
    base = base / denom[post].clamp_min(1) * .8

    class ConnectomeRNN(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.encoder = torch.nn.Linear(256, len(g['root_ids']))
            self.edge_gain = torch.nn.Parameter(torch.zeros(len(pre)))
            self.readout = torch.nn.Linear(len(g['root_ids']), len(labels))

        def forward(self, x, ablate=False):
            drive = self.encoder(x)
            h = torch.zeros_like(drive)
            weights = base * (2 * torch.sigmoid(self.edge_gain))
            for _ in range(4):
                rec = torch.zeros_like(h)
                if not ablate:
                    rec.index_add_(1, post, h[:, pre] * weights)
                h = .5 * h + .5 * torch.tanh(drive + rec)
            return self.readout(h)

    model = ConnectomeRNN()
    optimizer = torch.optim.Adam(model.parameters(), lr=.01)
    loss_fn = torch.nn.CrossEntropyLoss()
    logs = []
    with torch.no_grad():
        initial = float(loss_fn(model(train[0]), train[1]))
    for epoch in range(a.epochs):
        order = torch.randperm(len(train[1]))
        total = 0
        for idx in order.split(32):
            optimizer.zero_grad()
            loss = loss_fn(model(train[0][idx]), train[1][idx])
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1)
            optimizer.step()
            total += float(loss.detach()) * len(idx)
        logs.append({'epoch': epoch + 1, 'train_loss': total / len(order)})
        print(json.dumps(logs[-1]), flush=True)
    with torch.no_grad():
        logits = model(test[0])
        ablated = model(test[0], ablate=True)
        accuracy = lambda z: float((z.argmax(1) == test[1]).float().mean())
        metrics = dict(truth='real_connectome_induced_rate_rnn_internal_edge_gain_training',
                       scope=g['scope'], neurons=len(g['root_ids']), edges=len(pre),
                       source_sha256=g['source_sha256'], seed=783, epochs=a.epochs,
                       torch_version=torch.__version__, train_count=len(train[1]), test_count=len(test[1]),
                       initial_train_loss=initial, final_train_loss=float(loss_fn(model(train[0]), train[1])),
                       test_accuracy=accuracy(logits), disconnected_test_accuracy=accuracy(ablated),
                       disconnected_logit_mean_change=float((logits-ablated).abs().mean()),
                       changed_internal_edges=int((model.edge_gain.abs()>1e-7).sum()),
                       internal_gain_max_change=float(model.edge_gain.abs().max()),
                       evaluation_limit='synthetic shared-template family classification; not independent OOD, slot, or multi-turn state-tree validation',
                       browser_integration=False, biological_spiking_model=False, logs=logs)
    assert metrics['changed_internal_edges'] > 0, 'Internal network was not trained'
    assert metrics['disconnected_logit_mean_change'] > 0, 'Connectivity has no effect'
    torch.save({'state_dict': model.state_dict(), 'root_ids': g['root_ids'], 'pre': pre, 'post': post,
                'base': base, 'labels': labels, 'source_sha256': g['source_sha256'], 'steps': 4,
                'verification_input': test[0][:3], 'verification_logits': logits[:3]}, a.out / 'checkpoint.pt')
    metrics['checkpoint_sha256'] = digest(a.out / 'checkpoint.pt')
    (a.out / 'metrics.json').write_text(json.dumps(metrics, ensure_ascii=False, indent=2))
    (a.out / 'split-manifest.json').write_text(json.dumps({name: [hashlib.sha256(r[2].encode()).hexdigest() for r in s] for name, s in zip(['train', 'test'], splits)}, indent=2))
    print(json.dumps({k:v for k,v in metrics.items() if k!='logs'}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
