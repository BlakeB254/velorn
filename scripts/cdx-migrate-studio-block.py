#!/usr/bin/env python3
"""Migration pass v3 — populate the `studio` block in Velorn project files.

Ports CDX Studio source data (cast hierarchy, storyboard slots, QA verdicts,
docs/EDLs, blocking records) into each Velorn project's project.comfystudio,
and closes the known pass-1/2 gaps (audio folder taxonomy, orphan assets
already sitting unregistered in the project's assets/ tree).

Semantics mirror cdx-video-director/app/studio (storyboard_slots.py,
qa_verdicts.py, cast_resolver.py); the in-app model lives in
src/services/studioStore.js.

Idempotent: the studio block is rewritten deterministically from source, and
re-running produces the same end state. A backup (project.comfystudio
.bak-studio-v3) is written before the first touch of each project file.

Usage:
    python3 scripts/cdx-migrate-studio-block.py                # all projects
    python3 scripts/cdx-migrate-studio-block.py --slug chi-town-triplets
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import hashlib
import time
from pathlib import Path

import yaml

INDEX = Path("/home/codex450/VelornProjects/MIGRATION-INDEX.json")
CREATIVE = Path("/home/codex450/creative")

BACKUP_SUFFIX = ".bak-studio-v3"

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
VIDEO_EXT = {".mp4", ".webm", ".mov", ".mkv"}
AUDIO_EXT = {".wav", ".mp3", ".ogg", ".flac", ".m4a", ".aac"}
MAX_TOTAL_ASSETS = 4000  # orphan registration cap (pass 1's 120 was for imports)

RESERVED_KEYS = {"locations", "settings", "meta", "characters"}
QA_RESULTS = {"pass", "fail", "unverified"}
PATH_FIELDS = ("anchor", "face_ref", "pendant_cutout")
PATH_DICT_FIELDS = ("ref_set", "ref_set_draft")

AUDIO_TAXONOMY = ("vo", "music", "foley", "ambience", "sfx")
AUDIO_FOLDER_NAMES = {"vo": "VO", "music": "Music", "foley": "Foley",
                      "ambience": "Ambience", "sfx": "SFX"}

BLOCKING_INCLUDE_DIRS = ("versions", "runs", "genjobs")
BLOCKING_INCLUDE_FILES = ("blocking.json", "settings.json")


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def empty_studio() -> dict:
    return {
        "version": 1,
        "cast": {"series": {}, "seasons": {}, "episodes": {}},
        "slots": [],
        "qa": {},
        "edls": [],
        "blockingIndex": [],
        "locations": {},
    }


def link_or_copy(src: Path, dest: Path) -> bool:
    """Hardlink (or copy) src → dest. Returns True when a file was placed."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        return False
    try:
        os.link(src, dest)
    except OSError:
        shutil.copy2(src, dest)
    return True


def source_root(slug: str) -> Path | None:
    for root in (CREATIVE / slug,
                 CREATIVE / "parable-shorts" / slug,
                 CREATIVE / "commercials" / slug):
        if root.is_dir():
            return root
    return None


def episode_dirs(root: Path) -> list[Path]:
    return sorted(p for p in root.iterdir() if p.is_dir() and re.match(r"^ep\d+$", p.name))


# ── cast ─────────────────────────────────────────────────────────────────────

def parse_cast_file(path: Path) -> dict[str, dict]:
    """One cast yaml → {cast_id: fields}. Corrupt/missing degrades to {}."""
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    out: dict[str, dict] = {}
    chars = data.get("characters")
    if isinstance(chars, list):
        for item in chars:
            if not isinstance(item, dict):
                continue
            cid = item.get("cast_id") or item.get("id")
            if not cid:
                continue
            out[str(cid)] = {k: v for k, v in item.items() if k not in ("id", "cast_id")}
    for key, body in data.items():
        if key in RESERVED_KEYS or not isinstance(body, dict):
            continue
        out.setdefault(str(key), dict(body))
    return out


def parse_locations(path: Path) -> dict:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if isinstance(data, dict) and isinstance(data.get("locations"), dict):
        return data["locations"]
    return {}


def series_cast_file(root: Path) -> Path | None:
    for cand in (root / "cast" / "series.yaml", root / "cast.yaml", root / "docs" / "cast.yaml"):
        if cand.is_file():
            return cand
    return None


