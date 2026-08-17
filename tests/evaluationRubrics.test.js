import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DISPOSITIONS,
  dispositionToQaResult,
  evaluateCandidate,
  listRubrics,
  normalizeScores,
  rubricFor,
} from '../src/services/evaluationRubrics.js'

const VIDEO_PASS_SCORES = {
  identity: 0.9,
  composition: 0.9,
  motion_stability: 0.9,
  continuity: 0.9,
  lip_sync: 0.9,
  pacing: 0.9,
  brand_fit: 0.9,
}

const VIDEO_CHECKS = {
  file_valid: true,
  dimensions: true,
  duration: true,
  encoding: true,
  dropped_frames: true,
}

const JUDGE = { provider: 'local', model: 'vision-judge', revision: 'r3' }
const GEN = { provider: 'local', model: 'ltx-video', revision: 'r1' }

describe('evaluation rubrics', () => {
  test('media rubrics do not leak checks from another media class', () => {
    const frame = rubricFor('frame')
    const video = rubricFor('video')
    const audio = rubricFor('audio')
    assert.deepEqual(new Set(frame.dimensions), new Set(['identity', 'composition', 'continuity', 'typography', 'brand_fit']))
    assert.deepEqual(new Set(video.technicalChecks), new Set(['file_valid', 'dimensions', 'duration', 'encoding', 'dropped_frames']))
    assert.deepEqual(new Set(audio.dimensions), new Set(['voice_match', 'intelligibility', 'pacing', 'audio_artifacts']))
    assert.equal(new Set(audio.dimensions).has('identity'), false)
    assert.equal(listRubrics().length, 3)
    assert.throws(() => rubricFor('smell'), /unsupported/)
  })

  test('technical failure wins over perfect subjective scores', () => {
    const result = evaluateCandidate({
      mediaKind: 'video',
      technicalChecks: { ...VIDEO_CHECKS, encoding: false },
      scores: VIDEO_PASS_SCORES,
      evaluator: JUDGE,
      generator: GEN,
    })
    assert.equal(result.disposition, 'technical_fail')
    assert.deepEqual(result.failedChecks, ['encoding'])
    assert.equal(dispositionToQaResult(result.disposition), 'fail')
  })

  test('technical failure is resolved before malformed subjective scores', () => {
    const result = evaluateCandidate({
      mediaKind: 'frame',
      technicalChecks: { file_valid: false, dimensions: true },
      scores: { notes: 'private malformed evaluator rationale' },
      evaluator: JUDGE,
      generator: { provider: 'local', model: 'image-model', revision: 'r1' },
    })
    assert.equal(result.disposition, 'technical_fail')
    assert.deepEqual(result.failedChecks, ['file_valid'])
  })

  test('same model evaluation is explicitly labeled self evaluation', () => {
    const result = evaluateCandidate({
      mediaKind: 'frame',
      technicalChecks: { file_valid: true, dimensions: true },
      scores: { identity: 0.9, composition: 0.9, continuity: 0.9, typography: 0.9, brand_fit: 0.9 },
      evaluator: JUDGE,
      generator: JUDGE,
    })
    assert.equal(result.disposition, 'automated_pass')
    assert.equal(result.selfEvaluation, true)
  })

  test('unavailable evaluator routes to human review instead of auto approval', () => {
    const result = evaluateCandidate({
      mediaKind: 'audio',
      technicalChecks: {
        file_valid: true, duration: true, clipping: true, silence: true, encoding: true, missing_stems: true,
      },
      scores: null,
      evaluator: null,
      generator: { provider: 'local', model: 'qwen-tts', revision: 'r2' },
    })
    assert.equal(result.disposition, 'human_review')
    assert.equal(result.selfEvaluation, false)
    assert.equal(dispositionToQaResult(result.disposition), 'unverified')
  })

  test('incomplete technical checks are not treated as a pass', () => {
    const result = evaluateCandidate({
      mediaKind: 'frame',
      technicalChecks: { file_valid: true },
      scores: null,
      evaluator: null,
      generator: null,
    })
    assert.equal(result.disposition, 'human_review')
    assert.deepEqual(result.missingChecks, ['dimensions'])
  })

  test('dimension below threshold is automated_fail', () => {
    const result = evaluateCandidate({
      mediaKind: 'video',
      technicalChecks: VIDEO_CHECKS,
      scores: { ...VIDEO_PASS_SCORES, identity: 0.2 },
      evaluator: JUDGE,
      generator: GEN,
    })
    assert.equal(result.disposition, 'automated_fail')
    assert.deepEqual(result.failedDimensions, ['identity'])
  })

  test('normalizeScores rejects unknown dimensions and out-of-range values', () => {
    assert.throws(() => normalizeScores('video', { identity: 2 }), /between zero and one/)
    assert.throws(() => normalizeScores('video', { nope: 0.5 }), /unsupported/)
    assert.deepEqual(normalizeScores('frame', { identity: 1 }), { identity: 1 })
    assert.ok(DISPOSITIONS.includes('automated_pass'))
  })
})
