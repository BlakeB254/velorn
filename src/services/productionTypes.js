/**
 * CDX Studio production types, mirrored in Velorn.
 *
 * Canonical ids match the CDX Studio production-type schemas
 * plus production-types pacing. Agents should call
 * `list_production_catalog` or `discover_production` instead of guessing.
 */

export const PRODUCTION_TYPES = Object.freeze([
  'show',
  'movie',
  'commercial',
  'skit',
  'ig-short',
  'parody',
  'music-video',
  'psa',
  'animated',
  'narrative',
  'website-tour',
  'hype-video',
  'site-update',
  'documentary',
  'animated-short',
])

const ALIASES = Object.freeze({
  advertisement: 'commercial',
  advert: 'commercial',
  ad: 'commercial',
  ugc: 'ig-short',
  'ugc-ad': 'commercial',
  film: 'movie',
  'short-film': 'movie',
  short: 'ig-short',
  standalone: 'narrative',
  series: 'show',
  episode: 'show',
  reel: 'ig-short',
  shorts: 'ig-short',
  mv: 'music-video',
  'music video': 'music-video',
  musicvideo: 'music-video',
  promo: 'hype-video',
  hype: 'hype-video',
  tour: 'website-tour',
  doc: 'documentary',
  docs: 'documentary',
})

function typeDef(partial) {
  return {
    episodic: false,
    paceMode: 'feed',
    hookByS: 2,
    maxHoldS: 2.5,
    runtime: '15-30s',
    aspect: '9:16',
    outputTarget: 'mobile',
    skills: ['velorn-production', 'cdx-video-production', 'cdx-shot-routing', 'cdx-ltx25'],
    startTools: ['discover_production', 'get_production_context', 'list_production_catalog'],
    ...partial,
  }
}

