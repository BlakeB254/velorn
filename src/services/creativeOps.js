/**
 * Velorn-native CreativeOps ledger.
 *
 * Spec sources (semantics only — not a port of Studio Python):
 *   ai-creativeops-pipelines     append-only workspace, queues, ready pool
 *   versioned-creative-pipelines never overwrite a generation
 *   cdx-data-capture             drafts-only outward; provenance on graph facts
 *
 * The in-project object is the live ledger (`project.creativeOps`).
 * Disk under `out/_creative_ops/<slug>/` is the append-only folder contract.
 * This module is Electron-free so it runs under `node --test`.
 */

export const CREATIVE_OPS_VERSION = 1

export const LEDGER_POLICY = Object.freeze({
  appendOnly: true,
  neverOverwriteMedia: true,
  humanApprovalRequiredBeforePublish: true,
  readyPoolOnlyAfterQualityGate: true,
  preserveAllGenerationAttemptsForMorningReview: true,
  gpuSerial: true,
  outward: 'draft',
})

export const WORKSPACE_DIRS = Object.freeze([
  'versions',
  'variants',
  'review_queue',
  'regeneration_queue',
  'ready_pool',
  'publishing_packages',
  'feedback',
  'social_metadata',
  'comfy_runs',
  'source_links',
])

export const DEFAULT_CONTENT_PILLARS = Object.freeze([
  'product-value',
  'site-tour',
  'site-update',
  'business-hype',
  'community-proof',
  'behind-the-scenes',
  'launch-announcement',
])

export const DEFAULT_WORKFLOW_FAMILIES = Object.freeze([
  'still-generation',
  'first-frame-last-frame',
  'image-to-video',
  'tts-or-human-vo',
  'lip-sync',
  'hyperframe-commercial',
  'website-tour',
  'site-update-announcement',
])

export const DEFAULT_QUALITY_GATES = Object.freeze({
  visual_clarity: { weight: 0.18, minimum: 0.72 },
  brand_fit: { weight: 0.16, minimum: 0.70 },
  motion_stability: { weight: 0.14, minimum: 0.68 },
  story_clarity: { weight: 0.14, minimum: 0.72 },
  audio_quality: { weight: 0.10, minimum: 0.68 },
  lip_sync: { weight: 0.08, minimum: 0.65 },
  cta_strength: { weight: 0.10, minimum: 0.70 },
  platform_fit: { weight: 0.10, minimum: 0.72 },
})

export const QUALITY_GATES_BY_MEDIA = Object.freeze({
  image: ['visual_clarity', 'brand_fit', 'story_clarity', 'cta_strength', 'platform_fit'],
  video: Object.keys(DEFAULT_QUALITY_GATES),
  audio: ['audio_quality'],
})

export const READY_MIN_SCORE = 0.78
export const REGEN_MAX_ATTEMPTS = 3

const STOP_WORDS = new Set(['the', 'and', 'with', 'for', 'this', 'that'])

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const asString = (value, fallback = '') => (value === null || value === undefined ? fallback : String(value))
const clone = (value) => JSON.parse(JSON.stringify(value))
const nowIso = () => new Date().toISOString()

export function slugify(value, fallback = 'project') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallback
}

export function diskRootFor(slug, projectDir = '') {
  const safe = slugify(slug)
  return projectDir ? `${String(projectDir).replace(/\/+$/, '')}/out/_creative_ops/${safe}` : `out/_creative_ops/${safe}`
}

function tokenize(text) {
  return (String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || [])
    .filter((token) => !STOP_WORDS.has(token))
}

function emptyApprovalProfile(slug) {
  return {
    schema_version: CREATIVE_OPS_VERSION,
    slug,
    approved_count: 0,
    denied_count: 0,
    approved_reason_terms: {},
    denied_reason_terms: {},
    approved_pillars: {},
    denied_pillars: {},
    last_updated_at: '',
  }
}

