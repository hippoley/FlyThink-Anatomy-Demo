#!/usr/bin/env python3
"""Layered FlyWire model: one recurrent substrate, responsibility-specific heads."""
import torch
from flywire_encoder import FlyWireEncoder
from responsibility_heads import ResponsibilityHeads
class LayeredFlyWire(torch.nn.Module):
 def __init__(self,g,seed=3783,disconnect=False):
  super().__init__();self.encoder=FlyWireEncoder(g,seed,disconnect);self.heads=ResponsibilityHeads(self.encoder.output_dim)
 def forward(self,x):return self.heads(self.encoder(x))
