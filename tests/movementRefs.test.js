import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  acceptSlot,
  newCharacterCard,
  newMovementCard,
} from '../src/services/referenceCards.js'
import {
  addCardByName,
  emptyReferences,
  normalizeReferences,
  slotRows,
} from '../src/services/referencePanels.js'
import {
  MOVEMENT_DEFAULTS,
  acceptMovement,
  assignMovementToCharacter,
  failMovement,
  findMovementCard,
  listMovements,
  markMovementGenerating,
  motionMetaFromResponse,
  movementAccepted,
  movementGaps,
  movementLine,
  movementRequest,
  movementsForCharacter,
  normalizeMovementParams,
  requestRegenerateMovement,
  reviewMovement,
  sceneRequestFromMovements,
} from '../src/services/movementRefs.js'

const KIMODO_RESPONSE = {
  frames: 90,
  joints: 22,
  rotations_xyzw: [[0, 0, 0, 1]],
  root_positions: [[0, 0, 0]],
  out_dir: '/tmp/kimodo/run-1',
}

function acceptedCharacter({ id = 'character-mara', name = 'Mara' } = {}) {
  let card = newCharacterCard({ id, name })
  card = acceptSlot(card, 'close_up_face', 'asset-face-1')
  card = acceptSlot(card, 'full_body', 'asset-body-1')
  return card
}

function refsWith({ characters = [], movements = [] } = {}) {
  return { characters, locations: [], props: [], movements }
}

/* ── references shape ─────────────────────────────────────────────────── */

test('references gain a movements list without breaking older files', () => {
  assert.deepEqual(emptyReferences().movements, [])
  // An older project file has no `movements` key at all.
  const legacy = normalizeReferences({ characters: [], locations: [], props: [] })
  assert.deepEqual(legacy.movements, [])
})

test('addCardByName builds a movement card for the movement kind', () => {
  const { references, card } = addCardByName(emptyReferences(), 'movement', 'Right hook')
  assert.equal(card.kind, 'movement')
  assert.equal(card.id, 'movement-right-hook')
  assert.equal(references.movements.length, 1)
})

test('slotRows stays empty for movement cards instead of throwing', () => {
  assert.deepEqual(slotRows(newMovementCard({ id: 'movement-1', name: 'Hook' })), [])
})

/* ── params ───────────────────────────────────────────────────────────── */

test('movement params fall back to the kimodo defaults and clamp', () => {
  assert.deepEqual(normalizeMovementParams(undefined), { ...MOVEMENT_DEFAULTS })
  assert.equal(normalizeMovementParams({ frames: 99999 }).frames, 1200)
  assert.equal(normalizeMovementParams({ frames: 0 }).frames, 1)
  assert.equal(normalizeMovementParams({ steps: 'nonsense' }).steps, MOVEMENT_DEFAULTS.steps)
})

/* ── lifecycle ────────────────────────────────────────────────────────── */

test('a movement runs empty → generating → review → accepted', () => {
  let card = newMovementCard({ id: 'movement-hook', name: 'Right hook', prompt: 'throws a right hook' })
  assert.equal(card.status, 'empty')
  assert.equal(movementAccepted(card), false)

  card = markMovementGenerating(card, { now: 't1' })
  assert.equal(card.status, 'generating')

  const meta = motionMetaFromResponse(KIMODO_RESPONSE, { params: card.params, now: 't2' })
  card = reviewMovement(card, meta, { now: 't2' })
  assert.equal(card.status, 'review')
  assert.equal(movementAccepted(card), false, 'review is not acceptance')

  card = acceptMovement(card, { now: 't3' })
  assert.equal(card.status, 'accepted')
  assert.equal(movementAccepted(card), true)
  assert.equal(card.candidate, null)
  assert.equal(card.history.length, 1)
})

test('stored motion metadata drops the bulky per-frame arrays', () => {
  const meta = motionMetaFromResponse(KIMODO_RESPONSE, { params: MOVEMENT_DEFAULTS, now: 't' })
  assert.equal(meta.frames, 90)
  assert.equal(meta.joints, 22)
  assert.equal(meta.format, 'SMPL-X22')
  assert.equal(meta.outDir, '/tmp/kimodo/run-1')
  assert.equal(meta.rotations_xyzw, undefined)
  assert.equal(meta.root_positions, undefined)
})

test('regenerate keeps the accepted motion so the character is never bare', () => {
  let card = newMovementCard({ id: 'movement-hook', name: 'Hook', prompt: 'throws a hook' })
  card = reviewMovement(card, motionMetaFromResponse(KIMODO_RESPONSE, {}), {})
  card = acceptMovement(card, {})
  const accepted = card.motion

  card = requestRegenerateMovement(card, { now: 't4' })
  assert.equal(card.status, 'generating')
  assert.deepEqual(card.motion, accepted, 'accepted motion survives a regenerate')
})

test('a failed run falls back to accepted when there is one, else to empty', () => {
  let fresh = newMovementCard({ id: 'movement-a', name: 'A', prompt: 'walks' })
  fresh = markMovementGenerating(fresh, {})
  fresh = failMovement(fresh, new Error('kimodo 500'), {})
  assert.equal(fresh.status, 'empty')
  assert.match(fresh.error, /kimodo 500/)

  let settled = newMovementCard({ id: 'movement-b', name: 'B', prompt: 'runs' })
  settled = reviewMovement(settled, motionMetaFromResponse(KIMODO_RESPONSE, {}), {})
  settled = acceptMovement(settled, {})
  settled = failMovement(settled, 'boom', {})
  assert.equal(settled.status, 'accepted', 'keeps the good motion')
})