export function emptyWorkspace(concept = {}) {
  const slug = slugify(concept.slug || concept.title || concept.name, 'project')
  const now = nowIso()
  return {
    schemaVersion: CREATIVE_OPS_VERSION,
    slug,
    title: asString(concept.title || concept.name || slug),
    projectType: asString(concept.projectType || concept.type, 'untyped'),
    brand: asString(concept.brand),
    entityId: concept.entityId ?? concept.entity_id ?? null,
    entityName: asString(concept.entityName || concept.entity_name),
    entityType: asString(concept.entityType || concept.entity_type, 'business'),
    siteUrl: asString(concept.siteUrl || concept.site_url),
    projectDir: asString(concept.projectDir || concept.project_dir),
    diskRoot: asString(concept.diskRoot, diskRootFor(slug, concept.projectDir || concept.project_dir)),
    createdAt: asString(concept.createdAt, now),
    updatedAt: now,
    rules: { ...LEDGER_POLICY },
    qualityGates: clone(DEFAULT_QUALITY_GATES),
    readyMinScore: READY_MIN_SCORE,
    regenMaxAttempts: REGEN_MAX_ATTEMPTS,
    contentPillars: [...DEFAULT_CONTENT_PILLARS],
    targetPlatforms: ['youtube', 'x', 'website', 'postiz'],
    workflowFamilies: [...DEFAULT_WORKFLOW_FAMILIES],
    generations: [],
    feedback: [],
    readyPool: [],
    reviewQueue: [],
    regenerationQueue: [],
    sourceLinks: [],
    approvalProfile: emptyApprovalProfile(slug),
  }
}

export function normalizeWorkspace(raw, concept = {}) {
  const base = emptyWorkspace({ ...concept, ...(isPlainObject(raw) ? raw : {}) })
  if (!isPlainObject(raw)) return base
  const list = (key) => (Array.isArray(raw[key]) ? raw[key].filter(isPlainObject).map((item) => ({ ...item })) : base[key])
  return {
    ...base,
    generations: list('generations'),
    feedback: list('feedback'),
    readyPool: list('readyPool'),
    reviewQueue: list('reviewQueue'),
    regenerationQueue: list('regenerationQueue'),
    sourceLinks: list('sourceLinks'),
    approvalProfile: {
      ...emptyApprovalProfile(base.slug),
      ...(isPlainObject(raw.approvalProfile) ? raw.approvalProfile : {}),
    },
    rules: { ...LEDGER_POLICY, ...(isPlainObject(raw.rules) ? raw.rules : {}) },
  }
}

export function conceptFromProject(project = {}) {
  const production = isPlainObject(project.production) ? project.production : {}
  const migration = isPlainObject(project.cdxMigration) ? project.cdxMigration : {}
  return {
    slug: production.slug || migration.slug || slugify(project.name, 'project'),
    title: production.title || migration.title || project.name || '',
    projectType: production.type || migration.type || 'narrative',
    brand: migration.brand || production.brand || '',
    entityId: migration.entityId ?? migration.entity_id ?? production.entityId ?? null,
    entityName: migration.entityName || migration.entity_name || '',
    entityType: migration.entityType || migration.entity_type || 'business',
    siteUrl: migration.siteUrl || migration.site_url || '',
    projectDir: asString(project.projectDir || project.path || ''),
  }
}

function decisionReason(decision, failed, score, attempt) {
  if (decision === 'candidate_ready_for_review') {
    return `Quality score ${score.toFixed(2)} passed ready threshold and gate minimums.`
  }
  if (decision === 'needs_human_review') {
    if (score === null) return 'No quality scores provided — awaiting human review.'
    return `Attempt ${attempt} reached regen limit with usable score ${score.toFixed(2)}; preserve all variants for human review.`
  }
  return `Quality score ${score.toFixed(2)} failed gates: ${failed.join(', ') || 'overall threshold'}; queue another variant overnight.`
}

export function qualityDecision(scores, { attempt = 1, assetType = 'video' } = {}) {
  if (!scores || !Object.keys(scores).length) {
    return {
      score: null,
      decision: 'needs_human_review',
      failed_gates: [],
      reason: 'No quality scores provided — awaiting human review.',
    }
  }
  const media = ['audio', 'voice', 'music', 'foley'].includes(String(assetType).toLowerCase())
    ? 'audio'
    : String(assetType).toLowerCase()
  const gateNames = QUALITY_GATES_BY_MEDIA[media] || QUALITY_GATES_BY_MEDIA.video
  let weighted = 0
  let weightTotal = 0
  const failed = []
  for (const gate of gateNames) {
    const cfg = DEFAULT_QUALITY_GATES[gate]
    const value = Number(scores[gate] || 0) || 0
    weighted += value * Number(cfg.weight)
    weightTotal += Number(cfg.weight)
    if (value < Number(cfg.minimum)) failed.push(gate)
  }
  const score = weightTotal ? weighted / weightTotal : 0
  const needsRegen = failed.length > 0 || score < READY_MIN_SCORE
  let decision = 'candidate_ready_for_review'
  if (attempt >= REGEN_MAX_ATTEMPTS && score >= 0.70) decision = 'needs_human_review'
  else if (needsRegen) decision = 'preflag_for_regeneration'
  return {
    score: Number(score.toFixed(4)),
    decision,
    failed_gates: failed,
    reason: decisionReason(decision, failed, score, attempt),
  }
}

