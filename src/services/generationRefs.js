/**
 * Generation wiring for reference cards (docs/ux-guided-mobile-plan.md P5).
 *
 * Bridges the approved reference cards (project.references) into:
 *  - prompt assembly: body description lines for characters whose cards have
 *    both anchors accepted;
 *  - reference-image selection: accepted anchor assets become the primary
 *    referenceImage1/2 for storyboard stills and keyframes;
 *  - blocking v7: `characters[].ref_set.front` is sourced from the accepted
 *    close_up_face asset (project-relative path — the shape G6 and the
 *    Blender bridge already expect).
 *
 * Pure and node-test-safe. UI and gate layers read everything from here.
 */

import { activeWardrobe, anchorsAccepted, getSlot } from './referenceCards.js'
import { normalizeReferences } from './referencePanels.js'
import { slugify } from './productionStore.js'

/** Find a character card by id, exact name, or slug (cast_id-safe). */
export function findCharacterCard(references, nameOrId) {
  const refs = normalizeReferences(references)
  const wanted = String(nameOrId || '').trim()
  if (!wanted) return null
  const lower = wanted.toLowerCase()
  const slug = slugify(wanted)
  return refs.characters.find((card) => (
    card.id === wanted
    || String(card.name || '').toLowerCase() === lower
    || slugify(card.name) === slug
    || card.id === `character-${slug}`
  )) || null
}

/** Accepted anchor asset ids, or null while the cascade is incomplete. */
export function acceptedAnchorAssetIds(card) {
  if (!anchorsAccepted(card)) return null
  return {
    closeUp: getSlot(card, 'close_up_face')?.assetId || null,
    fullBody: getSlot(card, 'full_body')?.assetId || null,
  }
}

/** "178 cm, 75 kg, athletic" — '' when nothing is set. */
export function bodyDescription(body) {
  if (!body || typeof body !== 'object') return ''
  const parts = []
  const height = Number(body.height_cm)
  const weight = Number(body.weight_kg)
  if (body.height_cm !== null && body.height_cm !== undefined && Number.isFinite(height)) {
    parts.push(`${height} cm`)
  }
  if (body.weight_kg !== null && body.weight_kg !== undefined && Number.isFinite(weight)) {
    parts.push(`${weight} kg`)
  }
  const type = String(body.body_type || '').trim()
  if (type) parts.push(type)
  return parts.join(', ')
}

/**
 * Prompt line for one named character, e.g. "Mara build: 178 cm, athletic".
 * Only emitted once both anchors are accepted (body fields unlock then) and
 * only when the card actually carries body data.
 */
export function characterBuildLine(references, name) {
  const card = findCharacterCard(references, name)
  if (!card || !anchorsAccepted(card)) return ''
  const description = bodyDescription(card.body)
  if (!description) return ''
  return `${card.name} build: ${description}`
}

/** Find a location card by id, exact name, or slug (loc-/location- prefixed). */
export function findLocationCard(references, nameOrId) {
  const refs = normalizeReferences(references)
  const wanted = String(nameOrId || '').trim()
  if (!wanted) return null
  const lower = wanted.toLowerCase()
  const slug = slugify(wanted)
  return refs.locations.find((card) => (
    card.id === wanted
    || String(card.name || '').toLowerCase() === lower
    || slugify(card.name) === slug
    || card.id === `location-${slug}`
    || card.id === `loc-${slug}`
  )) || null
}

/** The accepted voice-sample asset for a character, or null. */
export function characterVoiceAssetId(references, nameOrId) {
  const card = findCharacterCard(references, nameOrId)
  return card?.audio?.assetId || null
}

/**
 * Anchor asset ids generation should dress from: with a wardrobe variant
 * active, its filled slots win per-slot over the base anchors; unfilled
 * variant slots fall back to the base. Null while the cascade is incomplete.
 * (applyCharacterCardRefSets deliberately stays on the BASE anchors — the
 * blocking identity lock should not move with wardrobe.)
 */
export function generationAnchorAssetIds(card) {
  const base = acceptedAnchorAssetIds(card)
  if (!base) return null
  const variant = activeWardrobe(card)
  if (!variant) return base
  const face = variant.slots?.close_up_face?.assetId || null
  const body = variant.slots?.full_body?.assetId || null
  if (!face && !body) return base
  return { closeUp: face || base.closeUp, fullBody: body || base.fullBody }
}

/** "Mara wardrobe: suit" — only when a variant is active on the card. */
export function wardrobeLine(references, name) {
  const card = findCharacterCard(references, name)
  const variant = card ? activeWardrobe(card) : null
  if (!variant) return ''
  return `${card.name} wardrobe: ${variant.label || variant.id}`
}

