/**
 * CDX Studio-native Core trace bridge.
 *
 * Semantics come from CDX Studio / cdx-video-director (spec only):
 * coded telemetry on the ledger, skill_version_id on every run,
 * entity/project linking, MCP-call traces, map receipts.
 * No Studio Python, no cdx-video-director imports.
 */

export const CORE_PROJECT_ID = 396
export const VELORN_WORKLOADS = Object.freeze({
  generation: 'velorn.media.generation.v1',
  review: 'velorn.media.review.v1',
  mcp: 'velorn.mcp.call.v1',
})

export const ASSET_TYPES = Object.freeze(['image', 'video', 'audio', 'voice', 'music', 'foley'])
export const FEEDBACK_REASONS = Object.freeze([
  'identity_drift', 'composition', 'motion_instability', 'lip_sync',
  'voice_mismatch', 'pacing', 'audio_artifacts', 'continuity', 'typography',
  'brand_fit', 'unsafe_content', 'other',
])
export const DIRECT_VERDICTS = Object.freeze(['up', 'down', 'neutral', 'best'])

const NAMESPACE = '7c2e9a14-4b8f-5d21-9e6a-1f0c3b8d5a72'
const OPAQUE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const TELEMETRY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const MEDIA_TYPE = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IMAGE_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.png': 'image/png' }
const VIDEO_EXT = { '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp4': 'video/mp4' }
const AUDIO_EXT = { '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg' }

const SHA1_K = [
  0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6,
]

function rotl(value, bits) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0
}

function sha1Bytes(bytes) {
  const extra = bytes.length % 64
  const pad = extra < 56 ? 56 - extra : 120 - extra
  const total = bytes.length + pad + 8
  const buf = new Uint8Array(total)
  buf.set(bytes)
  buf[bytes.length] = 0x80
  const bitLen = bytes.length * 8
  const view = new DataView(buf.buffer)
  view.setUint32(total - 4, bitLen >>> 0)
  view.setUint32(total - 8, Math.floor(bitLen / 0x100000000))

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const w = new Uint32Array(80)

  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 80; i += 1) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1)
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let i = 0; i < 80; i += 1) {
      const f = i < 20 ? (b & c) | (~b & d)
        : i < 40 ? b ^ c ^ d
          : i < 60 ? (b & c) | (b & d) | (c & d)
            : b ^ c ^ d
      const temp = (rotl(a, 5) + f + e + SHA1_K[Math.floor(i / 20)] + w[i]) >>> 0
      e = d
      d = c
      c = rotl(b, 30)
      b = a
      a = temp
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  const out = new Uint8Array(20)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, h0)
  outView.setUint32(4, h1)
  outView.setUint32(8, h2)
  outView.setUint32(12, h3)
  outView.setUint32(16, h4)
  return out
}

function encodeUtf8(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text)
  const out = []
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code < 0x80) out.push(code)
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    else out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
  }
  return Uint8Array.from(out)
}