def build_cast(root: Path, asset_by_basename: dict[str, dict]) -> tuple[dict, dict]:
    """→ (cast block, locations). Members found in the project's registered
    assets (by ref-path basename) get a refAssetIds list."""
    cast = {"series": {}, "seasons": {}, "episodes": {}}
    locations: dict = {}

    series_file = series_cast_file(root)
    if series_file:
        cast["series"] = parse_cast_file(series_file)
        locations = parse_locations(series_file)

    cast_dir = root / "cast"
    if cast_dir.is_dir():
        for f in sorted(cast_dir.glob("season-*.yaml")):
            m = re.search(r"season-(\d+)", f.stem)
            if m:
                cast["seasons"][f"season-{int(m.group(1)):02d}"] = parse_cast_file(f)

    for ep in episode_dirs(root):
        f = ep / "cast.yaml"
        if f.is_file():
            cast["episodes"][ep.name] = parse_cast_file(f)

    for tier_members in [cast["series"],
                         *[t for t in cast["seasons"].values()],
                         *[t for t in cast["episodes"].values()]]:
        for member in tier_members.values():
            ref_ids: set[str] = set()
            candidates: list[str] = []
            for field in PATH_FIELDS:
                val = member.get(field)
                if isinstance(val, str) and val.strip():
                    candidates.append(val)
            for field in PATH_DICT_FIELDS:
                ref_set = member.get(field)
                if isinstance(ref_set, dict):
                    candidates += [v for v in ref_set.values() if isinstance(v, str) and v.strip()]
            for val in candidates:
                asset = asset_by_basename.get(Path(val).name)
                if asset:
                    ref_ids.add(asset["id"])
            if ref_ids:
                member["refAssetIds"] = sorted(ref_ids)
    return cast, locations


# ── slots ────────────────────────────────────────────────────────────────────

def find_slots_file(root: Path) -> Path | None:
    for ep in episode_dirs(root):
        p = ep / "storyboard" / "slots.json"
        if p.is_file():
            return p
    p = root / "storyboard" / "slots.json"
    return p if p.is_file() else None


def locked_frame_map(root: Path) -> dict[str, dict[str, Path]]:
    """shot → {'first': path, 'last': path} from keyframes/locked."""
    frames: dict[str, dict[str, Path]] = {}
    dirs = [root / "keyframes" / "locked"]
    dirs += [ep / "keyframes" / "locked" for ep in episode_dirs(root)]
    for d in dirs:
        if not d.is_dir():
            continue
        for f in sorted(d.iterdir()):
            if not f.is_file() or f.suffix.lower() not in IMAGE_EXT:
                continue
            m = re.match(r"^(?P<shot>.*?)-(?P<which>first|last)", f.stem)
            if not m:
                continue
            frames.setdefault(m.group("shot"), {}).setdefault(m.group("which"), f)
    return frames


def build_slots(root: Path, keyframe_asset_ids: dict[str, str]) -> list[dict]:
    """slots.json → studio.slots, approved frames mapped to Keyframes asset ids.

    keyframe_asset_ids maps both absolute cdxSource paths and basenames of
    assets in the Keyframes folder to their asset id.
    """
    p = find_slots_file(root)
    if not p:
        return []
    try:
        raw = json.loads(p.read_text()).get("slots") or []
    except Exception:
        return []
    locked = locked_frame_map(root)
    slots = []
    for s in raw:
        if not isinstance(s, dict) or not s.get("slot_id"):
            continue
        shot = s.get("board_shot") or s.get("slot_id")
        assigned = {"first": None, "last": None}
        frames = locked.get(shot) or {}
        for which in ("first", "last"):
            path = frames.get(which)
            if not path:
                continue
            assigned[which] = (keyframe_asset_ids.get(str(path))
                               or keyframe_asset_ids.get(path.name))
        slots.append({
            "slot_id": s["slot_id"],
            "order": s.get("order"),
            "action": s.get("action") or "",
            "audio": s.get("audio") or "",
            "dur_s": s.get("dur_s"),
            "lane": s.get("lane") or "",
            "board_shot": s.get("board_shot"),
            "assigned": assigned,
            "notes": s.get("notes") or "",
            "source": s.get("source") or "edl",
            "created": s.get("created") or "",
        })
    slots.sort(key=lambda x: (x.get("order") or 0, x["slot_id"]))
    return slots


