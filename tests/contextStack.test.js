import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  acceptSlot,
  addLandmark,
  addWardrobeVariant,
  newCharacterCard,
  newLocationCard,
  newMovementCard,
  newPropCard,
  setActiveWardrobe,
  setBody,
} from '../src/services/referenceCards.js'
import {
  acceptMovement,
  assignMovementToCharacter,
  motionMetaFromResponse,
  reviewMovement,
} from '../src/services/movementRefs.js'
import {
  CONTEXT_LAYER_ORDER,
  contextProvenance,
  contextSignature,
  describeContextStack,
  resolveContextStack,
} from '../src/services/contextStack.js'

/* ── fixtures ─────────────────────────────────────────────────────────── */

function readyCharacter({ id = 'character-mara', name = 'Mara' } = {}) {
  let card = newCharacterCard({ id, name })
  card = acceptSlot(card, 'close_up_face', 'asset-face-1')
  card = acceptSlot(card, 'full_body', 'asset-body-1')
  card = setBody(card, { height_cm: 178, body_type: 'athletic' })
  return card
}

function readyLocation({ id = 'location-alley', name = 'Alley' } = {}) {
  let card = newLocationCard({ id, name })
  card = acceptSlot(card, 'wide', 'asset-alley-wide')
  card = addLandmark(card, { name: 'dumpster', x_m: 2, y_m: 1 })
  return card
}

function readyProp({ id = 'prop-duffel', name = 'Duffel bag' } = {}) {
  return acceptSlot(newPropCard({ id, name }), 'hero', 'asset-duffel-hero')
}

function readyMovement({ id = 'movement-hook', name = 'Right hook', characterId, prompt = 'throws a right hook' } = {}) {
  let card = assignMovementToCharacter(newMovementCard({ id, name, prompt }), characterId)
  card = reviewMovement(card, motionMetaFromResponse({ frames: 90, joints: 22, out_dir: '/tmp/k/1' }, {}), {})
  return acceptMovement(card, {})
}

const refsOf = ({ characters = [], locations = [], props = [], movements = [] } = {}) => ({
  characters, locations, props, movements,
})

const layerOf = (stack, kind, id) => stack.layers.find((l) => l.kind === kind && (!id || l.id === id))

/* ── layer ordering ───────────────────────────────────────────────────── */

test('layers resolve outermost identity first, innermost action last', () => {
  const character = readyCharacter()
  const stack = resolveContextStack({
    references: refsOf({
      characters: [character],
      locations: [readyLocation()],
      props: [readyProp()],
      movements: [readyMovement({ characterId: character.id })],
    }),
    production: { franchiseSlug: 'chi-town-triplets', type: 'show' },
    shot: {
      characterRefs: [{ name: 'Mara' }],
      location: 'Alley',
      props: ['Duffel bag'],
      movementIds: ['movement-hook'],
    },
  })

  const kinds = stack.layers.map((l) => l.kind)
  const seen = kinds.filter((k) => CONTEXT_LAYER_ORDER.includes(k))
  const positions = seen.map((k) => CONTEXT_LAYER_ORDER.indexOf(k))
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'layers are emitted in stack order')
})

/* ── the layers themselves ────────────────────────────────────────────── */

test('a franchise contributes its invariants as prompt lines', () => {
  const stack = resolveContextStack({
    references: refsOf({}),
    production: { franchiseSlug: 'chi-town-triplets' },
    shot: {},
  })
  const franchise = layerOf(stack, 'franchise')
  assert.equal(franchise.status, 'ready')
  assert.ok(franchise.contributes.promptLines.length > 0, 'invariants reach the prompt')
  assert.ok(stack.promptLines.some((line) => /Trio identities locked/i.test(line)))
})

test('an unknown franchise is reported as missing, not silently dropped', () => {
  const stack = resolveContextStack({
    references: refsOf({}),
    production: { franchiseSlug: 'no-such-franchise' },
    shot: {},
  })
  assert.equal(layerOf(stack, 'franchise').status, 'missing')
  assert.equal(stack.ready, false)
  assert.match(stack.gaps[0].reason, /not in the catalog/)
})

test('the style pack is inherited from the franchise when unset', () => {
  const stack = resolveContextStack({
    references: refsOf({}),
    production: { franchiseSlug: 'chi-town-triplets' },
    shot: {},
  })
  const style = layerOf(stack, 'style')
  assert.equal(style.status, 'ready')
  assert.equal(style.id, 'hex-halo-street', 'inherits the franchise house look')
})