function nextGenerationId(attempt) {
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  return `gen-${stamp}-${attempt}-${rand}`
}

export function recordGeneration(workspace, payload = {}) {
  const next = normalizeWorkspace(workspace)
  const attempt = Math.max(1, Number(payload.attempt) || 1)
  const assetType = asString(payload.asset_type || payload.assetType, 'video').toLowerCase()
  const scores = isPlainObject(payload.quality_scores || payload.qualityScores)
    ? (payload.quality_scores || payload.qualityScores)
    : {}
  const decision = qualityDecision(scores, { attempt, assetType })
  const generationId = asString(payload.generation_id || payload.generationId, nextGenerationId(attempt))
  if (next.generations.some((item) => item.generation_id === generationId)) {
    return { workspace: next, record: next.generations.find((item) => item.generation_id === generationId), created: false }
  }
  const record = {
    schema_version: CREATIVE_OPS_VERSION,
    generation_id: generationId,
    slug: next.slug,
    shot_slug: asString(payload.shot_slug || payload.shotSlug || payload.cardId),
    asset_type: assetType,
    workflow_family: asString(payload.workflow_family || payload.workflowFamily),
    content_pillar: asString(payload.content_pillar || payload.contentPillar),
    attempt,
    source_paths: Array.isArray(payload.source_paths || payload.sourcePaths) ? [...(payload.source_paths || payload.sourcePaths)] : [],
    output_paths: Array.isArray(payload.output_paths || payload.outputPaths) ? [...(payload.output_paths || payload.outputPaths)] : [],
    prompt: asString(payload.prompt),
    negative_prompt: asString(payload.negative_prompt || payload.negativePrompt),
    seed: payload.seed ?? null,
    model: asString(payload.model || payload.default_model),
    quality_scores: { ...scores },
    ai_evaluation: decision,
    human_status: 'unreviewed',
    created_at: nowIso(),
    metadata: isPlainObject(payload.metadata) ? { ...payload.metadata } : {},
  }
  next.generations = [...next.generations, record]
  const queueName = decision.decision === 'preflag_for_regeneration' ? 'regenerationQueue' : 'reviewQueue'
  next[queueName] = [...next[queueName], record]
  next.updatedAt = record.created_at
  return { workspace: next, record, created: true }
}

function learnFromFeedback(profile, event) {
  const next = { ...profile }
  const approved = Boolean(event.approved)
  const countKey = approved ? 'approved_count' : 'denied_count'
  const termsKey = approved ? 'approved_reason_terms' : 'denied_reason_terms'
  const pillarsKey = approved ? 'approved_pillars' : 'denied_pillars'
  next[countKey] = Number(next[countKey] || 0) + 1
  const terms = { ...(next[termsKey] || {}) }
  for (const token of tokenize(event.note)) terms[token] = Number(terms[token] || 0) + 1
  next[termsKey] = terms
  const pillar = event.content_pillar || 'uncategorized'
  const pillars = { ...(next[pillarsKey] || {}) }
  pillars[pillar] = Number(pillars[pillar] || 0) + 1
  next[pillarsKey] = pillars
  next.last_updated_at = event.created_at
  return next
}

export function recordFeedback(workspace, payload = {}) {
  const next = normalizeWorkspace(workspace)
  const generationId = asString(payload.generation_id || payload.generationId)
  if (!generationId) throw new Error('studio_creative_ops feedback needs generation_id')
  const event = {
    schema_version: CREATIVE_OPS_VERSION,
    slug: next.slug,
    generation_id: generationId,
    approved: Boolean(payload.approved),
    note: asString(payload.note),
    content_pillar: asString(payload.content_pillar || payload.contentPillar),
    created_at: nowIso(),
  }
  next.feedback = [...next.feedback, event]
  next.approvalProfile = learnFromFeedback(next.approvalProfile, event)
  next.generations = next.generations.map((item) => (
    item.generation_id === generationId
      ? { ...item, human_status: event.approved ? 'approved' : 'denied' }
      : item
  ))
  next.updatedAt = event.created_at
  let ready = null
  if (payload.promote_to_ready_pool || payload.promoteToReadyPool) {
    const promoted = promoteToReadyPool(next, generationId, payload.caption_pack || payload.captionPack || {})
    return { workspace: promoted.workspace, event, ready: promoted.record }
  }
  return { workspace: next, event, ready }
}

