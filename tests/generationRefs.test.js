import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  acceptSlot,
  acceptWardrobeSlot,
  addWardrobeVariant,
  attachAudio,
  newCharacterCard,
  newLocationCard,
  setActiveWardrobe,
  setBody,
} from '../src/services/referenceCards.js'
import {
  acceptedAnchorAssetIds,
  applyCharacterCardRefSets,
  bodyDescription,
  cardBackedRefIds,
  characterBuildLine,
  characterVoiceAssetId,
  findCharacterCard,
  findLocationCard,
  generationAnchorAssetIds,
  missingAnchorWarnings,
  wardrobeLine,
} from '../src/services/generationRefs.js'

function acceptedCard({ id = 'character-mara', name = 'Mara' } = {}) {
  let card = newCharacterCard({ id, name })
  card = acceptSlot(card, 'close_up_face', 'asset-face-1')
  card = acceptSlot(card, 'full_body', 'asset-body-1')
  return card
}

const refsWith = (...characters) => ({ characters, locations: [], props: [] })

test('findCharacterCard matches by id, name, and cast_id slug', () => {
  const refs = refsWith(acceptedCard())
  assert.equal(findCharacterCard(refs, 'character-mara')?.name, 'Mara')
  assert.equal(findCharacterCard(refs, 'Mara')?.id, 'character-mara')
  assert.equal(findCharacterCard(refs, 'mara')?.id, 'character-mara')
  const studRefs = refsWith(acceptedCard({ id: 'character-the-stud', name: 'The Stud' }))
  assert.equal(findCharacterCard(studRefs, 'the-stud')?.name, 'The Stud')
  assert.equal(findCharacterCard(refs, 'Nobody'), null)
})

test('acceptedAnchorAssetIds requires both anchors', () => {
  const pending = newCharacterCard({ id: 'c1', name: 'Mara' })
  assert.equal(acceptedAnchorAssetIds(pending), null)
  const faceOnly = acceptSlot(pending, 'close_up_face', 'a1')
  assert.equal(acceptedAnchorAssetIds(faceOnly), null)
  assert.deepEqual(acceptedAnchorAssetIds(acceptedCard()), {
    closeUp: 'asset-face-1', fullBody: 'asset-body-1',
  })
})

test('bodyDescription formats set fields only', () => {
  assert.equal(bodyDescription(null), '')
  assert.equal(bodyDescription({ height_cm: null, weight_kg: null, body_type: '' }), '')
  assert.equal(bodyDescription({ height_cm: 178, weight_kg: null, body_type: 'athletic' }), '178 cm, athletic')
  assert.equal(bodyDescription({ height_cm: 178, weight_kg: 75, body_type: 'athletic' }), '178 cm, 75 kg, athletic')
})

test('characterBuildLine gates on accepted anchors and body content', () => {
  let card = acceptedCard()
  const refs = refsWith(card)
  assert.equal(characterBuildLine(refs, 'Mara'), '') // anchors accepted but no body data
  card = setBody(card, { height_cm: 180, body_type: 'slim' })
  const refsBody = refsWith(card)
  assert.equal(characterBuildLine(refsBody, 'Mara'), 'Mara build: 180 cm, slim')
  const pendingRefs = refsWith(newCharacterCard({ id: 'character-mara', name: 'Mara' }))
  assert.equal(characterBuildLine(pendingRefs, 'Mara'), '')
})

test('cardBackedRefIds prefers the accepted card anchors over the pool', () => {
  const refs = refsWith(acceptedCard())
  assert.deepEqual(cardBackedRefIds(refs, [{ name: 'Mara', assetId: 'loose-asset' }]), {
    first: 'asset-face-1', second: 'asset-body-1', cardId: 'character-mara',
  })
  assert.equal(cardBackedRefIds(refs, [{ name: 'Nobody', assetId: 'x' }]), null)
  assert.equal(cardBackedRefIds(refs, []), null)
  const pendingRefs = refsWith(newCharacterCard({ id: 'character-mara', name: 'Mara' }))
  assert.equal(cardBackedRefIds(pendingRefs, [{ name: 'Mara' }]), null)
})

test('missingAnchorWarnings flags named characters with incomplete cards', () => {
  const refs = refsWith(
    acceptedCard(),
    newCharacterCard({ id: 'character-dex', name: 'Dex' }),
  )
  assert.deepEqual(missingAnchorWarnings(refs, [
    { name: 'Mara' }, { name: 'Dex' }, { name: 'Uncarded' },
  ]), ['Dex'])
})

test('applyCharacterCardRefSets fills ref_set.front from accepted cards', () => {
  const refs = refsWith(acceptedCard({ id: 'character-the-stud', name: 'The Stud' }))
  const pathById = (assetId) => ({ 'asset-face-1': 'assets/images/stud-face.png' })[assetId] || null
  const doc = {
    characters: [
      { cast_id: 'the-stud', position: {} },
      { cast_id: 'extra', position: {}, ref_set: { front: 'assets/images/manual.png' } },
    ],
  }
  const next = applyCharacterCardRefSets(doc, refs, pathById)
  assert.notEqual(next, doc)
  assert.equal(next.characters[0].ref_set.front, 'assets/images/stud-face.png')
  // No card for 'extra' → untouched
  assert.equal(next.characters[1].ref_set.front, 'assets/images/manual.png')
  // Idempotent when already correct
  assert.equal(applyCharacterCardRefSets(next, refs, pathById), next)
})

