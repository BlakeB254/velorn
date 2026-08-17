#!/usr/bin/env python3
"""Create Velorn projects from the live CDX Studio dashboard.

Does not modify CDX Studio, Kdenlive, or ComfyUI model trees.
Media is hardlinked when possible, copied otherwise.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
import uuid
from pathlib import Path

DASHBOARD = Path("/tmp/cdx-dashboard.json")
VELORN_ROOT = Path("/home/codex450/VelornProjects")
CREATIVE = Path("/home/codex450/creative")
_STUDIO_OUT = os.environ.get("CDX_STUDIO_OUT", "").strip()
DIRECTOR_OUT = Path(_STUDIO_OUT) if _STUDIO_OUT else None
FFPROBE = Path("/home/codex450/.local/bin/ffprobe")

SKIP_DIR_PARTS = {
    "node_modules",
    ".git",
    "__pycache__",
    "_superseded",
    "_archive",
    "_archive-bak",
    "clean",
    "gemini",
    "pose",
    "Cache",
    "blob_storage",
}
SKIP_NAME_PREFIXES = ("_superseded", "_archive", ".")
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
VIDEO_EXT = {".mp4", ".webm", ".mov", ".mkv"}
AUDIO_EXT = {".wav", ".mp3", ".ogg", ".flac", ".m4a", ".aac"}
MAX_FILE_BYTES = 80 * 1024 * 1024
MAX_ASSETS_PER_PROJECT = 120
MAX_STILLS_ON_BOARD = 24
MAX_CLIPS_ON_CUT = 20


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def safe_name(title: str, slug: str) -> str:
    raw = (title or slug or "Untitled").strip()
    raw = raw.replace("“", "").replace("”", "").replace('"', "")
    raw = re.sub(r"[\\/:*?<>|]", " ", raw)
    raw = re.sub(r"\s+", " ", raw).strip(" .")
    return (raw or slug)[:90]


def aspect_for(project: dict) -> tuple[int, int, float]:
    ptype = (project.get("type") or "").lower()
    if ptype in {"show", "skit", "animated", "animated-short", "commercial", "psa", "hype-video"}:
        return 1080, 1920, 24.0
    if ptype in {"website-tour", "site-update", "narrative"}:
        return 1920, 1080, 24.0
    return 1080, 1920, 24.0


def folder_defs() -> list[dict]:
    names = [
        ("Cast", "#e85d04"),
        ("Keyframes", "#5a7a9e"),
        ("Storyboard", "#a89030"),
        ("Video", "#3d7080"),
        ("Audio", "#2d5f4a"),
        ("Plates", "#737373"),
        ("Other", "#5c5c5c"),
    ]
    created = now_iso()
    return [
        {
            "id": f"folder-{i}",
            "name": name,
            "parentId": None,
            "color": color,
            "createdAt": created,
        }
        for i, (name, color) in enumerate(names, start=1)
    ]


def classify_folder(rel: str, name: str) -> str:
    blob = f"{rel}/{name}".lower()
    if any(k in blob for k in ("cast", "ref", "character", "face", "wardrobe")):
        return "folder-1"
    if "keyframe" in blob or "/locked/" in blob:
        return "folder-2"
    if "storyboard" in blob or "board" in blob:
        return "folder-3"
    if any(k in blob for k in ("video", "clip", "render", "assembly", "cut")):
        return "folder-4"
    if any(k in blob for k in ("audio", "vo", "voice", "tts", "music")):
        return "folder-5"
    if "plate" in blob or "location" in blob:
        return "folder-6"
    return "folder-7"


def should_skip_dir(path: Path) -> bool:
    parts = set(path.parts)
    if parts & SKIP_DIR_PARTS:
        return True
    return any(part.startswith(SKIP_NAME_PREFIXES) for part in path.parts)


def source_roots(slug: str) -> list[Path]:
    roots = [
        CREATIVE / slug,
        CREATIVE / "parable-shorts" / slug,
        CREATIVE / "commercials" / slug,
        CREATIVE / "hyperframes" / slug,
        Path("/home/codex450/cdx-platform/out/_creative_ops") / slug,
    ]
    if DIRECTOR_OUT:
        roots.append(DIRECTOR_OUT / slug)
    extra = list((CREATIVE / "commercials").glob(f"{slug}*")) if (CREATIVE / "commercials").exists() else []
    extra += list((CREATIVE / "hyperframes").glob(f"*{slug}*")) if (CREATIVE / "hyperframes").exists() else []
    out: list[Path] = []
    for p in roots + extra:
        if p.is_dir() and p not in out:
            out.append(p)
    return out


def iter_media(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        d = Path(dirpath)
        dirnames[:] = [n for n in dirnames if not should_skip_dir(d / n)]
        if should_skip_dir(d):
            continue
        for name in filenames:
            if name.startswith("."):
                continue
            ext = Path(name).suffix.lower()
            if ext not in IMAGE_EXT | VIDEO_EXT | AUDIO_EXT:
                continue
            p = d / name
            try:
                size = p.stat().st_size
            except OSError:
                continue
            if size <= 0 or size > MAX_FILE_BYTES:
                continue
            kind = "image" if ext in IMAGE_EXT else "video" if ext in VIDEO_EXT else "audio"
            yield p, kind, size


def ffprobe_duration(path: Path) -> float | None:
    if not FFPROBE.is_file():
        return None
    try:
        out = subprocess.check_output(
            [str(FFPROBE), "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
            text=True,
            timeout=8,
        ).strip()
        val = float(out)
        return val if val > 0 else None
    except Exception:
        return None


def link_or_copy(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        return
    try:
        os.link(src, dest)
    except OSError:
        shutil.copy2(src, dest)


def unique_dest(dest_dir: Path, name: str) -> Path:
    dest = dest_dir / name
    if not dest.exists():
        return dest
    stem, ext = dest.stem, dest.suffix
    i = 2
    while True:
        cand = dest_dir / f"{stem}-{i}{ext}"
        if not cand.exists():
            return cand
        i += 1


def default_timeline(name: str, tid: str, width: int, height: int, fps: float, clips: list, duration: float) -> dict:
    return {
        "id": tid,
        "name": name,
        "color": None,
        "folderId": None,
        "created": now_iso(),
        "modified": now_iso(),
        "width": width,
        "height": height,
        "fps": fps,
        "duration": max(60.0, duration + 5.0),
        "zoom": 100,
        "tracks": [
            {"id": "video-1", "name": "Video 1", "type": "video", "muted": False, "locked": False, "visible": True},
            {"id": "audio-1", "name": "Audio 1", "type": "audio", "channels": "stereo", "muted": False, "locked": False, "visible": True},
        ],
        "clips": clips,
        "transitions": [],
        "clipCounter": len(clips) + 1,
        "transitionCounter": 1,
        "snappingEnabled": True,
        "snappingThreshold": 10,
        "rippleEditMode": False,
    }


def make_clip(i: int, asset: dict, start: float, duration: float, fps: float) -> dict:
    return {
        "id": f"clip-{i}",
        "trackId": "video-1" if asset["type"] != "audio" else "audio-1",
        "assetId": asset["id"],
        "name": asset["name"],
        "startTime": start,
        "duration": duration,
        "sourceDuration": duration if asset["type"] != "image" else None,
        "trimStart": 0,
        "trimEnd": duration,
        "sourceFps": fps if asset["type"] == "video" else None,
        "timelineFps": fps,
        "sourceTimeScale": 1,
        "speed": 1,
        "reverse": False,
        "color": "#3d7080" if asset["type"] != "audio" else "#2d5f4a",
        "type": asset["type"],
        "enabled": True,
        "transform": {
            "positionX": 0,
            "positionY": 0,
            "scaleX": 100,
            "scaleY": 100,
            "scaleLinked": True,
            "rotation": 0,
            "anchorX": 50,
            "anchorY": 50,
            "opacity": 100,
            "flipH": False,
            "flipV": False,
            "cropTop": 0,
            "cropBottom": 0,
            "cropLeft": 0,
            "cropRight": 0,
            "blendMode": "normal",
            "blur": 0,
        },
    }


def episode_dirs(roots: list[Path]) -> list[Path]:
    found = []
    for root in roots:
        for p in sorted(root.glob("ep*")):
            if p.is_dir() and re.match(r"ep\d+", p.name, re.I):
                found.append(p)
    return found


def migrate_one(project: dict) -> dict:
    slug = project["slug"]
    name = safe_name(project.get("title") or slug, slug)
    dest = VELORN_ROOT / name
    if dest.exists() and not (dest / "project.comfystudio").exists():
        dest = VELORN_ROOT / f"{name} ({slug})"
    dest.mkdir(parents=True, exist_ok=True)
    for sub in (
        "assets/video",
        "assets/audio",
        "assets/images",
        "renders",
        "autosave",
        "cache",
        "docs",
    ):
        (dest / sub).mkdir(parents=True, exist_ok=True)

    width, height, fps = aspect_for(project)
    folders = folder_defs()
    assets: list[dict] = []
    imported = 0
    sources = source_roots(slug)
    for src_root in sources:
        for src, kind, size in iter_media(src_root):
            if imported >= MAX_ASSETS_PER_PROJECT:
                break
            sub = "images" if kind == "image" else "video" if kind == "video" else "audio"
            dest_file = unique_dest(dest / "assets" / sub, src.name)
            link_or_copy(src, dest_file)
            rel = f"assets/{sub}/{dest_file.name}"
            folder_id = classify_folder(str(src.relative_to(src_root)), src.name)
            duration = None
            if kind == "video" or kind == "audio":
                duration = ffprobe_duration(src)
            asset = {
                "id": f"asset_{uuid.uuid4().hex[:12]}",
                "name": dest_file.stem,
                "type": kind,
                "path": rel,
                "absolutePath": str(dest_file),
                "createdAt": now_iso(),
                "imported": now_iso(),
                "isImported": True,
                "mimeType": {
                    "image": "image/png",
                    "video": "video/mp4",
                    "audio": "audio/wav",
                }[kind],
                "size": size,
                "folderId": folder_id,
                "prompt": "",
                "settings": {
                    "duration": duration,
                    "sourcePath": str(src),
                    "cdxSource": str(src),
                },
            }
            assets.append(asset)
            imported += 1
        if imported >= MAX_ASSETS_PER_PROJECT:
            break

    stills = [a for a in assets if a["type"] == "image"][:MAX_STILLS_ON_BOARD]
    videos = [a for a in assets if a["type"] == "video"][:MAX_CLIPS_ON_CUT]

    timelines = []
    t0_clips = []
    t = 0.0
    for i, asset in enumerate(stills, start=1):
        dur = 2.0
        t0_clips.append(make_clip(i, asset, t, dur, fps))
        t += dur
    timelines.append(default_timeline("Storyboard", "timeline-storyboard", width, height, fps, t0_clips, t))

    t1_clips = []
    t = 0.0
    for i, asset in enumerate(videos, start=1):
        dur = float(asset.get("settings", {}).get("duration") or 5.0)
        t1_clips.append(make_clip(1000 + i, asset, t, dur, fps))
        t += dur
    timelines.append(default_timeline("Assembly", "timeline-assembly", width, height, fps, t1_clips, t))

    for ep in episode_dirs(sources):
        label = ep.name.upper().replace("EP", "Episode ")
        timelines.append(
            default_timeline(label.strip(), f"timeline-{ep.name.lower()}", width, height, fps, [], 60.0)
        )

    # Show/series always get at least Episode 1
    if project.get("type") in {"show", "animated"} and not any(
        (tl["name"] or "").lower().startswith("episode") for tl in timelines
    ):
        ep_no = project.get("episode") or 1
        season = project.get("season") or 1
        timelines.append(
            default_timeline(
                f"S{season}E{ep_no}",
                f"timeline-s{season}e{ep_no}",
                width,
                height,
                fps,
                [],
                60.0,
            )
        )

    project_data = {
        "name": name,
        "version": "1.1",
        "created": now_iso(),
        "modified": now_iso(),
        "settings": {
            "width": width,
            "height": height,
            "fps": fps,
            "aspectRatio": f"{width}:{height}",
        },
        "timelines": timelines,
        "currentTimelineId": timelines[0]["id"],
        "assets": assets,
        "folders": folders,
        "folderCounter": len(folders) + 1,
        "flowAi": {"version": 1, "activeDocumentId": None, "documents": []},
        "generateWorkspace": None,
        "cdxMigration": {
            "slug": slug,
            "title": project.get("title"),
            "type": project.get("type"),
            "status": project.get("status"),
            "season": project.get("season"),
            "episode": project.get("episode"),
            "runtime": project.get("runtime_label"),
            "franchise": project.get("franchise"),
            "studioUrl": project.get("url"),
            "sourceRoots": [str(p) for p in sources],
            "importedAssets": imported,
        },
    }
    (dest / "project.comfystudio").write_text(json.dumps(project_data, indent=2) + "\n")
    (dest / "docs" / "CDX-MIGRATION.md").write_text(
        f"""# {name}

