---
name: cdx-studio-production-types
description: The CDX Studio production-type taxonomy and its flows — show, movie, commercial, skit, ig-short, parody, music-video, psa, animated, narrative, website-tour, hype-video, site-update, documentary. Use when creating a project, deciding pacing/aspect/runtime for a piece, choosing which flow to run, or when a request names a format like "make a commercial" or "cut a skit".
tools: Read, Grep
---

# Production types and flows

A production type is not a label — it carries the pacing, aspect, output target and tool flow for
that kind of piece. Set it correctly and everything downstream inherits sane defaults. The canonical
definitions live in `src/services/productionTypes.js`; `discover_production` and
`list_production_catalog` return them live, so prefer calling those over guessing.

## The types

| id | Runtime | Aspect | Pace notes |
|---|---|---|---|
| `show` | 30–60s/episode | 9:16 | Episodic, seasons + episodes. Hook by 2s, max hold 4s. |
| `movie` | 1–3 min | 16:9 | Cinema pace. Hook by 8s, max hold 12s. Computer output. |
| `commercial` | 15–30s | 9:16 | One product, one CTA. Hook by 2s, max hold 2.5s. |
| `skit` | 20–45s | 9:16 | Premise → escalate → punch. |
| `ig-short` | 7–20s | 9:16 | Single idea, no establish. Hook by 1.5s. |
| `parody` | matches source | 16:9 | Source-faithful remake, swapped content. |
| `music-video` | full track or 60s | 9:16 | Picture to track. Use the dedicated MV tools. |
| `psa` | 30–60s | 9:16 | Sincerity register, single action CTA. |
| `animated` | 15–120s | 9:16 | Animation as medium; pair with a secondary form. |
| `narrative` | 30–90s | 9:16 | General / untyped creative work. |
| `website-tour` | 15–30s | 9:16 | Product site walkthrough. |
| `hype-video` | 15–30s | 9:16 | Energy-forward brand montage. |
| `site-update` | 15–20s | 9:16 | Changelog / feature drop. |
| `documentary` | 1–5 min | 16:9 | Nonfiction short. Cinema pace. |

A fifteenth id, `animated-short`, still resolves but is a **legacy alias** — prefer `animated`
paired with a secondary form.

Aliases normalize: `advertisement`/`advert`/`ad` → `commercial`, `film`/`short-film` → `movie`,
`series`/`episode` → `show`, `reel`/`shorts` → `ig-short`, `mv`/`music video` → `music-video`,
`promo`/`hype` → `hype-video`, `doc` → `documentary`.

## Picking one

Ask what the piece *does*, not how long it is:

- Selling a specific product or service, with a call to action → `commercial`.
- Recurring cast, numbered episodes → `show`.
- Standalone joke with a punchline → `skit`.
- Cut to a track → `music-video`.
- Walking through a site or product UI → `website-tour`.

When genuinely ambiguous, ask. Retyping a project later means redoing pacing decisions.

## Flows

Each type maps to a flow — an ordered tool sequence. Fetch them with `discover_production`.

**`show-episode`** is the most involved, and its ordering matters: load the production context, pick
a cut (never overwrite blindly), **lock the cast before generating**, route each shot to exactly one
ecosystem, finalize every dialogue take before lipsync, then generate — previewOnly first, GPU
serial, drafts only — and QA before promoting.

**`commercial`** is deliberately short: discover, set the type, one product and one CTA, generate
one-beat clips, then add the end card **in post**. Never generate text as part of an image.

**`music-video`** must start from `get_music_video_session`. Do not build a parallel storyboard for
a music video; the dedicated tools own that state.

**`review-deliver`** applies to every type: analyze, check media health, record the take, watch,
promote, export.

## Ad types carry a brand

`commercial`, `psa`, `hype-video`, `site-update` and `website-tour` are the types that sell
something. They link an org and its offerings, which then feed the prompt as a brand context layer —
see `cdx-studio-context-stack`.
