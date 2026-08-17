# Velorn evaluation rubrics + studio audit

**Date:** 2026-08-16 · **Kanban:** t_5329eb27 · **Spec source:** CDX Studio `evaluation_rubrics.MediaRubric` + `cdx-studio-audit` (semantics only, not a code port)

Velorn now owns the same verdicts and QA workflow as Studio, using `project.comfystudio` instead of `cdx-video-director` :7060.

## Verdicts (DONE ≠ PASSED)

| Verdict | Meaning | Next |
|---|---|---|
| **NEEDS_REGEN** | recorded QA fail | regenerate — reason is required |
| **READY_TO_GENERATE** | both keyframes locked, no clip | generate next (GPU serial, drafts only) |
| **DIALOGUE_BLOCKED** | dialogue whose VO is not canonical | record VO first |
| **NEEDS_FLF** | one or both keyframes not locked | keyframe work first |
| **DONE** | clip exists | watch + record a verdict; unverified is not a pass |

## Rubrics

`src/services/evaluationRubrics.js`

- `frame.v1` / `video.v1` / `audio.v1`
- Technical checks always win over subjective scores
- Missing evaluator or incomplete checks → `human_review` (never auto-approve)
- `automated_pass` is not human approval

## Surfaces

| Surface | What |
|---|---|
| QA panel | Storyboard card **QA** button + Inspector (selected clip) |
| Timeline | REGEN / READY / QA / UNV / FLF badge on video clips |
| MCP | `studio_audit` (read) · `studio_qa_record` accepts rubric checks/scores |
| CLI | `node scripts/velorn-studio-audit.mjs [project]` |
| Graph | `studio.qaGraph` rebuilt on every recorded verdict |

## CLI

```bash
node scripts/velorn-studio-audit.mjs "Chi-Town Triplets"
node scripts/velorn-studio-audit.mjs --json --verdict READY_TO_GENERATE
node scripts/velorn-studio-audit.mjs --record s1-ots --result pass --reason "forward motion, on-model"
node scripts/velorn-studio-audit.mjs --record fx4-punch --video fail --reason "punch reads in reverse"
```

`--reason` is required on fail.

## Policy

GPU serial. Outward artifacts stay drafts until a human cut. No Postiz / publish from this path.
