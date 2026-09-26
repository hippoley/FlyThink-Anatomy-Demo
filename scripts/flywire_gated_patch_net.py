#!/usr/bin/env python3
"""V3 FlyWire-gated architecture.

Text and world-context enter disjoint neuron populations. Readout sees only a
third population. Therefore context/text fusion requires paths through the real
FlyWire recurrent graph; disconnected ablation cannot use the encoder as a
direct classification bypass.
"""
import torch
from train_flywire_whole_home_patch import OPS,ROOMS,ENTITIES,SLOTS,MAX_PATCHES,TEXT_DIM,STATE_DIM

class FlyWireGatedPatchNet(torch.nn.Module):
    def __init__(self,g,seed=3783,disconnect=False):
        super().__init__();torch.manual_seed(seed);n=len(g["root_ids"]);e=torch.tensor(g["edges"])
        self.register_buffer("pre",e[:,0].long());self.register_buffer("post",e[:,1].long())
        base=e[:,3].float();den=torch.zeros(n).index_add_(0,self.post,base.abs())
        self.register_buffer("base",.9*base/den[self.post].clamp_min(1));self.gain=torch.nn.Parameter(torch.zeros(len(self.pre)))
        # deterministic disjoint populations
        order=torch.arange(n); self.register_buffer("text_idx",order[0:n//3]);self.register_buffer("ctx_idx",order[n//3:2*n//3]);self.register_buffer("read_idx",order[2*n//3:])
        self.text_encoder=torch.nn.Linear(TEXT_DIM,len(self.text_idx))
        self.ctx_encoder=torch.nn.Linear(STATE_DIM,len(self.ctx_idx))
        r=len(self.read_idx)
        self.count=torch.nn.Linear(r,MAX_PATCHES)
        self.patch_heads=torch.nn.ModuleList([torch.nn.Linear(r,len(OPS)+len(ROOMS)+len(ENTITIES)+len(SLOTS)) for _ in range(MAX_PATCHES)])
        self.disconnect=disconnect
    def forward(self,x,disconnect=None):
        b=x.shape[0];n=len(self.text_idx)+len(self.ctx_idx)+len(self.read_idx)
        drive=torch.zeros((b,n),device=x.device)
        drive[:,self.text_idx]=self.text_encoder(x[:,:TEXT_DIM])
        drive[:,self.ctx_idx]=self.ctx_encoder(x[:,TEXT_DIM:])
        h=torch.tanh(drive);w=self.base*2*torch.sigmoid(self.gain);off=self.disconnect if disconnect is None else disconnect
        for _ in range(8):
            rec=torch.zeros_like(h)
            if not off:rec.index_add_(1,self.post,h[:,self.pre]*w)
            # input remains clamped at source populations; readout population has no direct drive
            h=.35*h+.65*torch.tanh(drive+rec)
        z=h[:,self.read_idx]
        return self.count(z),[head(z) for head in self.patch_heads]
