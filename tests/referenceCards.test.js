import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CHARACTER_ANCHORS,
  CHARACTER_AUTO_SLOTS,
  CHARACTER_SLOTS,
  EMOTIONS,
  LOCATION_SLOTS,
  PROP_SLOTS,
  acceptSlot,
  acceptWardrobeSlot,
  activeWardrobe,
  addLandmark,
  addWardrobeVariant,
  anchorsAccepted,
  attachAudio,
  canGenerateSet,
  failSlot,
  getSlot,
  markGenerated,
  missingAnchors,
  newCharacterCard,
  newLocationCard,
  newPropCard,
  removeLandmark,
  replaceSlot,
  requestRegenerate,
  reviewSlot,
  setActiveWardrobe,
  setBody,
  unlocks,
} from '../src/services/referenceCards.js'

const card = () => newCharacterCard({ id: 'stud', name: 'The Stud' })

/* ── constructors ─────────────────────────────────────────────────────── */

test('character card has all slots empty with body/wardrobe/audio defaults', () => {
  const c = card()
  assert.deepEqual(Object.keys(c.slots).sort(), [...CHARACTER_SLOTS].sort())
  for (const id of CHARACTER_SLOTS) assert.equal(c.slots[id].status, 'empty')
  assert.equal(EMOTIONS.length, 6)
  assert.equal(CHARACTER_AUTO_SLOTS.includes('emotion_happy'), true)
  assert.deepEqual(c.body, { height_cm: null, weight_kg: null, body_type: '' })
  assert.deepEqual(c.wardrobe, [])
  assert.equal(c.audio, null)
})

test('location and prop cards have their slot sets', () => {
  const loc = newLocationCard({ id: 'bar' })
  assert.deepEqual(Object.keys(loc.slots).sort(), [...LOCATION_SLOTS].sort())
  const prop = newPropCard({ id: 'bottle' })
  assert.deepEqual(Object.keys(prop.slots).sort(), [...PROP_SLOTS].sort())
})

/* ── cascade unlocks ──────────────────────────────────────────────────── */

test('cascade: face unlocks body, body unlocks auto set + body fields', () => {
  let c = card()
  assert.deepEqual(unlocks(c), { full_body: false, autoSet: false, bodyFields: false })
  assert.deepEqual(missingAnchors(c), [...CHARACTER_ANCHORS])
  assert.equal(canGenerateSet(c), false)

  c = acceptSlot(c, 'close_up_face', 'asset-face')
  assert.deepEqual(unlocks(c), { full_body: true, autoSet: false, bodyFields: false })
  assert.deepEqual(missingAnchors(c), ['full_body'])
  assert.equal(anchorsAccepted(c), false)

  c = acceptSlot(c, 'full_body', 'asset-body')
  assert.deepEqual(unlocks(c), { full_body: true, autoSet: true, bodyFields: true })
  assert.equal(anchorsAccepted(c), true)
  assert.equal(canGenerateSet(c), true)
})

/* ── slot lifecycle ───────────────────────────────────────────────────── */

test('accept appends history; regenerate keeps the accepted asset', () => {
  let c = card()
  c = acceptSlot(c, 'close_up_face', 'a1')
  c = requestRegenerate(c, 'close_up_face')
  assert.equal(getSlot(c, 'close_up_face').status, 'generating')
  assert.equal(getSlot(c, 'close_up_face').assetId, 'a1') // never bare mid-flight
  c = markGenerated(c, 'close_up_face')
  assert.equal(getSlot(c, 'close_up_face').status, 'review')
  c = acceptSlot(c, 'close_up_face', 'a2')
  const slot = getSlot(c, 'close_up_face')
  assert.equal(slot.assetId, 'a2')
  assert.deepEqual(slot.history, ['a1', 'a2'])
})

test('failSlot restores accepted state (or empty when never accepted)', () => {
  let c = card()
  c = requestRegenerate(c, 'side_view')
  c = failSlot(c, 'side_view')
  assert.equal(getSlot(c, 'side_view').status, 'empty')
  c = acceptSlot(c, 'side_view', 'a1')
  c = requestRegenerate(c, 'side_view')
  c = failSlot(c, 'side_view')
  assert.equal(getSlot(c, 'side_view').status, 'accepted')
  assert.equal(getSlot(c, 'side_view').assetId, 'a1')
})

test('reviewSlot parks a candidate without touching the accepted asset', () => {
  let c = card()
  c = acceptSlot(c, 'close_up_face', 'a1')
  c = requestRegenerate(c, 'close_up_face')
  c = reviewSlot(c, 'close_up_face', 'cand-1')
  const parked = getSlot(c, 'close_up_face')
  assert.equal(parked.status, 'review')
  assert.equal(parked.candidateId, 'cand-1')
  assert.equal(parked.assetId, 'a1') // accepted ref stays put until accept

  // Accept promotes the candidate and clears the parking spot.
  c = acceptSlot(c, 'close_up_face', parked.candidateId)
  assert.equal(getSlot(c, 'close_up_face').assetId, 'cand-1')
  assert.equal(getSlot(c, 'close_up_face').candidateId, null)

  // Reject drops the candidate and restores the accepted state.
  c = requestRegenerate(c, 'close_up_face')
  c = reviewSlot(c, 'close_up_face', 'cand-2')
  c = failSlot(c, 'close_up_face')
  const rejected = getSlot(c, 'close_up_face')
  assert.equal(rejected.status, 'accepted')
  assert.equal(rejected.assetId, 'cand-1')
  assert.equal(rejected.candidateId, null)

  // Same input validation as the other mutations.
  assert.throws(() => reviewSlot(card(), 'nope', 'x'), /unknown slot 'nope'/)
  assert.throws(() => reviewSlot(card(), 'close_up_face', ''), /needs an assetId/)
})

