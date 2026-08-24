/**
 * CDX Studio-native shot routing matrix.
 *
 * Spec sources (semantics only — not a port of Studio Python):
 *   cdx-shot-routing          script call → lane
 *   cdx-generative-ecosystems exactly ONE ecosystem per job
 *
 * Maps a shot description onto CDX Studio workflow ids. Does not queue GPU work.
 * GPU jobs stay serial; outward artifacts stay drafts until a human cut.
 */

export const SHOT_CLASSES = Object.freeze([
  'vo',
  'surgical_fix',
  'signage',
  'talking_character',
  'action',
  'continuity',
  'identity',
  'audio_synced',
  'establishing',
  'atmosphere',
  'draft_still',
  'draft_clip',
  'narrative',
])

export const ROUTING_POLICY = Object.freeze({
  gpuSerial: true,
  outward: 'draft',
  realismFirst: true,
  talkingLipsRequired: true,
})

const CLIENT_FACING_TYPES = new Set([
  'commercial',
  'psa',
  'hype-video',
  'website-tour',
  'site-update',
])

const LANE_TO_CLASS = Object.freeze({
  vo: 'vo',
  voiceover: 'vo',
  narration: 'vo',
  tts: 'vo',
  lipdub: 'talking_character',
  talkvid: 'talking_character',
  dialogue: 'talking_character',
  talking: 'talking_character',
  lipsync: 'talking_character',
  action: 'action',
  fight: 'action',
  choreo: 'action',
  choreography: 'action',
  flf: 'continuity',
  continuity: 'continuity',
  union: 'continuity',
  'union-control': 'continuity',
  identity: 'identity',
  ref2va: 'identity',
  'ref-2va': 'identity',
  broll: 'atmosphere',
  'b-roll': 'atmosphere',
  atmosphere: 'atmosphere',
  establishing: 'establishing',
  plate: 'establishing',
  signage: 'signage',
  title: 'signage',
  lettering: 'signage',
  fix: 'surgical_fix',
  inpaint: 'surgical_fix',
  reactor: 'surgical_fix',
  region: 'surgical_fix',
  still: 'draft_still',
  keyframe: 'draft_still',
  draft: 'draft_clip',
  previz: 'draft_clip',
  beat: 'audio_synced',
  music: 'audio_synced',
  fl2va: 'audio_synced',
})

