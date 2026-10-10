#!/usr/bin/env python3
"""Stable text/context representation shared by sklearn training and inference."""

def scalar(v):
 if v is None:return "null"
 if isinstance(v,bool):return "true" if v else "false"
 return str(v)

def flatten(prefix,v,out):
 if isinstance(v,dict):
  for k in sorted(v):flatten(f"{prefix}.{k}" if prefix else k,v[k],out)
 elif isinstance(v,list):
  for x in v:flatten(prefix,x,out)
 else:
  out.append(f"{prefix}={scalar(v)}")

def context_text(bg):
 out=[];flatten("ctx",bg or {},out);return " ".join(out)

def judgement_text(row):
 return f"utterance={row['utterance']} {context_text(row.get('background'))}"

def semantic_text(row):
 return f"utterance={row['text']} {context_text(row.get('lifecycle'))}"
