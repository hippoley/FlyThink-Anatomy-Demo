#!/usr/bin/env python3
"""Training-regime experiment matrix. Frozen dev/sealed are never used for selection."""
REGIMES={
 "plain_ce":{"balanced":False,"counterfactual":False,"transition":False},
 "balanced_ce":{"balanced":True,"counterfactual":False,"transition":False},
 "contrastive_ce":{"balanced":True,"counterfactual":True,"transition":False},
 "transition_contrastive":{"balanced":True,"counterfactual":True,"transition":True},
}
DATASETS={
 "v10_baseline":"independent_rows",
 "v11_matched":"matched_surface_rows",
 "v12_transition":"state_transition_groups",
}
PRIMARY=("semantic_exact","resolution_exact","state_transition_exact")
SAFETY=("wrong_device","untouched_state_violation")