# ── QA ───────────────────────────────────────────────────────────────────────

def find_verdicts_file(root: Path) -> Path | None:
    for ep in episode_dirs(root):
        p = ep / "qa" / "verdicts.json"
        if p.is_file():
            return p
    p = root / "qa" / "verdicts.json"
    return p if p.is_file() else None


def build_qa(root: Path) -> dict:
    """verdicts.json → studio.qa, verbatim per-track records (v1 flat input is
    upgraded to both tracks, mirroring qa_verdicts._migrate_v1)."""
    p = find_verdicts_file(root)
    if not p:
        return {}
    try:
        raw = json.loads(p.read_text())
    except Exception:
        return {}
    if not isinstance(raw, dict):
        return {}
    verdicts = raw.get("verdicts") if raw.get("store_version") == 2 else raw
    if not isinstance(verdicts, dict):
        return {}
    out: dict[str, dict] = {}
    for shot, entry in verdicts.items():
        if not isinstance(entry, dict):
            continue
        if "result" in entry:  # v1 combined → both tracks
            entry = {"video": entry, "audio": entry}
        rec = {}
        for track in ("video", "audio"):
            t = entry.get(track) or {}
            if not isinstance(t, dict):
                t = {}
            result = t.get("result") if t.get("result") in QA_RESULTS else "unverified"
            rec[track] = {
                "result": result,
                "reason": t.get("reason") or "",
                "by": t.get("by") or "",
                "at": t.get("at") or "",
            }
        out[str(shot)] = rec
    return out


# ── docs + blocking ──────────────────────────────────────────────────────────

def copy_docs(root: Path, dest_root: Path, write: bool = True) -> tuple[int, list[str]]:
    """ep*/docs/*.md|json → docs/cdx/. Returns (files present, edl names).

    The count reflects what exists in docs/cdx/ after the pass, so re-runs
    report the same numbers (idempotent MIGRATION-INDEX counts)."""
    present = 0
    edls: list[str] = []
    doc_dirs = [ep / "docs" for ep in episode_dirs(root) if (ep / "docs").is_dir()]
    if not doc_dirs and (root / "docs").is_dir():
        doc_dirs = [root / "docs"]
    for d in doc_dirs:
        for src in sorted(d.iterdir()):
            if not src.is_file() or src.suffix.lower() not in (".md", ".json"):
                continue
            # same-name file already present → already migrated; never dupe
            dest = dest_root / "docs" / "cdx" / src.name
            if dest.exists() or (write and link_or_copy(src, dest)):
                present += 1
            if "edl" in src.stem.lower() and src.suffix.lower() == ".json":
                if src.name not in edls:
                    edls.append(src.name)
    return present, sorted(edls)


def copy_blocking(root: Path, dest_root: Path, write: bool = True) -> tuple[int, list[str]]:
    """ep*/blocking/<shot>/{blocking.json,settings.json,versions/,runs/,genjobs/}
    → docs/blocking/<shot>/. Control-frame PNGs (artifacts/) are NOT copied —
    they are multi-GB and stay in the creative tree.

    Returns (shot count, shot list) — shots present, not files newly copied,
    so re-runs report the same numbers."""
    shots: list[str] = []
    blocking_roots = [ep / "blocking" for ep in episode_dirs(root) if (ep / "blocking").is_dir()]
    if not blocking_roots and (root / "blocking").is_dir():
        blocking_roots = [root / "blocking"]
    for broot in blocking_roots:
        for shot_dir in sorted(p for p in broot.iterdir() if p.is_dir()):
            has_records = False
            targets: list[tuple[Path, Path]] = []
            for name in BLOCKING_INCLUDE_FILES:
                src = shot_dir / name
                if src.is_file():
                    targets.append((src, dest_root / "docs" / "blocking" / shot_dir.name / name))
            for sub in BLOCKING_INCLUDE_DIRS:
                sdir = shot_dir / sub
                if not sdir.is_dir():
                    continue
                for src in sorted(sdir.rglob("*.json")):
                    if src.is_file():
                        targets.append((src, dest_root / "docs" / "blocking" / shot_dir.name / src.relative_to(shot_dir)))
            has_records = bool(targets)
            if write:
                for src, dest in targets:
                    link_or_copy(src, dest)
            if has_records and shot_dir.name not in shots:
                shots.append(shot_dir.name)
    return len(shots), sorted(shots)