test('applyCharacterCardRefSets leaves docs without accepted cards or paths alone', () => {
  const pendingRefs = refsWith(newCharacterCard({ id: 'character-the-stud', name: 'The Stud' }))
  const doc = { characters: [{ cast_id: 'the-stud' }] }
  assert.equal(applyCharacterCardRefSets(doc, pendingRefs, () => 'assets/images/x.png'), doc)
  const refs = refsWith(acceptedCard({ id: 'character-the-stud', name: 'The Stud' }))
  assert.equal(applyCharacterCardRefSets(doc, refs, () => null), doc)
  assert.equal(applyCharacterCardRefSets(doc, refs, null), doc)
  assert.equal(applyCharacterCardRefSets(null, refs, () => 'x'), null)
})

/* ── wardrobe + audio consumption (P6) ────────────────────────────────── */

function wardrobeCard() {
  let card = acceptedCard()
  card = addWardrobeVariant(card, { id: 'suit', label: 'Suit' })
  return card
}

test('findLocationCard matches by id, name, slug, and loc-/location- prefixes', () => {
  const loc = newLocationCard({ id: 'loc-the-docks', name: 'The Docks' })
  const refs = { characters: [], locations: [loc], props: [] }
  assert.equal(findLocationCard(refs, 'loc-the-docks')?.name, 'The Docks')
  assert.equal(findLocationCard(refs, 'The Docks')?.id, 'loc-the-docks')
  assert.equal(findLocationCard(refs, 'the-docks')?.id, 'loc-the-docks')
  // Cards created via addCardByName carry the location- prefix — still found by name/slug.
  const loc2 = newLocationCard({ id: 'location-pier-9', name: 'Pier 9' })
  const refs2 = { characters: [], locations: [loc2], props: [] }
  assert.equal(findLocationCard(refs2, 'pier-9')?.id, 'location-pier-9')
  assert.equal(findLocationCard(refs, 'Nowhere'), null)
  assert.equal(findLocationCard(null, 'The Docks'), null)
})

test('characterVoiceAssetId returns the accepted audio ref or null', () => {
  let card = acceptedCard()
  const refs = refsWith(card)
  assert.equal(characterVoiceAssetId(refs, 'Mara'), null)
  card = attachAudio(card, 'asset-voice-1')
  assert.equal(characterVoiceAssetId(refsWith(card), 'Mara'), 'asset-voice-1')
  assert.equal(characterVoiceAssetId(refsWith(card), 'Nobody'), null)
})

test('generationAnchorAssetIds prefers filled wardrobe slots per-slot', () => {
  let card = wardrobeCard()
  // No active variant → base anchors
  assert.deepEqual(generationAnchorAssetIds(card), {
    closeUp: 'asset-face-1', fullBody: 'asset-body-1',
  })
  // Active but unfilled variant → still base anchors
  card = setActiveWardrobe(card, 'suit')
  assert.deepEqual(generationAnchorAssetIds(card), {
    closeUp: 'asset-face-1', fullBody: 'asset-body-1',
  })
  // Only the variant face filled → face wins, body falls back
  card = acceptWardrobeSlot(card, 'suit', 'close_up_face', 'asset-suit-face')
  assert.deepEqual(generationAnchorAssetIds(card), {
    closeUp: 'asset-suit-face', fullBody: 'asset-body-1',
  })
  // Both filled → both win
  card = acceptWardrobeSlot(card, 'suit', 'full_body', 'asset-suit-body')
  assert.deepEqual(generationAnchorAssetIds(card), {
    closeUp: 'asset-suit-face', fullBody: 'asset-suit-body',
  })
})

test('wardrobeLine names the active variant only', () => {
  const refs = refsWith(wardrobeCard())
  assert.equal(wardrobeLine(refs, 'Mara'), '')
  const active = refsWith(setActiveWardrobe(wardrobeCard(), 'suit'))
  assert.equal(wardrobeLine(active, 'Mara'), 'Mara wardrobe: Suit')
  assert.equal(wardrobeLine(active, 'Nobody'), '')
})

test('cardBackedRefIds dresses from the active wardrobe variant', () => {
  let card = wardrobeCard()
  card = setActiveWardrobe(card, 'suit')
  card = acceptWardrobeSlot(card, 'suit', 'close_up_face', 'asset-suit-face')
  const refs = refsWith(card)
  assert.deepEqual(cardBackedRefIds(refs, [{ name: 'Mara' }]), {
    first: 'asset-suit-face', second: 'asset-body-1', cardId: 'character-mara',
  })
})
