"""Export public recorded notebook states. No database, network or provider calls."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import uuid


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def pick(source, names):
    return {name: copy.deepcopy(source[name]) for name in names if name in source}


def sanitize(state, provider, case_id, source):
    assert state["provider"] == provider and state["status"] == "completed", "Incomplete actual answer"
    assert state["error"] is None, "Captured answer has an error"
    result = pick(state, ["provider", "title", "sourceLabel", "status", "phase", "createdAt", "updatedAt"])
    result["id"] = str(uuid.uuid5(uuid.NAMESPACE_URL, f"daybook-recorded-replay/{provider}/{source}/{case_id}"))
    result["error"] = None
    result["messages"] = [dict(pick(message, ["role", "content", "createdAt"]), id=f"message-{index + 1}") for index, message in enumerate(state["messages"])]
    assert any(message["role"] == "assistant" and message["content"].strip() for message in result["messages"]), "Missing delivered answer"
    cells = []
    for index, cell in enumerate(state["notebook"]["cells"]):
        outputs = []
        for output in cell["outputs"]:
            kind = output["type"]
            if kind in ("markdown", "notice"):
                outputs.append(pick(output, ["type", "text"]))
            elif kind == "table":
                outputs.append(pick(output, ["type", "columns", "rows", "totalRows", "totalRowsKnown", "truncated"]))
            elif kind == "chart":
                chart = pick(output["chart"], ["kind", "title", "xLabel", "xScale", "yLabel", "labels", "format", "currency"])
                chart["series"] = [pick(series, ["name", "values"]) for series in output["chart"]["series"]]
                assert all(len(series["values"]) == len(chart["labels"]) for series in chart["series"]), "Invalid chart shape"
                outputs.append({"type": "chart", "chart": chart})
            else:
                raise ValueError("Unknown public output type")
        cells.append(dict(pick(cell, ["title", "code"]), id=f"cell-{index + 1}", outputs=outputs))
    result["notebook"] = {"cells": cells, "updatedAt": state["notebook"]["updatedAt"]}
    assert any(output["type"] == "chart" for cell in cells for output in cell["outputs"]), "Missing actual chart; do not fabricate one"
    encoded = canonical(result)
    assert not re.search(r"postgres(?:ql)?://|Bearer\s+[A-Za-z0-9]|AIza[A-Za-z0-9_-]{20}|thoughtSignature|access_token|refresh_token|api[_-]?key\s*[:=]", encoded, re.I), "Possible secret or private provider history in public content"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cohort", type=Path, required=True)
    parser.add_argument("--provider", choices=["daybook", "querio"], required=True)
    parser.add_argument("--cases", nargs="+", choices=["A06", "A18"], default=["A06", "A18"])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    root = args.root.resolve()
    cohort = args.cohort.resolve()
    output = args.output.resolve()
    assert cohort.is_relative_to(root / ".tools"), "Raw captures must remain in private project tooling"
    assert output.is_relative_to(root), "Output must remain inside this project"
    binding_path = cohort / "binding.json"
    binding = json.loads(binding_path.read_text())
    references = root / "tests/analyst-workspace-acceptance"
    actual_hashes = {name: digest(references / name) for name in ["fixture.json", "expected.json", "cases.json", "shared-context.md", "oracle.py"]}
    assert binding["referenceHashes"] == actual_hashes, "Frozen references do not match this cohort"
    assert binding["businessDate"] == "2026-11-03"
    cases = json.loads((references / "cases.json").read_text())["cases"]
    pending = []
    for case_id in args.cases:
        path = cohort / f"{case_id.lower()}-turn-1.json"
        captured = json.loads(path.read_text())  # Missing captures are failures, never skips or dummy answers.
        assert captured["caseId"] == case_id and captured.get("turn", captured.get("number")) == 1
        assert captured["referenceHashes"] == actual_hashes
        assert captured["sourceCommit"] == binding["sourceCommit"] and captured["modelId"] == binding["modelId"]
        assert captured["businessDate"] == binding["businessDate"] and captured["organizationId"] == binding["organizationId"]
        prompt = next(case for case in cases if case["id"] == case_id)["turns"][0]["prompt"]
        assert captured["prompt"] == prompt
        state = sanitize(captured["state"], args.provider, case_id, binding["sourceCommit"])
        assert state["messages"][0]["content"] == prompt
        document = {
            "version": 1,
            "kind": "recorded-actual-response-replay",
            "caseId": case_id,
            "provider": args.provider,
            "businessDate": binding["businessDate"],
            "organizationId": binding["organizationId"],
            "provenance": {
                "sourceCommit": binding["sourceCommit"],
                "modelId": binding["modelId"],
                "captureBasename": path.name,
                "captureSha256": digest(path),
                "bindingSha256": digest(binding_path),
                "referenceHashes": actual_hashes,
                "originalPublicStateSha256": hashlib.sha256(canonical(captured["state"]).encode()).hexdigest(),
                "sanitizedStateSha256": hashlib.sha256(canonical(state).encode()).hexdigest(),
                "sanitization": ["Allowlisted public contract fields only", "Replaced opaque conversation/message/cell IDs", "Removed external notebook link", "Retained actual prose, code, table values and chart values without repair"],
            },
            "state": state,
        }
        target = output / f"{args.provider}-{case_id.lower()}.json"
        assert not target.exists(), "Never overwrite a recorded fixture"
        pending.append((target, document))
    output.mkdir(parents=True, exist_ok=True)
    for target, document in pending:
        with os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as stream:
            json.dump(document, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
    print(json.dumps({"exported": [path.name for path, _ in pending], "modelCalls": 0, "networkCalls": 0, "financialValuesRepaired": False}))


if __name__ == "__main__":
    main()
