# Velorn Core trace bridge + skill_version_id

Velorn-native ledger bridge to Core project #396.

Spec sources (semantics only, no Studio Python copied):

- `cdx-data-aware-workflows` entity/project/graph context
- `cdx-data-capture` drafts-only, search-before-create, cite `skill_version_id`
- `cdx-video-director` `trace_bridge.py` coded telemetry (prompt/path stay off the ledger)

Implementation:

- `src/services/coreTraceBridge.js`
- MCP: `studio_core_trace`, `studio_skill_context`, `studio_entity_resolve`, `studio_map_receipt`
- CLI: `scripts/velorn-production.mjs trace-plan | skill-cite | receipt-plan`

## Surfaces

| Surface | What it does |
|---|---|
| `studio_core_trace` | get / plan generation / feedback / MCP call. previewOnly default. |
| `studio_skill_context` | cite / attach Skills Registry version. |
| `studio_entity_resolve` | search-before-create. Unique match only; never invent. |
| `studio_map_receipt` | Build receipt with `skill_version_id` + `used_skill`. Does not post. |
| production packet `core` | `coreProjectId` 396, entity link, skill citation, last trace. |

## Rules

- Ledger payloads are coded telemetry only. Prompt text, reviewer notes, and filesystem paths stay local.
- Every generation and MCP production action can carry `skill_version_id`.
- Unowned productions (no `entity_id`) are reported, not guessed.
- GPU serial; outward artifacts stay drafts.
- Posting THE MAP is `POST http://127.0.0.1:7028/kanban/receipt` after preview.

Kanban: t_ed3aed05 (parity row 14).
