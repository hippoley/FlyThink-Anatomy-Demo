#!/usr/bin/env python3
"""scikit-learn implementation of the checkpoint inference interface."""
import joblib
from sklearn_checkpoint_features import judgement_text,semantic_text

class SklearnInference:
 def __init__(self,judgement_ckpt,semantic_ckpt):
  j=joblib.load(judgement_ckpt)
  s=joblib.load(semantic_ckpt)
  self.jvec=j["vectorizer"];self.judge=j["classifier"]
  self.svec=s["vectorizer"];self.semantic=s["models"]

 def judgement(self,text,background):
  X=self.jvec.transform([judgement_text({"utterance":text,"background":background or {}})])
  pred=self.judge.predict(X)[0]
  probs=self.judge.predict_proba(X)[0]
  cls=list(self.judge.classes_)
  i=cls.index(pred)
  return {"decision":str(pred),"confidence":float(probs[i])}

 def patch(self,text,context):
  X=self.svec.transform([semantic_text({"text":text,"lifecycle":context or {}})])
  out={h:str(m.predict(X)[0]) for h,m in self.semantic.items()}
  return {
   "op":out["op"],
   "cardinality":out["cardinality"],
   "direction":out["direction"],
   "has_value":out["has_value"]=="1"
  }