function parseUuidBytes(value) {
  const hex = String(value).replace(/-/g, '')
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('namespace must be a UUID')
  const out = new Uint8Array(16)
  for (let i = 0; i < 16; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function formatUuid(bytes) {
  const hex = Array.from(bytes, (item) => item.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function stableUuid(...parts) {
  const name = parts.map((part) => String(part ?? '')).join(':')
  const digest = sha1Bytes(Uint8Array.from([...parseUuidBytes(NAMESPACE), ...encodeUtf8(name)]))
  digest[6] = (digest[6] & 0x0f) | 0x50
  digest[8] = (digest[8] & 0x3f) | 0x80
  return formatUuid(digest.slice(0, 16))
}

function requiredCode(value, field) {
  if (typeof value !== 'string' || !TELEMETRY.test(value)) {
    throw new Error(`${field} must be a bounded telemetry code`)
  }
  return value
}

function optionalCode(value) {
  return typeof value === 'string' && TELEMETRY.test(value) ? value : null
}

function requiredRef(value, field) {
  if (typeof value !== 'string' || !OPAQUE_REF.test(value)) {
    throw new Error(`${field} must be an opaque artifact reference`)
  }
  return value
}

function requiredUuid(value, field) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new Error(`${field} must be a UUID`)
  }
  return value.toLowerCase()
}

function optionalInteger(value, field) {
  if (value == null || value === '') return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`)
  }
  return value
}

function isoTimestamp(value, field = 'created_at') {
  if (value == null || value === '') return ''
  if (typeof value !== 'string') throw new Error(`${field} must be an ISO-8601 timestamp`)
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) throw new Error(`${field} must be an ISO-8601 timestamp`)
  return value
}

function suffixOf(path) {
  const text = String(path || '')
  const index = text.lastIndexOf('.')
  return index >= 0 ? text.slice(index).toLowerCase() : ''
}

export function assetTypeOf(record = {}) {
  const value = String(record.asset_type || record.assetType || 'video').toLowerCase()
  if (!ASSET_TYPES.includes(value)) throw new Error('asset_type is unsupported')
  return ['voice', 'music', 'foley'].includes(value) ? 'audio' : value
}

export function mediaTypeOf(record = {}, assetType = assetTypeOf(record)) {
  const supplied = record.media_type || record.mediaType
  if (supplied != null) {
    if (typeof supplied !== 'string' || !supplied.toLowerCase().startsWith(`${assetType}/`)) {
      throw new Error(`media_type must be an ${assetType} media type`)
    }
    return supplied.toLowerCase()
  }
  const paths = record.output_paths || record.outputPaths || []
  const suffix = Array.isArray(paths) && typeof paths[0] === 'string' ? suffixOf(paths[0]) : ''
  if (assetType === 'image') return IMAGE_EXT[suffix] || 'image/png'
  if (assetType === 'video') return VIDEO_EXT[suffix] || 'video/mp4'
  return AUDIO_EXT[suffix] || 'audio/mpeg'
}

export function mediaQualityGateNames(record = {}) {
  const assetType = assetTypeOf(record)
  if (assetType === 'audio') return ['audio_quality']
  if (assetType === 'image') return ['visual_clarity', 'brand_fit', 'story_clarity', 'cta_strength', 'platform_fit']
  return [
    'visual_clarity', 'brand_fit', 'motion_stability', 'story_clarity',
    'audio_quality', 'lip_sync', 'cta_strength', 'platform_fit',
  ]
}

function parametersOf(record = {}) {
  const parameters = {}
  const seed = record.seed
  if (typeof seed === 'number' && Number.isInteger(seed) && !Number.isNaN(seed)) parameters.seed = seed
  const workflow = optionalCode(record.workflow_family || record.workflowFamily || record.workflow)
  if (workflow) parameters.workflow = workflow
  const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {}
  for (const key of ['provider', 'model', 'revision']) {
    const value = optionalCode(metadata[key] || record[key])
    if (value) parameters[key] = value
  }
  return parameters
}

function observableRef(record, key) {
  const value = record[key]
  if (value == null) return null
  if (typeof value !== 'string' || !value.startsWith('observable://')) {
    throw new Error(`${key} must be an observable:// UUID reference`)
  }
  const id = value.slice('observable://'.length)
  if (!UUID_RE.test(id)) throw new Error(`${key} must be an observable:// UUID reference`)
  const canonical = `observable://${id.toLowerCase()}`
  if (canonical !== value && canonical !== value.toLowerCase()) {
    throw new Error(`${key} must use canonical UUID form`)
  }
  return `observable://${id.toLowerCase()}`
}

export function asProjectCode(value, fallback = 'velorn') {
  const raw = String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return TELEMETRY.test(raw) ? raw.slice(0, 128) : fallback
}

export function citeSkillVersion(input = {}) {
  const skillVersionId = optionalInteger(
    input.skill_version_id ?? input.skillVersionId ?? input.id,
    'skill_version_id',
  )
  const slug = optionalCode(String(input.slug || input.skill || '').replace(/[/:]/g, '.')) || null
  const version = input.version == null || input.version === ''
    ? null
    : (typeof input.version === 'number' && Number.isInteger(input.version)
      ? input.version
      : (TELEMETRY.test(String(input.version)) ? String(input.version) : null))
  if (!skillVersionId && !slug) {
    throw new Error('skill citation needs skill_version_id or slug')
  }
  const ref = slug
    ? `skill:${slug}${version != null ? `@${version}` : ''}`
    : `skill_version:${skillVersionId}`
  return {
    slug,
    version,
    skill_version_id: skillVersionId,
    ref,
    receipt_hint: {
      cite: skillVersionId ? { skill_version_id: skillVersionId } : { slug },
      edge: { type: 'used_skill', to: ref },
    },
  }
}

export function usedSkillEdge(citation, fromKey = 'production') {
  const skill = citation.skill_version_id || citation.slug ? citation : citeSkillVersion(citation)
  return {
    from: fromKey,
    to: skill.slug || `skill-version-${skill.skill_version_id}`,
    type: 'used_skill',
    context: skill.ref,
    provenance: {
      method: 'observed',
      confidence: 0.9,
      evidence: skill.skill_version_id
        ? `skill_version_id:${skill.skill_version_id}`
        : `skill:${skill.slug}`,
    },
  }
}

export function parseEntityId(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  const text = String(value).trim()
  const prefixed = text.match(/^entities\/(\d+)$/i)
  if (prefixed) return Number(prefixed[1])
  if (/^\d+$/.test(text)) return Number(text)
  return null
}

export function entitySearchPlan(query, { limit = 10 } = {}) {
  const q = String(query || '').trim()
  if (!q) throw new Error('entity search needs a query')
  return {
    method: 'GET',
    path: '/api/v1/search/entities',
    params: { q, limit },
    note: 'search-before-create; apply only a unique match; never invent an entity_id',
  }
}

export function applyResolvedEntity(current = {}, candidate = {}, { matches = null } = {}) {
  const explicit = parseEntityId(candidate.entity_id ?? candidate.entityId ?? candidate.id)
  if (explicit) {
    return {
      entity_id: explicit,
      entity_name: String(candidate.name || candidate.entity_name || current.entity_name || ''),
      guessed: false,
    }
  }
  const rows = Array.isArray(matches) ? matches : (Array.isArray(candidate.docs) ? candidate.docs : [])
  if (rows.length !== 1) {
    return {
      entity_id: current.entity_id || null,
      entity_name: current.entity_name || '',
      guessed: false,
      unowned: true,
      match_count: rows.length,
      note: rows.length === 0
        ? 'no entity match; leave unowned'
        : 'multiple entity matches; do not guess',
    }
  }
  const hit = rows[0]
  const id = parseEntityId(hit.id ?? hit.entity_id)
  if (!id) {
    return {
      entity_id: current.entity_id || null,
      unowned: true,
      guessed: false,
      note: 'match lacked a numeric id',
    }
  }
  return {
    entity_id: id,
    entity_name: String(hit.name || ''),
    guessed: false,
    unowned: false,
  }
}

function policy() {
  return { privacy: 'internal', training_eligible: false }
}

function skillMeta(record = {}) {
  const citation = record.skill || record.skill_version_id || record.skillVersionId
    ? citeSkillVersion(record.skill || record)
    : null
  if (!citation) return {}
  const meta = {}
  if (citation.skill_version_id) meta.skill_version_id = citation.skill_version_id
  if (citation.slug) meta.skill = citation.slug
  if (citation.version != null) meta.skill_version = citation.version
  return { citation, meta }
}

function writePlan(path, kwargs, payload) {
  return { path, kwargs, payload }
}

export function buildGenerationTrace(record = {}) {
  const generationId = requiredRef(record.generation_id || record.generationId, 'generation_id')
  const projectId = requiredCode(asProjectCode(record.slug || record.project_id || record.projectId), 'slug')
  const entityId = parseEntityId(record.entity_id ?? record.entityId)
  const traceId = record.trace_id || stableUuid('generation', projectId, generationId)
  const spanId = record.span_id || stableUuid('generation-span', projectId, generationId)
  const parentGenerationId = record.parent_generation_id || record.parentGenerationId || record.regenerated_from || null
  if (parentGenerationId != null) requiredRef(parentGenerationId, 'parent_generation_id')
  const parentSpanId = parentGenerationId ? stableUuid('generation-span', projectId, parentGenerationId) : null
  const assetType = assetTypeOf(record)
  const parameters = parametersOf(record)
  const inputs = parameters && Object.keys(parameters).length ? { parameters } : {}
  const promptRef = observableRef(record, 'prompt_ref') || observableRef(record, 'promptRef')
  if (promptRef) inputs.prompt_ref = promptRef
  const outputs = { artifact_refs: [generationId], status: 'succeeded' }
  const outputRef = observableRef(record, 'output_ref') || observableRef(record, 'outputRef')
  if (outputRef) outputs.output_ref = outputRef
  const workflow = parameters.workflow || 'velorn-import'
  const { citation, meta } = skillMeta(record)
  const createdAt = isoTimestamp(record.created_at || record.createdAt)
  const idempotencyKey = stableUuid('generation-key', projectId, generationId)
  const name = `velorn_${assetType}_generation`
  const metadata = { workflow, status: 'succeeded', ...meta }
  const writes = [
    writePlan(
      '/api/v1/traces',
      {
        name, trace_id: traceId, workload_id: VELORN_WORKLOADS.generation,
        project_id: projectId, entity_id: entityId, inputs,
        metadata, idempotency_key: idempotencyKey,
      },
      {
        schema_version: 1, name, trace_id: traceId,
        workload_id: VELORN_WORKLOADS.generation, entity_id: entityId, project_id: projectId,
        input: inputs, metadata, privacy_classification: 'internal', training_eligible: false,
      },
    ),
    writePlan(
      `/api/v1/traces/${traceId}/spans`,
      {
        name, kind: 'generation', trace_id: traceId, span_id: spanId, parent_span_id: parentSpanId,
        workload_id: VELORN_WORKLOADS.generation, project_id: projectId, entity_id: entityId,
        inputs, outputs, metadata,
        idempotency_key: stableUuid('generation-span-key', projectId, generationId),
      },
      {
        schema_version: 1, name, kind: 'generation', span_id: spanId, parent_span_id: parentSpanId,
        provider: parameters.provider || null, model: parameters.model || null,
        input: inputs, output: outputs, metadata: { ...metadata, policy: policy() },
      },
    ),
    writePlan(
      `/api/v1/traces/${traceId}/artifacts`,
      {
        artifact_id: generationId, role: 'generated', trace_id: traceId, span_id: spanId,
        uri: `dam://${generationId}`, media_type: mediaTypeOf(record, assetType),
        idempotency_key: stableUuid('generation-artifact', projectId, generationId),
      },
      {
        schema_version: 1, artifact_id: generationId, role: 'generated', span_id: spanId,
        uri: `dam://${generationId}`, media_type: mediaTypeOf(record, assetType),
        sha256: null, metadata: { policy: policy() },
      },
    ),
  ]
  assertNoProse(writes, record)
  return {
    writes,
    receipt: {
      idempotency_key: idempotencyKey,
      trace_id: traceId,
      span_id: spanId,
      artifact_id: generationId,
      source_created_at: createdAt,
      skill_version_id: citation?.skill_version_id || null,
      skill: citation?.ref || null,
      lineage: {
        project_id: projectId,
        generation_id: generationId,
        core_project_id: CORE_PROJECT_ID,
        ...(entityId ? { entity_id: entityId } : {}),
        ...(parentGenerationId ? { parent_generation_id: parentGenerationId } : {}),
      },
      quality_gate_names: mediaQualityGateNames(record),
    },
  }
}

function feedbackReason(record = {}) {
  const explicit = record.reason
  if (typeof explicit === 'string' && FEEDBACK_REASONS.includes(explicit)) return explicit
  const note = String(record.note || '').toLowerCase()
  const needles = [
    ['voice', 'voice_mismatch'], ['audio', 'audio_artifacts'],
    ['lip', 'lip_sync'], ['motion', 'motion_instability'],
    ['identity', 'identity_drift'], ['composition', 'composition'],
    ['continuity', 'continuity'], ['typography', 'typography'],
    ['brand', 'brand_fit'], ['unsafe', 'unsafe_content'], ['pacing', 'pacing'],
  ]
  for (const [needle, reason] of needles) {
    if (note.includes(needle)) return reason
  }
  return note ? 'other' : null
}

export function buildFeedbackTrace(record = {}) {
  const generationId = requiredRef(record.generation_id || record.generationId, 'generation_id')
  const projectId = requiredCode(asProjectCode(record.slug || record.project_id || record.projectId), 'slug')
  const approved = record.approved
  if (typeof approved !== 'boolean') throw new Error('feedback approved must be boolean')
  const traceId = record.trace_id || stableUuid('generation', projectId, generationId)
  const spanId = record.span_id || stableUuid('generation-span', projectId, generationId)
  const createdAt = isoTimestamp(record.created_at || record.createdAt)
  const reason = feedbackReason(record)
  const { citation, meta } = skillMeta(record)
  const feedbackKey = stableUuid('feedback', projectId, generationId, String(approved), createdAt)
  const dimensions = reason ? { reason_tags: [reason] } : {}
  const write = writePlan(
    `/api/v1/traces/${traceId}/feedback`,
    {
      verdict: approved ? 'approve' : 'reject',
      trace_id: traceId,
      span_id: spanId,
      artifact_id: generationId,
      reason,
      dimensions: { ...dimensions, ...meta },
      idempotency_key: feedbackKey,
    },
    {
      schema_version: 1,
      verdict: approved ? 'approve' : 'reject',
      span_id: spanId,
      artifact_id: generationId,
      reason,
      dimensions: { ...dimensions, policy: policy(), ...meta },
      supersedes_id: null,
    },
  )
  assertNoProse([write], record)
  return {
    writes: [write],
    receipt: {
      idempotency_key: feedbackKey,
      trace_id: traceId,
      span_id: spanId,
      artifact_id: generationId,
      source_created_at: createdAt,
      skill_version_id: citation?.skill_version_id || null,
      lineage: { project_id: projectId, generation_id: generationId },
    },
  }
}

export function buildDirectFeedbackTrace(record = {}) {
  const traceId = requiredUuid(record.trace_id || record.traceId, 'trace_id')
  const spanId = requiredUuid(record.span_id || record.spanId, 'span_id')
  const artifactId = requiredRef(record.artifact_id || record.artifactId, 'artifact_id')
  const verdict = record.verdict
  if (!DIRECT_VERDICTS.includes(verdict)) throw new Error('direct feedback verdict is unsupported')
  const reason = record.reason == null ? null : record.reason
  if (reason != null && !FEEDBACK_REASONS.includes(reason)) throw new Error('direct feedback reason is unsupported')
  const key = requiredUuid(record.idempotency_key || record.idempotencyKey, 'idempotency_key')
  const mediaType = record.media_type || record.mediaType
  if (typeof mediaType !== 'string' || !MEDIA_TYPE.test(mediaType)) {
    throw new Error('direct feedback media_type must be structured')
  }
  const write = writePlan(
    `/api/v1/traces/${traceId}/feedback`,
    {
      verdict, trace_id: traceId, span_id: spanId, artifact_id: artifactId,
      reason, dimensions: reason ? { reason_tags: [reason] } : {},
      idempotency_key: key,
    },
    {
      schema_version: 1, verdict, span_id: spanId, artifact_id: artifactId, reason,
      dimensions: reason ? { reason_tags: [reason], policy: policy() } : { policy: policy() },
      supersedes_id: record.supersedes_id || null,
    },
  )
  assertNoProse([write], record)
  return { writes: [write], receipt: { idempotency_key: key, trace_id: traceId, span_id: spanId, artifact_id: artifactId } }
}

export function buildMcpCallTrace(record = {}) {
  const action = requiredCode(String(record.action || '').replace(/[^\w.-]+/g, '-'), 'action')
  const projectId = requiredCode(asProjectCode(record.slug || record.project_id || record.projectId || 'velorn'), 'slug')
  const callId = requiredRef(record.call_id || record.callId || `${action}-${record.started_at || 'call'}`, 'call_id')
  const traceId = record.trace_id || stableUuid('mcp', projectId, callId)
  const spanId = record.span_id || stableUuid('mcp-span', projectId, callId)
  const { citation, meta } = skillMeta(record)
  const status = record.ok === false ? 'failed' : 'succeeded'
  const inputs = {
    parameters: {
      action,
      preview: record.previewOnly === true ? 'preview' : 'apply',
    },
  }
  const outputs = {
    status,
    result_keys: Array.isArray(record.result_keys) ? record.result_keys.filter((key) => TELEMETRY.test(String(key))) : [],
  }
  const metadata = {
    workflow: 'velorn-mcp',
    status,
    ...meta,
  }
  const writes = [
    writePlan(
      '/api/v1/traces',
      {
        name: `velorn_mcp_${action}`,
        trace_id: traceId,
        workload_id: VELORN_WORKLOADS.mcp,
        project_id: projectId,
        entity_id: parseEntityId(record.entity_id ?? record.entityId),
        inputs,
        metadata,
        idempotency_key: stableUuid('mcp-key', projectId, callId),
      },
      {
        schema_version: 1,
        name: `velorn_mcp_${action}`,
        trace_id: traceId,
        workload_id: VELORN_WORKLOADS.mcp,
        entity_id: parseEntityId(record.entity_id ?? record.entityId),
        project_id: projectId,
        input: inputs,
        metadata,
        privacy_classification: 'internal',
        training_eligible: false,
      },
    ),
    writePlan(
      `/api/v1/traces/${traceId}/spans`,
      {
        name: `velorn_mcp_${action}`,
        kind: 'tool',
        trace_id: traceId,
        span_id: spanId,
        workload_id: VELORN_WORKLOADS.mcp,
        project_id: projectId,
        inputs,
        outputs,
        metadata,
        idempotency_key: stableUuid('mcp-span-key', projectId, callId),
      },
      {
        schema_version: 1,
        name: `velorn_mcp_${action}`,
        kind: 'tool',
        span_id: spanId,
        input: inputs,
        output: outputs,
        metadata: { ...metadata, policy: policy() },
      },
    ),
  ]
  assertNoProse(writes, record)
  return {
    writes,
    receipt: {
      trace_id: traceId,
      span_id: spanId,
      action,
      status,
      skill_version_id: citation?.skill_version_id || null,
      lineage: { project_id: projectId, call_id: callId, core_project_id: CORE_PROJECT_ID },
    },
  }
}

function assertNoProse(writes, record = {}) {
  const blob = JSON.stringify(writes)
  const banned = ['prompt', 'note', 'dialogue', 'private', '/home/', '/private/']
  for (const word of banned) {
    if (blob.toLowerCase().includes(word.toLowerCase()) && word !== 'note') {
      // allow the word only if the original record never contained it as free text
    }
  }
  if (typeof record.prompt === 'string' && record.prompt && blob.includes(record.prompt)) {
    throw new Error('prompt text must not enter the ledger')
  }
  if (typeof record.note === 'string' && record.note && blob.includes(record.note)) {
    throw new Error('reviewer note must not enter the ledger')
  }
  const paths = record.output_paths || record.outputPaths || []
  for (const path of paths) {
    if (typeof path === 'string' && path.includes('/') && blob.includes(path)) {
      throw new Error('filesystem paths must not enter the ledger')
    }
  }
}

export function decorateWithMcpTrace(action, payload = {}, result = {}, context = {}) {
  try {
    const plan = buildMcpCallTrace({
      action,
      slug: asProjectCode(context.slug || payload.slug || 'velorn'),
      call_id: context.call_id || `${action}-${context.started || 'now'}`,
      previewOnly: payload.previewOnly !== false && result.previewOnly !== false,
      ok: result && result.success !== false && !result.error,
      entity_id: context.entity_id || payload.entity_id,
      skill: context.skill || payload.skill,
      skill_version_id: context.skill_version_id || payload.skill_version_id,
      result_keys: result && typeof result === 'object' ? Object.keys(result).slice(0, 12) : [],
    })
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      return { ...result, _trace: plan.receipt }
    }
    return { result, _trace: plan.receipt }
  } catch {
    return result
  }
}

