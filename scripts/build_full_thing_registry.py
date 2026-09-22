#!/usr/bin/env python3
"""Build or verify the public registry containing all uploaded Thing Model schemas."""

import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path


SOURCE_SHA256 = "3a5e67efd5847d70761076506500d001cbed36b1d19dca60ed286eb72ae5d60c"
FIXTURE = Path("data/real-home-thing-model-registry.json.gz.b64")


def decode_fixture(path: Path) -> dict:
    encoded = "".join(path.read_text(encoding="utf-8").split())
    encoded += "=" * (-len(encoded) % 4)
    return json.loads(gzip.decompress(base64.b64decode(encoded, validate=True)))


def encode_fixture(payload: dict, path: Path) -> None:
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    compressed = gzip.compress(raw, compresslevel=9, mtime=0)
    encoded = base64.b64encode(compressed).decode("ascii")
    path.write_text("\n".join(encoded[i : i + 100] for i in range(0, len(encoded), 100)) + "\n", encoding="utf-8")


def schema_counts(schema: dict) -> dict:
    modules = schema.get("modules", {})
    properties = [p for m in modules.values() for p in m.get("properties", {}).values()]
    return {
        "modules": len(modules),
        "properties": len(properties),
        "services": sum(len(m.get("services", {})) for m in modules.values()),
        "events": sum(len(m.get("events", {})) for m in modules.values()),
        "writable_properties": sum("write" in p.get("op", []) for p in properties),
        "readable_properties": sum("read" in p.get("op", []) for p in properties),
    }


def verify(payload: dict) -> None:
    assert payload["source_archive_sha256"] == SOURCE_SHA256
    assert payload["model_count"] == 46
    assert len(payload["model_index"]) == 46
    assert len(payload["full_models"]) == 46
    indexed = {m["model_code"] for m in payload["model_index"]}
    assert indexed == set(payload["full_models"])
    for item in payload["model_index"]:
        code = item["model_code"]
        schema = payload["full_models"][code]
        assert schema.get("title") == item.get("title"), code
        assert schema_counts(schema) == item.get("counts"), code
    print("verified full Thing Model registry: 46/46 original schemas")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, help="directory containing the 46 archive JSON files")
    parser.add_argument("--fixture", type=Path, default=FIXTURE)
    args = parser.parse_args()

    payload = decode_fixture(args.fixture)
    if args.source_dir:
        files = sorted(args.source_dir.glob("*.json"))
        assert len(files) == 46, len(files)
        schemas = {}
        file_hashes = {}
        for path in files:
            code = path.stem
            source = path.read_bytes()
            schemas[code] = json.loads(source.decode("utf-8-sig"))
            file_hashes[code] = hashlib.sha256(source).hexdigest()
        assert {m["model_code"] for m in payload["model_index"]} == set(schemas)
        for item in payload["model_index"]:
            code = item["model_code"]
            item["counts"] = schema_counts(schemas[code])
            item["source_file_sha256"] = file_hashes[code]
        payload["truth"] = "all_46_original_schemas_from_fixed_user_uploaded_archive"
        payload["full_models"] = schemas
        payload["full_schema_count"] = len(schemas)
        encode_fixture(payload, args.fixture)
        payload = decode_fixture(args.fixture)
    verify(payload)


if __name__ == "__main__":
    main()
