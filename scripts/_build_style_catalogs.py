#!/usr/bin/env python3
"""One-shot catalog vendor: Studio YAML -> Velorn JS modules (spec only).

Source root is the legacy CDX Studio service this data was migrated from.
Velorn itself must never hardcode that path (see tests/cdxStudioIsolation.test.js) --
set STYLE_CATALOG_SOURCE_ROOT when re-running this one-shot vendoring step.
"""
import json
import os
from pathlib import Path

import yaml

ROOT = Path(os.environ["STYLE_CATALOG_SOURCE_ROOT"]) if os.environ.get("STYLE_CATALOG_SOURCE_ROOT") else None
OUT = Path("/home/codex450/opensource/velorn.worktrees/t_978f5101/src/catalogs")


def js_module(name, data, banner):
    payload = json.dumps(data, indent=2, ensure_ascii=False)
    return f"/** {banner} */\nexport const {name} = {payload}\n"


def main():
    if ROOT is None:
        raise SystemExit('Set STYLE_CATALOG_SOURCE_ROOT to the legacy source directory before running this one-shot vendoring step.')
    OUT.mkdir(parents=True, exist_ok=True)

    packs = []
    for path in sorted((ROOT / "styles" / "style-packs").glob("*.yaml")):
        if path.name.startswith("_"):
            continue
        data = yaml.safe_load(path.read_text()) or {}
        stem = path.stem
        packs.append({
            "id": stem,
            "name": data.get("name") or stem,
            "summary": data.get("summary") or "",
            "applies_to": list(data.get("applies_to") or []),
            "parody_of": data.get("parody_of"),
            "kind": data.get("kind") or "house",
            "swatches": list(data.get("swatches") or []),
            "prompt_tail": (data.get("prompt_tail") or "").strip(),
            "video_prompt_tail": (data.get("video_prompt_tail") or "").strip(),
            "negative_tail": (data.get("negative_tail") or "").strip(),
            "lora_stack": list(data.get("lora_stack") or []),
            "resolution": data.get("resolution"),
            "aspect": str(data.get("aspect") or ""),
            "camera_language": (data.get("camera_language") or "").strip(),
            "grade": (data.get("grade") or "").strip(),
            "pacing": (data.get("pacing") or "").strip(),
            "sound": (data.get("sound") or "").strip(),
            "notes": (data.get("notes") or "").strip(),
            "brand_id": data.get("brand_id"),
            "pace_mode": data.get("pace_mode"),
        })
    (OUT / "stylePacks.catalog.js").write_text(
        js_module(
            "STYLE_PACK_CATALOG",
            packs,
            "Velorn-native style pack catalog. Semantics from CDX Studio styles/style-packs (spec only).",
        )
    )

    franchises = []
    for path in sorted((ROOT / "franchises").glob("*.yaml")):
        data = yaml.safe_load(path.read_text()) or {}
        franchises.append({
            "slug": data.get("slug") or path.stem,
            "name": data.get("name") or path.stem,
            "summary": (data.get("summary") or "").strip(),
            "status": data.get("status") or "active",
            "cast_canon_path": data.get("cast_canon_path") or "",
            "locations_path": data.get("locations_path") or "",
            "style_pack": (data.get("style_pack") or "").strip().strip("`"),
            "animation_style": (data.get("animation_style") or "").strip(),
            "default_aspect": data.get("default_aspect") or "9:16",
            "project_kinds": list(data.get("project_kinds") or []),
            "project_slugs": list(data.get("project_slugs") or []),
            "brand": data.get("brand") or "",
            "invariants": list(data.get("invariants") or []),
            "tags": list(data.get("tags") or []),
            "source": "velorn-catalog",
        })
    (OUT / "franchises.catalog.js").write_text(
        js_module(
            "FRANCHISE_CATALOG",
            franchises,
            "Velorn-native franchise catalog. Semantics from CDX Studio franchises/*.yaml (spec only).",
        )
    )

    anim = yaml.safe_load((ROOT / "styles" / "animation-styles.yaml").read_text()) or {}
    styles = []
    for item in anim.get("styles") or []:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        cat = (item.get("category") or "other").strip().lower()
        if cat in ("film", "cinematic"):
            family = "film"
        elif cat in ("2d", "anime", "3d", "painterly", "graphic", "stop-motion"):
            family = "animation"
        else:
            family = "other"
        styles.append({
            "id": item["id"],
            "name": item.get("name") or item["id"],
            "tagline": (item.get("tagline") or "").strip(),
            "category": cat,
            "family": family,
            "swatches": list(item.get("swatches") or []),
            "prompt_tail": (item.get("prompt_tail") or "").strip(),
            "negative_tail": (item.get("negative_tail") or "").strip(),
            "best_for": list(item.get("best_for") or []),
            "style_pack": item.get("style_pack"),
            "aspect_default": item.get("aspect_default") or "9:16",
        })
    (OUT / "animationStyles.catalog.js").write_text(
        js_module(
            "ANIMATION_STYLE_CATALOG",
            styles,
            "Velorn-native animation/film style cards. Semantics from CDX Studio styles/animation-styles.yaml (spec only).",
        )
    )
    print(f"packs={len(packs)} franchises={len(franchises)} styles={len(styles)}")


if __name__ == "__main__":
    main()