export const PRODUCTION_TYPE_CATALOG = Object.freeze({
  show: typeDef({
    label: 'Show',
    description: 'Episodic series with seasons and episodes (CTT, etc.).',
    episodic: true,
    paceMode: 'series',
    hookByS: 2,
    maxHoldS: 4,
    runtime: '30-60s / episode',
    skills: ['velorn-production', 'cdx-video-production', 'cdx-viral-pacing', 'cdx-cast-lock', 'cdx-shot-routing', 'cdx-ltx25'],
    startTools: ['get_production_context', 'list_episodes', 'list_cuts', 'studio_cast_resolve', 'studio_ref_gate', 'production_readiness'],
    flow: 'show-episode',
  }),
  movie: typeDef({
    label: 'Movie',
    description: 'Short film / cinematic one-off.',
    paceMode: 'cinema',
    hookByS: 8,
    maxHoldS: 12,
    runtime: '1-3 min',
    aspect: '16:9',
    outputTarget: 'computer',
    skills: ['velorn-production', 'cdx-video-production', 'cdx-film-lexicon', 'cdx-ltx25'],
    startTools: ['get_production_context', 'set_production', 'list_cuts'],
    flow: 'movie',
  }),
  commercial: typeDef({
    label: 'Commercial',
    description: 'Product/service spot with CTA. Aliases: advertisement, ad.',
    hookByS: 2,
    maxHoldS: 2.5,
    runtime: '15-30s',
    skills: ['velorn-production', 'cdx-video-production', 'cdx-viral-pacing', 'cdx-graphic-production'],
    startTools: ['discover_production', 'set_production', 'queue_prompt_generation_batch'],
    flow: 'commercial',
  }),
  skit: typeDef({
    label: 'Skit',
    description: 'Standalone comedy bit. Premise → escalate → punch.',
    hookByS: 2,
    maxHoldS: 3,
    runtime: '20-45s',
    skills: ['velorn-production', 'cdx-video-production', 'cdx-viral-pacing'],
    flow: 'skit',
  }),
  'ig-short': typeDef({
    label: 'IG short',
    description: 'Single-idea vertical, non-episodic. 7–20s.',
    hookByS: 1.5,
    maxHoldS: 2.5,
    runtime: '7-20s',
    skills: ['velorn-production', 'cdx-viral-pacing', 'cdx-video-production'],
    flow: 'ig-short',
  }),
  parody: typeDef({
    label: 'Parody',
    description: 'Source-faithful remake with swapped content.',
    paceMode: 'series',
    hookByS: 3,
    maxHoldS: 4,
    runtime: 'matches source',
    aspect: '16:9',
    outputTarget: 'computer',
    flow: 'parody',
  }),
  'music-video': typeDef({
    label: 'Music video',
    description: 'Picture to track. Use the dedicated music-video MCP tools.',
    paceMode: 'cinema',
    hookByS: 0,
    maxHoldS: 4,
    runtime: 'full track or 60s cut',
    skills: ['velorn-production', 'cdx-video-production'],
    startTools: ['get_music_video_session', 'configure_music_video', 'generate_music'],
    flow: 'music-video',
  }),
  psa: typeDef({
    label: 'PSA',
    description: 'Public-service / sincerity register. Single action CTA.',
    paceMode: 'cinema',
    hookByS: 3,
    maxHoldS: 8,
    runtime: '30-60s',
    flow: 'psa',
  }),
  animated: typeDef({
    label: 'Animated',
    description: 'Animation is the medium. Pair with a secondary form (show/skit/ad).',
    runtime: '15-120s',
    skills: ['velorn-production', 'cdx-video-production', 'cdx-film-lexicon'],
    flow: 'animated',
  }),
  narrative: typeDef({
    label: 'Narrative',
    description: 'General narrative / untyped creative project (legacy: standalone).',
    paceMode: 'series',
    maxHoldS: 4,
    runtime: '30-90s',
    flow: 'narrative',
  }),
  'website-tour': typeDef({
    label: 'Website tour',
    description: 'Product site walkthrough reel.',
    hookByS: 1.5,
    runtime: '15-30s',
    skills: ['velorn-production', 'cdx-website-showcase-reel', 'cdx-viral-pacing'],
    flow: 'website-tour',
  }),
  'hype-video': typeDef({
    label: 'Hype video',
    description: 'Energy-forward brand/promo montage.',
    hookByS: 1.5,
    runtime: '15-30s',
    skills: ['velorn-production', 'cdx-viral-pacing', 'cdx-video-production'],
    flow: 'hype-video',
  }),
  'site-update': typeDef({
    label: 'Site update',
    description: 'Changelog / feature-drop announcement.',
    hookByS: 1.5,
    runtime: '15-20s',
    flow: 'site-update',
  }),
  documentary: typeDef({
    label: 'Documentary',
    description: 'Nonfiction short.',
    paceMode: 'cinema',
    hookByS: 5,
    maxHoldS: 8,
    runtime: '1-5 min',
    aspect: '16:9',
    outputTarget: 'computer',
    flow: 'documentary',
  }),
  'animated-short': typeDef({
    label: 'Animated short',
    description: 'Legacy alias — prefer type=animated + secondary form.',
    runtime: '30-90s',
    flow: 'animated',
  }),
})

