# Velorn production packet

Agents should treat this project file as a **show workspace**. The live storyboard / sequence is the **current episode**. Everything else is inherited context.

```
show concept / house look / standing cast
        ↓
season arc / season overrides
        ↓
episode plot / guests / this board
        ↓
shot: lexicon + camera xyz handle + 1 location + 0–N characters + pose/motion + still/clip
```

## Where it lives

`project.comfystudio`:

| Key | Role |
|-----|------|
| `production` | type (`show`…), bible, seasons[], current episode pointer |
| `studio` | CDX-ported cast tiers, slots, QA, EDL/blocking index |
| `storyboardBoard` | live cards for the current episode |
| `settings.cinematography` | inherited project look (lens/light/grade/mood) |
| `shortFilmDirector` | imported bible/cast/locations (hydrates production if needed) |

## MCP (Velorn app on :19790)

Read: `get_production_context`, `get_shot_packet`, `list_episodes`, `list_production_catalog`, `studio_cast_resolve`, `studio_slots_list`, `studio_flow`

Write (previewOnly first): `set_production`, `create_episode`, `switch_episode`, `update_shot`, `propose_shot_camera`, `apply_shot_camera_proposal`, `studio_slots_mutate`, `studio_qa_record`

Camera handle is **meters ENU** (`x_m` right, `y_m` forward, `z_m` up, never 0). Propose does not apply. Blake or `apply_shot_camera_proposal` commits it.

## CLI (app down)

```bash
node ~/opensource/velorn/scripts/velorn-production.mjs context "Chi-Town Triplets"
node ~/opensource/velorn/scripts/velorn-production.mjs catalog
node ~/opensource/velorn/scripts/velorn-production.mjs create-episode --title "Ep 002" "Chi-Town Triplets"
```

## Studio surfaces (this branch)

- Stage rail + cast panel on Storyboard.
- Slot state + video/audio QA pips on each card.
- Blocking: 2D ENU handle (drag camera, edit xyz). Save `docs/blocking/<shot>/blocking.json`. Generate from blocking queues `cdx-ltx-union-control-flf`.

## CDX workflow pack

Bundled as `public/workflows/cdx_*.json` (`cdx-keyframe-multiref`, `cdx-ltx-union-control-flf`, reactor, inpaint+ref, depth/pose extract, scene compose).

## Output ratio

Project default (Storyboard / Sequence **Output** bar) plus optional per-shot override:

| Target | Device | Aspect | Edit canvas | Generate (32-aligned) |
|---|---|---|---|---|
| `mobile` | phone | 9:16 | 1080×1920 | 768×1344 |
| `computer` | desktop | 16:9 | 1920×1080 | 1344×768 |
| `square` | feed | 1:1 | 1080×1080 | 1024×1024 |
| `portrait-feed` | phone feed | 4:5 | 1080×1350 | 896×1120 |

MCP: `set_production` with `outputTarget: "computer"` or `update_shot` with `outputTarget`. Generate events pass `resolution` so Comfy gets the generate size, not a stretched 1080 canvas.

## Optional extensions

Lexicon, camera xyz, pose/motion, location depth→Blender, FLF last-frame, sound/VO/music, multi-angles. Use them when the shot needs them. Do not dump every extension into every prompt.