export const ROUTING_MATRIX = Object.freeze({
  vo: {
    class: 'vo',
    label: 'VO / off-screen narration',
    status: 'proven',
    ecosystem: 'qwen3-tts',
    bundle: 'cdx-shot-routing',
    workflowId: 'elevenlabs-tts',
    stillWorkflowId: null,
    videoWorkflowId: null,
    draftWorkflowId: 'elevenlabs-tts',
    blenderControl: false,
    icLora: null,
    clientSafe: true,
    needs: ['text'],
    notes: 'Directed VO. CDX Studio lane is ElevenLabs TTS; Studio Qwen3-TTS/Applio stay on the take-chain card.',
  },
  surgical_fix: {
    class: 'surgical_fix',
    label: 'Surgical fix',
    status: 'proven',
    ecosystem: 'qwen-edit',
    bundle: 'cdx-flux2',
    workflowId: 'cdx-qwen-inpaint-ref',
    stillWorkflowId: 'cdx-qwen-inpaint-ref',
    videoWorkflowId: 'ltx25-inpaint',
    draftWorkflowId: 'image-edit',
    blenderControl: false,
    icLora: null,
    clientSafe: true,
    needs: ['first'],
    notes: 'Region / background / face repair. Face lock uses cdx-reactor-facelock.',
  },
  signage: {
    class: 'signage',
    label: 'Signage / in-world text',
    status: 'proven',
    ecosystem: 'ideogram4',
    bundle: 'cdx-ideogram4',
    workflowId: 'grok-text-to-image',
    stillWorkflowId: 'grok-text-to-image',
    videoWorkflowId: null,
    draftWorkflowId: 'grok-text-to-image',
    blenderControl: false,
    icLora: null,
    clientSafe: true,
    needs: [],
    notes: 'Ideogram 4 is the lettering ecosystem. CDX Studio has no Ideogram workflow yet — Grok stills, then composite.',
  },
  talking_character: {
    class: 'talking_character',
    label: 'Talking character',
    status: 'proven',
    ecosystem: 'ltx23',
    bundle: 'cdx-ltx25',
    workflowId: 'ltx23-id-lora',
    stillWorkflowId: 'cdx-keyframe-multiref',
    videoWorkflowId: 'ltx23-id-lora',
    draftWorkflowId: 'grok-video-i2v',
    blenderControl: false,
    icLora: null,
    clientSafe: true,
    needs: ['first', 'audio'],
    notes: 'On-screen dialogue needs moving lips at any angle unless the line is marked off-screen.',
    bTest: {
      workflowId: 'minimax-h3-r2v',
      status: 'untested',
      note: 'H3 native dialogue (line in prompt) is still an open comparison.',
    },
  },
  action: {
    class: 'action',
    label: 'Action / fight / choreography',
    status: 'proven',
    ecosystem: 'ltx25',
    bundle: 'cdx-ltx25',
    workflowId: 'cdx-ltx-union-control-flf',
    stillWorkflowId: 'cdx-keyframe-multiref',
    videoWorkflowId: 'cdx-ltx-union-control-flf',
    draftWorkflowId: 'grok-video-i2v',
    blenderControl: true,
    icLora: 'union',
    clientSafe: true,
    needs: ['first', 'last'],
    notes: 'Grok I2V draft A before GPU burn. Final: LTX union-control + Blender anchors, segment-chained FLF.',
    bTest: {
      workflowId: 'minimax-h3-flf2v',
      status: 'testing',
      note: 'H3 FL2VA as B-test per shot.',
    },
  },
  continuity: {
    class: 'continuity',
    label: 'Continuity across cuts',
    status: 'proven',
    ecosystem: 'ltx25',
    bundle: 'cdx-ltx25',
    workflowId: 'ltx25-flf2v',
    stillWorkflowId: 'cdx-keyframe-multiref',
    videoWorkflowId: 'ltx25-flf2v',
    draftWorkflowId: 'seedance2-flf2v',
    blenderControl: false,
    icLora: null,
    clientSafe: true,
    needs: ['first', 'last'],
    notes: 'FLF chains must share boundary frames. Prefer LTX 2.5 flf2v; blocking control uses cdx-ltx-union-control-flf.',
  },
  identity: {
    class: 'identity',
    label: 'Identity-conditioned / multi-char',
    status: 'proven',
    ecosystem: 'minimax-h3',
    bundle: 'cdx-minimax-h3',
    workflowId: 'minimax-h3-r2v',
    stillWorkflowId: 'cdx-keyframe-multiref',
    videoWorkflowId: 'minimax-h3-r2v',
    draftWorkflowId: 'grok-video-i2v',
    blenderControl: false,
    icLora: 'ingredients',
    clientSafe: false,
    needs: ['refs'],
    notes: 'Grok multi-ref still → I2V draft, then H3 Ref2VA. H3 is US-excluded — internal only.',
    clientSafeFallback: {
      ecosystem: 'ltx25',
      bundle: 'cdx-ltx25',
      workflowId: 'ltx25-ingredients',
      videoWorkflowId: 'ltx25-ingredients',
    },
  },
  audio_synced: {
    class: 'audio_synced',
    label: 'Audio-synced beat',
    status: 'testing',
    ecosystem: 'minimax-h3',
    bundle: 'cdx-minimax-h3',
    workflowId: 'minimax-h3-flf2v',
    stillWorkflowId: 'cdx-keyframe-multiref',
    videoWorkflowId: 'minimax-h3-flf2v',
    draftWorkflowId: 'grok-video-i2v',
    blenderControl: false,
    icLora: null,
    clientSafe: false,
    needs: ['first', 'audio'],
    notes: 'H3 FL2VA single-pass when music/SFX timing matters. Production-testing.',
    clientSafeFallback: {
      ecosystem: 'ltx25',
      bundle: 'cdx-ltx25',
      workflowId: 'ltx23-ia2v',
      videoWorkflowId: 'ltx23-ia2v',
    },
  },
  establishing: {
    class: 'establishing',
    label: 'Establishing / real place',
    status: 'proven',
    ecosystem: 'minimax-h3',
    bundle: 'cdx-minimax-h3',
    workflowId: 'minimax-h3-t2v',
    stillWorkflowId: 'grok-text-to-image',
    videoWorkflowId: 'minimax-h3-t2v',
    draftWorkflowId: 'grok-video-i2v',
    blenderControl: false,
    icLora: null,
    clientSafe: false,
    preferDamFootage: true,
    needs: [],
    notes: 'Real footage from DAM first. Else H3 t2v or Grok plate-conditioned.',
    clientSafeFallback: {
      ecosystem: 'ltx25',
      bundle: 'cdx-ltx25',
      workflowId: 'ltx25-t2v',
      videoWorkflowId: 'ltx25-t2v',
    },
  },
  atmosphere: {
    class: 'atmosphere',
    label: 'Atmosphere / B-roll',
    status: 'proven',
    ecosystem: 'minimax-h3',
    bundle: 'cdx-minimax-h3',
    workflowId: 'minimax-h3-t2v',
    stillWorkflowId: 'z-image-turbo',
    videoWorkflowId: 'minimax-h3-t2v',
    draftWorkflowId: 'grok-video-i2v',
    blenderControl: false,
    icLora: null,
    clientSafe: false,
    needs: [],
    notes: 'No named faces. Prefer H3 t2v (Sol) or Grok draft first.',
    clientSafeFallback: {
      ecosystem: 'ltx25',
      bundle: 'cdx-ltx25',
      workflowId: 'ltx25-t2v',
      videoWorkflowId: 'ltx25-t2v',
    },
  },
  draft_still: {
    class: 'draft_still',
    label: 'Draft still',
    status: 'proven',
    ecosystem: 'grok-imagine',
    bundle: 'cdx-shot-routing',
    workflowId: 'grok-text-to-image',
    stillWorkflowId: 'grok-text-to-image',
    videoWorkflowId: null,
    draftWorkflowId: 'grok-text-to-image',
    blenderControl: false,
    icLora: null,
    clientSafe: true,
    needs: [],
    notes: 'Concept / multi-ref identity trial. Native Grok before Comfy.',
  },
  draft_clip: {
    class: 'draft_clip',
    label: 'Draft clip',
    status: 'proven',
    ecosystem: 'grok-imagine',
    bundle: 'cdx-shot-routing',
    workflowId: 'grok-video-i2v',
    stillWorkflowId: 'grok-text-to-image',
    videoWorkflowId: 'grok-video-i2v',
    draftWorkflowId: 'grok-video-i2v',
    blenderControl: false,
    icLora: null,
    clientSafe: true,
    needs: ['first'],
    notes: 'Fast cloud identity trial. Label engine=grok-imagine. Do not ship a 6s linger as a short.',
  },
  narrative: {
    class: 'narrative',
    label: 'Narrative video',
    status: 'proven',
    ecosystem: 'ltx25',
    bundle: 'cdx-ltx25',
    workflowId: 'ltx25-i2v',
    stillWorkflowId: 'cdx-keyframe-multiref',
    videoWorkflowId: 'ltx25-i2v',
    draftWorkflowId: 'grok-video-i2v',
    blenderControl: false,
    icLora: null,
    clientSafe: true,
    needs: ['first'],
    notes: 'Default photoreal lane. Control / FLF / multishot stay inside LTX 2.5.',
  },
})

