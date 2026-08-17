# Velorn take chain / VO / lipsync / foley

Native Velorn production audio. Studio Python (`take_chain.py`,
`cdx-video-direction-dialogue`, LIPDUB, Foley V2A) is the **spec**, not
code to copy.

Implementation: `src/services/takeChain.js`

## Tools

| Tool | Meaning |
|---|---|
| `list_line_takes` | Every take for a line + the canonical one |
| `list_voice_profiles` | Velorn voice catalog |
| `production_readiness` | ready iff every dialogue line has a finalized canonical take |
| `synthesize_voiceover` | Plan/persist a `tts_synth` take. previewOnly default. Does not queue GPU. |
| `clone_voice` | Convert a parent take. previewOnly default. |
| `mark_take_canonical` | Promote without changing stage |
| `finalize_take` | `stage=finalized` AND `is_canonical=true` |
| `generate_lipsync_clip` | Flow A talking-head (`ltx23-id-lora`) or Flow B ffmpeg bake. Never queues GPU. |
| `generate_foley` | LTX Foley V2A plan. 503 semantics if the LoRA is missing. |

## Policy

- GPU serial
- Outward artifacts stay `draft`
- previewOnly first
- Human-recorded `blake-recorded` lines are not TTS'd
- Music ducks under VO; foley/SFX stay dry
- Master target: -16 LUFS / -1.5 TP / LRA 11

## Persistence

`project.studio.voiceover` is the v2 take manifest.
`project.studio.audio.tracks` holds planned foley/music registry rows.
Cards may bind `audioAssetId` (VO) and `foleyAssetId` (SFX).

v1 `{slug, wav_path}` manifests migrate on read.

## VSE

`get_production_context.audio.vse` is the three-lane mix plan
(VO / foley / music) for Sequence / Blender VSE assembly.
