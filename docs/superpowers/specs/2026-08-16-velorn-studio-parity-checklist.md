# Velorn ← CDX Studio Parity Checklist
**Date:** 2026-08-16
**Gate for deleting cdx-video-director MCP / custom CDX Studio**
**Velorn is the permanent foundational video production + edit surface.**

**Status:** 15/22 ✅ | 7 ❌ decomposed into child Kanban tasks (t_91b290aa orchestrator)

## Decomposition (t_91b290aa)
Child tasks created (all parented to t_91b290aa, assigned to programmer, branches off cdx-eval-0.3.25 in ~/opensource/velorn):

- t_510ae56d — Port cast lock/ref gate
- t_d9d90abe — Port shot routing matrix (cdx-shot-routing)
- t_d34b92db — Port CreativeOps ledger → production graph
- t_f3e76d3f — Port take chain/VO/lipsync/foley
- t_978f5101 — Port style packs/bible/franchises
- t_5329eb27 — Port evaluation rubrics
- t_ed3aed05 — Port Core trace bridge + skill_version_id

Update this checklist + Core #396 as each child lands. Final deletion card after all ✅.

## Parity Matrix (22 rows)

| # | Capability | Status | Owner | Branch/PR | Notes / Spec Source | Kanban |
|---|------------|--------|-------|-----------|---------------------|--------|
| 1 | Production packet / discover_production, get_production_context | ✅ | programmer | cdx-eval-0.3.25 | production-packet.md | - |
| 2 | Episode cuts (save_cut, checkout_cut, watch_cut, promote_cut) | ✅ | programmer | merged | Cuts are versions of one episode | - |
| 3 | Studio board / studio_board, studio_flow | ✅ | director | merged | Storyboard cards, slots | - |
| 4 | Studio blocking (studio_blocking_*) | ✅ | director | merged | 2D ENU camera handles, FLF | - |
| 5 | Studio QA record (studio_qa_record) | ✅ | director | merged | Per-shot verdicts | - |
| 6 | Studio cast resolve (studio_cast_resolve) | ✅ | director | merged | Cast tiers, slots | - |
| 7 | Studio slots mutate / list | ✅ | programmer | merged | Slot state on cards | - |
| 8 | **Cast lock / ref gate** | ❌ | director+programmer | tbd (t_510ae56d) | cdx-cast-lock skill + ref gate logic from cdx-video-director | t_510ae56d |
| 9 | **Shot routing matrix (cdx-shot-routing)** | ❌ | director+programmer | [PR #2](https://github.com/BlakeB254/velorn/pull/2) | Velorn-native router in `studio_flow` / `studio_route_shot` / storyboard UI. Flip ✅ after merge. | t_d9d90abe |
| 10 | **CreativeOps ledger → production graph** | ❌ | director+programmer | tbd (t_d34b92db) | Append-only _creative_ops/<slug>, map to Velorn production graph edges | t_d34b92db |
| 11 | **Take chain / VO / lipsync / foley** | ❌ | director+programmer | tbd (t_f3e76d3f) | take chain, synthesize_voiceover, generate_lipsync_clip, foley from cdx-video-director | t_f3e76d3f |
| 12 | **Style packs / bible / franchises** | ❌ | director+programmer | tbd (t_978f5101) | style packs, bible import, franchise consistency | t_978f5101 |
| 13 | **Evaluation rubrics** | ❌ | director+programmer | tbd (t_5329eb27) | Per-shot rubrics, studio_qa_record extension, cdx-studio-audit integration | t_5329eb27 |
| 14 | **Core trace bridge + skill_version_id** | ❌ | director+programmer | tbd (t_ed3aed05) | Bridge to Core project #396, trace with skill_version_id | t_ed3aed05 |
| 15 | cdx-film-lexicon integration | ✅ | director | merged | Shot lexicon | - |
| 16 | cdx-viral-pacing in timeline | ✅ | director | merged | Edit pacing rules | - |
| 17 | ComfyUI / LTX25 / H3 bundles in Velorn | ✅ | programmer | merged | cdx-generative-ecosystems routing | - |
| 18 | Blender VSE / blocking render | ✅ | programmer | merged | cdx-blender-vse | - |
| 19 | Studio desk / pipeline | ✅ | director | merged | studio_desk, studio_pipeline | - |
| 20 | Kanban map receipt per card | ✅ | operator | merged | POST /kanban/receipt for studio+beatlab | - |
| 21 | GPU serial + drafts-only outward | ✅ | programmer | merged | Earlyoom / queue rules | - |
| 22 | Deletion of cdx-video-director once complete | ❌ | director | final card | Only after all above ✅ and checklist updated + Core #396 closed | t_91b290aa (final) |

**Instructions for each child card:** (see decomposition section above)
- Director owns production semantics (extracted in checklist + skills like cdx-shot-routing, cdx-cast-lock, cdx-studio-audit, velorn-production, versioned-creative-pipelines).
- Programmer implements the port as PR.
- Work **exclusively in ~/opensource/velorn** — branch off `cdx-eval-0.3.25`.
- After landing PR: update this row to ✅ with PR link, update Core project #396 description.
- GPU serial; drafts-only outward.
- Every card must end with MAP RECEIPT (`POST http://127.0.0.1:7028/kanban/receipt` using template from GET /contracts).
- When all 7 ports + deletion done, this checklist reaches 22/22 ✅.

**Core Project Reference:** #396 — track parity progress here (update description after each PR).

**Version note:** This is v1 of the living checklist (append-only updates preferred for future rows). See velorn/docs/production-packet.md for current packet spec. Maintain append-only CreativeOps under out/_creative_ops/.

**Next:** Programmer cards will now execute the ports one-by-one (serial where GPU involved).