const rx = (source) => new RegExp(source, 'i')

const CLASS_HINTS = Object.freeze([
  { cls: 'vo', re: rx('\\b(voice[- ]?over|off[- ]screen narration|vo line|tts read)\\b') },
  { cls: 'surgical_fix', re: rx('\\b(inpaint|region fix|face lock|reactor|surgical|fix the (face|bg|background|region)|qwen-edit)\\b') },
  { cls: 'signage', re: rx('\\b(signage|in-world text|logo lockup|title card|lettering|storefront sign|on-image text)\\b') },
  { cls: 'talking_character', re: rx('\\b(talking|dialogue|lipsync|lip[- ]sync|speaks? the line|on-screen (line|dialogue)|talkvid|lipdub)\\b') },
  { cls: 'action', re: rx('\\b(fight|punch|choreograph|combat|action beat|brawl|windup|impact freeze|stunt)\\b') },
  { cls: 'continuity', re: rx('\\b(continuity|flf|first[- /]last|boundary frame|match cut|shared last frame)\\b') },
  { cls: 'identity', re: rx('\\b(multi[- ]char|two characters|identity[- ]condition|ref2va|same faces|cast lock)\\b') },
  { cls: 'audio_synced', re: rx('\\b(beat[- ]sync|audio[- ]sync|music video|sfx[- ]sync|hit the downbeat|fl2va)\\b') },
  { cls: 'establishing', re: rx('\\b(establishing|real place|location plate|north lawndale|exterior wide of)\\b') },
  { cls: 'atmosphere', re: rx('\\b(b-?roll|atmosphere|empty street|no faces|ambiance|insert of (sky|crowd|traffic))\\b') },
  { cls: 'draft_still', re: rx('\\b(draft still|concept still|identity trial still|previz still)\\b') },
  { cls: 'draft_clip', re: rx('\\b(draft clip|previz clip|identity trial clip|fast cloud clip)\\b') },
])

