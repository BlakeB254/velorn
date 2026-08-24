/**
 * CDX Studio-native media evaluation rubrics.
 *
 * Spec (semantics only — not a port of Studio Python):
 *   services/cdx-video-director/app/studio/evaluation_rubrics.py
 *
 * Objective technical checks always win. An incomplete or unavailable
 * evaluator always hands the candidate to a human. automated_pass is NOT
 * human approval — the Director / QA panel still routes through review.
 *
 * GPU serial / drafts-only: this module never queues generation or publishes.
 */

export const MEDIA_KINDS = Object.freeze(['frame', 'video', 'audio'])

export const DISPOSITIONS = Object.freeze([
  'technical_fail',
  'automated_fail',
  'automated_pass',
  'human_review',
])

export const PASS_THRESHOLD = 0.75

const DIMENSION_CODE = /^[a-z][a-z0-9_]{0,63}$/

const RUBRICS = Object.freeze({
  frame: Object.freeze({
    mediaKind: 'frame',
    version: 'frame.v1',
    technicalChecks: Object.freeze(['file_valid', 'dimensions']),
    dimensions: Object.freeze(['identity', 'composition', 'continuity', 'typography', 'brand_fit']),
    passThreshold: PASS_THRESHOLD,
  }),
  video: Object.freeze({
    mediaKind: 'video',
    version: 'video.v1',
    technicalChecks: Object.freeze(['file_valid', 'dimensions', 'duration', 'encoding', 'dropped_frames']),
    dimensions: Object.freeze([
      'identity',
      'composition',
      'motion_stability',
      'continuity',
      'lip_sync',
      'pacing',
      'brand_fit',
    ]),
    passThreshold: PASS_THRESHOLD,
  }),
  audio: Object.freeze({
    mediaKind: 'audio',
    version: 'audio.v1',
    technicalChecks: Object.freeze(['file_valid', 'duration', 'clipping', 'silence', 'encoding', 'missing_stems']),
    dimensions: Object.freeze(['voice_match', 'intelligibility', 'pacing', 'audio_artifacts']),
    passThreshold: PASS_THRESHOLD,
  }),
})

export function rubricFor(mediaKind) {
  const rubric = RUBRICS[mediaKind]
  if (!rubric) throw new Error(`unsupported CDX Studio media kind: ${mediaKind}`)
  return rubric
}

export function listRubrics() {
  return MEDIA_KINDS.map((kind) => rubricFor(kind))
}

export function evaluatorIdentity(raw = {}) {
  if (!raw || typeof raw !== 'object') return null
  const provider = String(raw.provider || '').trim()
  const model = String(raw.model || '').trim()
  const revision = String(raw.revision || '').trim()
  if (!provider && !model && !revision) return null
  return { provider, model, revision }
}

export function identitiesEqual(a, b) {
  if (!a || !b) return false
  return a.provider === b.provider && a.model === b.model && a.revision === b.revision
}

export function normalizeScores(mediaKind, scores) {
  if (scores == null) return null
  if (typeof scores !== 'object' || Array.isArray(scores)) {
    throw new Error('rubric scores must be a mapping')
  }
  const rubric = rubricFor(mediaKind)
  const keys = Object.keys(scores)
  if (keys.some((key) => typeof key !== 'string' || !DIMENSION_CODE.test(key) || !rubric.dimensions.includes(key))) {
    throw new Error('rubric scores contain unsupported dimensions')
  }
  const normalized = {}
  for (const [dimension, value] of Object.entries(scores)) {
    if (typeof value === 'boolean' || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error('rubric scores must be finite numeric values between zero and one')
    }
    normalized[dimension] = value
  }
  return normalized
}

function resultShape({
  mediaKind,
  rubricVersion,
  disposition,
  evaluator = null,
  selfEvaluation = false,
  failedChecks = [],
  missingChecks = [],
  failedDimensions = [],
  scores = null,
}) {
  return {
    mediaKind,
    rubricVersion,
    disposition,
    evaluator,
    selfEvaluation,
    failedChecks: [...failedChecks],
    missingChecks: [...missingChecks],
    failedDimensions: [...failedDimensions],
    scores,
  }
}

/**
 * Apply the evaluation hierarchy without granting human approval.
 * automated_pass means only that automated gates passed.
 */
export function evaluateCandidate({
  mediaKind,
  technicalChecks = {},
  scores = null,
  evaluator = null,
  generator = null,
} = {}) {
  const rubric = rubricFor(mediaKind)
  const checks = technicalChecks && typeof technicalChecks === 'object' ? technicalChecks : {}
  const missingChecks = rubric.technicalChecks.filter((check) => !(check in checks))
  const failedChecks = rubric.technicalChecks.filter((check) => check in checks && checks[check] !== true)
  const evaluatorId = evaluatorIdentity(evaluator)
  const generatorId = evaluatorIdentity(generator)
  const selfEvaluation = Boolean(evaluatorId && generatorId && identitiesEqual(evaluatorId, generatorId))

  if (failedChecks.length) {
    return resultShape({
      mediaKind: rubric.mediaKind,
      rubricVersion: rubric.version,
      disposition: 'technical_fail',
      evaluator: evaluatorId,
      selfEvaluation,
      failedChecks,
      missingChecks,
    })
  }
  if (missingChecks.length || !evaluatorId || scores == null) {
    return resultShape({
      mediaKind: rubric.mediaKind,
      rubricVersion: rubric.version,
      disposition: 'human_review',
      evaluator: evaluatorId,
      selfEvaluation,
      missingChecks,
    })
  }

  const normalized = normalizeScores(mediaKind, scores)
  const missingDimensions = rubric.dimensions.filter((dimension) => !(dimension in normalized))
  if (missingDimensions.length) {
    return resultShape({
      mediaKind: rubric.mediaKind,
      rubricVersion: rubric.version,
      disposition: 'human_review',
      evaluator: evaluatorId,
      selfEvaluation,
      failedDimensions: missingDimensions,
      scores: normalized,
    })
  }
  const failedDimensions = rubric.dimensions.filter((dimension) => normalized[dimension] < rubric.passThreshold)
  return resultShape({
    mediaKind: rubric.mediaKind,
    rubricVersion: rubric.version,
    disposition: failedDimensions.length ? 'automated_fail' : 'automated_pass',
    evaluator: evaluatorId,
    selfEvaluation,
    failedDimensions,
    scores: normalized,
  })
}

/** Map a rubric disposition onto the per-track QA result. Never infers pass from silence. */
export function dispositionToQaResult(disposition) {
  if (disposition === 'technical_fail' || disposition === 'automated_fail') return 'fail'
  if (disposition === 'automated_pass') return 'pass'
  return 'unverified'
}

export function reasonFromEvaluation(evaluation, fallback = '') {
  if (!evaluation) return fallback
  const bits = []
  if (evaluation.failedChecks?.length) bits.push(`tech: ${evaluation.failedChecks.join(', ')}`)
  if (evaluation.failedDimensions?.length) bits.push(`dims: ${evaluation.failedDimensions.join(', ')}`)
  if (evaluation.missingChecks?.length) bits.push(`missing checks: ${evaluation.missingChecks.join(', ')}`)
  if (evaluation.disposition === 'human_review' && !bits.length) bits.push('incomplete evaluation — human review')
  return bits.join('; ') || fallback
}