/**
 * Reference-image pair for a shot's characterRefs: the first character with
 * an accepted card contributes its close-up as referenceImage1 and full body
 * as referenceImage2 (wardrobe-aware via generationAnchorAssetIds). Returns
 * null when no characterRef has an accepted card, so callers fall back to the
 * legacy asset pool.
 */
export function cardBackedRefIds(references, characterRefs = []) {
  for (const ref of characterRefs || []) {
    const card = findCharacterCard(references, ref?.name || ref?.assetId)
    const anchors = card ? generationAnchorAssetIds(card) : null
    if (anchors?.closeUp) {
      return { first: anchors.closeUp, second: anchors.fullBody || null, cardId: card.id }
    }
  }
  return null
}

/**
 * Names of shot characters whose card exists but lacks accepted anchors —
 * the "no accepted refs, no character generation" warning list (plan §4.5).
 */
export function missingAnchorWarnings(references, characterRefs = []) {
  const warnings = []
  for (const ref of characterRefs || []) {
    const name = ref?.name
    if (!name) continue
    const card = findCharacterCard(references, name)
    if (card && !anchorsAccepted(card)) warnings.push(card.name)
  }
  return warnings
}

/**
 * Source blocking-doc `characters[].ref_set.front` from accepted character
 * cards. `assetPathById(assetId)` must return the project-relative path of
 * the asset (assets live under <project>/assets/…, which G6's approvedRoots
 * already covers). Characters without an accepted card keep their existing
 * ref_set untouched. Returns the same doc reference when nothing changed.
 */
export function applyCharacterCardRefSets(doc, references, assetPathById) {
  if (!doc || !Array.isArray(doc.characters) || doc.characters.length === 0) return doc
  if (typeof assetPathById !== 'function') return doc
  let changed = false
  const characters = doc.characters.map((character) => {
    const card = findCharacterCard(references, character?.cast_id)
    const anchors = card ? acceptedAnchorAssetIds(card) : null
    if (!anchors?.closeUp) return character
    const path = assetPathById(anchors.closeUp)
    if (!path || character.ref_set?.front === path) return character
    changed = true
    return { ...character, ref_set: { ...(character.ref_set || {}), front: path } }
  })
  return changed ? { ...doc, characters } : doc
}

/* ── slot regeneration queue specs (P5: regenerate against the queue) ──── */

const SLOT_SHOT_DESCRIPTIONS = {
  close_up_face: 'close-up face portrait, neutral expression, looking at camera',
  full_body: 'full body shot, standing, neutral pose, head to toe',
  side_view: 'side profile view, full body, neutral pose',
  seated: 'seated on a simple chair, full body, neutral pose',
  wide: 'wide establishing shot of the location',
  medium: 'medium shot of the location',
  detail: 'close detail shot of a telling location feature',
  birds_eye: 'top-down birds-eye plan view of the location',
  hero: 'hero product shot, centered, clean background',
  alt_1: 'alternate angle product shot',
  alt_2: 'second alternate angle product shot',
}

/**
 * Build the queue spec for regenerating one reference-card slot:
 * { tag, prompt, refs: { referenceImage1?, referenceImage2? } }.
 *
 * `tag` (`refslot:<cardId>:<slotId>`) rides the generation job onto the
 * imported asset's storyboardCardId, which is how the panel watcher routes
 * the finished image back into the slot as a review candidate.
 *
 * Identity comes from the card's accepted anchors: close_up_face is always
 * the face reference; full_body joins for body-aware slots. Emotion slots
 * prompt the expression explicitly.
 */
export function slotGenerationSpec(card, slotId) {
  if (!card?.id || !slotId) return null
  const name = card.name || card.id
  const emotion = slotId.startsWith('emotion_') ? slotId.slice('emotion_'.length) : ''
  const shot = emotion
    ? `close-up face portrait, ${emotion} expression`
    : SLOT_SHOT_DESCRIPTIONS[slotId] || slotId.replace(/_/g, ' ')
  const parts = [`${name}, ${shot}, character reference photo, consistent identity, plain background`]
  const body = card.kind === 'character' ? bodyDescription(card.body) : ''
  if (body) parts.push(`Build: ${body}`)

  const refs = {}
  const closeUp = getSlot(card, 'close_up_face')?.assetId
  const fullBody = getSlot(card, 'full_body')?.assetId
  if (card.kind === 'character') {
    if (closeUp && slotId !== 'close_up_face') {
      refs.referenceImage1 = closeUp
      parts.push('Keep the face and identity from the reference image.')
    }
    if (fullBody && !['close_up_face', 'full_body'].includes(slotId) && !emotion) {
      refs.referenceImage2 = fullBody
    }
  }
  return {
    tag: `refslot:${card.id}:${slotId}`,
    prompt: parts.join('. '),
    refs,
  }
}