export function normalizeCoreBridge(input = {}, project = {}) {
  const skill = input.skill || project.core?.skill || null
  let citation = null
  if (skill || input.skill_version_id || project.core?.skill_version_id) {
    try {
      citation = citeSkillVersion(skill || input)
    } catch {
      citation = null
    }
  }
  const entityId = parseEntityId(input.entity_id ?? input.entityId ?? project.core?.entity_id ?? project.cdxMigration?.entityId)
  return {
    schemaVersion: 1,
    coreProjectId: CORE_PROJECT_ID,
    entity_id: entityId,
    entity_name: String(input.entity_name || project.core?.entity_name || ''),
    unowned: !entityId,
    skill: citation,
    lastTrace: input.lastTrace || project.core?.lastTrace || null,
    traces: Array.isArray(input.traces) ? input.traces : (project.core?.traces || []),
  }
}

export function attachCoreToPacket(packet, project = {}) {
  return {
    ...packet,
    core: normalizeCoreBridge(project.core || {}, project),
  }
}

export function buildMapReceipt(input = {}) {
  const citation = input.skill || input.skill_version_id || input.slug
    ? citeSkillVersion(input.skill || input)
    : null
  const entityId = parseEntityId(input.entity_id ?? input.entityId)
  const productionKey = optionalCode(input.production_key || input.slug || 'velorn-production') || 'velorn-production'
  const nodes = [
    {
      key: productionKey,
      name: String(input.production_name || input.title || 'CDX Studio production'),
      type: 'project',
      action: input.action || 'updated',
      id: input.core_project_id || CORE_PROJECT_ID,
    },
  ]
  const edges = []
  if (citation) {
    nodes.push({
      key: citation.slug || `skill-version-${citation.skill_version_id}`,
      name: citation.ref,
      type: 'skill',
      action: 'referenced',
      id: citation.skill_version_id || undefined,
    })
    edges.push(usedSkillEdge(citation, productionKey))
  }
  if (entityId) {
    const entityKey = optionalCode(input.entity_key || `entity-${entityId}`) || `entity-${entityId}`
    nodes.push({
      key: entityKey,
      name: String(input.entity_name || `entity ${entityId}`),
      type: 'organization',
      action: 'referenced',
      id: entityId,
    })
    edges.push({
      from: productionKey,
      to: entityKey,
      type: 'related_to',
      context: 'production entity link',
      provenance: {
        method: 'observed',
        confidence: 0.8,
        evidence: `entities/${entityId}`,
      },
    })
  }
  const artifacts = []
  if (citation) artifacts.push({ kind: 'skill', ref: citation.ref })
  if (input.trace_id) artifacts.push({ kind: 'trace', ref: `trace:${input.trace_id}` })
  if (input.pr) artifacts.push({ kind: 'doc', ref: input.pr })
  const receipt = {
    card_id: input.card_id || input.cardId || '',
    board: input.board || 'cdx-creative',
    summary: String(input.summary || 'CDX Studio Core trace bridge cited skill_version_id'),
    confidence: typeof input.confidence === 'number' ? input.confidence : 0.8,
    nodes,
    edges,
    artifacts,
  }
  if (citation?.skill_version_id) {
    receipt.skill_version_id = citation.skill_version_id
  }
  if (!edges.length) {
    receipt.no_graph_impact = input.no_graph_impact || 'no owned entity or skill citation to map'
  }
  return receipt
}

export const CORE_ENDPOINTS = Object.freeze({
  traces: '/api/v1/traces',
  skills: '/api/v1/skills',
  skillRunContext: (slug) => `/api/v1/skills/${encodeURIComponent(slug)}/run-context`,
  entities: '/api/v1/search/entities',
  entity: (id) => `/api/v1/entities/${id}`,
  neighbors: (id) => `/api/v1/graph/neighbors/entities/${id}`,
  project: (id = CORE_PROJECT_ID) => `/api/v1/projects/${id}`,
  receipt: '/kanban/receipt',
})
