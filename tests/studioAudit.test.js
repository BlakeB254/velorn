import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addSlot,
  assignFrame,
  emptyStudio,
  recordVerdict,
  verdictForShot,
} from '../src/services/studioStore.js'
import { auditProject, auditShot, sceneOf, shotIdForClip, voScene } from '../src/services/studioAudit.js'
import { buildQaGraph } from '../src/services/qaGraph.js'

function filledStudio(shot = 's1-ots') {
  let studio = addSlot(emptyStudio(), { slot_id: 'o1', board_shot: shot, audio: '' })
  studio = assignFrame(studio, 'o1', 'first', 'asset_f')
  studio = assignFrame(studio, 'o1', 'last', 'asset_l')
  return studio
}

describe('studio audit', () => {
  test('scene prefix join matches Studio VO heuristic', () => {
    assert.equal(sceneOf('s3-stud-move'), 's3')
    assert.equal(voScene('s01-random-guy-1'), 's1')
  })

  test('NEEDS_FLF when a keyframe is missing', () => {
    let studio = addSlot(emptyStudio(), { slot_id: 'o1', board_shot: 's1-walk' })
    studio = assignFrame(studio, 'o1', 'first', 'asset_f')
    const row = auditShot({
      card: { id: 's1-walk', order: 1 },
      slot: studio.slots[0],
      studio,
    })
    assert.equal(row.verdict, 'NEEDS_FLF')
    assert.match(row.action, /last/)
  })

  test('READY_TO_GENERATE when both frames locked and no clip', () => {
    const studio = filledStudio('s1-ots')
    const row = auditShot({
      card: { id: 's1-ots', order: 1 },
      slot: studio.slots[0],
      studio,
    })
    assert.equal(row.verdict, 'READY_TO_GENERATE')
  })

  test('DIALOGUE_BLOCKED when VO is not canonical', () => {
    let studio = addSlot(emptyStudio(), { slot_id: 'o1', board_shot: 's2-talk', audio: 'Line one' })
    studio = assignFrame(studio, 'o1', 'first', 'asset_f')
    studio = assignFrame(studio, 'o1', 'last', 'asset_l')
    const row = auditShot({
      card: { id: 's2-talk', audio: 'Line one' },
      slot: studio.slots[0],
      studio,
      extras: { missingCanonical: ['s02-line-1'] },
    })
    assert.equal(row.verdict, 'DIALOGUE_BLOCKED')
    assert.equal(row.dialogue, true)
  })

  test('DONE unverified until a verdict is recorded; fail becomes NEEDS_REGEN', () => {
    const studio = filledStudio('fx4-punch')
    const card = { id: 'fx4-punch', videoAssetId: 'clip-1' }
    const done = auditShot({ card, slot: studio.slots[0], studio, extras: { assets: [{ id: 'clip-1' }] } })
    assert.equal(done.verdict, 'DONE')
    assert.match(done.action, /UNVERIFIED/)
    const failed = recordVerdict(studio, 'fx4-punch', { video: 'fail', reason: 'punch reads in reverse' })
    const regen = auditShot({ card, slot: failed.slots[0], studio: failed, extras: { assets: [{ id: 'clip-1' }] } })
    assert.equal(regen.verdict, 'NEEDS_REGEN')
    assert.match(regen.action, /reverse/)
  })

  test('DONE + QA pass is still DONE, not a silent promotion', () => {
    let studio = filledStudio('s1-ots')
    studio = recordVerdict(studio, 's1-ots', { video: 'pass', audio: 'pass', reason: 'on-model, forward motion' })
    const row = auditShot({
      card: { id: 's1-ots', videoAssetId: 'clip-1' },
      slot: studio.slots[0],
      studio,
      extras: { assets: [{ id: 'clip-1' }] },
    })
    assert.equal(row.verdict, 'DONE')
    assert.match(row.action, /PASSED/)
    assert.equal(row.qa.overall, 'pass')
  })

  test('auditProject joins board cards and leftover slots', () => {
    const studio = filledStudio('s1-ots')
    const report = auditProject({
      name: 'Chi-Town Triplets',
      studio,
      storyboardBoard: { cards: [{ id: 's1-ots', order: 1, title: 'OTS' }] },
    })
    assert.equal(report.shots_total, 1)
    assert.equal(report.counts.READY_TO_GENERATE, 1)
    assert.ok(report.audit_gaps.some((gap) => gap.includes('DONE ≠ PASSED')))
    assert.equal(report.policy.gpuSerial, true)
    assert.equal(report.policy.outward, 'draft')
  })

  test('shotIdForClip matches asset id then name', () => {
    const studio = filledStudio('s1-ots')
    const cards = [{ id: 's1-ots', videoAssetId: 'clip-1' }]
    assert.equal(shotIdForClip(studio, cards, { assetId: 'clip-1' }), 's1-ots')
    assert.equal(shotIdForClip(studio, cards, { name: 'fx leftover s1-ots take' }), 's1-ots')
  })
})

describe('qa graph', () => {
  test('recordVerdict attaches rubric eval and production-graph edges', () => {
    let studio = emptyStudio()
    studio = recordVerdict(studio, 's1-ots', {
      videoChecks: {
        file_valid: true, dimensions: true, duration: true, encoding: false, dropped_frames: true,
      },
      videoScores: {
        identity: 1, composition: 1, motion_stability: 1, continuity: 1, lip_sync: 1, pacing: 1, brand_fit: 1,
      },
      evaluator: { provider: 'local', model: 'vision-judge', revision: 'r3' },
      generator: { provider: 'local', model: 'ltx-video', revision: 'r1' },
      production: { slug: 'chi-town-triplets', title: 'Chi-Town Triplets' },
    })
    const v = verdictForShot(studio, 's1-ots')
    assert.equal(v.video.result, 'fail')
    assert.equal(v.video.rubric.disposition, 'technical_fail')
    assert.deepEqual(v.video.rubric.failedChecks, ['encoding'])
    assert.match(v.video.reason, /encoding/)
    assert.ok(studio.qaGraph.edges.some((edge) => edge.type === 'uses' && String(edge.to).includes('video.v1')))
    assert.ok(studio.qaGraph.nodes.some((node) => node.key === 'shot:s1-ots'))
    const rebuilt = buildQaGraph(studio, { production: { slug: 'chi-town-triplets' } })
    assert.equal(rebuilt.stats.shots, 1)
    assert.ok(rebuilt.edges.length >= 2)
  })
})
