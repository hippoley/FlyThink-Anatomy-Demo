#!/usr/bin/env python3
"""Prepare the verified real FlyWire induced graph without training an unrelated task."""
import argparse,json,urllib.request
from pathlib import Path
from train_flywire import SOURCE,EXPECTED_SHA256,digest,graph
def main():
 p=argparse.ArgumentParser();p.add_argument("--connections",type=Path,default=Path("data/flywire/connections_princeton.csv.gz"));p.add_argument("--download",action="store_true");p.add_argument("--neurons",type=int,default=512);p.add_argument("--out",type=Path,default=Path("artifacts/flywire"));a=p.parse_args()
 if a.download and not a.connections.exists():
  a.connections.parent.mkdir(parents=True,exist_ok=True);tmp=a.connections.with_suffix(".partial");urllib.request.urlretrieve(SOURCE,tmp);tmp.replace(a.connections)
 if not a.connections.exists():p.error("Real connectivity required. Use --download. No synthetic fallback.")
 sha=digest(a.connections)
 if sha!=EXPECTED_SHA256:p.error("Connectivity checksum differs from verified v783 source.")
 g=graph(a.connections,a.neurons);a.out.mkdir(parents=True,exist_ok=True);(a.out/"connectome.json").write_text(json.dumps(g,ensure_ascii=False))
 print(json.dumps({"truth":"verified_real_flywire_graph_only","source_sha256":sha,"neurons":len(g["root_ids"]),"edges":len(g["edges"]),"scope":g["scope"]},ensure_ascii=False))
if __name__=="__main__":main()