test('production type contributes pace and format data', () => {
  const stack = resolveContextStack({
    references: refsOf({}),
    production: { type: 'commercial' },
    shot: {},
  })
  const type = layerOf(stack, 'productionType')
  assert.equal(type.status, 'ready')
  assert.equal(type.contributes.data.aspect, '9:16')
  assert.equal(type.contributes.data.flow, 'commercial')
})

test('a character contributes its build line and anchor reference images', () => {
  const stack = resolveContextStack({
    references: refsOf({ characters: [readyCharacter()] }),
    shot: { characterRefs: [{ name: 'Mara' }] },
  })
  const character = layerOf(stack, 'character', 'character-mara')
  assert.equal(character.status, 'ready')
  assert.ok(character.contributes.promptLines.some((l) => /Mara build: 178 cm, athletic/.test(l)))
  assert.deepEqual(character.contributes.referenceAssetIds, ['asset-face-1', 'asset-body-1'])
})

test('a character with unaccepted anchors is partial and explains why', () => {
  const bare = newCharacterCard({ id: 'character-rex', name: 'Rex' })
  const stack = resolveContextStack({
    references: refsOf({ characters: [bare] }),
    shot: { characterRefs: [{ name: 'Rex' }] },
  })
  const character = layerOf(stack, 'character', 'character-rex')
  assert.equal(character.status, 'partial')
  assert.equal(stack.ready, false)
  assert.match(stack.gaps[0].reason, /no accepted anchor pair/)
})

test('wardrobe rides on the character but surfaces as its own layer', () => {
  let card = readyCharacter()
  const added = addWardrobeVariant(card, { id: 'suit', label: 'suit' })
  card = setActiveWardrobe(added.card ?? added, 'suit')
  const stack = resolveContextStack({
    references: refsOf({ characters: [card] }),
    shot: { characterRefs: [{ name: 'Mara' }] },
  })
  const wardrobe = layerOf(stack, 'wardrobe')
  assert.ok(wardrobe, 'wardrobe is its own visible layer')
  assert.match(wardrobe.contributes.promptLines[0], /Mara wardrobe: suit/)
})

test('a location contributes its accepted plate and carries landmarks', () => {
  const stack = resolveContextStack({
    references: refsOf({ locations: [readyLocation()] }),
    shot: { location: 'Alley' },
  })
  const location = layerOf(stack, 'location', 'location-alley')
  assert.equal(location.status, 'ready')
  assert.deepEqual(location.contributes.referenceAssetIds, ['asset-alley-wide'])
  assert.equal(location.contributes.data.landmarks.length, 1)
})

test('a shot naming an absent card reports missing rather than resolving empty', () => {
  const stack = resolveContextStack({
    references: refsOf({}),
    shot: { location: 'Nowhere', characterRefs: [{ name: 'Ghost' }], props: ['Nothing'] },
  })
  assert.equal(layerOf(stack, 'location').status, 'missing')
  assert.equal(layerOf(stack, 'character').status, 'missing')
  assert.equal(layerOf(stack, 'prop').status, 'missing')
  assert.equal(stack.counts.missing, 3)
})

/* ── movement ─────────────────────────────────────────────────────────── */

test('movement contributes the action line and its motion clip', () => {
  const character = readyCharacter()
  const stack = resolveContextStack({
    references: refsOf({
      characters: [character],
      movements: [readyMovement({ characterId: character.id })],
    }),
    shot: { characterRefs: [{ name: 'Mara' }], movementIds: ['movement-hook'] },
  })
  const movement = layerOf(stack, 'movement', 'movement-hook')
  assert.equal(movement.status, 'ready')
  assert.equal(movement.contributes.promptLines[0], 'Mara throws a right hook')
  assert.equal(movement.contributes.data.motion.format, 'SMPL-X22')
})

test('movement assigned to a shot character is picked up even when the shot names none', () => {
  const character = readyCharacter()
  const stack = resolveContextStack({
    references: refsOf({
      characters: [character],
      movements: [readyMovement({ characterId: character.id })],
    }),
    // No movementIds on the shot at all.
    shot: { characterRefs: [{ name: 'Mara' }] },
  })
  const movement = layerOf(stack, 'movement', 'movement-hook')
  assert.ok(movement, 'a bound movement is not dropped by an older shot')
  assert.equal(movement.status, 'ready')
})

test('an unaccepted movement still lends its action words but blocks readiness', () => {
  const character = readyCharacter()
  const pending = assignMovementToCharacter(
    newMovementCard({ id: 'movement-duck', name: 'Duck', prompt: 'ducks under the swing' }),
    character.id,
  )
  const stack = resolveContextStack({
    references: refsOf({ characters: [character], movements: [pending] }),
    shot: { characterRefs: [{ name: 'Mara' }] },
  })
  const movement = layerOf(stack, 'movement', 'movement-duck')
  assert.equal(movement.status, 'partial')
  assert.equal(movement.contributes.promptLines[0], 'Mara ducks under the swing')
  assert.equal(stack.ready, false)
})

