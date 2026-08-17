import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SHOT_CLASSES,
  ROUTING_MATRIX,
  ROUTING_POLICY,
  classifyShot,
  routeShot,
  routeShotFromCard,
  routeStudioShots,
  routingSummary,
  isClientFacingProduction,
} from '../src/services/shotRouting.js'

test('matrix covers every shot class with one ecosystem + Velorn workflow', () => {
  for (const cls of SHOT_CLASSES) {
    const row = ROUTING_MATRIX[cls]
    assert.ok(row, `missing matrix row ${cls}`)
    assert.equal(row.class, cls)
    assert.ok(row.ecosystem)
    assert.ok(row.bundle)
    assert.ok(row.workflowId)
    assert.ok(['proven', 'testing', 'untested'].includes(row.status))
  }
})

test('classifyShot honors explicit class and slot lane', () => {
  assert.equal(classifyShot({ class: 'talking-character' }), 'talking_character')
  assert.equal(classifyShot({ lane: 'lipdub' }), 'talking_character')
  assert.equal(classifyShot({ lane: 'flf' }), 'continuity')
  assert.equal(classifyShot({ lane: 'vo' }), 'vo')
})

test('classifyShot maps script calls to the living matrix', () => {
  const cases = [
    ['Off-screen narration VO line for the recap', 'vo'],
    ['Surgical region fix on the jacket', 'surgical_fix'],
    ['Storefront signage with in-world text', 'signage'],
    ['Codex talking on-screen dialogue, lipsync the line', 'talking_character'],
    ['Fight choreography punch impact freeze', 'action'],
    ['FLF continuity sharing the boundary frame', 'continuity'],
    ['Two characters identity-conditioned two-shot', 'identity'],
    ['Music video beat-sync hit the downbeat', 'audio_synced'],
    ['Establishing exterior wide of North Lawndale', 'establishing'],
    ['Atmosphere B-roll empty street, no faces', 'atmosphere'],
    ['Draft still concept identity trial still', 'draft_still'],
    ['Draft clip previz identity trial clip', 'draft_clip'],
    ['Wide walk down the hallway', 'narrative'],
  ]
  for (const [description, expected] of cases) {
    assert.equal(classifyShot({ description }), expected, description)
  }
})

test('off-screen dialogue is VO, not lipsync', () => {
  assert.equal(classifyShot({
    description: 'Ray-Ray talking off-screen over the reaction',
    dialogue: 'Nah.',
    offScreen: true,
  }), 'vo')
})

test('routeShot returns Grok draft + serial/drafts-only policy', () => {
  const route = routeShot({ description: 'Fight choreography punch' })
  assert.equal(route.class, 'action')
  assert.equal(route.workflowId, 'cdx-ltx-union-control-flf')
  assert.equal(route.draftWorkflowId, 'grok-video-i2v')
  assert.equal(route.gpuSerial, true)
  assert.equal(route.outward, 'draft')
  assert.equal(route.blenderControl, true)
  assert.deepEqual(ROUTING_POLICY, { gpuSerial: true, outward: 'draft', realismFirst: true, talkingLipsRequired: true })
})

test('talking character stays on LTX 2.3 talkvid', () => {
  const route = routeShot({ description: 'On-screen dialogue, she speaks the line' })
  assert.equal(route.ecosystem, 'ltx23')
  assert.equal(route.workflowId, 'ltx23-id-lora')
  assert.equal(route.bundle, 'cdx-ltx25')
  assert.ok(route.bTest.workflowId.includes('minimax'))
})

test('client-facing productions do not keep US-excluded H3', () => {
  assert.equal(isClientFacingProduction('commercial'), true)
  const internal = routeShot({ description: 'Atmosphere B-roll empty street' })
  assert.equal(internal.ecosystem, 'minimax-h3')
  assert.equal(internal.workflowId, 'minimax-h3-t2v')
  const client = routeShot({
    description: 'Atmosphere B-roll empty street',
    productionType: 'commercial',
    clientSafe: true,
  })
  assert.equal(client.ecosystem, 'ltx25')
  assert.equal(client.workflowId, 'ltx25-t2v')
  assert.equal(client.clientSafe, true)
})

test('identity and establishing prefer DAM / refs before GPU', () => {
  const identity = routeShot({ description: 'Two characters identity-conditioned two-shot' })
  assert.equal(identity.stillWorkflowId, 'cdx-keyframe-multiref')
  assert.equal(identity.workflowId, 'minimax-h3-r2v')
  const plate = routeShot({ description: 'Establishing location plate of the real place' })
  assert.equal(plate.preferDamFootage, true)
})

test('surgical face lock vs region inpaint', () => {
  const face = routeShot({ description: 'Reactor face lock the hero' })
  assert.equal(face.workflowId, 'cdx-reactor-facelock')
  const region = routeShot({ description: 'Surgical region fix on the sleeve' })
  assert.equal(region.workflowId, 'cdx-qwen-inpaint-ref')
})

test('routeShotFromCard and studio_flow batch use slot lane', () => {
  const card = {
    id: 'card-7',
    title: '14. fx4-punch',
    description: 'Codex throws the closing punch',
    characterRefs: [{ name: 'Codex' }],
  }
  const slot = { slot_id: 'fx4-punch', board_shot: 'fx4-punch', lane: 'action', action: 'punch' }
  const one = routeShotFromCard(card, { slot })
  assert.equal(one.class, 'action')
  assert.equal(one.cardId, 'card-7')
  assert.equal(one.slotId, 'fx4-punch')

  const batch = routeStudioShots(
    { slots: [slot, { slot_id: 's1-ots', lane: 'lipdub', action: 'Codex talking the line' }] },
    [card, { id: 's1-ots', title: 's1-ots', description: 'OTS talking', dialogue: 'Watch this.' }],
  )
  assert.equal(batch.policy.gpuSerial, true)
  assert.equal(batch.count, 2)
  assert.equal(batch.shots[0].class, 'action')
  assert.equal(batch.shots[1].class, 'talking_character')
})

test('routingSummary is scannable', () => {
  const text = routingSummary(routeShot({ description: 'Draft still concept identity trial still' }))
  assert.match(text, /Draft still/)
  assert.match(text, /grok-text-to-image/)
})
