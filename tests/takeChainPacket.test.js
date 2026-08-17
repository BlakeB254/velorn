import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildProductionPacket, buildShotPacket } from '../src/services/productionPacket.js'
import { addTake, applyVoiceover, emptyManifest, planVoiceover } from '../src/services/takeChain.js'

test('production packet includes take-chain readiness and VSE lanes', () => {
  const voiced = applyVoiceover(
    emptyManifest('ctt'),
    planVoiceover({ lineSlug: 's1-ots', text: 'Watch this.' }),
    { assetId: 'vo-1' },
  )
  const finalized = addTake(voiced.manifest, 's1-ots', '/a.wav', 'finalized', 'elevenlabs', { assetId: 'vo-1' })
  const project = {
    name: 'Chi-Town Triplets',
    studio: { voiceover: finalized.manifest, audio: { tracks: [] }, cast: { series: {} }, slots: [] },
    storyboardBoard: {
      cards: [
        { id: 'c1', order: 1, title: 's1-ots', dialogue: 'Watch this.', duration: 4, audioAssetId: 'vo-1', musicAssetId: 'm1', foleyAssetId: 'f1' },
      ],
    },
  }
  const packet = buildProductionPacket(project, { assets: [] })
  assert.equal(packet.audio.takeChain.total_lines, 1)
  assert.equal(packet.audio.vse.lanes.length, 3)
  assert.equal(packet.audio.policy.gpuSerial, true)
  assert.equal(packet.audio.policy.outward, 'draft')
  const shot = buildShotPacket(project, 'c1', { assets: [] })
  assert.equal(shot.shot.audio.lineSlug, 's1-ots')
  assert.ok(shot.shot.audio.lipsync)
  assert.ok(shot.shot.audio.foley)
})