Migrated from CDX Studio (`:7060`) on {now_iso()}.

- Slug: `{slug}`
- Type: `{project.get('type')}`
- Status: `{project.get('status')}`
- Runtime: `{project.get('runtime_label')}`
- Studio: `{project.get('url')}`
- Imported media files: {imported}
- Source folders:\n"""
        + "\n".join(f"  - `{p}`" for p in sources or ["(none on disk)"])
        + """

CDX Studio remains the original production record. This Velorn project is the
edit/generate workspace copy. Original files were hardlinked when possible.
"""
    )
    return {
        "slug": slug,
        "name": name,
        "path": str(dest),
        "assets": imported,
        "timelines": len(timelines),
        "sources": len(sources),
    }


def main() -> None:
    dashboard = json.loads(DASHBOARD.read_text())
    projects = dashboard["projects"]
    VELORN_ROOT.mkdir(parents=True, exist_ok=True)
    results = []
    for project in projects:
        results.append(migrate_one(project))
        print(f"OK {results[-1]['slug']} -> {results[-1]['name']} assets={results[-1]['assets']} timelines={results[-1]['timelines']}")
    (VELORN_ROOT / "MIGRATION-INDEX.json").write_text(json.dumps({"created": now_iso(), "projects": results}, indent=2) + "\n")
    print(f"DONE {len(results)} projects in {VELORN_ROOT}")


if __name__ == "__main__":
    main()
