import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MANIFEST_VERSION,
  STAGE_RAW_READ,
  STAGE_TTS_SYNTH,
  STAGE_APPLIO_CONVERTED,
  STAGE_FINALIZED,
  AUDIO_POLICY,
  VO_WORKFLOW_ID,
  LIPSYNC_WORKFLOW_ID,
  FOLEY_WORKFLOW_ID,
  FOLEY_GATE_URL,
  emptyManifest,
  normalizeManifest,
  addTake,
  markCanonical,
  finalizeTake,
  removeTake,
  findTake,
  canonicalTake,
  takesForLine,
  lineage,
  readinessFor,
  expectedLinesFromCards,
  lineSlugForCard,
  planVoiceover,
  applyVoiceover,
  planCloneVoice,
  applyCloneVoice,
  planLipsyncClip,
  planFoley,
  applyFoley,
  buildVseAudioPlan,
  listVoiceProfiles,
  bindCanonicalAudio,
} from '../src/services/takeChain.js'

test('empty manifest is v2 with no takes', () => {
  const m = emptyManifest('demo')
  assert.equal(m.concept, 'demo')
  assert.equal(m.version, MANIFEST_VERSION)
  assert.deepEqual(m.takes, [])
})

test('v1 manifest auto-migrates; phantom wavs drop', () => {
  const migrated = normalizeManifest({
    concept: 'tech-trappers',
    takes: [
      { slug: 's01-codex-1', wav_path: '/tmp/exists.wav', duration_s: 4.2 },
      { slug: 'ghost', wav_path: '/nope.wav' },
    ],
  }, 'tech-trappers', { fileExists: (path) => path === '/tmp/exists.wav' })
  assert.equal(migrated.version, 2)
  assert.equal(migrated.takes.length, 1)
  assert.equal(migrated.takes[0].line_slug, 's01-codex-1')
  assert.equal(migrated.takes[0].stage, STAGE_RAW_READ)
  assert.equal(migrated.takes[0].engine, 'human')
  assert.equal(migrated.takes[0].is_canonical, true)
})

test('addTake demotes prior canonical unless skipped', () => {
  let m = emptyManifest('x')
  const first = addTake(m, 's01', '/a.wav', STAGE_RAW_READ, 'human')
  const second = addTake(first.manifest, 's01', '/b.wav', STAGE_RAW_READ, 'human')
  assert.equal(canonicalTake(second.manifest, 's01').audio_path, '/b.wav')
  const skipped = addTake(second.manifest, 's01', '/c.wav', STAGE_RAW_READ, 'human', { makeCanonical: false })
  assert.equal(canonicalTake(skipped.manifest, 's01').audio_path, '/b.wav')
  assert.equal(skipped.take.is_canonical, false)
})

test('markCanonical and finalizeTake lock the renderer take', () => {
  let { manifest, take: raw } = addTake(emptyManifest('x'), 's01', '/a.wav', STAGE_RAW_READ, 'human')
  const converted = addTake(manifest, 's01', '/b.wav', STAGE_APPLIO_CONVERTED, 'applio', { parentTakeId: raw.take_id })
  const promoted = markCanonical(converted.manifest, raw.take_id)
  assert.equal(canonicalTake(promoted.manifest, 's01').take_id, raw.take_id)
  const locked = finalizeTake(promoted.manifest, converted.take.take_id)
  assert.equal(locked.take.stage, STAGE_FINALIZED)
  assert.equal(locked.take.is_canonical, true)
  assert.equal(findTake(locked.manifest, raw.take_id).is_canonical, false)
})

test('lineage walks parent chain newest to root', () => {
  let { manifest, take: raw } = addTake(emptyManifest('x'), 's01', '/a.wav', STAGE_RAW_READ, 'human')
  const mid = addTake(manifest, 's01', '/b.wav', STAGE_APPLIO_CONVERTED, 'applio', { parentTakeId: raw.take_id })
  const last = addTake(mid.manifest, 's01', '/c.wav', STAGE_FINALIZED, 'applio', { parentTakeId: mid.take.take_id })
  assert.deepEqual(lineage(last.manifest, last.take.take_id).map((t) => t.take_id), [
    last.take.take_id,
    mid.take.take_id,
    raw.take_id,
  ])
})

