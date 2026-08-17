import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CORE_PROJECT_ID,
  VELORN_WORKLOADS,
  applyResolvedEntity,
  attachCoreToPacket,
  buildDirectFeedbackTrace,
  buildFeedbackTrace,
  buildGenerationTrace,
  buildMapReceipt,
  buildMcpCallTrace,
  citeSkillVersion,
  decorateWithMcpTrace,
  entitySearchPlan,
  mediaQualityGateNames,
  parseEntityId,
  stableUuid,
} from '../src/services/coreTraceBridge.js'

describe('core trace bridge', () => {
  test('stable ids are uuid v5 and repeatable', () => {
    const first = stableUuid('generation', 'demo-site-tour', 'frame-001-v1')
    const second = stableUuid('generation', 'demo-site-tour', 'frame-001-v1')
    assert.equal(first, second)
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  test('generation plan cites skill_version_id and keeps prompt/path out of the ledger', () => {
    const plan = buildGenerationTrace({
      generation_id: 'frame-001-v1',
      parent_generation_id: 'frame-000-v3',
      slug: 'demo-site-tour',
      asset_type: 'image',
      workflow_family: 'zimage-region-fix',
      seed: 42,
      skill_version_id: 7,
      slug_skill: 'studio.skit',
      skill: { slug: 'studio.skit', version: 1, skill_version_id: 7 },
      entity_id: 1836,
      prompt: 'A private prompt must never enter the ledger.',
      output_paths: ['/private/render.png'],
      created_at: '2026-07-30T01:02:03Z',
    })

    assert.equal(plan.receipt.source_created_at, '2026-07-30T01:02:03Z')
    assert.equal(plan.receipt.skill_version_id, 7)
    assert.equal(plan.receipt.lineage.entity_id, 1836)
    assert.equal(plan.receipt.lineage.core_project_id, CORE_PROJECT_ID)
    assert.equal(plan.receipt.lineage.parent_generation_id, 'frame-000-v3')
    assert.equal(plan.writes.length, 3)
    assert.equal(plan.writes[0].kwargs.workload_id, VELORN_WORKLOADS.generation)
    assert.equal(plan.writes[0].kwargs.metadata.skill_version_id, 7)
    assert.equal(plan.writes[1].kwargs.name, 'velorn_image_generation')
    assert.equal(plan.writes[2].kwargs.media_type, 'image/png')
    assert.equal(plan.writes[1].kwargs.inputs.parameters.seed, 42)
    const blob = JSON.stringify(plan.writes)
    assert.equal(blob.includes('private'), false)
    assert.equal(blob.includes('A private prompt'), false)
    assert.equal(blob.includes('/private/render.png'), false)
  })

  test('audio generation uses only audio quality gates', () => {
    const plan = buildGenerationTrace({
      generation_id: 'music-001',
      slug: 'demo-site-tour',
      asset_type: 'audio',
      workflow_family: 'music_ace_step_turbo',
      created_at: '2026-07-30T01:02:03Z',
    })
    assert.deepEqual(plan.receipt.quality_gate_names, ['audio_quality'])
    assert.equal(plan.writes[1].kwargs.name, 'velorn_audio_generation')
    assert.equal(plan.writes[2].kwargs.media_type, 'audio/mpeg')
    assert.deepEqual(mediaQualityGateNames({ asset_type: 'voice' }), ['audio_quality'])
  })

  test('feedback maps notes to coded reasons without exporting the note', () => {
    const plan = buildFeedbackTrace({
      generation_id: 'voice-001',
      slug: 'demo-site-tour',
      approved: false,
      note: 'The voice is wrong and the source file is /private/voice.wav.',
      created_at: '2026-07-30T01:03:04Z',
      skill_version_id: 7,
    })
    assert.equal(plan.writes[0].kwargs.verdict, 'reject')
    assert.equal(plan.writes[0].kwargs.reason, 'voice_mismatch')
    assert.equal(plan.receipt.skill_version_id, 7)
    assert.equal(JSON.stringify(plan.writes).includes('private'), false)
  })

  test('direct feedback rejects unknown verdicts and keeps notes out', () => {
    const plan = buildDirectFeedbackTrace({
      trace_id: '11111111-1111-4111-8111-111111111111',
      span_id: '22222222-2222-4222-8222-222222222222',
      artifact_id: 'frame-42',
      media_type: 'image/png',
      verdict: 'down',
      reason: 'identity_drift',
      note: 'private reviewer prose',
      idempotency_key: '33333333-3333-4333-8333-333333333333',
    })
    assert.equal(plan.writes[0].kwargs.reason, 'identity_drift')
    assert.equal(JSON.stringify(plan.writes).includes('private'), false)
    assert.throws(() => buildDirectFeedbackTrace({
      trace_id: '11111111-1111-4111-8111-111111111111',
      span_id: '22222222-2222-4222-8222-222222222222',
      artifact_id: 'frame-42',
      media_type: 'image/png',
      verdict: 'lol',
      idempotency_key: '33333333-3333-4333-8333-333333333333',
    }), /unsupported/)
  })

  test('MCP call traces stay coded and attach to production results', () => {
    const plan = buildMcpCallTrace({
      action: 'save_cut',
      slug: 'chi-town-triplets',
      call_id: 'save_cut-1',
      previewOnly: true,
      skill: { slug: 'velorn-production', version: 1, skill_version_id: 12 },
      result_keys: ['previewOnly', 'action'],
    })
    assert.equal(plan.writes[0].kwargs.workload_id, VELORN_WORKLOADS.mcp)
    assert.equal(plan.writes[0].kwargs.metadata.skill_version_id, 12)
    assert.equal(plan.receipt.action, 'save_cut')
    const decorated = decorateWithMcpTrace('get_production_context', { previewOnly: true }, { action: 'get_production_context' }, {
      slug: 'chi-town-triplets',
      skill_version_id: 12,
      started: 't0',
    })
    assert.equal(decorated.action, 'get_production_context')
    assert.equal(decorated._trace.action, 'get_production_context')
    assert.equal(decorated._trace.skill_version_id, 12)
  })

  test('entity resolve never guesses when matches are missing or ambiguous', () => {
    assert.equal(parseEntityId('entities/1836'), 1836)
    assert.deepEqual(entitySearchPlan('Velorn').path, '/api/v1/search/entities')
    const none = applyResolvedEntity({}, {}, { matches: [] })
    assert.equal(none.unowned, true)
    assert.equal(none.entity_id, null)
    const many = applyResolvedEntity({}, {}, { matches: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] })
    assert.equal(many.unowned, true)
    assert.equal(many.entity_id, null)
    const one = applyResolvedEntity({}, {}, { matches: [{ id: 1836, name: 'Velorn' }] })
    assert.equal(one.entity_id, 1836)
    assert.equal(one.guessed, false)
    const explicit = applyResolvedEntity({}, { entity_id: 1836, name: 'Velorn' })
    assert.equal(explicit.entity_id, 1836)
  })

  test('map receipt cites skill_version_id and used_skill', () => {
    const receipt = buildMapReceipt({
      card_id: 't_ed3aed05',
      board: 'cdx-creative',
      slug: 'velorn-core-trace',
      production_name: 'Velorn Core trace bridge',
      skill: { slug: 'velorn-production', version: 1, skill_version_id: 12 },
      entity_id: 1836,
      entity_name: 'Velorn',
      entity_key: 'velorn',
      trace_id: '11111111-1111-4111-8111-111111111111',
      summary: 'Velorn traces to Core with skill_version_id',
    })
    assert.equal(receipt.skill_version_id, 12)
    assert.equal(receipt.edges.some((edge) => edge.type === 'used_skill'), true)
    assert.equal(receipt.artifacts.some((item) => item.kind === 'skill' && item.ref.includes('velorn-production')), true)
    assert.ok(!receipt.no_graph_impact)
  })

  test('production packet core section stays unowned until an entity is linked', () => {
    const packet = attachCoreToPacket({ schemaVersion: 1 }, { name: 'Show' })
    assert.equal(packet.core.coreProjectId, CORE_PROJECT_ID)
    assert.equal(packet.core.unowned, true)
    const linked = attachCoreToPacket({ schemaVersion: 1 }, {
      core: { entity_id: 1836, entity_name: 'Velorn', skill: { slug: 'studio.skit', skill_version_id: 7, version: 1 } },
    })
    assert.equal(linked.core.entity_id, 1836)
    assert.equal(linked.core.skill.skill_version_id, 7)
  })

  test('skill citation requires a version id or slug', () => {
    assert.throws(() => citeSkillVersion({}), /skill citation/)
    assert.deepEqual(citeSkillVersion({ skill_version_id: 7, slug: 'studio.skit', version: 1 }).receipt_hint.cite, {
      skill_version_id: 7,
    })
  })
})
