/**
 * Reference cards (docs/ux-guided-mobile-plan.md §4) — the data model and
 * cascade rules for character / location / prop reference sets.
 *
 * A card owns a named slot grid. Slot lifecycle:
 *   empty → generating → review → accepted
 * Regenerate re-queues a slot but KEEPS the currently accepted asset until a
 * new candidate is accepted (never leaves a slot bare mid-flight). Every
 * accept appends to the slot's history.
 *
 * Character cascade: accept close_up_face → unlocks full_body → accepting
 * full_body unlocks body fields (height/weight/body type) and the auto set
 * (side_view, seated, 6 emotions). Replacing any slot may optionally
 * propagate: regenerate the other filled slots so the set stays consistent
 * with the new anchor.
 *
 * Pure and node-test-safe; the UI, the generation queue wiring, and the
 * quality gates all read these rules from here.
 */

export const SLOT_STATUS = Object.freeze(['empty', 'generating', 'review', 'accepted'])

export const CHARACTER_ANCHORS = Object.freeze(['close_up_face', 'full_body'])
export const EMOTIONS = Object.freeze(['happy', 'sad', 'angry', 'surprised', 'fearful', 'disgusted'])
export const CHARACTER_AUTO_SLOTS = Object.freeze([
  'side_view',
  'seated',
  ...EMOTIONS.map((e) => `emotion_${e}`),
])
export const CHARACTER_SLOTS = Object.freeze([...CHARACTER_ANCHORS, ...CHARACTER_AUTO_SLOTS])
export const LOCATION_SLOTS = Object.freeze(['wide', 'medium', 'detail', 'birds_eye'])
export const PROP_SLOTS = Object.freeze(['hero', 'alt_1', 'alt_2'])

/**
 * Movement cards have no slot grid — their product is motion data, not
 * images — so they carry a single status instead. The lifecycle rules live
 * in movementRefs.js; only the shape lives here, next to the other
 * constructors, so referencePanels.js can build one without importing the
 * movement module (which would close an import cycle).
 */
export const MOVEMENT_STATUS = Object.freeze(['empty', 'generating', 'review', 'accepted'])

/** Matches the kimodo_serve.py defaults so the card and the service agree. */
export const MOVEMENT_DEFAULTS = Object.freeze({ frames: 90, steps: 30, seed: 42 })

const emptySlot = () => ({ status: 'empty', assetId: null, history: [], updatedAt: null })

function slotsOf(ids) {
  return Object.fromEntries(ids.map((id) => [id, emptySlot()]))
}

/* ── constructors ─────────────────────────────────────────────────────── */

export function newCharacterCard({ id, name }) {
  return {
    kind: 'character',
    id,
    name: name || id,
    slots: slotsOf(CHARACTER_SLOTS),
    body: { height_cm: null, weight_kg: null, body_type: '' },
    wardrobe: [],
    activeWardrobeId: null,
    audio: null,
  }
}

export function newLocationCard({ id, name }) {
  return {
    kind: 'location',
    id,
    name: name || id,
    slots: slotsOf(LOCATION_SLOTS),
    landmarks: [],
  }
}

export function newPropCard({ id, name }) {
  return {
    kind: 'prop',
    id,
    name: name || id,
    slots: slotsOf(PROP_SLOTS),
  }
}

function clampInt(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.round(parsed)))
}

export function normalizeMovementParams(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  return {
    frames: clampInt(src.frames, MOVEMENT_DEFAULTS.frames, 1, 1200),
    steps: clampInt(src.steps, MOVEMENT_DEFAULTS.steps, 1, 200),
    seed: clampInt(src.seed, MOVEMENT_DEFAULTS.seed, 0, 2 ** 31 - 1),
  }
}

/** A named action bound to ONE character, realised by kimodo.cpp. */
export function newMovementCard({ id, name, characterId = '', prompt = '', params } = {}) {
  return {
    kind: 'movement',
    id,
    name: name || id,
    characterId: characterId ? String(characterId) : '',
    prompt: prompt ? String(prompt) : '',
    params: normalizeMovementParams(params),
    status: 'empty',
    motion: null, // accepted motion metadata
    candidate: null, // motion awaiting review
    history: [],
    error: '',
    updatedAt: null,
  }
}

/* ── slot primitives ──────────────────────────────────────────────────── */