test('removeTake promotes the most recent sibling', () => {
  const first = addTake(emptyManifest('x'), 's01', '/a.wav', STAGE_RAW_READ, 'human')
  const second = addTake(first.manifest, 's01', '/b.wav', STAGE_APPLIO_CONVERTED, 'applio')
  assert.equal(second.take.is_canonical, true)
  const removed = removeTake(second.manifest, second.take.take_id)
  assert.equal(canonicalTake(removed.manifest, 's01').take_id, first.take.take_id)
})

test('takesForLine orders by created_at', () => {
  const a = addTake(emptyManifest('x'), 's01', '/a.wav', STAGE_RAW_READ, 'human', { createdAt: '2026-01-01T00:00:00Z' })
  const b = addTake(a.manifest, 's01', '/b.wav', STAGE_TTS_SYNTH, 'qwen3', { createdAt: '2026-01-02T00:00:00Z' })
  assert.deepEqual(takesForLine(b.manifest, 's01').map((t) => t.take_id), [a.take.take_id, b.take.take_id])
})

test('readiness is not ready with zero lines or missing finals', () => {
  assert.equal(readinessFor(emptyManifest('x'), []).ready, false)
  const one = addTake(emptyManifest('x'), 's01', '/a.wav', STAGE_RAW_READ, 'human')
  const missing = readinessFor(one.manifest, ['s01', 's02'])
  assert.equal(missing.canonical, 1)
  assert.equal(missing.finalized, 0)
  assert.deepEqual(missing.missing_canonical, ['s02'])
  assert.deepEqual(missing.missing_final, ['s01'])
  const doneA = finalizeTake(one.manifest, one.take.take_id)
  const two = addTake(doneA.manifest, 's02', '/b.wav', STAGE_RAW_READ, 'human')
  const doneB = finalizeTake(two.manifest, two.take.take_id)
  const ready = readinessFor(doneB.manifest, ['s01', 's02'])
  assert.equal(ready.ready, true)
  assert.equal(ready.finalized, 2)
})

test('addTake rejects unknown stage', () => {
  assert.throws(() => addTake(emptyManifest('x'), 's01', '/a.wav', 'bogus_stage', 'human'), /unknown stage/)
})

test('dialogue cards become expected VO lines', () => {
  const lines = expectedLinesFromCards([
    { id: 'c1', title: 's1-ots', dialogue: 'Watch this.', characterRefs: [{ name: 'Codex' }] },
    { id: 'c2', title: 'broll', dialogue: '' },
  ])
  assert.equal(lines.length, 1)
  assert.equal(lines[0].lineSlug, 's1-ots')
  assert.equal(lineSlugForCard({ id: 'x', title: '14. fx4 Punch' }), '14-fx4-punch')
})

test('planVoiceover stays drafts-only and never queues GPU', () => {
  const plan = planVoiceover({ lineSlug: 's01-codex-1', text: 'Hold up.', engine: 'qwen3' })
  assert.equal(plan.ok, true)
  assert.equal(plan.workflowId, VO_WORKFLOW_ID)
  assert.equal(plan.stage, STAGE_TTS_SYNTH)
  assert.equal(plan.queued, false)
  assert.equal(plan.gpuSerial, true)
  assert.equal(plan.outward, 'draft')
  const human = planVoiceover({ lineSlug: 's01', text: 'hi', targetVoice: 'blake-recorded' })
  assert.equal(human.ok, false)
  assert.match(human.reason, /human-recorded/)
  const applied = applyVoiceover(emptyManifest('x'), plan)
  assert.equal(applied.take.stage, STAGE_TTS_SYNTH)
  assert.equal(applied.take.is_canonical, true)
  assert.equal(applied.take.engine_params.outward, 'draft')
})

