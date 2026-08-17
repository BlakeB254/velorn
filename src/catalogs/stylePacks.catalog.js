/** Velorn-native style pack catalog. Semantics from CDX Studio styles/style-packs (spec only). */
export const STYLE_PACK_CATALOG = [
  {
    "id": "bw-detective-noir",
    "name": "bw-detective-noir",
    "summary": "1940s film-noir detective picture — B&W, hard shadows, voiceover-driven, parody-ready.",
    "applies_to": [
      "parody",
      "movie",
      "skit"
    ],
    "parody_of": "1940s American film noir (The Maltese Falcon / Double Indemnity register)",
    "kind": "house",
    "swatches": [
      "#0a0a0a",
      "#6b6b6b",
      "#e8e8e8",
      "#1a1a1a"
    ],
    "prompt_tail": "black and white photography, 1940s film noir, 35mm silver-nitrate film grain, hard single-source key light, venetian-blind shadow patterns, deep blacks with hot highlights, cigarette smoke haze, wet night streets, fedora and trench coat wardrobe, period-correct set dressing, 4:3-safe central composition, dramatic low-key chiaroscuro",
    "video_prompt_tail": "locked-off tripod framing with slow deliberate dolly moves, film-noir pacing, subtle gate weave and film flicker, black and white",
    "negative_tail": "color, modern clothing, modern cars, smartphones, LED lighting, soft diffuse lighting, drone shot, whip pan, digital sharpness, clean skin retouching, text, watermark",
    "lora_stack": [],
    "resolution": {
      "w": 1216,
      "h": 1216
    },
    "aspect": "9:16 (center-safe)",
    "camera_language": "Locked-off or slow dolly only. Faces half-in-shadow by default. Dutch angle allowed once per episode at the betrayal beat. Inserts: hands, matchbooks, glasses of rye. Push-in on the femme fatale reveal.",
    "grade": "True B&W (no toning). Crushed blacks, specular highlights, halation on practicals. Period vignette.",
    "pacing": "Slower than street-skit house style: beats 5-10s, dialogue overlapped by hard-boiled VO narration. Parody laughs come from anachronism inside period grammar — never break the visual style for the joke.",
    "sound": "Constant rain/room-tone bed, solo brass score, VO narration mixed hot. Period telephone rings and revolver foley.",
    "notes": "Parody contract: the VISUAL grammar stays 100% faithful to the source era; only the content is modern (see concepts/_templates/parody.md — \"break the grammar and the parody dies\"). When Blake supplies a specific source film, add a source-shot map in the concept doc and tighten this pack's camera_language to that film's trademarks.",
    "brand_id": null,
    "pace_mode": null
  },
  {
    "id": "hex-halo-street",
    "name": "hex-halo-street",
    "summary": "Hex & Halo–inspired photoreal urban drama — luxury streetwear, golden daylight, short-form street skits. Custom series pack (not a CTT production still).",
    "applies_to": [
      "show",
      "skit"
    ],
    "parody_of": null,
    "kind": "custom",
    "swatches": [
      "#1a1410",
      "#c9a227",
      "#f5e6c8",
      "#2d4a6f"
    ],
    "prompt_tail": "photorealistic candid street photography, natural skin texture, shallow depth of field, sunny summer day at Navy Pier Chicago, crowded boardwalk, vertical composition, iced-out diamond jewelry glinting in the light, designer streetwear, crisp fresh sneakers, luxury lifestyle aesthetic, rich color depth",
    "video_prompt_tail": "subtle handheld camera sway, photorealistic, natural motion",
    "negative_tail": "blurry, cartoon, illustration, anime, deformed hands, extra fingers, plastic skin, text, watermark, logo overlay, text on clothing, lettering on t-shirt",
    "lora_stack": [
      {
        "file": "ltx-2.3-22b-distilled-lora-384.safetensors",
        "strength": 1.0,
        "when": "video"
      }
    ],
    "resolution": {
      "w": 928,
      "h": 1664
    },
    "aspect": "9:16",
    "camera_language": "Handheld energy throughout. Tight CUs for dialogue with slow push-ins. OTS shot-reverse-shot for confrontations. Freeze-frame on the knockout. Slow push-in for the direct-to-camera moral. Never drone, crane, or sweeping establishing moves except the cold-open arrival.",
    "grade": "Golden daylight warmth at the pier; dusk moody-cinematic for end cards. Rich saturated color, no bleach or teal-orange.",
    "pacing": "30s total. Beats 3-6s. Fight beat: 60% speed into 0.4s freeze, music drops out. 1.5s of frozen silence after the knockdown. Moral runs ~9s. Same series end card every episode (title + tagline), 2.5s.",
    "sound": "Diegetic only until the fourth-wall close. Antagonist is the only loud voice. Music drop on impact; silence after; low bed under the moral.",
    "notes": "Continuity is carried by the cast library refs (ComfyUI input/ctt-*.png) + per-character wardrobe rules in the concept doc. Keyframes via Qwen-Image-Edit 2509 multi-ref (or Krea 2 identity-edit once core is upgraded); video via LTX 2.3 FLF; control via IC-LoRA union when choreography needs to be exact (see docs/CONTROL-STACK-2026-07.md).",
    "brand_id": null,
    "pace_mode": null
  }
]
