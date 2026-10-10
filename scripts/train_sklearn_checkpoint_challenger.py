#!/usr/bin/env python3
"""Mature external challenger for FlyThink judgement + semantic checkpoints.

Uses scikit-learn only on existing train corpora. Dev/final/diagnostic sets are
evaluation-only. No V3 sealed rows are used for fitting or model selection.
"""
import argparse,json,pathlib,re
from collections import Counter,defaultdict

import joblib
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression

from context_judgement_corpus_v4 import build as judgement_build
from whole_home_patch_corpus_v12 import build as semantic_build
from semantic_patch_contract import OPS,CARD,DIR,encode
from sklearn_checkpoint_features import judgement_text,semantic_text

DECISIONS=["EXECUTE","CLARIFY","BLOCK","NOOP","CANCEL_PENDING","UNDO_EXECUTED"]
HEADS=("op","cardinality","direction","has_value")

def vectorizer():
 return TfidfVectorizer(
  analyzer="char",
  ngram_range=(1,5),
  min_df=1,
  max_features=120000,
  sublinear_tf=True,
  norm="l2",
 )

def classifier():
 return LogisticRegression(
  solver="lbfgs",
  class_weight="balanced",
  max_iter=1200,
  C=4.0,
  random_state=20261010,
 )

def family_accuracy(rows,ok):
 fam=defaultdict(list)
 for r,x in zip(rows,ok):fam[r["family"]].append(bool(x))
 return {k:sum(v)/len(v) for k,v in sorted(fam.items())}

def judgement_score(vec,clf,rows):
 X=vec.transform([judgement_text(r) for r in rows])
 gold=np.array([r["judgement"]["decision"] for r in rows],dtype=object)
 pred=clf.predict(X)
 ok=pred==gold
 return {
  "accuracy":float(ok.mean()) if len(ok) else 0.0,
  "family":family_accuracy(rows,ok),
  "examples":len(rows)
 }

def train_judgement(out):
 d=judgement_build()
 vec=vectorizer()
 X=vec.fit_transform([judgement_text(r) for r in d["train"]])
 y=np.array([r["judgement"]["decision"] for r in d["train"]],dtype=object)
 clf=classifier();clf.fit(X,y)
 report={
  "truth":"sklearn_char_tfidf_logreg_judgement_v1",
  "library":"scikit-learn",
  "fit_split":"train_only",
  "train":judgement_score(vec,clf,d["train"]),
  "dev":judgement_score(vec,clf,d["dev"]),
  "final":judgement_score(vec,clf,d["final"]),
  "classes":list(clf.classes_),
  "features":len(vec.vocabulary_)
 }
 out.mkdir(parents=True,exist_ok=True)
 joblib.dump({"vectorizer":vec,"classifier":clf,"decisions":DECISIONS},out/"judgement.joblib")
 return report

def semantic_labels(rows):
 enc=[encode(r) for r in rows]
 return {
  "op":np.array([x["op"] for x in enc],dtype=object),
  "cardinality":np.array([x["cardinality"] for x in enc],dtype=object),
  "direction":np.array([x["direction"] for x in enc],dtype=object),
  "has_value":np.array(["1" if x["has_value"] else "0" for x in enc],dtype=object),
 }

def semantic_predict(vec,models,rows):
 X=vec.transform([semantic_text(r) for r in rows])
 return {h:models[h].predict(X) for h in HEADS}

def semantic_score(vec,models,rows):
 gold=semantic_labels(rows);pred=semantic_predict(vec,models,rows)
 head_ok={h:pred[h]==gold[h] for h in HEADS}
 exact=np.logical_and.reduce([head_ok[h] for h in HEADS])
 return {
  "exact":float(exact.mean()) if len(exact) else 0.0,
  "op":float(head_ok["op"].mean()) if len(exact) else 0.0,
  "cardinality":float(head_ok["cardinality"].mean()) if len(exact) else 0.0,
  "direction":float(head_ok["direction"].mean()) if len(exact) else 0.0,
  "value_semantics":float(head_ok["has_value"].mean()) if len(exact) else 0.0,
  "family":family_accuracy(rows,exact),
  "examples":len(rows)
 }

def train_semantic(out):
 d=semantic_build()
 vec=vectorizer()
 X=vec.fit_transform([semantic_text(r) for r in d["train"]])
 gold=semantic_labels(d["train"])
 models={}
 for h in HEADS:
  m=classifier();m.fit(X,gold[h]);models[h]=m
 report={
  "truth":"sklearn_char_tfidf_logreg_semantic_v1",
  "library":"scikit-learn",
  "fit_split":"train_only",
  "train":semantic_score(vec,models,d["train"]),
  "dev":semantic_score(vec,models,d["dev"]),
  "diagnostic":semantic_score(vec,models,d["sealed"]),
  "features":len(vec.vocabulary_),
  "classes":{h:list(models[h].classes_) for h in HEADS}
 }
 out.mkdir(parents=True,exist_ok=True)
 joblib.dump({"vectorizer":vec,"models":models,"ops":OPS,"card":CARD,"dir":DIR},out/"semantic.joblib")
 return report

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--out",type=pathlib.Path,default=pathlib.Path("artifacts/sklearn-checkpoint-challenger"))
 a=ap.parse_args()
 rep={
  "schema_version":"flythink-sklearn-challenger-v1",
  "selection_policy":"fixed_hyperparameters_train_only_no_dev_tuning",
  "judgement":train_judgement(a.out),
  "semantic":train_semantic(a.out)
 }
 (a.out/"report.json").write_text(json.dumps(rep,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 print(json.dumps(rep,ensure_ascii=False))

if __name__=="__main__":main()
