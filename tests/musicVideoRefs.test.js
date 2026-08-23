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
  musicArtistBuildLines,
  musicCastReferenceCandidates,
  musicLocationReferenceAssetId,
  musicMemberAnchorSlots,
  musicShotVocalAssetId,
} from '../src/services/musicVideoRefs.js'

function acceptedCard({ id = 'character-mara', name = 'Mara' } = {}) {
  let card = newCharacterCard({ id, name })
  card = acceptSlot(card, 'close_up_face', 'asset-face-1')
  card = acceptSlot(card, 'full_body', 'asset-body-1')
  return card
}

const refsWith = (characters = [], locations = []) => ({ characters, locations, props: [] })

const maraMember = { id: 'cast-1', slug: 'mara', label: 'Mara', assetId: 'asset-cast-mara' }

test('musicMemberAnchorSlots returns wardrobe-aware anchors for a carded member', () => {
  const refs = refsWith([acceptedCard()])
  assert.deepEqual(musicMemberAnchorSlots(refs, maraMember), {
    closeUp: 'asset-face-1', fullBody: 'asset-body-1',
  })
  // Slugs and ids resolve too.
  assert.deepEqual(musicMemberAnchorSlots(refs, { label: '', slug: 'mara', id: 'cast-9' }), {
    closeUp: 'asset-face-1', fullBody: 'asset-body-1',
  })
  // No card, incomplete card, or no member → null.
  assert.equal(musicMemberAnchorSlots(refs, { label: 'Nobody', assetId: 'x' }), null)
  assert.equal(musicMemberAnchorSlots(refsWith([newCharacterCard({ id: 'character-mara', name: 'Mara' })]), maraMember), null)
  assert.equal(musicMemberAnchorSlots(refs, null), null)
})

test('musicMemberAnchorSlots dresses from the active wardrobe variant', () => {
  let card = acceptedCard()
  card = addWardrobeVariant(card, { id: 'suit', label: 'Suit' })
  card = setActiveWardrobe(card, 'suit')
  card = acceptWardrobeSlot(card, 'suit', 'close_up_face', 'asset-suit-face')
  const refs = refsWith([card])
  assert.deepEqual(musicMemberAnchorSlots(refs, maraMember), {
    closeUp: 'asset-suit-face', fullBody: 'asset-body-1',
  })
})

test('musicCastReferenceCandidates prefers card anchors, keeps legacy fallbacks', () => {
  const dex = attachAudio(acceptedCard({ id: 'character-dex', name: 'Dex' }), 'asset-voice-dex')
  const refs = refsWith([acceptedCard(), dex])
  const cast = [
    maraMember,
    { id: 'cast-2', slug: 'dex', label: 'Dex', assetId: 'asset-cast-dex' },
    { id: 'cast-3', slug: 'uncarded', label: 'Uncarded', assetId: 'asset-cast-uncarded' },
  ]
  assert.deepEqual(musicCastReferenceCandidates(refs, cast, 'asset-legacy-artist'), [
    'asset-face-1', 'asset-body-1', // Mara card anchors
    'asset-face-1', 'asset-body-1', // Dex card anchors (same fixture ids)
    'asset-cast-uncarded', // no card → raw cast image
    'asset-legacy-artist',
  ])
  assert.deepEqual(musicCastReferenceCandidates(null, cast), ['asset-cast-mara', 'asset-cast-dex', 'asset-cast-uncarded'])
  assert.deepEqual(musicCastReferenceCandidates(refs, [], null), [])
})

test('musicArtistBuildLines emits lines only for carded labels with body data', () => {
  const card = setBody(acceptedCard(), { height_cm: 180, body_type: 'slim' })
  const refs = refsWith([card, acceptedCard({ id: 'character-dex', name: 'Dex' })])
  assert.deepEqual(musicArtistBuildLines(refs, ['Mara', 'Dex', 'Nobody']), ['Mara build: 180 cm, slim'])
  assert.deepEqual(musicArtistBuildLines(refs, []), [])
  assert.deepEqual(musicArtistBuildLines(null, ['Mara']), [])
})

test('musicShotVocalAssetId returns the first label with a card vocal sample', () => {
  const refs = refsWith([attachAudio(acceptedCard(), 'asset-voice-mara')])
  assert.equal(musicShotVocalAssetId(refs, ['Mara']), 'asset-voice-mara')
  assert.equal(musicShotVocalAssetId(refs, ['Nobody', 'Mara']), 'asset-voice-mara')
  assert.equal(musicShotVocalAssetId(refs, ['Nobody']), null)
  assert.equal(musicShotVocalAssetId(refsWith([acceptedCard()]), ['Mara']), null)
  assert.equal(musicShotVocalAssetId(null, ['Mara']), null)
})

test('musicLocationReferenceAssetId prefers accepted wide, falls back to medium', () => {
  let loc = newLocationCard({ id: 'loc-the-docks', name: 'The Docks' })
  const refsEmpty = refsWith([], [loc])
  assert.equal(musicLocationReferenceAssetId(refsEmpty, 'The Docks'), null)
  loc = acceptSlot(loc, 'medium', 'asset-docks-medium')
  const refsMedium = refsWith([], [loc])
  assert.equal(musicLocationReferenceAssetId(refsMedium, 'The Docks'), 'asset-docks-medium')
  loc = acceptSlot(loc, 'wide', 'asset-docks-wide')
  const refsWide = refsWith([], [loc])
  assert.equal(musicLocationReferenceAssetId(refsWide, 'The Docks'), 'asset-docks-wide')
  // Coverage label is the second match channel; unknown labels miss.
  assert.equal(musicLocationReferenceAssetId(refsWide, '', 'the-docks'), 'asset-docks-wide')
  assert.equal(musicLocationReferenceAssetId(refsWide, 'Nowhere', 'Elsewhere'), null)
  assert.equal(musicLocationReferenceAssetId(null, 'The Docks'), null)
})
