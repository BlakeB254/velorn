/**
 * Reference panels view-model (docs/ux-guided-mobile-plan.md P2/P3).
 *
 * referenceCards.js owns the per-card cascade rules; this module owns the
 * list-level operations and the row model the panels render, so the UI
 * stays a thin mapping over pure functions.
 *
 * All functions are pure and node-test-safe. Persistence is the caller's
 * job (projectStore.saveProject({ references })).
 */

import {
  CHARACTER_ANCHORS,
  CHARACTER_AUTO_SLOTS,
  LOCATION_SLOTS,
  PROP_SLOTS,
  getSlot,
  newCharacterCard,
  newLocationCard,
  newPropCard,
  unlocks,
} from './referenceCards.js'

export function emptyReferences() {
  return { characters: [], locations: [], props: [] }
}

/** Tolerate missing/partial references blocks from older project files. */
export function normalizeReferences(raw) {
  const blank = emptyReferences()
  if (!raw || typeof raw !== 'object') return blank
  const list = (value) => (Array.isArray(value) ? value.filter((item) => item && item.id) : [])
  return {
    characters: list(raw.characters),
    locations: list(raw.locations),
    props: list(raw.props),
  }
}

const KIND_KEY = { character: 'characters', location: 'locations', prop: 'props' }

export function listKeyForKind(kind) {
  const key = KIND_KEY[kind]
  if (!key) throw new Error(`unknown card kind '${kind}'`)
  return key
}

/** Insert or replace a card (matched by kind + id). */
export function upsertCard(references, card) {
  const refs = normalizeReferences(references)
  const key = listKeyForKind(card.kind)
  const index = refs[key].findIndex((item) => item.id === card.id)
  const list = [...refs[key]]
  if (index >= 0) list[index] = card
  else list.push(card)
  return { ...refs, [key]: list }
}

export function removeCard(references, kind, cardId) {
  const refs = normalizeReferences(references)
  const key = listKeyForKind(kind)
  return { ...refs, [key]: refs[key].filter((item) => item.id !== cardId) }
}

/** Apply a pure card mutation (referenceCards.js) to one card in the list. */
export function mapCard(references, kind, cardId, fn) {
  const refs = normalizeReferences(references)
  const key = listKeyForKind(kind)
  return {
    ...refs,
    [key]: refs[key].map((item) => (item.id === cardId ? fn(item) : item)),
  }
}

/** Create + insert a named card. Id is slugified from the name, deduped. */
export function addCardByName(references, kind, name) {
  const refs = normalizeReferences(references)
  const key = listKeyForKind(kind)
  const clean = String(name || '').trim()
  if (!clean) return { references: refs, card: null }
  const base = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'card'
  let id = `${kind}-${base}`
  let counter = 2
  while (refs[key].some((item) => item.id === id)) {
    id = `${kind}-${base}-${counter}`
    counter += 1
  }
  const card = kind === 'character'
    ? newCharacterCard({ id, name: clean })
    : kind === 'location'
      ? newLocationCard({ id, name: clean })
      : newPropCard({ id, name: clean })
  return { references: { ...refs, [key]: [...refs[key], card] }, card }
}

/* ── slot row model ───────────────────────────────────────────────────── */

const SLOT_ORDER = {
  character: [...CHARACTER_ANCHORS, ...CHARACTER_AUTO_SLOTS],
  location: [...LOCATION_SLOTS],
  prop: [...PROP_SLOTS],
}

const SLOT_LABELS = {
  close_up_face: 'Close-up face',
  full_body: 'Full body',
  side_view: 'Side view',
  seated: 'Seated',
  emotion_happy: 'Happy',
  emotion_sad: 'Sad',
  emotion_angry: 'Angry',
  emotion_surprised: 'Surprised',
  emotion_fearful: 'Fearful',
  emotion_disgusted: 'Disgusted',
  wide: 'Wide',
  medium: 'Medium',
  detail: 'Detail',
  birds_eye: 'Birds-eye',
  hero: 'Hero',
  alt_1: 'Alt 1',
  alt_2: 'Alt 2',
}

/**
 * Ordered slot rows for the panel grid. `locked` means the cascade says
 * this slot can't be worked yet (character: full_body needs the face
 * accepted; auto set needs both anchors). Location/prop slots never lock.
 */
export function slotRows(card) {
  if (!card?.kind) return []
  const order = SLOT_ORDER[card.kind] || Object.keys(card.slots || {})
  const gates = card.kind === 'character' ? unlocks(card) : null
  return order.map((id) => {
    const slot = getSlot(card, id) || { status: 'empty', assetId: null }
    const isAnchor = card.kind === 'character' && CHARACTER_ANCHORS.includes(id)
    const locked = card.kind === 'character'
      ? (id === 'full_body' ? !gates.full_body : !isAnchor && !gates.autoSet)
      : false
    return {
      id,
      label: SLOT_LABELS[id] || id,
      status: slot.status || 'empty',
      assetId: slot.assetId || null,
      candidateId: slot.candidateId || null,
      anchor: isAnchor,
      locked,
    }
  })
}

/** Progress summary for the card header. */
export function cardProgress(card) {
  const rows = slotRows(card)
  const accepted = rows.filter((row) => row.status === 'accepted').length
  const busy = rows.filter((row) => row.status === 'generating' || row.status === 'review').length
  return { total: rows.length, accepted, busy }
}

/** Body fields are editable only once both anchors are accepted. */
export function bodyFieldsEditable(card) {
  return card?.kind === 'character' && Boolean(unlocks(card).bodyFields)
}