export function getSlot(card, slotId) {
  return card?.slots?.[slotId] || null
}

function withSlot(card, slotId, patch, now) {
  const slot = getSlot(card, slotId)
  if (!slot) throw new Error(`unknown slot '${slotId}' on ${card.kind} '${card.id}'`)
  return {
    ...card,
    slots: {
      ...card.slots,
      [slotId]: { ...slot, ...patch, updatedAt: now || slot.updatedAt },
    },
  }
}

const isFilled = (slot) => slot && (slot.status === 'accepted' || slot.status === 'review' || slot.status === 'generating')

/* ── cascade queries ──────────────────────────────────────────────────── */

/** What each accepted anchor unlocks (character cards). */
export function unlocks(card) {
  if (card?.kind !== 'character') return {}
  const face = getSlot(card, 'close_up_face')?.status === 'accepted'
  const body = getSlot(card, 'full_body')?.status === 'accepted'
  return {
    full_body: face,
    autoSet: face && body,
    bodyFields: face && body,
  }
}

export function anchorsAccepted(card) {
  if (card?.kind !== 'character') return false
  return CHARACTER_ANCHORS.every((id) => getSlot(card, id)?.status === 'accepted')
}

export function missingAnchors(card) {
  if (card?.kind !== 'character') return []
  return CHARACTER_ANCHORS.filter((id) => getSlot(card, id)?.status !== 'accepted')
}

/** Gate for character generation: both anchors accepted. */
export function canGenerateSet(card) {
  return anchorsAccepted(card)
}

/* ── mutations (all return new cards) ─────────────────────────────────── */

/** Accept an image into a slot (locks it, appends to history). */
export function acceptSlot(card, slotId, assetId, { now } = {}) {
  const slot = getSlot(card, slotId)
  if (!slot) throw new Error(`unknown slot '${slotId}' on ${card.kind} '${card.id}'`)
  if (!assetId) throw new Error('acceptSlot needs an assetId')
  return withSlot(card, slotId, {
    status: 'accepted',
    assetId,
    candidateId: null,
    history: [...(slot.history || []), assetId],
  }, now)
}

/** Re-queue a slot. The accepted asset stays until a new one is accepted. */
export function requestRegenerate(card, slotId, { now } = {}) {
  const slot = getSlot(card, slotId)
  if (!slot) throw new Error(`unknown slot '${slotId}' on ${card.kind} '${card.id}'`)
  if (slot.status === 'generating') return card
  return withSlot(card, slotId, { status: 'generating' }, now)
}

/** A queued candidate is ready for review. */
export function markGenerated(card, slotId, { now } = {}) {
  return withSlot(card, slotId, { status: 'review' }, now)
}

/**
 * A regenerated candidate arrived from the queue: park it on the slot as
 * `candidateId` for review WITHOUT disturbing the accepted assetId — the
 * current accepted image stays the slot's ref until the candidate is
 * accepted (acceptSlot) or rejected (failSlot).
 */
export function reviewSlot(card, slotId, assetId, { now } = {}) {
  const slot = getSlot(card, slotId)
  if (!slot) throw new Error(`unknown slot '${slotId}' on ${card.kind} '${card.id}'`)
  if (!assetId) throw new Error('reviewSlot needs an assetId')
  return withSlot(card, slotId, { status: 'review', candidateId: assetId }, now)
}

/** Generation failed: fall back to the last accepted state (or empty). */
export function failSlot(card, slotId, { now } = {}) {
  const slot = getSlot(card, slotId)
  if (!slot) throw new Error(`unknown slot '${slotId}' on ${card.kind} '${card.id}'`)
  return withSlot(card, slotId, { status: slot.assetId ? 'accepted' : 'empty', candidateId: null }, now)
}

/**
 * Manually place an image over a slot (accepts it). With propagate=true the
 * caller also gets the list of OTHER filled slots to re-queue so the set
 * stays consistent with the new image (the "update the rest to match" flow).
 * Returns { card, regenerate: string[] }.
 */
export function replaceSlot(card, slotId, assetId, { propagate = false, now } = {}) {
  const next = acceptSlot(card, slotId, assetId, { now })
  const regenerate = propagate
    ? Object.entries(next.slots)
        .filter(([id, slot]) => id !== slotId && isFilled(slot))
        .map(([id]) => id)
    : []
  return { card: next, regenerate }
}