# ── audio taxonomy + orphan assets ───────────────────────────────────────────

def ensure_folder(data: dict, name: str, parent_id: str | None = None) -> str:
    for f in data.get("folders") or []:
        if f.get("name") == name and f.get("parentId") == parent_id:
            return f["id"]
    next_id = 1
    for f in data.get("folders") or []:
        m = re.match(r"folder-(\d+)$", str(f.get("id") or ""))
        if m:
            next_id = max(next_id, int(m.group(1)) + 1)
    fid = f"folder-{next_id}"
    data.setdefault("folders", []).append({
        "id": fid, "name": name, "parentId": parent_id,
        "color": None, "createdAt": now(),
    })
    data["folderCounter"] = max(data.get("folderCounter") or 1, next_id + 1)
    return fid


def move_audio_into_taxonomy(data: dict) -> int:
    """Re-file registered audio assets into VO/Music/Foley/Ambience/SFX child
    folders based on their source path under ep*/audio/<kind>/. Moves only —
    never duplicates."""
    audio_parent = None
    for f in data.get("folders") or []:
        if f.get("name") == "Audio":
            audio_parent = f["id"]
            break
    if audio_parent is None:
        return 0
    moved = 0
    for asset in data.get("assets") or []:
        if asset.get("type") != "audio":
            continue
        blob = ((asset.get("settings") or {}).get("cdxSource") or asset.get("path") or "").lower()
        m = re.search(r"/audio/(vo|music|foley|ambience|sfx)/", blob)
        if not m:
            continue
        folder_id = ensure_folder(data, AUDIO_FOLDER_NAMES[m.group(1)], audio_parent)
        if asset.get("folderId") != folder_id:
            asset["folderId"] = folder_id
            moved += 1
    return moved


def classify_orphan(rel_under_assets: str) -> str:
    """Folder name for an orphan file by its path inside the project's assets/
    tree. Mirrors the enrich pass's classify() on the destination side."""
    blob = rel_under_assets.lower()
    if "locked" in blob:
        return "Keyframes"
    if "storyboard" in blob:
        return "Storyboard"
    if any(k in blob for k in ("cast", "refs", "character", "face")):
        return "Cast"
    if "plate" in blob:
        return "Plates"
    if any(k in blob for k in ("video", "render", "assembly", "clip")):
        return "Video"
    if any(k in blob for k in ("audio", "vo", "voice", "tts", "music", "foley", "ambience", "sfx")):
        return "Audio"
    if "keyframe" in blob or "pool" in blob:
        return "Pool"
    return "Other"


def register_orphans(data: dict, dest_root: Path) -> int:
    """Register files already on disk under assets/ that have no asset record.
    Ids are content-derived from the path so re-runs are deterministic."""
    assets_dir = dest_root / "assets"
    if not assets_dir.is_dir():
        return 0
    assets = data.setdefault("assets", [])
    registered = {a.get("path") for a in assets}
    registered_abs = {a.get("absolutePath") for a in assets}
    added = 0
    for dirpath, _dirnames, filenames in os.walk(assets_dir):
        for name in sorted(filenames):
            if name.startswith("."):
                continue
            src = Path(dirpath) / name
            ext = src.suffix.lower()
            if ext in IMAGE_EXT:
                kind = "image"
            elif ext in VIDEO_EXT:
                kind = "video"
            elif ext in AUDIO_EXT:
                kind = "audio"
            else:
                continue
            rel = str(src.relative_to(dest_root))
            if rel in registered or str(src) in registered_abs:
                continue
            if len(assets) >= MAX_TOTAL_ASSETS:
                return added
            try:
                size = src.stat().st_size
            except OSError:
                continue
            if size <= 0:
                continue
            folder_name = classify_orphan(rel)
            folder_id = None
            for f in data.get("folders") or []:
                if f.get("name") == folder_name:
                    folder_id = f["id"]
                    break
            if folder_id is None:
                folder_id = ensure_folder(data, folder_name)
            asset_id = "asset_" + hashlib.md5(rel.encode()).hexdigest()[:12]
            assets.append({
                "id": asset_id,
                "name": src.stem,
                "type": kind,
                "path": rel,
                "absolutePath": str(src),
                "createdAt": now(),
                "imported": now(),
                "isImported": True,
                "mimeType": {"image": "image/png", "video": "video/mp4", "audio": "audio/wav"}[kind],
                "size": size,
                "folderId": folder_id,
                "prompt": "",
                "settings": {"duration": None, "cdxOrphan": True},
            })
            registered.add(rel)
            added += 1
    return added


