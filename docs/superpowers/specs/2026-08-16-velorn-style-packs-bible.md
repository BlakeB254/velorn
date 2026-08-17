# Velorn style packs / bible / franchises

Parity row 12. Studio Python (`style_packs.py`, `franchises.py`, `production_bible.py`, `animation_styles.py`) is **spec only**. Velorn owns the implementation.

## Contract

- One style pack per production. Beat prompts describe action. The pack carries look, LoRAs, palette, negatives, camera language.
- Franchise is the shared IP parent. Binding inherits house pack, animation style, and default aspect when those fields are empty.
- Bible is a deterministic snapshot of identity + cast + locations + style + constraints. Seal it so generators stop inventing identity.
- GPU serial. Outward artifacts stay drafts. MCP writes default to `previewOnly`.

## Where it lives

| Surface | Path |
|---|---|
| Catalogs | `src/catalogs/{stylePacks,franchises,animationStyles}.catalog.js` |
| Services | `src/services/{stylePacks,franchises,animationStyles,productionBible}.js` |
| Production fields | `production.franchiseSlug`, `production.stylePack`, `production.animationStyle`, `production.bible` |
| Packet | `get_production_context` → `style`, `franchise`, `bible`, `franchiseConsistency` |
| UI | Storyboard Cast + Style/bible/franchise details; Sequence inspector strip |
| Generate | `composeGenerationPrompt` appends pack + animation tails |

Regenerate catalogs from Studio YAML (does not copy runtime Python):

```bash
python3 scripts/_build_style_catalogs.py
```

## MCP

| Tool | Ops | Write? |
|---|---|---|
| `studio_animation_styles` | list / get | read |
| `studio_style_pack` | list / get / apply | apply is previewOnly by default |
| `studio_franchise` | list / get / bind / consistency | bind is previewOnly by default |
| `studio_bible` | build / import / seal / unseal / shot_brief / apply | seal/import/unseal previewOnly by default |

## Seeded catalogs

- Style packs: `hex-halo-street`, `bw-detective-noir`
- Franchises: `chi-town-triplets` (house pack hex-halo-street), `little-legend-riders` (animation `classic-2d-cel`)
- Animation cards: 39 film/animation styles including `classic-2d-cel`

## Tests

```bash
npm run test:style-packs-bible
npm run test:production-store
```