/* ── character extras ─────────────────────────────────────────────────── */

/** Height/weight/body type — editable once both anchors are accepted. */
export function setBody(card, fields, { now } = {}) {
  if (card?.kind !== 'character') throw new Error('setBody is for character cards')
  const body = { ...card.body }
  if (fields.height_cm !== undefined) body.height_cm = fields.height_cm === null ? null : Number(fields.height_cm)
  if (fields.weight_kg !== undefined) body.weight_kg = fields.weight_kg === null ? null : Number(fields.weight_kg)
  if (fields.body_type !== undefined) body.body_type = String(fields.body_type || '')
  return { ...card, body, updatedAt: now || card.updatedAt }
}

export function addWardrobeVariant(card, { id, label }) {
  if (card?.kind !== 'character') throw new Error('wardrobe is for character cards')
  if (!id) throw new Error('wardrobe variant needs an id')
  if (card.wardrobe.some((w) => w.id === id)) return card
  return {
    ...card,
    wardrobe: [...card.wardrobe, { id, label: label || id, slots: slotsOf(CHARACTER_ANCHORS) }],
  }
}

export function attachAudio(card, assetId, { now } = {}) {
  if (card?.kind !== 'character') throw new Error('audio reference is for character cards')
  if (!assetId) throw new Error('attachAudio needs an assetId')
  return { ...card, audio: { status: 'accepted', assetId, updatedAt: now || null } }
}

/**
 * Set (or clear, with null) the wardrobe variant generation should dress the
 * character in. Filled variant slots then win over the base anchors per-slot
 * (see generationRefs.generationAnchorAssetIds).
 */
export function setActiveWardrobe(card, variantId, { now } = {}) {
  if (card?.kind !== 'character') throw new Error('wardrobe is for character cards')
  if (variantId != null && variantId !== '' && !card.wardrobe.some((w) => w.id === variantId)) {
    throw new Error(`unknown wardrobe variant '${variantId}' on '${card.id}'`)
  }
  return { ...card, activeWardrobeId: variantId || null, updatedAt: now || card.updatedAt }
}

/** The active wardrobe variant object, or null when none is selected. */
export function activeWardrobe(card) {
  if (card?.kind !== 'character' || !card.activeWardrobeId) return null
  return (card.wardrobe || []).find((w) => w.id === card.activeWardrobeId) || null
}

/** Accept an image into a wardrobe variant's slot (variants carry anchor slots). */
export function acceptWardrobeSlot(card, variantId, slotId, assetId, { now } = {}) {
  if (card?.kind !== 'character') throw new Error('wardrobe is for character cards')
  if (!assetId) throw new Error('acceptWardrobeSlot needs an assetId')
  const variant = card.wardrobe.find((w) => w.id === variantId)
  if (!variant) throw new Error(`unknown wardrobe variant '${variantId}' on '${card.id}'`)
  if (!variant.slots?.[slotId]) throw new Error(`unknown slot '${slotId}' on wardrobe '${variantId}'`)
  const slot = variant.slots[slotId]
  return {
    ...card,
    wardrobe: card.wardrobe.map((w) => (
      w.id === variantId
        ? {
          ...w,
          slots: {
            ...w.slots,
            [slotId]: {
              ...slot,
              status: 'accepted',
              assetId,
              history: [...(slot.history || []), assetId],
              updatedAt: now || slot.updatedAt,
            },
          },
        }
        : w
    )),
  }
}

/* ── location extras ──────────────────────────────────────────────────── */

/** Landmarks feed the blocking environment (birds-eye with labels). */
export function addLandmark(card, { name, x_m, y_m }) {
  if (card?.kind !== 'location') throw new Error('landmarks are for location cards')
  const x = Number(x_m)
  const y = Number(y_m)
  if (!name || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('landmark needs name + finite x_m/y_m')
  }
  return { ...card, landmarks: [...card.landmarks, { name, x_m: x, y_m: y }] }
}

/** Drop a landmark by index (returned in order by the panel). */
export function removeLandmark(card, index) {
  if (card?.kind !== 'location') throw new Error('landmarks are for location cards')
  return { ...card, landmarks: card.landmarks.filter((_, i) => i !== index) }
}
