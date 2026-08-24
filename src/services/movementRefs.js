/**
 * Movement reference cards — the fourth reference kind, alongside
 * character / location / prop.
 *
 * A movement card binds a named action ("throws a right hook then backpedals")
 * to ONE character card, and is realised by the kimodo.cpp motion service
 * (services/kimodoMotion.js, SMPL-X22 on the GB10). Unlike the image kinds a
 * movement has no slot grid: its product is motion data, so the card owns a
 * single lifecycle instead of a slot cascade.
 *
 *   empty → generating → review → accepted
 *
 * Regenerate re-queues the card but KEEPS the accepted motion until a new
 * candidate is accepted, mirroring the slot rule in referenceCards.js so a
 * character is never left with no movement mid-flight.
 *
 * Only motion METADATA is stored on the card. kimodo returns per-frame
 * rotation and root-translation arrays that are far too large for project
 * JSON; those stay on disk in the service's `out_dir` and the card keeps the
 * pointer plus the counts needed to reason about the clip.
 *
 * Pure and node-test-safe — no fetch, no Electron. The panel layer performs
 * the actual kimodo call and feeds the result back through `reviewMovement`.
 */

import {
  MOVEMENT_DEFAULTS,
  MOVEMENT_STATUS,
  newMovementCard,
  normalizeMovementParams,
} from './referenceCards.js'
import { normalizeReferences } from './referencePanels.js'

// The card shape lives in referenceCards.js beside the other constructors;
// re-exported here so callers can treat movementRefs as the movement module.
export { MOVEMENT_DEFAULTS, MOVEMENT_STATUS, newMovementCard, normalizeMovementParams }

const asString = (value) => (value === null || value === undefined ? '' : String(value))

const clampInt = (value, fallback, min, max) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.round(parsed)))
}

/** Tolerate partial cards from older project files. */
export function normalizeMovementCard(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const base = newMovementCard({ id: asString(src.id), name: asString(src.name) })
  const status = MOVEMENT_STATUS.includes(src.status) ? src.status : 'empty'
  return {
    ...base,
    characterId: asString(src.characterId),
    prompt: asString(src.prompt),
    params: normalizeMovementParams(src.params),
    status,
    motion: src.motion && typeof src.motion === 'object' ? src.motion : null,
    candidate: src.candidate && typeof src.candidate === 'object' ? src.candidate : null,
    history: Array.isArray(src.history) ? src.history.filter(Boolean) : [],
    error: asString(src.error),
    updatedAt: src.updatedAt || null,
  }
}

/* ── kimodo response → stored metadata ────────────────────────────────── */

/**
 * Reduce a kimodo `/motion` response to what belongs in project JSON.
 * The bulky `rotations_xyzw` / `root_positions` arrays are deliberately
 * dropped — `outDir` is where they live.
 */
export function motionMetaFromResponse(raw, { params, now } = {}) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const used = normalizeMovementParams(params)
  const frames = Number(src.frames)
  const joints = Number(src.joints)
  return {
    frames: Number.isFinite(frames) && frames > 0 ? frames : used.frames,
    joints: Number.isFinite(joints) && joints > 0 ? joints : 22,
    format: 'SMPL-X22',
    engine: 'kimodo.cpp',
    outDir: asString(src.out_dir || src.outDir),
    params: used,
    generatedAt: now || null,
  }
}

/* ── lifecycle ────────────────────────────────────────────────────────── */

export function markMovementGenerating(card, { now } = {}) {
  return { ...card, status: 'generating', error: '', updatedAt: now || null }
}

/** A finished kimodo run lands here first; nothing is accepted implicitly. */
export function reviewMovement(card, motionMeta, { now } = {}) {
  if (!motionMeta || typeof motionMeta !== 'object') {
    throw new Error(`reviewMovement needs motion metadata for '${card?.id}'`)
  }
  return { ...card, status: 'review', candidate: motionMeta, error: '', updatedAt: now || null }
}

export function acceptMovement(card, { now } = {}) {
  const accepted = card?.candidate
  if (!accepted) throw new Error(`no candidate motion to accept on '${card?.id}'`)
  return {
    ...card,
    status: 'accepted',
    motion: accepted,
    candidate: null,
    history: [...(card.history || []), { ...accepted, acceptedAt: now || null }],
    error: '',
    updatedAt: now || null,
  }
}

/** Keeps the accepted motion in place so the character is never left bare. */
export function requestRegenerateMovement(card, { now } = {}) {
  return { ...card, status: 'generating', candidate: null, error: '', updatedAt: now || null }
}

export function failMovement(card, error, { now } = {}) {
  return {
    ...card,
    // Fall back to accepted if there is one, otherwise back to empty.
    status: card?.motion ? 'accepted' : 'empty',
    candidate: null,
    error: asString(error?.message || error) || 'motion generation failed',
    updatedAt: now || null,
  }
}

