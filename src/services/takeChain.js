/**
 * CDX Studio-native take chain, VO, lipsync, and foley.
 *
 * Spec sources (semantics only — not a port of Studio Python):
 *   cdx-video-direction-dialogue   record → convert → finalize → lipdub
 *   take_chain.py                  one canonical take per line, parent chain
 *   VO_AND_LIPSYNC.md / LIPDUB     TTS then Flow A talking-head or Flow B bake
 *   2026-07-25 audio stack         foley V2A gated, mix buses, duck music
 *
 * GPU jobs stay serial. Outward artifacts stay drafts. These helpers plan
 * and persist provenance; they do not queue Comfy / ElevenLabs themselves.
 */

export const MANIFEST_VERSION = 2

export const STAGE_RAW_READ = 'raw_read'
export const STAGE_TTS_SYNTH = 'tts_synth'
export const STAGE_CHATTERBOX_CONVERTED = 'chatterbox_converted'
export const STAGE_APPLIO_CONVERTED = 'applio_converted'
export const STAGE_FINALIZED = 'finalized'

export const ALL_STAGES = Object.freeze([
  STAGE_RAW_READ,
  STAGE_TTS_SYNTH,
  STAGE_CHATTERBOX_CONVERTED,
  STAGE_APPLIO_CONVERTED,
  STAGE_FINALIZED,
])

export const AUDIO_KINDS = Object.freeze(['vo', 'music', 'foley', 'ambience', 'sfx'])

export const AUDIO_POLICY = Object.freeze({
  gpuSerial: true,
  outward: 'draft',
  previewOnlyDefault: true,
  duckMusicUnderVo: true,
  master: { I: -16, TP: -1.5, LRA: 11 },
})

export const VO_WORKFLOW_ID = 'elevenlabs-tts'
export const LIPSYNC_WORKFLOW_ID = 'ltx23-id-lora'
export const LIPSYNC_DRAFT_WORKFLOW_ID = 'grok-video-i2v'
export const FOLEY_WORKFLOW_ID = 'ltx-foley-v2a'
export const FOLEY_LORA_NAME = 'ltx-2.3-22b-lora-foley-v2a-1.0.safetensors'
export const FOLEY_LORA_PATH = '/home/codex450/Documents/ComfyUI/ComfyUI/models/loras/ltx-2.3-22b-lora-foley-v2a-1.0.safetensors'
export const FOLEY_GATE_URL = 'https://huggingface.co/Lightricks/LTX-2.3-22b-LoRA-Foley-V2A'

export const VOICE_PROFILES = Object.freeze([
  {
    id: 'elevenlabs-default',
    engine: 'elevenlabs',
    velornWorkflowId: VO_WORKFLOW_ID,
    available: true,
    note: 'CDX Studio TTS lane. Directed VO goes through ElevenLabs, drafts only.',
  },
  {
    id: 'qwen3-directed',
    engine: 'qwen3',
    velornWorkflowId: VO_WORKFLOW_ID,
    available: true,
    note: 'Studio Qwen3-TTS maps onto the CDX Studio ElevenLabs workflow until a local TTS workflow lands.',
  },
  {
    id: 'chatterbox',
    engine: 'chatterbox',
    velornWorkflowId: VO_WORKFLOW_ID,
    available: true,
    note: 'Studio Chatterbox maps onto the CDX Studio ElevenLabs workflow.',
  },
  {
    id: 'blake-recorded',
    engine: 'human',
    velornWorkflowId: null,
    available: false,
    note: 'Human raw read. Do not TTS-synthesize this line.',
  },
])

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const asString = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback
  return String(value)
}

const nowIso = () => new Date().toISOString()

