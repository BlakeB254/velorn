import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  acceptSlot,
  newCharacterCard,
  newLocationCard,
  newMovementCard,
} from '../src/services/referenceCards.js'
import {
  acceptMovement,
  assignMovementToCharacter,
  motionMetaFromResponse,
  reviewMovement,
} from '../src/services/movementRefs.js'
import { resolveContextStack } from '../src/services/contextStack.js'

/**
 * The generation path (components/storyboard/boardShared.jsx) now takes its
 * reference context from resolveContextStack instead of re-deriving each
 * layer. These lock in the contract that composeGenerationPrompt depends on:
 * a storyboard card resolves without adaptation, and the layers that used to
 * be dropped now reach the prompt.
 */

function readyCharacter({ id = 'character-mara', name = 'Mara' } = {}) {
  let card = newCharacterCard({ id, name })
  card = acceptSlot(card, 'close_up_face', 'asset-face-1')
  card = acceptSlot(card, 'full_body', 'asset-body-1')
  return card
}

function boundMovement(characterId, prompt = 'throws a right hook then backpedals') {
  let card = assignMovementToCharacter(
    newMovementCard({ id: 'movement-hook', name: 'Right hook', prompt }),
    characterId,
  )
  card = reviewMovement(card, motionMetaFromResponse({ frames: 90, joints: 22, out_dir: '/tmp/k' }, {}), {})
  return acceptMovement(card, {})
}

/** The shape a storyboard card actually has. */
function boardCard(overrides = {}) {
  return {
    id: 'card-1',
    title: 'Shot 1',
    description: 'Mara steps out of the alley.',
    characterRefs: [{ assetId: 'a1', name: 'Mara' }],
    locationRef: { assetId: 'a2', name: 'Alley' },
    propRefs: [],
    ...overrides,
  }
}

test('a storyboard card resolves with no adaptation — locationRef is understood', () => {
  let location = newLocationCard({ id: 'location-alley', name: 'Alley' })
  location = acceptSlot(location, 'wide', 'asset-alley-wide')
  const stack = resolveContextStack({
    references: { characters: [readyCharacter()], locations: [location], props: [], movements: [] },
    shot: boardCard(),
  })
  const resolved = stack.layers.find((l) => l.kind === 'location' && l.id === 'location-alley')
  assert.ok(resolved, 'locationRef on a board card resolves the location layer')
  assert.equal(resolved.status, 'ready')
})

test('franchise invariants now reach the prompt — they never did before', () => {
  const stack = resolveContextStack({
    references: { characters: [readyCharacter()], locations: [], props: [], movements: [] },
    production: { franchiseSlug: 'chi-town-triplets' },
    shot: boardCard(),
  })
  assert.ok(
    stack.promptLines.some((line) => /Trio identities locked/i.test(line)),
    'the franchise invariant is in the prompt lines the composer pushes',
  )
})

test('the movement bound to a character reaches the prompt', () => {
  const character = readyCharacter()
  const stack = resolveContextStack({
    references: {
      characters: [character],
      locations: [],
      props: [],
      movements: [boundMovement(character.id)],
    },
    shot: boardCard(),
  })
  assert.ok(
    stack.promptLines.includes('Mara throws a right hook then backpedals'),
    'the action line is contributed even though the card names no movement',
  )
})

test('the build line the old inline loop produced is still produced', () => {
  let character = readyCharacter()
  character = { ...character, body: { height_cm: 178, weight_kg: null, body_type: 'athletic' } }
  const stack = resolveContextStack({
    references: { characters: [character], locations: [], props: [], movements: [] },
    shot: boardCard(),
  })
  assert.ok(
    stack.promptLines.some((line) => /Mara build: 178 cm, athletic/.test(line)),
    'replacing the inline loop did not lose the body description',
  )
})

test('a card with no reference cards contributes no prompt lines', () => {
  const stack = resolveContextStack({
    references: { characters: [], locations: [], props: [], movements: [] },
    shot: { id: 'card-2', characterRefs: [], propRefs: [] },
  })
  assert.deepEqual(stack.promptLines, [], 'nothing is invented for an empty card')
})

test('provenance for a generated shot names the layers that fed it', () => {
  const character = readyCharacter()
  const stack = resolveContextStack({
    references: {
      characters: [character],
      locations: [],
      props: [],
      movements: [boundMovement(character.id)],
    },
    production: { franchiseSlug: 'chi-town-triplets', type: 'show' },
    shot: boardCard(),
  })
  const kinds = stack.active.map((l) => l.kind)
  assert.ok(kinds.includes('franchise'))
  assert.ok(kinds.includes('productionType'))
  assert.ok(kinds.includes('character'))
  assert.ok(kinds.includes('movement'))
  assert.match(stack.signature, /^ctx_[0-9a-f]{8}$/)
})
