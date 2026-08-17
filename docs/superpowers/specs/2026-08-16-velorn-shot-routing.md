# Velorn shot routing matrix

Velorn-native classifier: **script call → one ecosystem → one Velorn workflow**.

Spec sources (semantics only, no Studio Python copied):

- `cdx-shot-routing` living matrix
- `cdx-generative-ecosystems` one-bundle rule

Implementation: `src/services/shotRouting.js`

## Surfaces

| Surface | What it does |
|---|---|
| `studio_route_shot` | Classify a description or an open-project card. Does not queue GPU. |
| `studio_flow.routing` | Same matrix for every storyboard card / studio slot |
| `get_shot_packet` / `shot.routing` | Per-shot choice on the production packet |
| Storyboard card chip + Generate panel | Shows the choice; seeds still/video workflow ids when still on defaults |

## Policy

- GPU serial
- Outward artifacts stay **drafts** until a human cut
- Talking characters need moving lips unless the line is marked off-screen
- Client-facing types (`commercial`, `psa`, `hype-video`, `website-tour`, `site-update`) or `clientSafe=true` never keep US-excluded MiniMax H3

## Classes

`vo` · `surgical_fix` · `signage` · `talking_character` · `action` · `continuity` · `identity` · `audio_synced` · `establishing` · `atmosphere` · `draft_still` · `draft_clip` · `narrative`

Kanban: t_d9d90abe (parity row 9).