test('unknown slot throws a useful error', () => {
  assert.throws(() => acceptSlot(card(), 'nope', 'a'), /unknown slot 'nope'/)
})

/* ── replace + propagate ──────────────────────────────────────────────── */

test('replaceSlot with propagate lists the other filled slots', () => {
  let c = card()
  c = acceptSlot(c, 'close_up_face', 'face1')
  c = acceptSlot(c, 'full_body', 'body1')
  c = acceptSlot(c, 'side_view', 'side1')
  // emotion_happy stays empty -> not a dependent
  const { card: next, regenerate } = replaceSlot(c, 'close_up_face', 'face2', { propagate: true })
  assert.equal(getSlot(next, 'close_up_face').assetId, 'face2')
  assert.deepEqual(regenerate.sort(), ['full_body', 'side_view'])
  const noProp = replaceSlot(c, 'close_up_face', 'face2')
  assert.deepEqual(noProp.regenerate, [])
})

/* ── body / wardrobe / audio ──────────────────────────────────────────── */

test('setBody stores height/weight/body_type', () => {
  const c = setBody(card(), { height_cm: 187, weight_kg: 84, body_type: 'athletic' })
  assert.deepEqual(c.body, { height_cm: 187, weight_kg: 84, body_type: 'athletic' })
  const cleared = setBody(c, { weight_kg: null })
  assert.equal(cleared.body.weight_kg, null)
})

test('wardrobe variants are idempotent and carry anchor slots', () => {
  let c = addWardrobeVariant(card(), { id: 'suit', label: 'Suit' })
  c = addWardrobeVariant(c, { id: 'suit' })
  assert.equal(c.wardrobe.length, 1)
  assert.deepEqual(Object.keys(c.wardrobe[0].slots).sort(), [...CHARACTER_ANCHORS].sort())
})

test('setActiveWardrobe validates and clears; activeWardrobe resolves it', () => {
  let c = addWardrobeVariant(card(), { id: 'suit', label: 'Suit' })
  assert.equal(c.activeWardrobeId, null)
  assert.equal(activeWardrobe(c), null)
  c = setActiveWardrobe(c, 'suit')
  assert.equal(c.activeWardrobeId, 'suit')
  assert.equal(activeWardrobe(c).label, 'Suit')
  c = setActiveWardrobe(c, null)
  assert.equal(c.activeWardrobeId, null)
  assert.throws(() => setActiveWardrobe(card(), 'nope'), /unknown wardrobe variant 'nope'/)
  assert.throws(() => setActiveWardrobe(newLocationCard({ id: 'l' }), 'x'), /character cards/)
})

test('attachAudio stores an accepted audio reference', () => {
  const c = attachAudio(card(), 'voice-a1')
  assert.equal(c.audio.status, 'accepted')
  assert.equal(c.audio.assetId, 'voice-a1')
})

test('acceptWardrobeSlot accepts into one variant slot and validates ids', () => {
  let c = addWardrobeVariant(card(), { id: 'suit', label: 'Suit' })
  c = addWardrobeVariant(c, { id: 'casual', label: 'Casual' })
  c = acceptWardrobeSlot(c, 'suit', 'full_body', 'asset-fb')
  assert.equal(c.wardrobe[0].slots.full_body.status, 'accepted')
  assert.equal(c.wardrobe[0].slots.full_body.assetId, 'asset-fb')
  assert.deepEqual(c.wardrobe[0].slots.full_body.history, ['asset-fb'])
  assert.equal(c.wardrobe[1].slots.full_body.status, 'empty')
  assert.throws(() => acceptWardrobeSlot(c, 'nope', 'full_body', 'x'), /unknown wardrobe variant/)
  assert.throws(() => acceptWardrobeSlot(c, 'suit', 'emotion_happy', 'x'), /unknown slot/)
})

/* ── landmarks ────────────────────────────────────────────────────────── */

test('landmarks validate and append', () => {
  let loc = newLocationCard({ id: 'bar' })
  loc = addLandmark(loc, { name: 'pool table', x_m: 2.5, y_m: 4 })
  assert.deepEqual(loc.landmarks, [{ name: 'pool table', x_m: 2.5, y_m: 4 }])
  assert.throws(() => addLandmark(loc, { name: 'bad', x_m: 'x', y_m: 1 }), /finite/)
})

test('removeLandmark drops by index and leaves other kinds alone', () => {
  let loc = newLocationCard({ id: 'bar' })
  loc = addLandmark(loc, { name: 'a', x_m: 0, y_m: 0 })
  loc = addLandmark(loc, { name: 'b', x_m: 1, y_m: 1 })
  loc = addLandmark(loc, { name: 'c', x_m: 2, y_m: 2 })
  loc = removeLandmark(loc, 1)
  assert.deepEqual(loc.landmarks.map((l) => l.name), ['a', 'c'])
  assert.throws(() => removeLandmark(newPropCard({ id: 'p1' }), 0), /location cards/)
})
