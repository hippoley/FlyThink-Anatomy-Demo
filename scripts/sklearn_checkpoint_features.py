#!/usr/bin/env python3
"""Stable text/context representation shared by sklearn training and inference."""

FEATURE_CONTRACT="sklearn-checkpoint-context-v1"
STABLE_CONTEXT_KEYS=(
 "focused_target","referent_set","pending_ids","executed_ids",
 "failed_execution_ids","protected_paths","device_keys","device_registry",
 "add_target","commit_state",
)

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

def stable_context(bg):
 bg=bg or {}
 return {k:bg[k] for k in STABLE_CONTEXT_KEYS if k in bg}

def context_text(bg):
 out=[];flatten("ctx",stable_context(bg),out);return " ".join(out)

def judgement_text(row):
 return f"utterance={row['utterance']} {context_text(row.get('background'))}"

def semantic_text(row):
 return f"utterance={row['text']} {context_text(row.get('lifecycle'))}"