test('accepting with no candidate is an error', () => {
  const card = newMovementCard({ id: 'movement-x', name: 'X', prompt: 'idles' })
  assert.throws(() => acceptMovement(card, {}), /no candidate motion/)
})

/* ── character binding ────────────────────────────────────────────────── */

test('movements resolve by the character they are bound to', () => {
  const character = acceptedCharacter()
  const bound = assignMovementToCharacter(
    newMovementCard({ id: 'movement-hook', name: 'Hook', prompt: 'throws a right hook' }),
    character.id,
  )
  const other = newMovementCard({ id: 'movement-idle', name: 'Idle', prompt: 'stands still' })
  const refs = refsWith({ characters: [character], movements: [bound, other] })

  assert.equal(movementsForCharacter(refs, character.id).length, 1)
  assert.equal(movementsForCharacter(refs, character.id)[0].id, 'movement-hook')
  assert.equal(movementsForCharacter(refs, 'nobody').length, 0)
  assert.equal(listMovements(refs).length, 2)
  assert.equal(findMovementCard(refs, 'Hook')?.id, 'movement-hook')
})

test('the prompt line names the bound character', () => {
  const character = acceptedCharacter()
  const bound = assignMovementToCharacter(
    newMovementCard({ id: 'm1', name: 'Hook', prompt: 'throws a right hook then backpedals' }),
    character.id,
  )
  const refs = refsWith({ characters: [character], movements: [bound] })
  assert.equal(movementLine(refs, bound), 'Mara throws a right hook then backpedals')

  // Unbound still contributes the action, just unnamed.
  const loose = newMovementCard({ id: 'm2', name: 'Hook', prompt: 'throws a right hook' })
  assert.equal(movementLine(refs, loose), 'throws a right hook')
})

/* ── generation wiring ────────────────────────────────────────────────── */

test('movementRequest produces a kimodo /motion body', () => {
  const card = newMovementCard({ id: 'm1', name: 'Hook', prompt: 'throws a hook', params: { frames: 60, seed: 7 } })
  assert.deepEqual(movementRequest(card), { prompt: 'throws a hook', frames: 60, steps: 30, seed: 7 })
  assert.throws(() => movementRequest(newMovementCard({ id: 'm2', name: 'No prompt' })), /no prompt/)
})

test('a multi-character scene binds each track to its character and arena spot', () => {
  const mara = acceptedCharacter()
  const rex = acceptedCharacter({ id: 'character-rex', name: 'Rex' })
  const a = assignMovementToCharacter(newMovementCard({ id: 'm-a', name: 'A', prompt: 'throws a hook' }), mara.id)
  const b = assignMovementToCharacter(newMovementCard({ id: 'm-b', name: 'B', prompt: 'ducks and counters' }), rex.id)
  const refs = refsWith({ characters: [mara, rex], movements: [a, b] })

  const payload = sceneRequestFromMovements(refs, [a, b], {
    placement: { 'm-b': { root_offset: [1, 0, 0], facing_deg: 180 } },
    frames: 120,
  })
  assert.equal(payload.characters.length, 2)
  assert.equal(payload.frames, 120)
  assert.equal(payload.characters[0].ref, 'character-mara')
  assert.deepEqual(payload.characters[1].root_offset, [1, 0, 0])
  assert.equal(payload.characters[1].facing_deg, 180)
  assert.equal(payload.characters[0].root_offset, undefined, 'no placement means no offset key')
})

test('a scene refuses cards with no prompt', () => {
  const blank = newMovementCard({ id: 'm-blank', name: 'Blank' })
  assert.throws(() => sceneRequestFromMovements(refsWith({}), [blank], {}), /missing a prompt/)
  assert.throws(() => sceneRequestFromMovements(refsWith({}), [], {}), /at least one movement/)
})

/* ── gates ────────────────────────────────────────────────────────────── */

test('movementGaps explains every reason the layer is not ready', () => {
  const character = acceptedCharacter()
  const noPrompt = newMovementCard({ id: 'm-1', name: 'No prompt' })
  const unassigned = newMovementCard({ id: 'm-2', name: 'Unassigned', prompt: 'walks' })
  const dangling = assignMovementToCharacter(
    newMovementCard({ id: 'm-3', name: 'Dangling', prompt: 'walks' }),
    'character-ghost',
  )
  const pending = assignMovementToCharacter(
    newMovementCard({ id: 'm-4', name: 'Pending', prompt: 'walks' }),
    character.id,
  )
  const refs = refsWith({ characters: [character], movements: [noPrompt, unassigned, dangling, pending] })

  const gaps = movementGaps(refs)
  assert.equal(gaps.length, 4)
  assert.match(gaps[0].reason, /no action prompt/)
  assert.match(gaps[1].reason, /not assigned to a character/)
  assert.match(gaps[2].reason, /missing character/)
  assert.match(gaps[3].reason, /no accepted motion/)
})

test('an accepted, bound movement reports no gaps', () => {
  const character = acceptedCharacter()
  let card = assignMovementToCharacter(
    newMovementCard({ id: 'm-ok', name: 'OK', prompt: 'walks' }),
    character.id,
  )
  card = reviewMovement(card, motionMetaFromResponse(KIMODO_RESPONSE, {}), {})
  card = acceptMovement(card, {})
  assert.deepEqual(movementGaps(refsWith({ characters: [character], movements: [card] })), [])
})