function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `take-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function slugify(value) {
  return asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export function emptyManifest(concept = '') {
  return {
    concept: asString(concept),
    version: MANIFEST_VERSION,
    takes: [],
    lines: [],
  }
}

export function emptyAudioRegistry() {
  return { tracks: [] }
}

export function emptyVoiceover(concept = '') {
  return emptyManifest(concept)
}

function takeIsWellFormed(take) {
  return isPlainObject(take)
    && take.take_id
    && take.line_slug
    && take.stage
    && take.engine
    && take.audio_path !== undefined
}

function normalizeTake(raw) {
  return {
    take_id: asString(raw.take_id),
    line_slug: asString(raw.line_slug),
    stage: asString(raw.stage),
    engine: asString(raw.engine),
    engine_params: isPlainObject(raw.engine_params) ? { ...raw.engine_params } : {},
    audio_path: asString(raw.audio_path),
    duration_s: Number.isFinite(Number(raw.duration_s)) ? Number(raw.duration_s) : null,
    parent_take_id: raw.parent_take_id ? asString(raw.parent_take_id) : null,
    is_canonical: Boolean(raw.is_canonical),
    created_at: asString(raw.created_at, nowIso()),
    card_id: raw.card_id ? asString(raw.card_id) : null,
    asset_id: raw.asset_id ? asString(raw.asset_id) : null,
  }
}

function migrateV1(concept, data, { fileExists } = {}) {
  const out = emptyManifest(data.concept || concept)
  for (const row of data.takes || []) {
    if (!isPlainObject(row)) continue
    const slug = row.slug || row.line_slug
    const wav = row.wav_path || row.path || row.audio_path
    if (!slug || !wav) continue
    if (typeof fileExists === 'function' && !fileExists(wav)) continue
    out.takes.push(normalizeTake({
      take_id: newId(),
      line_slug: slug,
      stage: STAGE_RAW_READ,
      engine: 'human',
      audio_path: wav,
      duration_s: row.duration_s,
      is_canonical: true,
    }))
  }
  return out
}

export function normalizeManifest(raw, concept = '', options = {}) {
  if (!isPlainObject(raw)) return emptyManifest(concept)
  const version = Number(raw.version || 1)
  if (version === 1) return migrateV1(concept, raw, options)
  if (version !== MANIFEST_VERSION) return emptyManifest(raw.concept || concept)
  return {
    concept: asString(raw.concept, concept),
    version: MANIFEST_VERSION,
    takes: (Array.isArray(raw.takes) ? raw.takes : []).filter(takeIsWellFormed).map(normalizeTake),
    lines: Array.isArray(raw.lines) ? raw.lines.filter(isPlainObject).map((line) => ({
      lineSlug: asString(line.lineSlug || line.line_slug || line.slug),
      text: asString(line.text),
      motivation: asString(line.motivation),
      cardId: asString(line.cardId || line.card_id),
      characterSlug: asString(line.characterSlug || line.character_slug),
      offScreen: Boolean(line.offScreen || line.off_screen),
    })).filter((line) => line.lineSlug) : [],
  }
}

export function normalizeVoiceover(raw, concept = '', options = {}) {
  return normalizeManifest(raw, concept, options)
}

export function normalizeAudio(raw) {
  if (!isPlainObject(raw)) return emptyAudioRegistry()
  const tracks = (Array.isArray(raw.tracks) ? raw.tracks : [])
    .filter(isPlainObject)
    .map((track) => ({
      id: asString(track.id || newId()),
      kind: AUDIO_KINDS.includes(track.kind) ? track.kind : 'sfx',
      name: asString(track.name),
      cardId: asString(track.cardId || track.card_id),
      assetId: asString(track.assetId || track.asset_id),
      path: asString(track.path),
      tags: asString(track.tags),
      duration_s: Number.isFinite(Number(track.duration_s)) ? Number(track.duration_s) : null,
      offset_s: Number.isFinite(Number(track.offset_s)) ? Number(track.offset_s) : 0,
      gain_db: Number.isFinite(Number(track.gain_db)) ? Number(track.gain_db) : 0,
      duck: track.duck !== undefined ? Boolean(track.duck) : track.kind === 'music',
      status: asString(track.status, 'planned'),
      outward: asString(track.outward, AUDIO_POLICY.outward),
    }))
  return { tracks }
}

export function lineSlugForCard(card = {}) {
  return asString(
    card.lineSlug
    || card.line_slug
    || card.board_shot
    || slugify(card.title)
    || card.id,
  )
}

export function expectedLinesFromCards(cards = []) {
  return (Array.isArray(cards) ? cards : [])
    .filter((card) => asString(card?.dialogue).trim())
    .map((card) => ({
      lineSlug: lineSlugForCard(card),
      text: asString(card.dialogue).trim(),
      motivation: asString(card.action),
      cardId: asString(card.id),
      characterSlug: asString(card.characterRefs?.[0]?.slug || card.characterRefs?.[0]?.name),
      offScreen: Boolean(card.offScreen),
    }))
}

export function takesForLine(manifest, lineSlug) {
  return (manifest.takes || [])
    .filter((take) => take.line_slug === lineSlug)
    .slice()
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
}

export function canonicalTake(manifest, lineSlug) {
  return (manifest.takes || []).find((take) => take.line_slug === lineSlug && take.is_canonical) || null
}

export function findTake(manifest, takeId) {
  return (manifest.takes || []).find((take) => take.take_id === takeId) || null
}

export function lineage(manifest, takeId) {
  const byId = Object.fromEntries((manifest.takes || []).map((take) => [take.take_id, take]))
  const chain = []
  const seen = new Set()
  let cur = byId[takeId]
  while (cur && !seen.has(cur.take_id)) {
    chain.push(cur)
    seen.add(cur.take_id)
    cur = cur.parent_take_id ? byId[cur.parent_take_id] : null
  }
  return chain
}

export function addTake(manifest, lineSlug, audioPath, stage, engine, options = {}) {
  if (!ALL_STAGES.includes(stage)) throw new Error(`unknown stage: ${stage}`)
  const next = {
    ...manifest,
    version: MANIFEST_VERSION,
    takes: (manifest.takes || []).map((take) => ({ ...take })),
  }
  const take = normalizeTake({
    take_id: options.takeId || newId(),
    line_slug: lineSlug,
    stage,
    engine,
    engine_params: options.engineParams || {},
    audio_path: audioPath,
    duration_s: options.duration_s,
    parent_take_id: options.parentTakeId || null,
    is_canonical: false,
    created_at: options.createdAt || nowIso(),
    card_id: options.cardId || null,
    asset_id: options.assetId || null,
  })
  if (options.makeCanonical !== false) {
    for (const row of next.takes) {
      if (row.line_slug === lineSlug) row.is_canonical = false
    }
    take.is_canonical = true
  }
  next.takes.push(take)
  return { manifest: next, take }
}

export function markCanonical(manifest, takeId) {
  const target = findTake(manifest, takeId)
  if (!target) throw new Error(`take_id ${takeId} not found`)
  const next = {
    ...manifest,
    takes: (manifest.takes || []).map((take) => ({
      ...take,
      is_canonical: take.line_slug === target.line_slug ? take.take_id === takeId : take.is_canonical,
    })),
  }
  return { manifest: next, take: findTake(next, takeId) }
}

export function finalizeTake(manifest, takeId) {
  const marked = markCanonical(manifest, takeId)
  const next = {
    ...marked.manifest,
    takes: marked.manifest.takes.map((take) => (
      take.take_id === takeId ? { ...take, stage: STAGE_FINALIZED } : take
    )),
  }
  return { manifest: next, take: findTake(next, takeId) }
}

export function removeTake(manifest, takeId) {
  const target = findTake(manifest, takeId)
  if (!target) throw new Error(`take_id ${takeId} not found`)
  const remaining = (manifest.takes || []).filter((take) => take.take_id !== takeId).map((take) => ({ ...take }))
  if (target.is_canonical) {
    const siblings = remaining
      .filter((take) => take.line_slug === target.line_slug)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    if (siblings.length) siblings[siblings.length - 1].is_canonical = true
  }
  return { manifest: { ...manifest, takes: remaining }, take: target }
}

export function readinessFor(manifest, expectedLineSlugs = []) {
  const expected = [...expectedLineSlugs]
  const canonBySlug = Object.fromEntries(
    (manifest.takes || []).filter((take) => take.is_canonical).map((take) => [take.line_slug, take]),
  )
  const missingCanonical = []
  const missingFinal = []
  let canonical = 0
  let finalized = 0
  for (const slug of expected) {
    const take = canonBySlug[slug]
    if (!take) {
      missingCanonical.push(slug)
      continue
    }
    canonical += 1
    if (take.stage === STAGE_FINALIZED) finalized += 1
    else missingFinal.push(slug)
  }
  return {
    concept_slug: manifest.concept || '',
    total_lines: expected.length,
    canonical,
    finalized,
    missing_canonical: missingCanonical,
    missing_final: missingFinal,
    ready: expected.length > 0 && finalized === expected.length,
    gpuSerial: AUDIO_POLICY.gpuSerial,
    outward: AUDIO_POLICY.outward,
  }
}

export function listVoiceProfiles() {
  return VOICE_PROFILES.map((profile) => ({ ...profile }))
}

export function resolveVoiceProfile(id) {
  const key = asString(id).trim()
  if (!key) return VOICE_PROFILES[0]
  return VOICE_PROFILES.find((profile) => profile.id === key || profile.engine === key) || null
}

export function planVoiceover({
  lineSlug,
  text,
  engine = 'elevenlabs',
  targetVoice = 'elevenlabs-default',
  card = null,
} = {}) {
  const profile = resolveVoiceProfile(targetVoice) || resolveVoiceProfile(engine)
  if (!profile) {
    return { ok: false, reason: `unknown voice profile: ${targetVoice || engine}` }
  }
  if (profile.engine === 'human' || targetVoice === 'blake-recorded') {
    return { ok: false, reason: 'human-recorded line — do not TTS', profile }
  }
  const spoken = asString(text || card?.dialogue).trim()
  if (!spoken) return { ok: false, reason: 'synthesize_voiceover needs text or card.dialogue' }
  return {
    ok: true,
    action: 'synthesize_voiceover',
    lineSlug: asString(lineSlug || (card ? lineSlugForCard(card) : '')),
    text: spoken,
    engine: profile.engine,
    targetVoice: profile.id,
    workflowId: profile.velornWorkflowId || VO_WORKFLOW_ID,
    stage: STAGE_TTS_SYNTH,
    gpuSerial: true,
    outward: 'draft',
    queued: false,
    previewOnlyDefault: true,
  }
}

export function applyVoiceover(manifest, plan, options = {}) {
  if (!plan?.ok) throw new Error(plan?.reason || 'voiceover plan is not ok')
  return addTake(
    manifest,
    plan.lineSlug,
    options.audioPath || `drafts/vo/${plan.lineSlug}.wav`,
    STAGE_TTS_SYNTH,
    plan.engine,
    {
      engineParams: {
        targetVoice: plan.targetVoice,
        workflowId: plan.workflowId,
        outward: 'draft',
      },
      cardId: options.cardId || null,
      assetId: options.assetId || null,
      duration_s: options.duration_s,
      makeCanonical: options.makeCanonical !== false,
    },
  )
}

export function planCloneVoice(manifest, {
  lineSlug,
  sourceTakeId,
  targetVoice = 'chatterbox',
  engine = '',
} = {}) {
  const source = sourceTakeId
    ? findTake(manifest, sourceTakeId)
    : canonicalTake(manifest, lineSlug)
  if (!source) return { ok: false, reason: 'clone_voice needs a source take' }
  const profile = resolveVoiceProfile(targetVoice) || resolveVoiceProfile(engine) || resolveVoiceProfile('chatterbox')
  const convertedStage = profile?.engine === 'applio' ? STAGE_APPLIO_CONVERTED : STAGE_CHATTERBOX_CONVERTED
  return {
    ok: true,
    action: 'clone_voice',
    lineSlug: source.line_slug,
    sourceTakeId: source.take_id,
    parentTakeId: source.take_id,
    engine: profile?.engine || 'chatterbox',
    targetVoice: profile?.id || targetVoice,
    stage: convertedStage,
    workflowId: profile?.velornWorkflowId || VO_WORKFLOW_ID,
    gpuSerial: true,
    outward: 'draft',
    queued: false,
  }
}

export function applyCloneVoice(manifest, plan, options = {}) {
  if (!plan?.ok) throw new Error(plan?.reason || 'clone plan is not ok')
  return addTake(
    manifest,
    plan.lineSlug,
    options.audioPath || `drafts/vo/${plan.lineSlug}__${plan.targetVoice}.wav`,
    plan.stage,
    plan.engine,
    {
      parentTakeId: plan.parentTakeId,
      engineParams: { targetVoice: plan.targetVoice, workflowId: plan.workflowId, outward: 'draft' },
      makeCanonical: options.makeCanonical !== false,
    },
  )
}

export function planLipsyncClip({
  card = {},
  take = null,
  offScreen = false,
} = {}) {
  if (!take) {
    return { ok: false, action: 'generate_lipsync_clip', reason: 'no canonical take for this line' }
  }
  const spokenOff = offScreen || Boolean(card.offScreen)
  if (spokenOff || !card.imageAssetId) {
    return {
      ok: true,
      action: 'generate_lipsync_clip',
      flow: 'B',
      kind: 'bake',
      workflowId: null,
      mux: 'ffmpeg',
      takeId: take.take_id,
      audioPath: take.audio_path,
      videoAssetId: card.videoAssetId || null,
      gpuSerial: true,
      outward: 'draft',
      queued: false,
      notes: 'Off-screen or no still — overlay canonical WAV onto the silent clip. No GPU.',
    }
  }
  return {
    ok: true,
    action: 'generate_lipsync_clip',
    flow: 'A',
    kind: 'talking_head',
    workflowId: LIPSYNC_WORKFLOW_ID,
    draftWorkflowId: LIPSYNC_DRAFT_WORKFLOW_ID,
    takeId: take.take_id,
    audioPath: take.audio_path,
    firstFrameAssetId: card.imageAssetId,
    videoAssetId: card.videoAssetId || null,
    duration_s: Number(card.duration) || 5,
    needs: ['first', 'audio'],
    gpuSerial: true,
    outward: 'draft',
    queued: false,
    notes: 'On-screen dialogue. LTX 2.3 Talkvid talking-head, drafts only, GPU serial.',
  }
}

export function foleyAvailable(fileExists = null) {
  if (typeof fileExists === 'function') return Boolean(fileExists(FOLEY_LORA_PATH))
  return null
}

export function planFoley({
  card = {},
  fileExists = null,
  tags = '',
} = {}) {
  const available = foleyAvailable(fileExists)
  if (available === false) {
    return {
      ok: false,
      action: 'generate_foley',
      status: 503,
      available: false,
      gateUrl: FOLEY_GATE_URL,
      lora: FOLEY_LORA_NAME,
      reason: `foley LoRA missing at ${FOLEY_LORA_PATH} — accept terms + download from ${FOLEY_GATE_URL}`,
    }
  }
  const notes = asString(tags || card.soundNotes).trim()
  if (!card.videoAssetId && !card.silentVideoPath) {
    return {
      ok: false,
      action: 'generate_foley',
      status: 404,
      available: available !== false,
      reason: 'generate_foley needs a silent video on the shot',
    }
  }
  return {
    ok: true,
    action: 'generate_foley',
    status: 200,
    available: available !== false,
    kind: 'foley',
    workflowId: FOLEY_WORKFLOW_ID,
    lora: FOLEY_LORA_NAME,
    tags: notes,
    source: 'silent',
    videoAssetId: card.videoAssetId || null,
    silentVideoPath: card.silentVideoPath || '',
    duration_s: Number(card.duration) || 5,
    gpuSerial: true,
    outward: 'draft',
    queued: false,
    notes: 'LTX 2.3 Foley V2A. Silent clip → synced SFX. Drafts only.',
  }
}

export function applyFoley(registry, plan, options = {}) {
  if (!plan?.ok) throw new Error(plan?.reason || 'foley plan is not ok')
  const next = normalizeAudio(registry)
  const track = {
    id: options.id || newId(),
    kind: 'foley',
    name: options.name || `foley-${options.cardId || 'shot'}`,
    cardId: options.cardId || '',
    assetId: options.assetId || '',
    path: options.path || `drafts/audio/sfx/${options.cardId || 'shot'}.wav`,
    tags: plan.tags,
    duration_s: plan.duration_s,
    offset_s: Number(options.offset_s) || 0,
    gain_db: 0,
    duck: false,
    status: 'planned',
    outward: 'draft',
  }
  return { audio: { tracks: [...next.tracks, track] }, track }
}

export function bindCanonicalAudio(card, take) {
  if (!card) return card
  if (!take) return { ...card }
  return {
    ...card,
    audioAssetId: take.asset_id || card.audioAssetId || null,
    lineSlug: card.lineSlug || take.line_slug,
    canonicalTakeId: take.take_id,
  }
}

export function buildVseAudioPlan({ cards = [], manifest = emptyManifest(), audio = emptyAudioRegistry() } = {}) {
  const voClips = []
  const foleyClips = []
  const musicClips = []
  let cursor = 0
  for (const card of cards) {
    const duration = Number(card.duration) || 5
    const slug = lineSlugForCard(card)
    const take = canonicalTake(manifest, slug)
    if (take || card.audioAssetId) {
      voClips.push({
        kind: 'vo',
        cardId: card.id,
        lineSlug: slug,
        takeId: take?.take_id || null,
        assetId: take?.asset_id || card.audioAssetId || null,
        path: take?.audio_path || '',
        offset_s: cursor,
        duration_s: take?.duration_s || duration,
        gain_db: 0,
        duck: false,
        finalized: take?.stage === STAGE_FINALIZED,
      })
    }
    if (card.musicAssetId) {
      musicClips.push({
        kind: 'music',
        cardId: card.id,
        assetId: card.musicAssetId,
        offset_s: cursor,
        duration_s: duration,
        gain_db: 0,
        duck: true,
      })
    }
    if (card.foleyAssetId) {
      foleyClips.push({
        kind: 'foley',
        cardId: card.id,
        assetId: card.foleyAssetId,
        offset_s: cursor,
        duration_s: duration,
        gain_db: 0,
        duck: false,
      })
    }
    cursor += duration
  }
  for (const track of audio.tracks || []) {
    if (track.kind === 'foley' && !foleyClips.some((clip) => clip.assetId && clip.assetId === track.assetId)) {
      foleyClips.push({
        kind: 'foley',
        cardId: track.cardId,
        assetId: track.assetId,
        path: track.path,
        offset_s: track.offset_s,
        duration_s: track.duration_s,
        gain_db: track.gain_db,
        duck: false,
        tags: track.tags,
        status: track.status,
      })
    }
  }
  return {
    lanes: [
      { id: 'vo', kind: 'vo', label: 'Dialogue / VO', duck: false, clips: voClips },
      { id: 'foley', kind: 'foley', label: 'Foley / SFX', duck: false, clips: foleyClips },
      { id: 'music', kind: 'music', label: 'Music bed', duck: true, clips: musicClips },
    ],
    mix: {
      duckMusicUnderVo: AUDIO_POLICY.duckMusicUnderVo,
      master: AUDIO_POLICY.master,
    },
    gpuSerial: true,
    outward: 'draft',
    policy: AUDIO_POLICY,
  }
}

export function takeSummary(take) {
  if (!take) return 'no take'
  const flag = take.is_canonical ? 'canonical' : 'alt'
  return `${take.line_slug} ${take.stage}/${take.engine} (${flag})`
}

export function attachVoiceover(studio, manifest) {
  return { ...studio, voiceover: normalizeManifest(manifest, manifest.concept) }
}

export function attachAudio(studio, audio) {
  return { ...studio, audio: normalizeAudio(audio) }
}