# ── per-project migration ────────────────────────────────────────────────────

def migrate_one(rec: dict, dry_run: bool = False) -> dict:
    dest = Path(rec["path"])
    pj = dest / "project.comfystudio"
    if not pj.is_file():
        return {**rec, "studioError": "missing project file"}
    data = json.loads(pj.read_text())

    assets = data.get("assets") or []
    asset_by_basename: dict[str, dict] = {}
    for a in assets:
        for cand in (a.get("path"), (a.get("settings") or {}).get("cdxSource")):
            if cand:
                asset_by_basename.setdefault(Path(cand).name, a)

    folders = data.get("folders") or []
    keyframes_id = next((f["id"] for f in folders if f.get("name") == "Keyframes"), None)
    keyframe_asset_ids: dict[str, str] = {}
    for a in assets:
        if keyframes_id and a.get("folderId") != keyframes_id:
            continue
        src = (a.get("settings") or {}).get("cdxSource")
        if src:
            keyframe_asset_ids.setdefault(src, a["id"])
        if a.get("path"):
            keyframe_asset_ids.setdefault(Path(a["path"]).name, a["id"])

    root = source_root(rec["slug"])

    studio = empty_studio()
    docs_present = 0
    blocking_shots = 0
    if root:
        cast, locations = build_cast(root, asset_by_basename)
        studio["cast"] = cast
        studio["locations"] = locations
        studio["slots"] = build_slots(root, keyframe_asset_ids)
        studio["qa"] = build_qa(root)
        docs_present, studio["edls"] = copy_docs(root, dest, write=not dry_run)
        blocking_shots, studio["blockingIndex"] = copy_blocking(root, dest, write=not dry_run)

    data["studio"] = studio
    audio_moved = move_audio_into_taxonomy(data)
    orphans = register_orphans(data, dest)

    counts = {
        "slots": len(studio["slots"]),
        "cast": sum(len(t) for t in studio["cast"]["seasons"].values())
                + sum(len(t) for t in studio["cast"]["episodes"].values())
                + len(studio["cast"]["series"]),
        "qa": len(studio["qa"]),
        "docs": docs_present,
        "blocking": blocking_shots,
    }
    if counts["slots"] > 0 and counts["cast"] > 0 and counts["qa"] > 0:
        status = "full"
    elif any(counts[k] > 0 for k in ("slots", "cast", "qa", "docs", "blocking")):
        status = "partial"
    else:
        status = "shell"

    mig = data.setdefault("cdxMigration", {})
    mig["studioV3"] = {**counts, "audioMoved": audio_moved, "orphansRegistered": orphans}

    out = {**rec, "studio": counts, "status": status,
           "audioMoved": audio_moved, "orphansRegistered": orphans,
           "assets": len(data.get("assets") or [])}

    if dry_run:
        return out

    serialized = json.dumps(data, indent=2) + "\n"
    if pj.read_text() != serialized:
        backup = dest / ("project.comfystudio" + BACKUP_SUFFIX)
        if not backup.exists():
            shutil.copy2(pj, backup)
        pj.write_text(serialized)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slug", help="migrate only this project slug")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    idx = json.loads(INDEX.read_text())
    results = []
    for rec in idx["projects"]:
        if args.slug and rec.get("slug") != args.slug:
            results.append(rec)
            continue
        out = migrate_one(rec, dry_run=args.dry_run)
        results.append(out)
        s = out.get("studio") or {}
        print(f"{out.get('slug')}: status={out.get('status')} "
              f"slots={s.get('slots', 0)} cast={s.get('cast', 0)} qa={s.get('qa', 0)} "
              f"docs={s.get('docs', 0)} blocking={s.get('blocking', 0)} "
              f"audioMoved={out.get('audioMoved', 0)} orphans={out.get('orphansRegistered', 0)}")

    if not args.dry_run:
        idx["projects"] = results
        idx["studioV3"] = now()
        INDEX.write_text(json.dumps(idx, indent=2) + "\n")
        print(f"INDEX updated ({len(results)} projects)")


if __name__ == "__main__":
    main()
