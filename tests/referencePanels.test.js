import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  acceptSlot,
  newCharacterCard,
  newLocationCard,
  newPropCard,
  reviewSlot,
} from '../src/services/referenceCards.js'
import {
  addCardByName,
  bodyFieldsEditable,
  cardProgress,
  emptyReferences,
  mapCard,
  normalizeReferences,
  removeCard,
  slotRows,
  upsertCard,
} from '../src/services/referencePanels.js'

test('normalizeReferences tolerates junk and keeps valid cards', () => {
  assert.deepEqual(normalizeReferences(null), emptyReferences())
  assert.deepEqual(normalizeReferences({ characters: 'nope' }), emptyReferences())
  const card = newCharacterCard({ id: 'c1', name: 'Mara' })
  const refs = normalizeReferences({ characters: [card, { name: 'no id' }, null] })
  assert.equal(refs.characters.length, 1)
})

test('addCardByName slugifies and dedupes ids per kind', () => {
  let refs = emptyReferences()
  const first = addCardByName(refs, 'character', 'The Captain')
  refs = first.references
  assert.equal(first.card.id, 'character-the-captain')
  const second = addCardByName(refs, 'character', 'The Captain')
  assert.equal(second.card.id, 'character-the-captain-2')
  assert.equal(second.references.characters.length, 2)
  assert.equal(addCardByName(refs, 'character', '  ').card, null)
})

test('upsertCard inserts then replaces by id; removeCard drops it', () => {
  const card = newLocationCard({ id: 'loc-1', name: 'Docks' })
  let refs = upsertCard(emptyReferences(), card)
  assert.equal(refs.locations.length, 1)
  refs = upsertCard(refs, { ...card, name: 'The Docks' })
  assert.equal(refs.locations.length, 1)
  assert.equal(refs.locations[0].name, 'The Docks')
  refs = removeCard(refs, 'location', 'loc-1')
  assert.equal(refs.locations.length, 0)
})

test('mapCard applies a pure mutation to one card only', () => {
  let refs = emptyReferences()
  refs = addCardByName(refs, 'character', 'Mara').references
  refs = addCardByName(refs, 'character', 'Dex').references
  refs = mapCard(refs, 'character', 'character-mara', (card) => acceptSlot(card, 'close_up_face', 'asset-1'))
  assert.equal(refs.characters[0].slots.close_up_face.status, 'accepted')
  assert.equal(refs.characters[1].slots.close_up_face.status, 'empty')
})

test('slotRows: full_body locked until face accepted, auto set until both anchors', () => {
  let card = newCharacterCard({ id: 'c1', name: 'Mara' })
  let rows = slotRows(card)
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]))
  assert.equal(byId.close_up_face.locked, false)
  assert.equal(byId.full_body.locked, true)
  assert.equal(byId.emotion_happy.locked, true)
  assert.equal(byId.close_up_face.anchor, true)
  assert.equal(byId.emotion_happy.anchor, false)

  card = acceptSlot(card, 'close_up_face', 'a1')
  rows = slotRows(card)
  assert.equal(rows.find((row) => row.id === 'full_body').locked, false)
  assert.equal(rows.find((row) => row.id === 'side_view').locked, true)
  assert.equal(bodyFieldsEditable(card), false)

  card = acceptSlot(card, 'full_body', 'a2')
  rows = slotRows(card)
  assert.ok(rows.every((row) => !row.locked))
  assert.equal(bodyFieldsEditable(card), true)
})

test('slotRows: locations never lock, keep slot order and status', () => {
  let card = newLocationCard({ id: 'l1', name: 'Docks' })
  card = acceptSlot(card, 'wide', 'asset-w')
  const rows = slotRows(card)
  assert.deepEqual(rows.map((row) => row.id), ['wide', 'medium', 'detail', 'birds_eye'])
  assert.ok(rows.every((row) => !row.locked))
  assert.equal(rows[0].status, 'accepted')
  assert.equal(rows[0].assetId, 'asset-w')
})

test('slotRows surfaces a parked review candidate', () => {
  let card = newLocationCard({ id: 'l1', name: 'Docks' })
  card = acceptSlot(card, 'wide', 'asset-w')
  card = reviewSlot(card, 'wide', 'asset-cand')
  const row = slotRows(card).find((entry) => entry.id === 'wide')
  assert.equal(row.status, 'review')
  assert.equal(row.assetId, 'asset-w')
  assert.equal(row.candidateId, 'asset-cand')
})

test('slotRows: props render hero/alt slots unlocked with labels', () => {
  const card = newPropCard({ id: 'p1', name: 'Briefcase' })
  const rows = slotRows(card)
  assert.deepEqual(rows.map((row) => row.id), ['hero', 'alt_1', 'alt_2'])
  assert.deepEqual(rows.map((row) => row.label), ['Hero', 'Alt 1', 'Alt 2'])
  assert.ok(rows.every((row) => !row.locked && row.status === 'empty'))
})

test('cardProgress counts accepted and busy slots', () => {
  let card = newCharacterCard({ id: 'c1', name: 'Mara' })
  assert.deepEqual(cardProgress(card), { total: 10, accepted: 0, busy: 0 })
  card = acceptSlot(card, 'close_up_face', 'a1')
  card = { ...card, slots: { ...card.slots, side_view: { status: 'review', assetId: 'x', history: [] } } }
  assert.deepEqual(cardProgress(card), { total: 10, accepted: 1, busy: 1 })
})
