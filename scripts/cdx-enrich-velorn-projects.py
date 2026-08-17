#!/usr/bin/env python3
"""Fill Velorn project thumbnails, media pools, and storyboard sequences."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
import uuid
from pathlib import Path

INDEX = Path("/home/codex450/VelornProjects/MIGRATION-INDEX.json")
CREATIVE = Path("/home/codex450/creative")
_STUDIO_OUT = os.environ.get("CDX_STUDIO_OUT", "").strip()
DIRECTOR_OUT = Path(_STUDIO_OUT) if _STUDIO_OUT else None
RENDERS = Path("/home/codex450/creative/commercial-renders-2026")
HYPER = Path("/home/codex450/creative/hyperframes")
FFMPEG = Path("/home/codex450/.local/bin/ffmpeg")
FFPROBE = Path("/home/codex450/.local/bin/ffprobe")
THUMB_NAME = "project.thumbnail.webp"

SKIP_DIR = {
    "node_modules", ".git", "__pycache__", "clean", "gemini", "pose",
    "Cache", "blob_storage",
}
SKIP_PREFIX = ("_superseded", "_archive", "_rejected", "_purged", "_gemtest",
               "_checks", "_needs-fix", "_pending", ".region")
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
VIDEO_EXT = {".mp4", ".webm", ".mov", ".mkv"}
AUDIO_EXT = {".wav", ".mp3", ".ogg", ".flac", ".m4a", ".aac"}
MAX_FILE = 400 * 1024 * 1024
MAX_POOL = 80
MAX_STORY = 40

FOLDER_IDS = {
    "Cast": "folder-1",
    "Keyframes": "folder-2",
    "Storyboard": "folder-3",
    "Video": "folder-4",
    "Audio": "folder-5",
    "Plates": "folder-6",
    "Pool": "folder-8",
    "Other": "folder-7",
}


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def kind_of(p: Path) -> str | None:
    ext = p.suffix.lower()
    if ext in IMAGE_EXT:
        return "image"
    if ext in VIDEO_EXT:
        return "video"
    if ext in AUDIO_EXT:
        return "audio"
    return None


def skip_dir(path: Path) -> bool:
    for part in path.parts:
        if part in SKIP_DIR or part.startswith(SKIP_PREFIX):
            return True
    return False


def duration(path: Path) -> float | None:
    if not FFPROBE.is_file():
        return None
    try:
        out = subprocess.check_output(
            [str(FFPROBE), "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(path)],
            text=True, timeout=8,
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


def unique(dest_dir: Path, name: str) -> Path:
    dest = dest_dir / name
    if not dest.exists():
        return dest
    i = 2
    while True:
        cand = dest_dir / f"{dest.stem}-{i}{dest.suffix}"
        if not cand.exists():
            return cand
        i += 1


def default_transform() -> dict:
    return {
        "positionX": 0, "positionY": 0, "scaleX": 100, "scaleY": 100,
        "scaleLinked": True, "rotation": 0, "anchorX": 50, "anchorY": 50,
        "opacity": 100, "flipH": False, "flipV": False,
        "cropTop": 0, "cropBottom": 0, "cropLeft": 0, "cropRight": 0,
        "blendMode": "normal", "blur": 0,
    }


def ensure_folders(data: dict) -> dict[str, str]:
    folders = list(data.get("folders") or [])
    by_name = {f.get("name"): f for f in folders}
    created = now()
    next_id = 1
    for f in folders:
        m = re.match(r"folder-(\d+)$", str(f.get("id") or ""))
        if m:
            next_id = max(next_id, int(m.group(1)) + 1)
    mapping = {}
    for name, preferred in FOLDER_IDS.items():
        if name in by_name:
            mapping[name] = by_name[name]["id"]
            continue
        fid = preferred if preferred not in {f.get("id") for f in folders} else f"folder-{next_id}"
        if fid.startswith("folder-"):
            try:
                next_id = max(next_id, int(fid.split("-")[1]) + 1)
            except Exception:
                next_id += 1
        folders.append({
            "id": fid, "name": name, "parentId": None,
            "color": None, "createdAt": created,
        })
        mapping[name] = fid
    data["folders"] = folders
    data["folderCounter"] = max(data.get("folderCounter") or 1, next_id)
    return mapping


def sources_for(slug: str) -> list[Path]:
    roots = [
        CREATIVE / slug,
        CREATIVE / "parable-shorts" / slug,
        CREATIVE / "commercials" / slug,
        CREATIVE / "hyperframes" / slug,
        Path("/home/codex450/cdx-platform/out/_creative_ops") / slug,
    ]
    if DIRECTOR_OUT:
        roots.extend([
            DIRECTOR_OUT / slug,
            DIRECTOR_OUT / "vo" / slug,
            DIRECTOR_OUT / "_creative_ops" / slug,
        ])
    if (CREATIVE / "commercials").is_dir():
        roots += list((CREATIVE / "commercials").glob(f"{slug}*"))
    if HYPER.is_dir():
        roots += [p for p in HYPER.iterdir() if p.is_dir() and slug.startswith(p.name)]
        # website-tour slugs often equal hyperframes folder + suffix
        short = slug.replace("-website-tour", "").replace("-hype-video", "").replace("-site-update", "")
        cand = HYPER / short
        if cand.is_dir():
            roots.append(cand)
    out = []
    for p in roots:
        if p.is_dir() and p not in out:
            out.append(p)
    return out


def already(data: dict, src: Path) -> bool:
    for a in data.get("assets") or []:
        if str(src) == (a.get("settings") or {}).get("cdxSource"):
            return True
        path = a.get("path") or ""
        if path.endswith("/" + src.name) or path.endswith(src.name):
            # same basename already imported
            if src.name == Path(path).name:
                return True
    return False


def add_asset(data: dict, dest_root: Path, src: Path, folder_id: str) -> dict | None:
    kind = kind_of(src)
    if not kind or already(data, src):
        return None
    try:
        size = src.stat().st_size
    except OSError:
        return None
    if size <= 0 or size > MAX_FILE:
        return None
    sub = "images" if kind == "image" else "video" if kind == "video" else "audio"
    dest = unique(dest_root / "assets" / sub, src.name)
    link_or_copy(src, dest)
    asset = {
        "id": f"asset_{uuid.uuid4().hex[:12]}",
        "name": dest.stem,
        "type": kind,
        "path": f"assets/{sub}/{dest.name}",
        "absolutePath": str(dest),
        "createdAt": now(),
        "imported": now(),
        "isImported": True,
        "mimeType": {"image": "image/png", "video": "video/mp4", "audio": "audio/wav"}[kind],
        "size": size,
        "folderId": folder_id,
        "prompt": "",
        "settings": {
            "duration": duration(src) if kind != "image" else None,
            "cdxSource": str(src),
        },
    }
    data.setdefault("assets", []).append(asset)
    return asset


def classify(rel: str) -> str:
    blob = rel.lower()
    if "/locked/" in blob or blob.startswith("locked/"):
        return "Keyframes"
    if "storyboard" in blob:
        return "Storyboard"
    if any(k in blob for k in ("/cast", "/refs", "/_refs", "character", "face")):
        return "Cast"
    if "plate" in blob:
        return "Plates"
    if any(k in blob for k in ("/video", "/renders", "/assembly", "/clip")):
        return "Video"
    if any(k in blob for k in ("/audio", "/vo", "/voice", "tts")):
        return "Audio"
    if "/keyframes/" in blob:
        return "Pool"
    return "Other"


def find_slots(slug: str) -> list[dict]:
    for p in [
        CREATIVE / slug / "ep001" / "storyboard" / "slots.json",
        CREATIVE / slug / "storyboard" / "slots.json",
    ]:
        if p.is_file():
            try:
                return json.loads(p.read_text()).get("slots") or []
            except Exception:
                return []
    return []


def locked_first_map(slug: str) -> dict[str, Path]:
    mapping = {}
    dirs = []
    for root in [CREATIVE / slug, CREATIVE / "parable-shorts" / slug]:
        dirs += list(root.glob("ep*/keyframes/locked"))
        dirs.append(root / "keyframes" / "locked")
    for d in dirs:
        if not d.is_dir():
            continue
        for f in d.iterdir():
            if not f.is_file() or f.suffix.lower() not in IMAGE_EXT:
                continue
            name = f.name
            if "-first" in name:
                shot = name.split("-first")[0]
                mapping.setdefault(shot, f)
            mapping.setdefault(f.stem, f)
    return mapping


def storyboard_images(slug: str) -> list[Path]:
    cands = [
        CREATIVE / slug / "ep001" / "storyboard",
        CREATIVE / slug / "storyboard",
        CREATIVE / "parable-shorts" / slug / "storyboard",
    ]
    if DIRECTOR_OUT:
        cands.append(DIRECTOR_OUT / slug / "storyboard_v2")
        if (DIRECTOR_OUT / slug).is_dir():
            cands += list((DIRECTOR_OUT / slug).glob("versions/*/storyboard"))
    best: list[Path] = []
    for d in cands:
        if not d.is_dir():
            continue
        imgs = sorted(
            p for p in d.iterdir()
            if p.is_file() and p.suffix.lower() in IMAGE_EXT and not p.name.startswith(".")
        )
        if len(imgs) > len(best):
            best = imgs
    return best


def make_clip(i: int, asset: dict, start: float, dur: float, label: str | None = None) -> dict:
    clip = {
        "id": f"clip-{i}",
        "trackId": "video-1" if asset["type"] != "audio" else "audio-1",
        "assetId": asset["id"],
        "name": label or asset["name"],
        "startTime": start,
        "duration": dur,
        "sourceDuration": None if asset["type"] == "image" else dur,
        "trimStart": 0,
        "trimEnd": dur,
        "speed": 1,
        "reverse": False,
        "color": "#a89030" if asset["type"] == "image" else "#3d7080",
        "type": asset["type"],
        "enabled": True,
        "transform": default_transform(),
    }
    if label:
        clip["metadata"] = {"cdxSlot": label}
    return clip


def rebuild_storyboard(data: dict, dest_root: Path, slug: str, folders: dict[str, str]) -> int:
    fps = float((data.get("settings") or {}).get("fps") or 24)
    width = int((data.get("settings") or {}).get("width") or 1080)
    height = int((data.get("settings") or {}).get("height") or 1920)
    clips = []
    t = 0.0
    i = 1
    assets_by_source = {}
    assets_by_name = {}
    for a in data.get("assets") or []:
        src = (a.get("settings") or {}).get("cdxSource")
        if src:
            assets_by_source[src] = a
        assets_by_name[a.get("name")] = a

    slots = find_slots(slug)
    locked = locked_first_map(slug)
    used = set()

    def asset_for(path: Path) -> dict | None:
        existing = assets_by_source.get(str(path))
        if existing:
            return existing
        added = add_asset(data, dest_root, path, folders["Storyboard"])
        if added:
            assets_by_source[str(path)] = added
        return added

    if slots:
        for slot in sorted(slots, key=lambda s: (s.get("order") or 0, s.get("slot_id") or "")):
            shot = slot.get("board_shot") or slot.get("slot_id")
            path = locked.get(shot)
            if path is None and shot:
                # try first-frame naming
                for key, p in locked.items():
                    if key == shot or key.startswith(str(shot) + "-") or str(shot).startswith(key):
                        path = p
                        break
            if path is None:
                continue
            asset = asset_for(path)
            if not asset:
                continue
            dur = float(slot.get("dur_s") or 2.0)
            label = f"{slot.get('order')}. {slot.get('slot_id')}"
            clips.append(make_clip(i, asset, t, dur, label))
            used.add(str(path))
            t += dur
            i += 1

    if not clips:
        images = storyboard_images(slug)
        if not images:
            # fallback: locked first frames in name order
            images = [locked[k] for k in sorted(locked) if k.endswith("") and "-first" in locked[k].name]
            if not images:
                images = [locked[k] for k in sorted(locked)]
        for path in images[:MAX_STORY]:
            asset = asset_for(path)
            if not asset:
                continue
            clips.append(make_clip(i, asset, t, 2.0, path.stem))
            used.add(str(path))
            t += 2.0
            i += 1

    timelines = list(data.get("timelines") or [])
    story = None
    for tl in timelines:
        if tl.get("id") == "timeline-storyboard" or (tl.get("name") or "").lower() == "storyboard":
            story = tl
            break
    if story is None:
        story = {
            "id": "timeline-storyboard",
            "name": "Storyboard",
            "created": now(),
            "width": width, "height": height, "fps": fps,
            "tracks": [
                {"id": "video-1", "name": "Video 1", "type": "video",
                 "muted": False, "locked": False, "visible": True},
                {"id": "audio-1", "name": "Audio 1", "type": "audio",
                 "channels": "stereo", "muted": False, "locked": False, "visible": True},
            ],
            "transitions": [],
            "transitionCounter": 1,
        }
        timelines.insert(0, story)
    story.update({
        "modified": now(),
        "clips": clips,
        "clipCounter": i + 1,
        "duration": max(60.0, t + 5.0),
        "width": width, "height": height, "fps": fps,
    })
    data["timelines"] = timelines
    data["currentTimelineId"] = story["id"]
    return len(clips)


def write_thumbnail(dest_root: Path, data: dict) -> str | None:
    # prefer first storyboard image, then any image, then first video frame
    src = None
    story = None
    for tl in data.get("timelines") or []:
        if tl.get("id") == "timeline-storyboard":
            story = tl
            break
    assets = {a["id"]: a for a in data.get("assets") or []}
    if story:
        for clip in story.get("clips") or []:
            a = assets.get(clip.get("assetId"))
            if a and a.get("type") == "image":
                cand = dest_root / a["path"]
                if cand.is_file():
                    src = cand
                    break
    if src is None:
        for a in data.get("assets") or []:
            if a.get("type") == "image":
                cand = dest_root / a["path"]
                if cand.is_file():
                    src = cand
                    break
    dest = dest_root / THUMB_NAME
    vf = "scale=480:270:force_original_aspect_ratio=increase,crop=480:270"
    if src is not None:
        try:
            from PIL import Image
            im = Image.open(src).convert("RGB")
            # cover 480x270
            tw, th = 480, 270
            scale = max(tw / im.width, th / im.height)
            nw, nh = int(im.width * scale), int(im.height * scale)
            im = im.resize((nw, nh), Image.Resampling.LANCZOS)
            left = (nw - tw) // 2
            top = (nh - th) // 2
            im = im.crop((left, top, left + tw, top + th))
            im.save(dest, "WEBP", quality=80)
            return THUMB_NAME
        except Exception:
            if FFMPEG.is_file():
                subprocess.run(
                    [str(FFMPEG), "-y", "-i", str(src), "-vf", vf, "-frames:v", "1", str(dest)],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20,
                )
                if dest.is_file() and dest.stat().st_size > 0:
                    return THUMB_NAME
    # video fallback
    for a in data.get("assets") or []:
        if a.get("type") != "video":
            continue
        cand = dest_root / a["path"]
        if not cand.is_file() or not FFMPEG.is_file():
            continue
        subprocess.run(
            [str(FFMPEG), "-y", "-ss", "0.4", "-i", str(cand), "-vf", vf, "-frames:v", "1", str(dest)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30,
        )
        if dest.is_file() and dest.stat().st_size > 0:
            return THUMB_NAME
    return None


def import_tree(data: dict, dest_root: Path, slug: str, folders: dict[str, str]) -> tuple[int, int]:
    added = 0
    pool = 0
    # locked + storyboard first
    locked = locked_first_map(slug)
    for path in locked.values():
        if add_asset(data, dest_root, path, folders["Keyframes"]):
            added += 1
    for path in storyboard_images(slug):
        if add_asset(data, dest_root, path, folders["Storyboard"]):
            added += 1

    prefer = (
        "keyframes/locked", "keyframes", "storyboard", "assets/refs",
        "assets/plates", "assets", "video", "audio", "vo", "renders",
    )
    for root in sources_for(slug):
        walk_roots = []
        for rel in prefer:
            p = root / rel
            if p.is_dir():
                walk_roots.append(p)
        for ep in root.glob("ep*"):
            if ep.is_dir():
                for rel in prefer:
                    p = ep / rel
                    if p.is_dir():
                        walk_roots.append(p)
        if not walk_roots:
            walk_roots = [root]
        for start in walk_roots:
            for dirpath, dirnames, filenames in os.walk(start):
                d = Path(dirpath)
                dirnames[:] = [n for n in dirnames if not skip_dir(d / n)]
                if skip_dir(d):
                    continue
                try:
                    rel = str(d.relative_to(root))
                except ValueError:
                    rel = str(d)
                folder_name = classify(rel + "/")
                for name in filenames:
                    if name.startswith("."):
                        continue
                    src = d / name
                    k = kind_of(src)
                    if not k:
                        continue
                    dest_folder = folder_name
                    if dest_folder == "Pool" and pool >= MAX_POOL:
                        continue
                    if add_asset(data, dest_root, src, folders.get(dest_folder, folders["Other"])):
                        added += 1
                        if dest_folder == "Pool":
                            pool += 1

    # commercial renders by prefix
    if RENDERS.is_dir():
        for src in RENDERS.iterdir():
            if src.is_file() and src.name.lower().startswith(slug.replace("-website-tour", "")[:12]):
                if add_asset(data, dest_root, src, folders["Video"]):
                    added += 1
    return added, pool


def enrich_one(rec: dict) -> dict:
    dest = Path(rec["path"])
    pj = dest / "project.comfystudio"
    if not pj.is_file():
        return {"slug": rec["slug"], "ok": False, "reason": "missing project"}
    data = json.loads(pj.read_text())
    folders = ensure_folders(data)
    added, pool = import_tree(data, dest, rec["slug"], folders)
    story_n = rebuild_storyboard(data, dest, rec["slug"], folders)
    thumb = write_thumbnail(dest, data)
    if thumb:
        data["thumbnail"] = thumb
    data["modified"] = now()
    mig = data.setdefault("cdxMigration", {})
    mig["importedAssets"] = len(data.get("assets") or [])
    mig["storyboardClips"] = story_n
    mig["thumbnail"] = thumb
    pj.write_text(json.dumps(data, indent=2) + "\n")
    rec["assets"] = len(data.get("assets") or [])
    rec["storyboardClips"] = story_n
    rec["thumbnail"] = bool(thumb)
    return rec


def main() -> None:
    idx = json.loads(INDEX.read_text())
    results = []
    for rec in idx["projects"]:
        out = enrich_one(rec)
        results.append(out)
        print(
            f"OK {out.get('slug')} assets={out.get('assets')} "
            f"story={out.get('storyboardClips')} thumb={out.get('thumbnail')}"
        )
    idx["enriched"] = now()
    idx["projects"] = results
    INDEX.write_text(json.dumps(idx, indent=2) + "\n")
    thumbs = sum(1 for r in results if r.get("thumbnail"))
    stories = sum(1 for r in results if (r.get("storyboardClips") or 0) > 0)
    print(f"DONE thumbs={thumbs}/{len(results)} storyboards={stories}/{len(results)}")


if __name__ == "__main__":
    main()