test('clone_voice parents the converted take', () => {
  const raw = addTake(emptyManifest('x'), 's01', '/a.wav', STAGE_RAW_READ, 'human')
  const plan = planCloneVoice(raw.manifest, { lineSlug: 's01', targetVoice: 'chatterbox' })
  assert.equal(plan.ok, true)
  assert.equal(plan.parentTakeId, raw.take.take_id)
  const cloned = applyCloneVoice(raw.manifest, plan)
  assert.equal(cloned.take.parent_take_id, raw.take.take_id)
  assert.equal(cloned.take.is_canonical, true)
})

test('lipsync Flow A needs a still; Flow B bakes off-screen', () => {
  const take = addTake(emptyManifest('x'), 's01', '/a.wav', STAGE_TTS_SYNTH, 'elevenlabs').take
  const talking = planLipsyncClip({
    card: { id: 'c1', imageAssetId: 'still-1', dialogue: 'Hey.', duration: 4 },
    take,
  })
  assert.equal(talking.flow, 'A')
  assert.equal(talking.workflowId, LIPSYNC_WORKFLOW_ID)
  assert.equal(talking.queued, false)
  assert.equal(talking.outward, 'draft')
  const bake = planLipsyncClip({
    card: { id: 'c2', videoAssetId: 'clip-1', offScreen: true },
    take,
  })
  assert.equal(bake.flow, 'B')
  assert.equal(bake.mux, 'ffmpeg')
  assert.equal(planLipsyncClip({ card: { id: 'c3' } }).ok, false)
})

test('foley is model-gated and VSE-planned without queueing', () => {
  const missing = planFoley({
    card: { id: 'c1', videoAssetId: 'v1', soundNotes: 'footsteps on pier' },
    fileExists: () => false,
  })
  assert.equal(missing.ok, false)
  assert.equal(missing.status, 503)
  assert.equal(missing.gateUrl, FOLEY_GATE_URL)
  const noVideo = planFoley({ card: { id: 'c1', soundNotes: 'whoosh' }, fileExists: () => true })
  assert.equal(noVideo.status, 404)
  const ok = planFoley({
    card: { id: 'c1', videoAssetId: 'v1', duration: 5, soundNotes: 'punch impact' },
    fileExists: () => true,
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.workflowId, FOLEY_WORKFLOW_ID)
  assert.equal(ok.queued, false)
  const applied = applyFoley({ tracks: [] }, ok, { cardId: 'c1' })
  assert.equal(applied.track.kind, 'foley')
  assert.equal(applied.track.duck, false)
  assert.equal(applied.track.outward, 'draft')
})

test('VSE lanes duck music under VO and keep foley dry', () => {
  const voiced = applyVoiceover(
    emptyManifest('show'),
    planVoiceover({ lineSlug: 's1-ots', text: 'Watch this.' }),
    { assetId: 'vo-1' },
  )
  const vse = buildVseAudioPlan({
    cards: [
      { id: 'c1', title: 's1-ots', dialogue: 'Watch this.', duration: 4, audioAssetId: 'vo-1', musicAssetId: 'bed-1', foleyAssetId: 'fx-1' },
    ],
    manifest: voiced.manifest,
    audio: { tracks: [] },
  })
  assert.equal(vse.gpuSerial, true)
  assert.equal(vse.outward, 'draft')
  assert.equal(vse.lanes.find((lane) => lane.id === 'vo').clips.length, 1)
  assert.equal(vse.lanes.find((lane) => lane.id === 'music').clips[0].duck, true)
  assert.equal(vse.lanes.find((lane) => lane.id === 'foley').clips[0].duck, false)
  assert.deepEqual(vse.mix.master, AUDIO_POLICY.master)
})

test('voice catalog and card bind stay drafts-only', () => {
  const ids = listVoiceProfiles().map((row) => row.id)
  assert.ok(ids.includes('elevenlabs-default'))
  assert.ok(ids.includes('blake-recorded'))
  const take = addTake(emptyManifest('x'), 's01', '/a.wav', STAGE_TTS_SYNTH, 'elevenlabs', { assetId: 'a1' }).take
  const card = bindCanonicalAudio({ id: 'c1', title: 's01' }, take)
  assert.equal(card.audioAssetId, 'a1')
  assert.equal(card.canonicalTakeId, take.take_id)
})
