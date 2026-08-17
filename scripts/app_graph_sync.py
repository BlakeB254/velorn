#!/usr/bin/env python3
"""Velorn CreativeOps ledger → production graph.

Mirrors cdx-platform/scripts/app_graph_sync.py for the Velorn port:

    scripts/app_graph_sync.py --app twin|beatlab|studio|all [--apply] [--out report.json]

Dry-run by default. --apply writes through cdx_common.research_map.seed_map
when CDX is available; otherwise it writes a local receipt only.

Never publishes, schedules, or queues GPU work.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MAPPER = HERE / "velorn-graph-sync.mjs"


def _node_map(payload: dict[str, Any]) -> dict[str, Any]:
    proc = subprocess.run(
        ["node", str(MAPPER), "--map-json"],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise SystemExit(proc.stderr or proc.stdout or "velorn-graph-sync --map-json failed")
    return json.loads(proc.stdout)


def _discover(args: argparse.Namespace) -> dict[str, Any]:
    cmd = ["node", str(MAPPER), "--app", args.app]
    if args.project:
        cmd.extend(["--project", str(args.project)])
    for root in args.ledger_root or []:
        cmd.extend(["--ledger-root", str(root)])
    if args.twin_json:
        cmd.extend(["--twin-json", str(args.twin_json)])
    if args.beatlab_json:
        cmd.extend(["--beatlab-json", str(args.beatlab_json)])
    if args.core_project_id:
        cmd.extend(["--core-project-id", str(args.core_project_id)])
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise SystemExit(proc.stderr or proc.stdout or "velorn-graph-sync failed")
    return json.loads(proc.stdout)


def _try_seed_map(nodes: list[dict], edges: list[dict]) -> dict[str, Any]:
    shared = Path(os.environ.get("CDX_PLATFORM_ROOT", "/home/codex450/cdx-platform")) / "_shared" / "python"
    if str(shared) not in sys.path:
        sys.path.insert(0, str(shared))
    try:
        from cdx_common.research_map import seed_map  # type: ignore
    except Exception as exc:  # noqa: BLE001 — optional CDX apply path
        return {"written": [], "errors": [f"cdx_common unavailable: {exc}"], "local_only": True}

    core = os.environ.get("CDX_CORE_API_URL", "http://127.0.0.1:7017").rstrip("/")
    mapped = []
    for edge in edges:
        item = dict(edge)
        if item.get("to_project") is not None and not item.get("to"):
            item["to_project"] = item["to_project"]
        mapped.append(item)
    res = seed_map(
        nodes,
        mapped,
        core_url=core,
        source="app_graph:velorn",
        method="observed",
        evidence="velorn:creativeops-ledger",
    )
    return {
        "written": list(getattr(res, "relationship_ids", []) or []),
        "errors": list(getattr(res, "errors", []) or []),
        "local_only": False,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--app", choices=["twin", "beatlab", "studio", "all"], default="all")
    ap.add_argument("--apply", action="store_true", help="Write edges to Core via seed_map when CDX is present.")
    ap.add_argument("--out", type=Path)
    ap.add_argument("--project", type=Path, help="Velorn project directory (project.comfystudio).")
    ap.add_argument("--ledger-root", type=Path, action="append", default=[])
    ap.add_argument("--twin-json", type=Path)
    ap.add_argument("--beatlab-json", type=Path)
    ap.add_argument("--core-project-id", type=int)
    args = ap.parse_args(argv)

    report = _discover(args)
    report["apply"] = bool(args.apply)
    if args.apply:
        seeded = _try_seed_map(report.get("nodes") or [], report.get("edges") or [])
        report["written"] = seeded.get("written") or []
        report["errors"] = seeded.get("errors") or []
        report["local_only"] = seeded.get("local_only", False)
        local = ROOT / "out" / "_creative_ops" / "_graph" / "receipts"
        local.mkdir(parents=True, exist_ok=True)
        stamp = __import__("datetime").datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
        receipt = local / f"{stamp}-{args.app}.json"
        receipt.write_text(json.dumps(report, indent=2, default=str) + "\n")
        report["local_receipt"] = str(receipt)

    text = json.dumps(report, indent=2, default=str) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text)
        summary = {
            "app": args.app,
            "edges": len(report.get("edges") or []),
            "nodes": len(report.get("nodes") or []),
            "apply": args.apply,
            "wrote": str(args.out),
            "errors": report.get("errors") or [],
        }
        print(json.dumps(summary, indent=2))
    else:
        print(text, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