function asString(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function haystack(input = {}) {
  return [
    input.description,
    input.title,
    input.action,
    input.audio,
    input.dialogue,
    input.notes,
    input.lane,
    input.prompt,
  ].map(asString).filter(Boolean).join('\n')
}

export function isClientFacingProduction(productionType, clientSafe) {
  if (clientSafe === true) return true
  if (clientSafe === false) return false
  return CLIENT_FACING_TYPES.has(asString(productionType).toLowerCase())
}

export function classifyShot(input = {}) {
  const explicit = asString(input.class || input.shotClass).toLowerCase().replace(/[\s-]+/g, '_')
  if (SHOT_CLASSES.includes(explicit)) return explicit

  const lane = asString(input.lane).toLowerCase()
  if (LANE_TO_CLASS[lane]) return LANE_TO_CLASS[lane]

  if (input.offScreen === true && (asString(input.dialogue) || /vo|narrat/i.test(lane))) {
    return 'vo'
  }

  const text = haystack(input)
  for (const hint of CLASS_HINTS) {
    if (hint.re.test(text)) {
      if (hint.cls === 'talking_character' && (input.offScreen === true || /\boff[- ]screen\b/i.test(text))) {
        return 'vo'
      }
      return hint.cls
    }
  }

  const characterCount = Number(input.characterCount)
  if (Number.isFinite(characterCount) && characterCount >= 2) return 'identity'
  if (input.hasNamedFaces === false && !asString(input.dialogue)) return 'atmosphere'

  const intent = asString(input.intent).toLowerCase()
  const stage = asString(input.stage).toLowerCase()
  if (intent === 'still' || (stage === 'draft' && intent !== 'clip' && intent !== 'video')) {
    if (intent === 'still' || stage === 'draft') return 'draft_still'
  }
  if (intent === 'clip' || intent === 'video') {
    if (stage === 'draft') return 'draft_clip'
  }

  if (input.hasLastFrame === true || input.hasBlocking === true) return 'continuity'
  return 'narrative'
}

function applyClientSafe(entry, clientFacing) {
  if (!clientFacing || entry.clientSafe !== false || !entry.clientSafeFallback) return entry
  return {
    ...entry,
    ...entry.clientSafeFallback,
    clientSafe: true,
    licenseNote: 'H3 is US-excluded; swapped to the client-safe LTX lane.',
  }
}

function refineWorkflow(entry, input = {}) {
  const next = { ...entry }
  if (entry.class === 'surgical_fix') {
    const text = haystack(input)
    if (/\b(face lock|reactor|swap face)\b/i.test(text)) {
      next.workflowId = 'cdx-reactor-facelock'
      next.stillWorkflowId = 'cdx-reactor-facelock'
    } else if (/\b(background|bg fix|qwen-edit)\b/i.test(text)) {
      next.workflowId = 'image-edit'
      next.stillWorkflowId = 'image-edit'
    }
  }
  if (entry.class === 'continuity' && (input.hasBlocking === true || input.hasControlVideo === true)) {
    next.workflowId = 'cdx-ltx-union-control-flf'
    next.videoWorkflowId = 'cdx-ltx-union-control-flf'
    next.blenderControl = true
    next.icLora = 'union'
  }
  if (entry.class === 'draft_still' && Number(input.characterCount) >= 1) {
    next.workflowId = 'cdx-keyframe-multiref'
    next.stillWorkflowId = 'cdx-keyframe-multiref'
    next.notes = 'Identity trial still with character refs — multi-ref keyframe, Grok if no refs.'
  }
  if (entry.class === 'narrative' && !input.hasStill && input.hasLastFrame !== true) {
    next.workflowId = 'ltx25-t2v'
    next.videoWorkflowId = 'ltx25-t2v'
    next.needs = []
  }
  if (entry.class === 'action' && input.hasBlocking !== true && input.hasLastFrame === true) {
    next.workflowId = 'ltx25-flf2v'
    next.videoWorkflowId = 'ltx25-flf2v'
  }
  return next
}

export function routeShot(input = {}) {
  const shotClass = classifyShot(input)
  const base = ROUTING_MATRIX[shotClass] || ROUTING_MATRIX.narrative
  const clientFacing = isClientFacingProduction(input.productionType, input.clientSafe)
  const entry = refineWorkflow(applyClientSafe(base, clientFacing), input)
  const reasons = []
  if (input.lane) reasons.push(`lane=${asString(input.lane)}`)
  if (input.class || input.shotClass) reasons.push('explicit class')
  if (!reasons.length) reasons.push('classified from shot description')
  if (entry.licenseNote) reasons.push(entry.licenseNote)

  return {
    ...entry,
    class: entry.class || shotClass,
    gpuSerial: ROUTING_POLICY.gpuSerial,
    outward: ROUTING_POLICY.outward,
    realismFirst: ROUTING_POLICY.realismFirst,
    reasons,
    source: 'velorn-shot-routing',
    spec: ['cdx-shot-routing', 'cdx-generative-ecosystems'],
  }
}

export function shotInputFromCard(card = {}, extras = {}) {
  const slot = extras.slot || null
  const characters = Array.isArray(card.characterRefs) ? card.characterRefs : []
  return {
    description: card.description || card.prompt || '',
    title: card.title || '',
    action: card.action || slot?.action || '',
    audio: card.soundNotes || slot?.audio || '',
    dialogue: card.dialogue || '',
    notes: slot?.notes || '',
    lane: extras.lane || slot?.lane || '',
    class: extras.class || card.shotClass || slot?.shot_class,
    intent: extras.intent || card.intent,
    stage: extras.stage || (card.status === 'draft' ? 'draft' : ''),
    offScreen: extras.offScreen,
    hasNamedFaces: extras.hasNamedFaces ?? (characters.length > 0 ? true : undefined),
    characterCount: extras.characterCount ?? characters.length,
    productionType: extras.productionType,
    clientSafe: extras.clientSafe,
    hasStill: Boolean(card.imageAssetId || extras.hasStill),
    hasLastFrame: Boolean(card.lastFrameAssetId || extras.hasLastFrame),
    hasBlocking: Boolean(card.cameraRig?.source && card.cameraRig.source !== 'default') || extras.hasBlocking === true,
    hasControlVideo: extras.hasControlVideo === true,
  }
}

export function routeShotFromCard(card = {}, extras = {}) {
  const route = routeShot(shotInputFromCard(card, extras))
  return {
    ...route,
    cardId: card.id || null,
    slotId: extras.slot?.slot_id || extras.slotId || null,
    boardShot: extras.slot?.board_shot || card.id || null,
  }
}

export function routeStudioShots(studio = {}, cards = [], extras = {}) {
  const slots = Array.isArray(studio?.slots) ? studio.slots : []
  const list = Array.isArray(cards) && cards.length
    ? cards
    : slots.map((slot) => ({
      id: slot.board_shot || slot.slot_id,
      title: slot.board_shot || slot.slot_id,
      description: [slot.action, slot.audio, slot.notes].filter(Boolean).join('\n'),
      action: slot.action,
      soundNotes: slot.audio,
    }))

  const shots = list.map((card) => {
    const hay = `${card.id || ''} ${card.title || ''} ${card.action || ''}`.toLowerCase()
    const slot = slots.find((item) => (
      item.board_shot === card.id
      || item.slot_id === card.id
      || hay.includes(String(item.slot_id || '').toLowerCase())
      || (item.board_shot && hay.includes(String(item.board_shot).toLowerCase()))
    )) || null
    return routeShotFromCard(card, { ...extras, slot })
  })

  return {
    policy: ROUTING_POLICY,
    count: shots.length,
    shots,
  }
}

export function routingSummary(route) {
  if (!route) return ''
  const draft = route.draftWorkflowId && route.draftWorkflowId !== route.workflowId
    ? ` · draft ${route.draftWorkflowId}`
    : ''
  return `${route.label} → ${route.workflowId}${draft}`
}