export const PRODUCTION_FLOWS = Object.freeze([
  {
    id: 'show-episode',
    title: 'Show / episode',
    types: ['show'],
    steps: [
      'get_production_context — bible, current episode, board, cuts',
      'list_cuts / checkout_cut — pick Draft 1 vs Grok Draft 1, never overwrite blindly',
      'studio_cast_resolve + studio_ref_gate + studio_cast_lock — lock cast before gen',
      'studio_blocking_add_character — add a stand-in only after the ref gate passes',
      'studio_route_shot / studio_flow.routing — pick ONE ecosystem + Velorn workflow per shot',
      'production_readiness + synthesize_voiceover / finalize_take — every dialogue line needs a finalized canonical take',
      'generate_lipsync_clip / generate_foley — previewOnly first, GPU serial, drafts only',
      'studio_franchise / studio_style_pack / studio_bible — inherit house look, seal bible',
      'update_shot / propose_shot_camera — write action, dialogue, xyz',
      'queue_prompt_generation_batch or generate-from-blocking — GPU serial, previewOnly first',
      'import_asset_from_path + save_cut — attach clips, snapshot the draft',
      'watch_cut then studio_qa_record / studio_audit — review before promote_cut',
    ],
    tools: ['get_production_context', 'list_episodes', 'list_cuts', 'save_cut', 'checkout_cut', 'watch_cut', 'promote_cut', 'studio_cast_resolve', 'studio_ref_gate', 'studio_cast_lock', 'studio_blocking_add_character', 'studio_route_shot', 'studio_flow', 'update_shot', 'propose_shot_camera', 'queue_prompt_generation_batch', 'studio_qa_record', 'list_line_takes', 'production_readiness', 'synthesize_voiceover', 'finalize_take', 'generate_lipsync_clip', 'generate_foley', 'studio_franchise', 'studio_style_pack', 'studio_bible', 'studio_animation_styles', 'studio_audit'],
  },
  {
    id: 'commercial',
    title: 'Advertisement / commercial',
    types: ['commercial'],
    steps: [
      'discover_production type=commercial — load pace + output defaults',
      'set_production type=commercial outputTarget=mobile — hook by 2s, max hold 2.5s',
      'create_project or open_project — one product, one CTA',
      'queue_prompt_generation_batch — short one-beat clips, audio frame 0',
      'add_assets_to_timeline + add_text_clip — end card / CTA in post, never generated text',
      'save_cut name="Draft 1" — keep a watchable draft before export_timeline',
    ],
    tools: ['discover_production', 'set_production', 'create_project', 'queue_prompt_generation_batch', 'add_assets_to_timeline', 'add_text_clip', 'save_cut', 'export_timeline'],
  },
  {
    id: 'ig-short',
    title: 'IG short / UGC / reel',
    types: ['ig-short', 'hype-video', 'site-update'],
    steps: [
      'set_production type=ig-short — 7–20s, hook by 1.5s, no establish',
      'write edit-map timestamps before gen',
      'queue_prompt_generation_batch — one beat per clip',
      'save_cut + watch_cut — mute-test first 3s',
    ],
    tools: ['set_production', 'queue_prompt_generation_batch', 'save_cut', 'watch_cut'],
  },
  {
    id: 'skit',
    title: 'Skit',
    types: ['skit'],
    steps: [
      'set_production type=skit',
      'board premise → escalate → punch → optional promo tag ≤3s',
      'same generate + cut + QA loop as show, without seasons',
    ],
    tools: ['set_production', 'update_shot', 'queue_prompt_generation_batch', 'save_cut', 'studio_qa_record', 'studio_audit'],
  },
  {
    id: 'music-video',
    title: 'Music video',
    types: ['music-video'],
    steps: [
      'get_music_video_session — do not invent a parallel storyboard',
      'configure_music_video + generate_music (track first)',
      'manage_music_video_cast / queue_music_video_character_asset',
      'queue_music_video_keyframes then queue_music_video_videos (previewOnly)',
      'assemble_music_video_timeline after Blake approves',
    ],
    tools: ['get_music_video_session', 'configure_music_video', 'generate_music', 'manage_music_video_cast', 'queue_music_video_keyframes', 'queue_music_video_videos', 'assemble_music_video_timeline'],
  },
  {
    id: 'movie',
    title: 'Movie / documentary / parody',
    types: ['movie', 'documentary', 'parody', 'narrative'],
    steps: [
      'set_production type=movie outputTarget=computer — cinema pace only if Blake asks',
      'list_cuts — keep act drafts watchable',
      'coverage: OTS/CU, not one master',
      'export_fcpxml or export_timeline for human finish',
    ],
    tools: ['set_production', 'list_cuts', 'update_shot', 'queue_prompt_generation_batch', 'export_fcpxml', 'export_timeline'],
  },
  {
    id: 'website-tour',
    title: 'Website tour',
    types: ['website-tour'],
    steps: [
      'set_production type=website-tour',
      'Use HyperFrames / site-capture skills for the reel; import the mp4 into Velorn',
      'studio_creative_ops op=link kind=hyperframes — metadata only, do not move media',
      'import_asset_from_path + add_asset_to_timeline + save_cut',
    ],
    tools: ['set_production', 'studio_creative_ops', 'import_asset_from_path', 'add_asset_to_timeline', 'save_cut'],
  },
  {
    id: 'review-deliver',
    title: 'Review + deliver (any type)',
    types: PRODUCTION_TYPES.slice(),
    steps: [
      'analyze_timeline + check_media_health',
      'inspect_visible_shots — mark issues, previewOnly',
      'studio_creative_ops + studio_graph_ledger — record the take, do not publish',
      'watch_cut / promote_cut',
      'export_timeline or export_delivery_batch',
    ],
    tools: ['analyze_timeline', 'check_media_health', 'inspect_visible_shots', 'studio_creative_ops', 'studio_graph_ledger', 'watch_cut', 'promote_cut', 'export_timeline'],
  },
])

