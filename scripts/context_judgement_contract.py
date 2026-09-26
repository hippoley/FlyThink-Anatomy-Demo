#!/usr/bin/env python3
"""Context judgement schema for long-context whole-home reasoning.
Separates whether/when to act from the patch itself.
"""
from dataclasses import dataclass,asdict
from typing import Literal
Decision=Literal["EXECUTE","CLARIFY","BLOCK","NOOP","CANCEL_PENDING","UNDO_EXECUTED"]

@dataclass(frozen=True)
class Judgement:
 decision:Decision
 reason:str
 evidence:list[str]
 missing:list[str]
 protected:list[str]

def validate_judgement(x):
 assert x["decision"] in {"EXECUTE","CLARIFY","BLOCK","NOOP","CANCEL_PENDING","UNDO_EXECUTED"}
 assert isinstance(x["evidence"],list) and isinstance(x["missing"],list)
 # EXECUTE cannot knowingly miss target/slot facts required by the action.
 if x["decision"]=="EXECUTE": assert not x["missing"]
 return True
