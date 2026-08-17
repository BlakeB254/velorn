# Velorn CreativeOps ledger → production graph

Velorn-native append-only ledger plus a production-graph mapper.

Spec sources (semantics only, no Studio Python copied):

- `ai-creativeops-pipelines` folder contract
- `versioned-creative-pipelines` never overwrite a generation
- `cdx-data-capture` drafts-only outward; provenance on every edge
- `cdx_common.app_graph` World Twin / Beat Lab / Studio map shapes

Implementation:

- `src/services/creativeOps.js`
- `src/services/productionGraph.js`
- `src/services/creativeOpsDisk.js` (Node/CLI only)
- `scripts/velorn-graph-sync.mjs`
- `scripts/app_graph_sync.py`

## Surfaces

| Surface | What it does |
|---|---|
| `studio_creative_ops` | get / ensure / record / feedback / link. Defaults to previewOnly on writes. |
| `studio_graph_ledger` | Owned productions + mapped nodes/edges (read-only). |
| `sync_production_graph` | Snapshot the map onto `project.productionGraph`. Does not write Core. |
| `scripts/app_graph_sync.py` | Dry-run mapper. `--apply` writes THE MAP via `seed_map` when CDX is present. |

## Folder contract

```text
<project>/out/_creative_ops/<slug>/
  manifest.json
  approval_profile.json
  generations.jsonl
  versions/ variants/ review_queue/ regeneration_queue/
  ready_pool/ publishing_packages/ feedback/
  social_metadata/ comfy_runs/ source_links/
```

Rules: append-only, never overwrite media, human approval before publish, GPU serial, outward artifacts stay drafts.

## Graph edges

| App | Edge | Evidence |
|---|---|---|
| Studio / CreativeOps | entity `--uses-->` product(model) | `studio:production:<slug>` |
| Beat Lab | model `--used_by-->` project | `skill:cdx-beat-lab` |
| World Twin | place `--hosts-->` project; dataset `--used_by-->` project | `twin:<slug>` |

Unowned productions (no `entity_id`) are reported, not guessed.

Kanban: t_d34b92db (parity row 10).
