/** Velorn-native animation/film style cards. Semantics from CDX Studio styles/animation-styles.yaml (spec only). */
export const ANIMATION_STYLE_CATALOG = [
  {
    "id": "classic-2d-cel",
    "name": "Classic 2D Cel",
    "tagline": "Hand-inked cel look, soft fills, film grain",
    "category": "2d",
    "family": "animation",
    "swatches": [
      "#1a1a2e",
      "#e94560",
      "#f5f0e8",
      "#16213e"
    ],
    "prompt_tail": "classic 2D hand-drawn cel animation, clean ink outlines, soft cel fills, subtle film grain, traditional cartoon proportions, animated feature look",
    "negative_tail": "photorealistic, 3d render, live action, uncanny",
    "best_for": [
      "show",
      "movie",
      "commercial"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "modern-flat",
    "name": "Modern Flat",
    "tagline": "Bold shapes, limited palette, motion-graphics energy",
    "category": "2d",
    "family": "animation",
    "swatches": [
      "#0f172a",
      "#38bdf8",
      "#f472b6",
      "#f8fafc"
    ],
    "prompt_tail": "modern flat vector animation, bold geometric shapes, limited color palette, clean edges, motion-graphics style, crisp UI-like character design",
    "negative_tail": "photorealistic, muddy textures, noisy grain, 3d",
    "best_for": [
      "commercial",
      "ig-short",
      "explainers"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "anime-cinematic",
    "name": "Anime Cinematic",
    "tagline": "Japanese anime grammar — dramatic light, expressive eyes",
    "category": "anime",
    "family": "animation",
    "swatches": [
      "#0c0a1d",
      "#7c3aed",
      "#fbbf24",
      "#fce7f3"
    ],
    "prompt_tail": "cinematic anime still, detailed character design, dramatic rim lighting, expressive eyes, anime cel shading, high production anime film quality",
    "negative_tail": "western cartoon, photoreal, chibi only, low detail",
    "best_for": [
      "show",
      "movie",
      "music-video"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "chibi-cute",
    "name": "Chibi / Super-deformed",
    "tagline": "Oversized heads, tiny bodies, max expressiveness",
    "category": "anime",
    "family": "animation",
    "swatches": [
      "#fff1f2",
      "#fb7185",
      "#fcd34d",
      "#a5b4fc"
    ],
    "prompt_tail": "chibi super-deformed characters, oversized heads, tiny bodies, big shiny eyes, soft pastel palette, cute kawaii animation style",
    "negative_tail": "realistic proportions, horror, gritty",
    "best_for": [
      "skit",
      "commercial",
      "show"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "stop-motion-clay",
    "name": "Stop-motion Clay",
    "tagline": "Tactile clay / puppet texture, imperfect charm",
    "category": "stop-motion",
    "family": "animation",
    "swatches": [
      "#292524",
      "#d97706",
      "#fef3c7",
      "#78716c"
    ],
    "prompt_tail": "stop-motion claymation, clay texture, fingerprint surface detail, practical puppet lighting, tactile handmade feel, Aardman-inspired craft",
    "negative_tail": "smooth CGI, photoreal skin, flat vector",
    "best_for": [
      "skit",
      "commercial",
      "movie"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "paper-cutout",
    "name": "Paper Cutout",
    "tagline": "Layered paper silhouettes, craft-shadow depth",
    "category": "stop-motion",
    "family": "animation",
    "swatches": [
      "#1e293b",
      "#f59e0b",
      "#fef9c3",
      "#94a3b8"
    ],
    "prompt_tail": "paper cutout animation, layered paper silhouettes, craft shadows between layers, handmade collage aesthetic, soft directional light",
    "negative_tail": "photoreal, 3d glossy, liquid metal",
    "best_for": [
      "commercial",
      "psa",
      "ig-short"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "3d-pixarish",
    "name": "3D Stylized (Pixar-ish)",
    "tagline": "Soft subsurface, appealing shapes, family feature",
    "category": "3d",
    "family": "animation",
    "swatches": [
      "#0ea5e9",
      "#f97316",
      "#fef3c7",
      "#1e3a5f"
    ],
    "prompt_tail": "stylized 3D animated feature look, soft subsurface scattering, appealing character shapes, cinematic lighting, high-end family animation quality",
    "negative_tail": "uncanny photoreal, horror, low-poly game junk",
    "best_for": [
      "movie",
      "show",
      "commercial"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "3d-lowpoly",
    "name": "3D Low-poly",
    "tagline": "Faceted geometry, game-art clarity",
    "category": "3d",
    "family": "animation",
    "swatches": [
      "#14532d",
      "#4ade80",
      "#facc15",
      "#0f172a"
    ],
    "prompt_tail": "low-poly 3D animation, faceted geometry, clean game-art style, simplified shapes, vibrant materials, isometric-friendly lighting",
    "negative_tail": "hyperdetail pores, photoreal, muddy textures",
    "best_for": [
      "ig-short",
      "commercial",
      "show"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "watercolor-storybook",
    "name": "Watercolor Storybook",
    "tagline": "Soft washes, ink line, children's book warmth",
    "category": "painterly",
    "family": "animation",
    "swatches": [
      "#fef3c7",
      "#60a5fa",
      "#f472b6",
      "#334155"
    ],
    "prompt_tail": "watercolor storybook illustration animation, soft pigment washes, delicate ink line, children's picture book warmth, paper texture",
    "negative_tail": "hard cel lines only, photoreal, neon cyberpunk",
    "best_for": [
      "movie",
      "show",
      "psa"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "neon-synthwave",
    "name": "Neon Synthwave",
    "tagline": "Glow lines, retro-future night, chrome accents",
    "category": "graphic",
    "family": "animation",
    "swatches": [
      "#0f0a1a",
      "#ff2d95",
      "#00f0ff",
      "#7b2cbf"
    ],
    "prompt_tail": "neon synthwave animation, glowing magenta cyan accents, retro-future night city, chrome highlights, vaporwave energy, graphic motion design",
    "negative_tail": "daytime pastoral, muted earth tones only, photoreal",
    "best_for": [
      "music-video",
      "commercial",
      "skit"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "ink-noir",
    "name": "Ink Noir",
    "tagline": "High-contrast B&W ink, graphic novel frames",
    "category": "graphic",
    "family": "animation",
    "swatches": [
      "#000000",
      "#ffffff",
      "#6b7280",
      "#111827"
    ],
    "prompt_tail": "black and white ink noir animation, high contrast graphic novel frames, crosshatching shadows, stark silhouettes, Sin City energy",
    "negative_tail": "pastel, cute, full color photoreal",
    "best_for": [
      "movie",
      "parody",
      "skit"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "retro-saturday",
    "name": "Retro Saturday Morning",
    "tagline": "90s TV cartoon grain, limited cycles, warm nostalgia",
    "category": "2d",
    "family": "animation",
    "swatches": [
      "#1e3a5f",
      "#f59e0b",
      "#ef4444",
      "#fde68a"
    ],
    "prompt_tail": "1990s Saturday morning cartoon style, limited animation cycles, warm CRT glow, bold outlines, nostalgic kids TV aesthetic",
    "negative_tail": "hypermodern 3d, photoreal, ultra HD anime",
    "best_for": [
      "show",
      "skit",
      "commercial"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "sumi-e-ink",
    "name": "Sumi-e Ink Wash",
    "tagline": "Monochrome brush, cream paper, one red seal",
    "category": "painterly",
    "family": "animation",
    "swatches": [
      "#f5f0e6",
      "#1a1a1a",
      "#2c3e50",
      "#b91c1c"
    ],
    "prompt_tail": "traditional Japanese sumi-e ink wash painting animation style, monochrome ink on cream aged paper, minimal brush strokes, generous negative space, soft indigo water wash only where needed, NO red seal stamp, NO Chinese calligraphy seal, NO red corner mark, Zen calm, 9:16 vertical composition for social shorts",
    "negative_tail": "photoreal, full color cartoon, thick western comic ink, neon, 3d render",
    "best_for": [
      "animated-short",
      "ig-short",
      "psa",
      "show"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "storybook-parchment",
    "name": "Storybook Parchment",
    "tagline": "Klaus/Despereaux painted frames, dust-gold light",
    "category": "painterly",
    "family": "animation",
    "swatches": [
      "#c4a574",
      "#5c4033",
      "#6b7c8a",
      "#f5e6c8"
    ],
    "prompt_tail": "illuminated storybook animation, painted parchment texture, Klaus and Despereaux film illustration register, warm burnt sienna and ochre, slate-blue sky, soft brush strokes visible, hand-lettered caption feel, medieval European warmth, 9:16 vertical social short framing",
    "negative_tail": "photoreal live action, flat vector UI, neon cyberpunk, anime eyes",
    "best_for": [
      "animated-short",
      "movie",
      "show",
      "psa"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "ghibli-pastoral",
    "name": "Ghibli Pastoral",
    "tagline": "Soft watercolor hills, wind in grass, gentle light",
    "category": "painterly",
    "family": "animation",
    "swatches": [
      "#7cb342",
      "#87ceeb",
      "#c4785a",
      "#f5f0d8"
    ],
    "prompt_tail": "Studio Ghibli pastoral watercolor animation style, soft rolling green hills, warm sunlight, light wind in grass, soft edges, My Neighbor Totoro countryside energy, gentle character design, full soft color, 9:16 vertical composition",
    "negative_tail": "hard cel only, photoreal, horror, cyberpunk, low poly",
    "best_for": [
      "animated-short",
      "show",
      "movie",
      "ig-short"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "ukiyo-e-woodblock",
    "name": "Ukiyo-e Woodblock",
    "tagline": "Hokusai/Hiroshige prints, flat color, Fuji forms",
    "category": "graphic",
    "family": "animation",
    "swatches": [
      "#1e3a5f",
      "#c45c26",
      "#e8d5a3",
      "#2d5a4a"
    ],
    "prompt_tail": "traditional Japanese ukiyo-e woodblock print animation style, Hokusai and Hiroshige register, strong black outlines, flat color fills, gradient skies, stylized cloud curls, limited indigo ochre soft-red palette, Mount Fuji silhouette forms, 9:16 vertical social short framing",
    "negative_tail": "photoreal, western comic, 3d CGI, pastel kawaii only",
    "best_for": [
      "animated-short",
      "show",
      "movie",
      "ig-short"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "dramatic-cinema",
    "name": "Dramatic Cinema",
    "tagline": "Golden-hour film still, anamorphic mood in 9:16",
    "category": "cinematic",
    "family": "film",
    "swatches": [
      "#1a120b",
      "#c48a3a",
      "#f5e6c8",
      "#4a3728"
    ],
    "prompt_tail": "dramatic cinematic still animation look, golden hour rim light, shallow depth of field feel, film grain, epic composition, movie key art energy, 9:16 vertical",
    "negative_tail": "flat cartoon, clipart, low detail",
    "best_for": [
      "movie",
      "show",
      "music-video",
      "commercial"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "c4d-cartoon",
    "name": "C4D Cartoon",
    "tagline": "Soft 3D clay-render characters, toy-like charm",
    "category": "3d",
    "family": "animation",
    "swatches": [
      "#f8fafc",
      "#f59e0b",
      "#38bdf8",
      "#1e293b"
    ],
    "prompt_tail": "Cinema 4D cartoon render style, soft rounded 3D characters, clay-like materials, studio softbox lighting, toy-like charm, clean colorful backgrounds, 9:16 vertical",
    "negative_tail": "photoreal skin, horror, muddy textures",
    "best_for": [
      "skit",
      "commercial",
      "show",
      "ig-short"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "halftone-print",
    "name": "Halftone Print",
    "tagline": "Ben-Day dots, mid-century poster ink",
    "category": "graphic",
    "family": "animation",
    "swatches": [
      "#f5f0e0",
      "#1a1a1a",
      "#c41e3a",
      "#2b4c7e"
    ],
    "prompt_tail": "classic halftone print animation style, Ben-Day dots, mid-century poster ink, limited spot color, paper grain, comic-book print register, 9:16 vertical",
    "negative_tail": "photoreal, smooth gradient 3d, neon vaporwave",
    "best_for": [
      "commercial",
      "skit",
      "ig-short",
      "parody"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "pop-art-bold",
    "name": "Pop Art",
    "tagline": "Warhol/Lichtenstein energy, bold primary blocks",
    "category": "graphic",
    "family": "animation",
    "swatches": [
      "#ff2d55",
      "#ffcc00",
      "#00a3ff",
      "#111111"
    ],
    "prompt_tail": "bold pop art animation style, Warhol and Lichtenstein energy, primary color blocks, thick outlines, high contrast graphic, 9:16 vertical social framing",
    "negative_tail": "muted pastel only, photoreal, soft watercolor",
    "best_for": [
      "commercial",
      "music-video",
      "skit",
      "ig-short"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "spotlight-80s",
    "name": "Spotlight 80s",
    "tagline": "Soft glam portrait light, neon rim, VHS film softness",
    "category": "film",
    "family": "film",
    "swatches": [
      "#1a0a2e",
      "#ff6bcb",
      "#7c5cff",
      "#fce7f3"
    ],
    "prompt_tail": "photoreal 1980s live-action film still, soft theatrical spotlight key, neon magenta rim light, gentle VHS tape softness and 35mm film grain, dreamy haze, glam fashion editorial cinema, natural skin texture, period music-video / glam drama energy, not animation not illustration",
    "negative_tail": "animation, cartoon, anime, illustration, cel shading, flat vector, claymation, medieval, pastoral watercolor, harsh documentary, modern smartphone look",
    "best_for": [
      "music-video",
      "commercial",
      "show",
      "movie"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "flat-vector-bold",
    "name": "Flat Vector",
    "tagline": "Bold shapes, limited palette, motion-graphics crisp",
    "category": "2d",
    "family": "animation",
    "swatches": [
      "#0f172a",
      "#22d3ee",
      "#f472b6",
      "#f8fafc"
    ],
    "prompt_tail": "modern flat vector animation, bold geometric shapes, limited color palette, clean edges, motion-graphics style, crisp character design, 9:16 vertical",
    "negative_tail": "photoreal, muddy textures, noisy grain, 3d",
    "best_for": [
      "commercial",
      "ig-short",
      "explainers",
      "skit"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "anime-cel-clean",
    "name": "Anime Cel Clean",
    "tagline": "Clean anime stills, expressive eyes, soft shading",
    "category": "anime",
    "family": "animation",
    "swatches": [
      "#0c0a1d",
      "#7c3aed",
      "#fbbf24",
      "#fce7f3"
    ],
    "prompt_tail": "clean anime cel animation still, detailed character design, soft anime shading, expressive eyes, high production anime film quality, 9:16 vertical framing",
    "negative_tail": "western cartoon, photoreal, chibi only, low detail",
    "best_for": [
      "show",
      "movie",
      "music-video",
      "animated-short"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "double-exposure",
    "name": "Double Exposure",
    "tagline": "Silhouette filled with landscape / emotion",
    "category": "graphic",
    "family": "animation",
    "swatches": [
      "#0f172a",
      "#f97316",
      "#38bdf8",
      "#e2e8f0"
    ],
    "prompt_tail": "double exposure animation style, silhouette profile filled with landscape and emotion, cinematic color grade, poster-art clarity, 9:16 vertical",
    "negative_tail": "cluttered multi-character comic, flat UI icons only",
    "best_for": [
      "music-video",
      "psa",
      "commercial",
      "ig-short"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "monochrome-ink",
    "name": "Monochrome Ink",
    "tagline": "High-contrast B&W illustration, graphic novel",
    "category": "graphic",
    "family": "animation",
    "swatches": [
      "#000000",
      "#ffffff",
      "#6b7280",
      "#111827"
    ],
    "prompt_tail": "monochrome ink illustration animation, high contrast black and white, graphic novel framing, clean silhouettes, strong negative space, 9:16 vertical",
    "negative_tail": "pastel color, photoreal color, muddy greys only without structure",
    "best_for": [
      "movie",
      "parody",
      "skit",
      "animated-short"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "film-anamorphic-blockbuster",
    "name": "Anamorphic Blockbuster",
    "tagline": "Wide scope, lens flares, epic scale",
    "category": "film",
    "family": "film",
    "swatches": [
      "#0a0a12",
      "#c9a227",
      "#1e3a5f",
      "#f5f0e8"
    ],
    "prompt_tail": "photoreal anamorphic cinema still, 2.39 scope feel, horizontal lens flare, deep contrast, epic production design, blockbuster film look, film grain",
    "negative_tail": "cartoon, anime, flat vector, phone selfie, low budget",
    "best_for": [
      "movie",
      "commercial",
      "music-video",
      "trailer"
    ],
    "style_pack": null,
    "aspect_default": "16:9"
  },
  {
    "id": "film-teal-orange",
    "name": "Teal & Orange",
    "tagline": "Modern Hollywood grade, warm skin / cool shadows",
    "category": "film",
    "family": "film",
    "swatches": [
      "#0d3b4c",
      "#e07a3d",
      "#1a1a2e",
      "#f5d6b8"
    ],
    "prompt_tail": "photoreal cinematic teal and orange color grade, warm skin tones, cool cyan shadows, modern Hollywood commercial look, shallow depth of field",
    "negative_tail": "pastel flat, monochrome, cartoon, oversaturated neon only",
    "best_for": [
      "commercial",
      "movie",
      "show",
      "trailer"
    ],
    "style_pack": null,
    "aspect_default": "16:9"
  },
  {
    "id": "film-noir-classic",
    "name": "Classic Film Noir",
    "tagline": "Hard light, deep shadows, B&W crime mood",
    "category": "film",
    "family": "film",
    "swatches": [
      "#000000",
      "#2a2a2a",
      "#c0c0c0",
      "#ffffff"
    ],
    "prompt_tail": "classic black and white film noir still, hard key light, deep shadows, venetian blind patterns, 1940s crime cinema, silver halide grain",
    "negative_tail": "full color, pastel, cute, cartoon, HDR hyperreal",
    "best_for": [
      "movie",
      "show",
      "parody",
      "trailer"
    ],
    "style_pack": null,
    "aspect_default": "16:9"
  },
  {
    "id": "film-golden-hour",
    "name": "Golden Hour Romance",
    "tagline": "Warm low sun, soft flares, intimate frames",
    "category": "film",
    "family": "film",
    "swatches": [
      "#1a120b",
      "#e8a54b",
      "#f5e6c8",
      "#8b4513"
    ],
    "prompt_tail": "photoreal golden hour cinema, warm low sun, soft lens flare, intimate framing, romantic drama look, natural skin, gentle film grain",
    "negative_tail": "harsh noon sun, cold fluorescent, cartoon, neon cyberpunk",
    "best_for": [
      "movie",
      "commercial",
      "music-video",
      "show"
    ],
    "style_pack": null,
    "aspect_default": "16:9"
  },
  {
    "id": "film-documentary-handheld",
    "name": "Documentary Handheld",
    "tagline": "Natural light, slight shake feel, real-world grit",
    "category": "film",
    "family": "film",
    "swatches": [
      "#2c2c2c",
      "#8a8a7a",
      "#d4cfc4",
      "#4a5568"
    ],
    "prompt_tail": "photoreal documentary film still, natural available light, observational framing, slight handheld energy, real-world grit, cinéma vérité",
    "negative_tail": "staged studio glam, heavy CGI, cartoon, perfect beauty retouch",
    "best_for": [
      "show",
      "psa",
      "commercial",
      "movie"
    ],
    "style_pack": null,
    "aspect_default": "16:9"
  },
  {
    "id": "film-wes-symmetry",
    "name": "Symmetry Pastel",
    "tagline": "Centered frames, pastel sets, deadpan wit",
    "category": "film",
    "family": "film",
    "swatches": [
      "#f4d6c6",
      "#7eb8c9",
      "#c45c5c",
      "#faf3e8"
    ],
    "prompt_tail": "photoreal centered symmetry cinema, pastel production design, meticulous set dressing, deadpan wit, flat frontal framing, Wes Anderson–adjacent look",
    "negative_tail": "gritty handheld, horror, dark noir only, chaotic composition",
    "best_for": [
      "movie",
      "commercial",
      "skit",
      "show"
    ],
    "style_pack": null,
    "aspect_default": "16:9"
  },
  {
    "id": "film-bleach-bypass",
    "name": "Bleach Bypass",
    "tagline": "Desaturated silver, high contrast war-drama",
    "category": "film",
    "family": "film",
    "swatches": [
      "#1a1a1a",
      "#6b6b5a",
      "#a8a090",
      "#3d3d3d"
    ],
    "prompt_tail": "photoreal bleach bypass film grade, desaturated silver highlights, high contrast, war-drama and thriller look, retained blacks, metallic midtones",
    "negative_tail": "candy colors, pastel, cartoon, soft beauty commercial",
    "best_for": [
      "movie",
      "show",
      "trailer",
      "commercial"
    ],
    "style_pack": null,
    "aspect_default": "16:9"
  },
  {
    "id": "film-neon-night",
    "name": "Neon Night City",
    "tagline": "Wet streets, magenta/cyan practicals, night exteriors",
    "category": "film",
    "family": "film",
    "swatches": [
      "#0a0612",
      "#ff2d95",
      "#00e5ff",
      "#1a0a2e"
    ],
    "prompt_tail": "photoreal neon night city cinema, wet reflective streets, magenta and cyan practical lights, cyberpunk-adjacent but grounded, night exterior film look",
    "negative_tail": "daytime pastoral, flat office fluorescent, cartoon cel",
    "best_for": [
      "movie",
      "music-video",
      "commercial",
      "show"
    ],
    "style_pack": null,
    "aspect_default": "16:9"
  },
  {
    "id": "film-vintage-technicolor",
    "name": "Vintage Technicolor",
    "tagline": "Saturated primaries, 50s–60s film stock glow",
    "category": "film",
    "family": "film",
    "swatches": [
      "#1a1a2e",
      "#c41e3a",
      "#1e5f8a",
      "#f5d76e"
    ],
    "prompt_tail": "photoreal vintage Technicolor film look, saturated primaries, 1950s–60s stock glow, slight soft focus, period cinema color science",
    "negative_tail": "modern teal-orange only, digital clean HDR, flat vector",
    "best_for": [
      "movie",
      "commercial",
      "music-video",
      "parody"
    ],
    "style_pack": null,
    "aspect_default": "16:9"
  },
  {
    "id": "film-found-footage",
    "name": "Found Footage",
    "tagline": "Consumer cam, date stamp energy, raw urgency",
    "category": "film",
    "family": "film",
    "swatches": [
      "#1c1c1c",
      "#4a4a3a",
      "#9a9a80",
      "#2d2d2d"
    ],
    "prompt_tail": "photoreal found-footage camera look, consumer camcorder quality, slight overexposure, raw urgency, diegetic framing, horror-thriller documentary hybrid",
    "negative_tail": "polished studio cinema, beauty retouch, cartoon, clean anamorphic",
    "best_for": [
      "movie",
      "skit",
      "ig-short",
      "parody"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  },
  {
    "id": "film-arthouse-grain",
    "name": "Arthouse Grain",
    "tagline": "Slow cinema, heavy grain, muted natural palette",
    "category": "film",
    "family": "film",
    "swatches": [
      "#2b2520",
      "#6b5d4d",
      "#c4b8a8",
      "#3d4a3d"
    ],
    "prompt_tail": "photoreal arthouse cinema still, heavy film grain, muted natural palette, contemplative framing, European slow-cinema energy, available light",
    "negative_tail": "blockbuster spectacle, neon, cartoon, oversharpened commercial",
    "best_for": [
      "movie",
      "show",
      "music-video"
    ],
    "style_pack": null,
    "aspect_default": "16:9"
  },
  {
    "id": "film-natural-indie",
    "name": "Natural Light Indie",
    "tagline": "Soft windows, real locations, intimate drama",
    "category": "film",
    "family": "film",
    "swatches": [
      "#3d3d3d",
      "#a8b5c4",
      "#e8e0d5",
      "#5c6b5a"
    ],
    "prompt_tail": "photoreal natural light indie film, soft window light, real locations, intimate drama framing, subtle color, Sundance-adjacent realism",
    "negative_tail": "heavy CGI, neon cyberpunk, cartoon, glam beauty commercial only",
    "best_for": [
      "movie",
      "show",
      "commercial",
      "psa"
    ],
    "style_pack": null,
    "aspect_default": "16:9"
  },
  {
    "id": "film-horror-cold",
    "name": "Cold Horror",
    "tagline": "Desat blues, negative space, dread composition",
    "category": "film",
    "family": "film",
    "swatches": [
      "#0a1018",
      "#2a4a5a",
      "#6a8a9a",
      "#1a1a1a"
    ],
    "prompt_tail": "photoreal cold horror cinema, desaturated blue-green grade, negative space, dread composition, practical darkness, elevated horror film look",
    "negative_tail": "bright comedy, pastel, cartoon gore comedy, warm golden hour only",
    "best_for": [
      "movie",
      "show",
      "trailer"
    ],
    "style_pack": null,
    "aspect_default": "16:9"
  },
  {
    "id": "film-commercial-clean",
    "name": "Clean Commercial",
    "tagline": "Soft beauty light, product-ready polish",
    "category": "film",
    "family": "film",
    "swatches": [
      "#f5f5f5",
      "#e8eef5",
      "#2c3e50",
      "#d4a574"
    ],
    "prompt_tail": "photoreal clean commercial film, soft beauty lighting, product-ready polish, high-end advertising look, controlled highlights, crisp detail",
    "negative_tail": "gritty documentary, horror, muddy, cartoon, heavy grain",
    "best_for": [
      "commercial",
      "ig-short",
      "product",
      "show"
    ],
    "style_pack": null,
    "aspect_default": "9:16"
  }
]
