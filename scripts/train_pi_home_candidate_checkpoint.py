#!/usr/bin/env python3
"""Train a small shadow-only candidate ranking checkpoint from recovery trajectories."""
import argparse,json,random,hashlib
from pathlib import Path
import torch

FEATURES=["noise_cost","ventilation_gain","rain_exposure","leeward_score"]
FAMILIES=["quiet-ventilation","rain-safe-opening"]

def target_key(t):
    return f'{t["area"]}::{t["entity"]}::{t.get("instance","default")}'

def canonical_json(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"))

def train_fingerprint(train_cases):
    return hashlib.sha256(canonical_json(train_cases).encode("utf-8")).hexdigest()

def row_vector(family,candidate):
    fam=[1.0 if family==x else 0.0 for x in FAMILIES]
    feats=candidate.get("features",{})
    vals=[float(feats.get(k,0.0)) for k in FEATURES]
    # family-feature interactions let one feature mean different things by intent family.
    interactions=[]
    for f in fam:
        interactions.extend([f*v for v in vals])
    return torch.tensor(fam+vals+interactions,dtype=torch.float32)

class CandidateRankNet(torch.nn.Module):
    def __init__(self):
        super().__init__()
        dim=len(FAMILIES)+len(FEATURES)+len(FAMILIES)*len(FEATURES)
        self.score=torch.nn.Linear(dim,1,bias=True)
    def forward(self,x):
        return self.score(x).squeeze(-1)

def candidate_identities(cases):
    ids=set()
    for case in cases:
        for cand in case.get("context",{}).get("candidates",[]):
            ids.add(target_key(cand["target"]))
    return ids

def assert_identity_isolation(train_cases,eval_cases):
    train_ids=candidate_identities(train_cases)
    eval_ids=candidate_identities(eval_cases)
    overlap=sorted(train_ids & eval_ids)
    if overlap:
        raise ValueError("candidate identity leakage across train/eval: "+",".join(overlap))
    return {
        "train_candidate_identities":len(train_ids),
        "eval_candidate_identities":len(eval_ids),
        "overlap":[]
    }

def training_pairs(train_cases):
    out=[]
    for case in train_cases:
        family=case["context"]["intent_family"]
        candidates=case["context"]["candidates"]
        chosen=case["replay"]["patches"][0]["target"]
        chosen_key=target_key(chosen)
        positive=None
        negatives=[]
        for cand in candidates:
            if target_key(cand["target"])==chosen_key: positive=cand
            else: negatives.append(cand)
        if positive is None:
            raise ValueError(f'chosen target missing from candidates: {case["id"]}')
        for negative in negatives:
            out.append((case["id"],family,positive,negative))
    return out

def fit(train_cases,epochs=300,seed=4517):
    torch.manual_seed(seed); random.seed(seed)
    model=CandidateRankNet()
    pairs=training_pairs(train_cases)
    if not pairs: raise ValueError("candidate ranking training pairs required")
    opt=torch.optim.AdamW(model.parameters(),lr=.03,weight_decay=.01)
    for _ in range(epochs):
        opt.zero_grad()
        losses=[]
        for _,family,pos,neg in pairs:
            ps=model(row_vector(family,pos).unsqueeze(0))[0]
            ns=model(row_vector(family,neg).unsqueeze(0))[0]
            losses.append(torch.nn.functional.softplus(-(ps-ns)))
        loss=torch.stack(losses).mean()
        loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(),1); opt.step()
    return model,pairs

def rank(model,case):
    family=case["context"]["intent_family"]
    rows=[]
    with torch.no_grad():
        for cand in case["context"]["candidates"]:
            score=float(model(row_vector(family,cand).unsqueeze(0))[0])
            rows.append({"target":cand["target"],"score":score})
    rows.sort(key=lambda x:(-x["score"],target_key(x["target"])))
    return rows

def evaluate(model,cases):
    correct=0;rows=[]
    for case in cases:
        ranking=rank(model,case)
        predicted=ranking[0]["target"]
        gold=case["gold"]["expected_targets"][0]
        ok=target_key(predicted)==target_key(gold)
        correct+=int(ok)
        rows.append({"id":case["id"],"predicted":predicted,"gold":gold,"correct":ok,"ranking":ranking})
    return {"cases":len(cases),"exact":correct/len(cases) if cases else 0.0,"rows":rows}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--data",default="benchmarks/pi_home_candidate_generalization.json")
    ap.add_argument("--out",type=Path,default=Path("artifacts/pi-home-candidate-checkpoint"))
    ap.add_argument("--epochs",type=int,default=300)
    ap.add_argument("--seed",type=int,default=4517)
    args=ap.parse_args()
    torch.set_num_threads(2)
    data=json.loads(Path(args.data).read_text(encoding="utf-8"))
    isolation=assert_identity_isolation(data["train_cases"],data["cases"])
    model,pairs=fit(data["train_cases"],args.epochs,args.seed)
    fingerprint=train_fingerprint(data["train_cases"])
    report={
        "schema_version":"pi-home-candidate-checkpoint-report-v1",
        "shadow_only":True,
        "train_cases":len(data["train_cases"]),
        "pairwise_preferences":len(pairs),
        "identity_isolation":isolation,
        "train_fingerprint":fingerprint,
        "holdout":evaluate(model,data["cases"]),
        "features":FEATURES,
        "families":FAMILIES,
        "seed":args.seed,
        "epochs":args.epochs,
        "device_execution_authorized":False
    }
    args.out.mkdir(parents=True,exist_ok=True)
    torch.save({
        "state_dict":model.state_dict(),
        "features":FEATURES,
        "families":FAMILIES,
        "schema_version":"pi-home-candidate-checkpoint-v1",
        "shadow_only":True,
        "train_fingerprint":fingerprint
    },args.out/"model.pt")
    (args.out/"report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2), encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False))

if __name__=="__main__": main()
