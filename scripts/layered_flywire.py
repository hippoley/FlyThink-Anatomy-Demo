#!/usr/bin/env python3
"""Layered FlyWire model: shared recurrent substrate plus responsibility heads."""
import torch
from flywire_encoder import FlyWireEncoder
from responsibility_heads import ResponsibilityHeads
class LayeredFlyWire(torch.nn.Module):
 def __init__(self,g,seed=3783,disconnect=False):
  super().__init__();self.encoder=FlyWireEncoder(g,seed,disconnect);self.heads=ResponsibilityHeads(self.encoder.output_dim)
 def encode(self,x):return self.encoder(x)
 def classify(self,z):return self.heads(z)
 def forward(self,x):return self.classify(self.encode(x))