export function normalizeProductionType(value, fallback = 'narrative') {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return fallback
  if (PRODUCTION_TYPES.includes(raw)) return raw
  if (ALIASES[raw]) return ALIASES[raw]
  const slug = raw.replace(/[^a-z0-9]+/g, '-')
  if (PRODUCTION_TYPES.includes(slug)) return slug
  if (ALIASES[slug]) return ALIASES[slug]
  return fallback
}

export function getProductionType(id) {
  const canonical = normalizeProductionType(id, '')
  const def = PRODUCTION_TYPE_CATALOG[canonical]
  if (!def) return null
  return { id: canonical, ...def }
}

export function listProductionTypes() {
  return PRODUCTION_TYPES.map((id) => {
    const def = PRODUCTION_TYPE_CATALOG[id]
    return {
      id,
      label: def.label,
      description: def.description,
      episodic: def.episodic,
      paceMode: def.paceMode,
      hookByS: def.hookByS,
      maxHoldS: def.maxHoldS,
      runtime: def.runtime,
      aspect: def.aspect,
      outputTarget: def.outputTarget,
      skills: def.skills,
      startTools: def.startTools,
      flow: def.flow,
    }
  })
}

export function applyTypeDefaults(typeId, format = {}) {
  const def = getProductionType(typeId)
  if (!def) return { ...format }
  return {
    aspect: format.aspect || def.aspect,
    outputTarget: format.outputTarget || def.outputTarget,
    durationHint: format.durationHint || def.runtime,
    fps: format.fps == null ? 24 : format.fps,
    paceMode: format.paceMode || def.paceMode,
  }
}

export function discoverProduction({ query = '', type = '' } = {}) {
  const wanted = normalizeProductionType(type, '')
  const needle = String(query || '').toLowerCase()
  const types = listProductionTypes().filter((item) => {
    if (wanted && item.id !== wanted) return false
    if (!needle) return true
    return [item.id, item.label, item.description, ...(item.skills || [])].join(' ').toLowerCase().includes(needle)
  })
  const typeIds = new Set(types.map((item) => item.id))
  const flows = PRODUCTION_FLOWS.filter((flow) => (
    (!wanted && !needle) || flow.types.some((id) => typeIds.has(id)) || flow.id.includes(needle) || flow.title.toLowerCase().includes(needle)
  ))
  return {
    action: 'discover_production',
    query: query || null,
    type: wanted || null,
    types,
    flows,
    aliases: ALIASES,
    next: wanted
      ? (getProductionType(wanted)?.startTools || ['get_production_context'])
      : ['list_production_catalog', 'get_production_context', 'get_mcp_recipes'],
  }
}

export function productionRecipeCards() {
  return PRODUCTION_FLOWS.map((flow) => ({
    id: `production_${flow.id.replace(/-/g, '_')}`,
    title: flow.title,
    goal: `Run the ${flow.title} Velorn flow.`,
    prompt: flow.steps.join(' '),
    tools: flow.tools,
    types: flow.types,
    previewOnlyFirst: true,
  }))
}