export function promoteToReadyPool(workspace, generationId, captionPack = {}) {
  const next = normalizeWorkspace(workspace)
  const id = asString(generationId)
  if (!id) throw new Error('ready-pool promotion needs generation_id')
  const existing = next.readyPool.find((item) => item.generation_id === id)
  if (existing) return { workspace: next, record: existing, created: false }
  const record = {
    schema_version: CREATIVE_OPS_VERSION,
    slug: next.slug,
    generation_id: id,
    status: 'ready',
    caption_pack: isPlainObject(captionPack) ? { ...captionPack } : {},
    human_approved_at: nowIso(),
    publish_policy: 'schedule_future_only_via_postiz_after_final_approval',
  }
  next.readyPool = [...next.readyPool, record]
  next.updatedAt = record.human_approved_at
  return { workspace: next, record, created: true }
}

export function linkSource(workspace, payload = {}) {
  const next = normalizeWorkspace(workspace)
  const path = asString(payload.path || payload.source_path)
  if (!path) throw new Error('source link needs path')
  const record = {
    schema_version: CREATIVE_OPS_VERSION,
    slug: next.slug,
    kind: asString(payload.kind, 'import'),
    path,
    note: asString(payload.note),
    created_at: nowIso(),
  }
  const dup = next.sourceLinks.some((item) => item.path === path && item.kind === record.kind)
  if (dup) return { workspace: next, record: next.sourceLinks.find((item) => item.path === path), created: false }
  next.sourceLinks = [...next.sourceLinks, record]
  next.updatedAt = record.created_at
  return { workspace: next, record, created: true }
}

export function summarize(workspace) {
  const next = normalizeWorkspace(workspace)
  const pillars = next.approvalProfile.approved_pillars || {}
  const lastEvent = [...next.generations, ...next.feedback]
    .map((item) => item.created_at || '')
    .reduce((max, value) => (value > max ? value : max), '')
  return {
    slug: next.slug,
    workspace: next.diskRoot,
    project_type: next.projectType,
    ready_count: next.readyPool.length,
    review_count: next.reviewQueue.length,
    regen_count: next.regenerationQueue.length,
    generation_count: next.generations.length,
    approval_count: Number(next.approvalProfile.approved_count || 0),
    denial_count: Number(next.approvalProfile.denied_count || 0),
    preferred_pillars: Object.keys(pillars).slice(0, 5),
    last_event_at: lastEvent,
    has_workspace: true,
    append_only: true,
    outward: LEDGER_POLICY.outward,
    gpu_serial: LEDGER_POLICY.gpuSerial,
  }
}

export function fullState(workspace) {
  const next = normalizeWorkspace(workspace)
  return {
    manifest: {
      schema_version: next.schemaVersion,
      slug: next.slug,
      title: next.title,
      project_type: next.projectType,
      brand: next.brand,
      entity_id: next.entityId,
      site_url: next.siteUrl,
      project_dir: next.projectDir,
      disk_root: next.diskRoot,
      created_at: next.createdAt,
      updated_at: next.updatedAt,
      rules: next.rules,
      quality_gates: next.qualityGates,
      ready_min_score: next.readyMinScore,
      regen_max_attempts: next.regenMaxAttempts,
      content_pillars: next.contentPillars,
      target_platforms: next.targetPlatforms,
      workflow_families: next.workflowFamilies,
    },
    summary: summarize(next),
    approval_profile: next.approvalProfile,
    generations: next.generations.slice(-50),
    feedback: next.feedback.slice(-50),
    ready_pool: next.readyPool,
    review_queue: next.reviewQueue,
    regeneration_queue: next.regenerationQueue,
    source_links: next.sourceLinks,
  }
}

export function modelsFromWorkspace(workspace) {
  const next = normalizeWorkspace(workspace)
  const models = []
  for (const record of next.generations) {
    const model = asString(record.model || record.metadata?.model)
    if (model && !models.includes(model)) models.push(model)
  }
  return models
}

export function productionFromWorkspace(workspace, extras = {}) {
  const next = normalizeWorkspace(workspace)
  const models = modelsFromWorkspace(next)
  if (!models.length && extras.defaultModel) models.push(String(extras.defaultModel))
  const qaScores = next.generations
    .map((item) => item.ai_evaluation?.score)
    .filter((score) => typeof score === 'number')
  const avgQa = qaScores.length
    ? Number((qaScores.reduce((sum, score) => sum + score, 0) / qaScores.length).toFixed(4))
    : null
  return {
    id: extras.id || next.slug,
    name: next.title || next.slug,
    slug: next.slug,
    entity_id: next.entityId,
    entity_name: next.entityName,
    entity_type: next.entityType || 'business',
    clip_count: next.generations.length,
    avg_qa: avgQa,
    models,
    core_project_id: extras.coreProjectId ?? extras.core_project_id ?? null,
    ready_count: next.readyPool.length,
    review_count: next.reviewQueue.length,
    regen_count: next.regenerationQueue.length,
  }
}