export function movementAccepted(card) {
  return card?.status === 'accepted' && Boolean(card?.motion)
}

/* ── character binding ────────────────────────────────────────────────── */

export function assignMovementToCharacter(card, characterId) {
  return { ...card, characterId: asString(characterId) }
}

export function listMovements(references) {
  const refs = normalizeReferences(references)
  return (refs.movements || []).map(normalizeMovementCard)
}

/** Every movement card bound to a character, in list order. */
export function movementsForCharacter(references, characterId) {
  const wanted = asString(characterId)
  if (!wanted) return []
  return listMovements(references).filter((card) => card.characterId === wanted)
}

export function findMovementCard(references, idOrName) {
  const wanted = asString(idOrName).trim()
  if (!wanted) return null
  const lower = wanted.toLowerCase()
  return listMovements(references).find((card) => (
    card.id === wanted || asString(card.name).toLowerCase() === lower
  )) || null
}

/* ── generation wiring ────────────────────────────────────────────────── */

/** Request body for kimodoMotion.generateMotion. */
export function movementRequest(card) {
  const prompt = asString(card?.prompt).trim()
  if (!prompt) throw new Error(`movement '${card?.id}' has no prompt`)
  const params = normalizeMovementParams(card?.params)
  return { prompt, ...params }
}

/**
 * The action line a movement contributes to prompt assembly. Named so the
 * character it is bound to reads naturally in the shot description.
 */
export function movementLine(references, card) {
  const move = card && typeof card === 'object' ? card : null
  if (!move) return ''
  const action = asString(move.prompt).trim()
  if (!action) return ''
  const refs = normalizeReferences(references)
  const character = refs.characters.find((item) => item.id === move.characterId)
  const who = asString(character?.name).trim()
  return who ? `${who} ${action}` : action
}

/**
 * Build a kimodo `/scene` payload from several movement cards so a
 * multi-character beat (a fight, a chase) is generated in ONE shared arena
 * rather than as unrelated single clips. `placement` supplies the per-card
 * arena position: { [cardId]: { root_offset, facing_deg } }.
 */
export function sceneRequestFromMovements(references, cards, { placement = {}, frames, steps } = {}) {
  const list = (Array.isArray(cards) ? cards : []).filter(Boolean)
  if (!list.length) throw new Error('a scene needs at least one movement card')
  const refs = normalizeReferences(references)
  const characters = list.map((card) => {
    const params = normalizeMovementParams(card.params)
    const spot = placement[card.id] && typeof placement[card.id] === 'object' ? placement[card.id] : {}
    const character = refs.characters.find((item) => item.id === card.characterId)
    const entry = {
      id: card.characterId || card.id,
      prompt: asString(card.prompt).trim(),
      frames: params.frames,
      steps: params.steps,
      seed: params.seed,
    }
    if (character?.id) entry.ref = character.id
    if (Array.isArray(spot.root_offset) && spot.root_offset.length === 3) {
      entry.root_offset = spot.root_offset.map((value) => Number(value) || 0)
    }
    if (spot.facing_deg !== undefined) entry.facing_deg = Number(spot.facing_deg) || 0
    return entry
  })
  const missing = characters.filter((entry) => !entry.prompt)
  if (missing.length) {
    throw new Error(`movement cards missing a prompt: ${missing.map((m) => m.id).join(', ')}`)
  }
  const payload = { characters }
  if (frames !== undefined) payload.frames = clampInt(frames, MOVEMENT_DEFAULTS.frames, 1, 1200)
  if (steps !== undefined) payload.steps = clampInt(steps, MOVEMENT_DEFAULTS.steps, 1, 200)
  return payload
}

/* ── gates ────────────────────────────────────────────────────────────── */

/**
 * Why the movement layer is not ready. Mirrors the shape the other
 * reference gates report so the context stack can merge them.
 */
export function movementGaps(references) {
  const refs = normalizeReferences(references)
  const characterIds = new Set(refs.characters.map((card) => card.id))
  const gaps = []
  for (const card of listMovements(references)) {
    if (!asString(card.prompt).trim()) {
      gaps.push({ kind: 'movement', id: card.id, reason: `'${card.name}' has no action prompt` })
      continue
    }
    if (!card.characterId) {
      gaps.push({ kind: 'movement', id: card.id, reason: `'${card.name}' is not assigned to a character` })
      continue
    }
    if (!characterIds.has(card.characterId)) {
      gaps.push({
        kind: 'movement',
        id: card.id,
        reason: `'${card.name}' points at missing character '${card.characterId}'`,
      })
      continue
    }
    if (!movementAccepted(card)) {
      gaps.push({ kind: 'movement', id: card.id, reason: `'${card.name}' has no accepted motion yet` })
    }
  }
  return gaps
}
