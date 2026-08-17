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
| `storyboardBoard` | live cards for the checked-out cut of the current episode |
| `productionCuts` | named drafts per episode (`draft-1`, `grok-draft-1`, …) + review timeline ids |
| `settings.cinematography` | inherited project look (lens/light/grade/mood) |
| `shortFilmDirector` | imported bible/cast/locations (hydrates production if needed) |

## MCP (Velorn app on :19790)

Read: `discover_production`, `get_production_context`, `get_shot_packet`, `studio_route_shot`, `list_episodes`, `list_cuts`, `list_production_catalog`, `studio_cast_resolve`, `studio_ref_gate`, `studio_slots_list`, `studio_flow`, `list_line_takes`, `list_voice_profiles`, `production_readiness`, `studio_graph_ledger`, `studio_animation_styles`, `studio_style_pack`, `studio_franchise`, `studio_bible`

Types (CDX Studio set): `show`, `commercial` (advertisement/ad), `music-video`, `ig-short`, `skit`, `movie` (film), `psa`, `website-tour`, `hype-video`, `site-update`, `documentary`, `animated`, `narrative` (standalone).

Write (previewOnly first): `set_production`, `create_episode`, `switch_episode`, `save_cut`, `checkout_cut`, `watch_cut`, `promote_cut`, `update_shot`, `propose_shot_camera`, `apply_shot_camera_proposal`, `studio_cast_lock`, `studio_blocking_add_character`, `studio_slots_mutate`, `studio_qa_record`, `synthesize_voiceover`, `clone_voice`, `mark_take_canonical`, `finalize_take`, `generate_lipsync_clip`, `generate_foley`, `studio_creative_ops`, `sync_production_graph`, `studio_style_pack`, `studio_franchise`, `studio_bible`

## Episode cuts (drafts)

Named versions of **one episode inside one show project**. Draft 1 and Grok Draft 1
are not sibling folders on the welcome screen. Never `create_project` / Save As for
a cut — use `save_cut`. A mistaken second folder belongs in `_archive/` and is
hidden from the project list.

The live storyboard is the checked-out version. Primary is the official version.
Saving a version does not delete the others. Switching episodes snapshots the
open version first, then loads that episode's current version.

| Action | Meaning |
|---|---|
| `save_cut` | Snapshot the live board as e.g. `Draft 1` or `Grok Draft 1` + build a review timeline |
| `checkout_cut` | Load that draft onto the live board (snapshots the outgoing draft first) |
| `watch_cut` | Open the cut’s review timeline in Sequence without promoting |
| `promote_cut` | Mark it primary. Other drafts stay. `checkout=true` also loads it. |

`project.productionCuts[episodeId]` holds the snapshots. `production.current.cutId` is the checkout pointer.

```bash
node ~/opensource/velorn/scripts/velorn-production.mjs cuts "Chi-Town Triplets"
node ~/opensource/velorn/scripts/velorn-production.mjs save-cut --name "Draft 1" --author blake "Chi-Town Triplets"
node ~/opensource/velorn/scripts/velorn-production.mjs checkout-cut --cut grok-draft-1 "Chi-Town Triplets"
node ~/opensource/velorn/scripts/velorn-production.mjs promote-cut --cut draft-1 "Chi-Town Triplets"
```

Camera handle is **meters ENU** (`x_m` right, `y_m` forward, `z_m` up, never 0). Propose does not apply. Blake or `apply_shot_camera_proposal` commits it.

## CLI (app down)

```bash
node ~/opensource/velorn/scripts/velorn-production.mjs context "Chi-Town Triplets"
node ~/opensource/velorn/scripts/velorn-production.mjs catalog
node ~/opensource/velorn/scripts/velorn-production.mjs create-episode --title "Ep 002" "Chi-Town Triplets"
node ~/opensource/velorn/scripts/velorn-production.mjs creative-ops "Chi-Town Triplets"
node ~/opensource/velorn/scripts/app_graph_sync.py --app studio
```

## Studio surfaces (this branch)

- Stage rail + cast panel on Storyboard. Cast chips show ready / blocked / frozen.
- Ref gate refuses group sheets, missing refs, and generated-output canon before generate or `studio_blocking_add_character`.
- `studio.graph.edges` records `cast_lock`, `ref_gate`, and `shot_cast` production edges.
- Style / bible / franchise strip on Storyboard + Sequence (house pack, palette, sealed bible).
- Slot state + video/audio QA pips on each card.
- Take chain chip on dialogue cards (canonical stage). Foley assign on Sequence.
- Shot routing chip: script call → ONE ecosystem + Velorn workflow (Grok draft first; GPU serial; drafts only). `studio_route_shot` / `studio_flow.routing`.
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

Lexicon, camera xyz, pose/motion, location depth→Blender, FLF last-frame, sound/VO/take-chain/lipsync/foley, multi-angles. Use them when the shot needs them. Do not dump every extension into every prompt.