/* ── aggregation ──────────────────────────────────────────────────────── */

test('unused layers are inactive and contribute nothing', () => {
  const stack = resolveContextStack({ references: refsOf({}), production: {}, shot: {} })
  assert.equal(stack.promptLines.length, 0)
  assert.equal(stack.referenceAssetIds.length, 0)
  assert.equal(stack.active.length, 0)
  assert.equal(stack.ready, true, 'nothing requested means nothing missing')
})

test('reference images are deduped while keeping first-seen order', () => {
  const mara = readyCharacter()
  // A second character deliberately sharing one anchor asset.
  let twin = newCharacterCard({ id: 'character-twin', name: 'Twin' })
  twin = acceptSlot(twin, 'close_up_face', 'asset-face-1')
  twin = acceptSlot(twin, 'full_body', 'asset-body-2')
  const stack = resolveContextStack({
    references: refsOf({ characters: [mara, twin] }),
    shot: { characterRefs: [{ name: 'Mara' }, { name: 'Twin' }] },
  })
  assert.deepEqual(stack.referenceAssetIds, ['asset-face-1', 'asset-body-1', 'asset-body-2'])
})

test('blocking is passed in and summarised, never imported', () => {
  const stack = resolveContextStack({
    references: refsOf({}),
    shot: {},
    blocking: { id: 'scene-1', characters: [{ id: 'a' }, { id: 'b' }], camera: { lens: 35 } },
  })
  const blocking = layerOf(stack, 'blocking')
  assert.equal(blocking.status, 'ready')
  assert.equal(blocking.contributes.data.characters, 2)
  assert.equal(blocking.contributes.data.camera, true)
})

test('with no shot the whole project context resolves', () => {
  const character = readyCharacter()
  const stack = resolveContextStack({
    references: refsOf({
      characters: [character],
      locations: [readyLocation()],
      props: [readyProp()],
      movements: [readyMovement({ characterId: character.id })],
    }),
    production: { type: 'show' },
  })
  assert.ok(layerOf(stack, 'character', 'character-mara'))
  assert.ok(layerOf(stack, 'location', 'location-alley'))
  assert.ok(layerOf(stack, 'prop', 'prop-duffel'))
  assert.ok(layerOf(stack, 'movement', 'movement-hook'))
})

/* ── provenance ───────────────────────────────────────────────────────── */

test('the signature is stable for the same context and moves when it changes', () => {
  const base = {
    references: refsOf({ characters: [readyCharacter()] }),
    shot: { characterRefs: [{ name: 'Mara' }] },
  }
  const a = resolveContextStack(base)
  const b = resolveContextStack(base)
  assert.equal(a.signature, b.signature, 'same context, same signature')

  const changed = resolveContextStack({ ...base, production: { type: 'commercial' } })
  assert.notEqual(a.signature, changed.signature, 'adding a layer changes the signature')
})

test('contextSignature is deterministic and order sensitive', () => {
  assert.equal(contextSignature([['a', 1]]), contextSignature([['a', 1]]))
  assert.notEqual(contextSignature([['a', 1], ['b', 2]]), contextSignature([['b', 2], ['a', 1]]))
  assert.match(contextSignature([]), /^ctx_[0-9a-f]{8}$/)
})

test('provenance records what fed a take, small enough to store', () => {
  const character = readyCharacter()
  const stack = resolveContextStack({
    references: refsOf({ characters: [character] }),
    production: { type: 'show' },
    shot: { characterRefs: [{ name: 'Mara' }] },
  })
  const record = contextProvenance(stack, { now: '2026-08-24T00:00:00Z' })
  assert.equal(record.signature, stack.signature)
  assert.equal(record.ready, true)
  assert.equal(record.recordedAt, '2026-08-24T00:00:00Z')
  assert.ok(record.layers.every((l) => Object.keys(l).length === 4), 'ids and statuses only')
  assert.equal(JSON.stringify(record).length < 2000, true, 'provenance stays small')
})

test('describeContextStack summarises the counts', () => {
  const bare = newCharacterCard({ id: 'character-rex', name: 'Rex' })
  const stack = resolveContextStack({
    references: refsOf({ characters: [readyCharacter(), bare] }),
    shot: { characterRefs: [{ name: 'Mara' }, { name: 'Rex' }, { name: 'Ghost' }] },
  })
  const summary = describeContextStack(stack)
  assert.match(summary, /ready/)
  assert.match(summary, /partial/)
  assert.match(summary, /missing/)
})
