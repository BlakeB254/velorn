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

## Optional extensions

Lexicon, camera xyz, pose/motion, location depth→Blender, FLF last-frame, sound/VO/music, multi-angles. Use them when the shot needs them. Do not dump every extension into every prompt.
