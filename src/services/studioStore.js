/**
 * Studio data model — the canonical in-app shape of the `studio` block in
 * project.comfystudio, ported from CDX Studio (cdx-video-director/app/studio).
 *
 * Semantics mirrored from the Python sources (NOT their implementation):
 *
 * - storyboard_slots.py: a slot is a beat the script needs, whether or not a
 *   frame exists for it. An empty slot is a PLACEHOLDER — a visible hole, not
 *   a silent absence. Slots carry EDL/cut order plus the production metadata
 *   (action, audio, dur_s, lane, board_shot). Slot state is DERIVED from its
 *   assigned approved frames, never stored. Approving assigns an asset to the
 *   slot; the pool copy is never moved or silently promoted here.
 * - qa_verdicts.py + evaluation_rubrics.py: per-shot QA with separate video
 *   and audio tracks, plus optional MediaRubric evaluations. `unverified` is
 *   the default and is NOT a pass. A `fail` REQUIRES a reason. Overall = fail
 *   if either track fails, pass only if both pass. Rubric technical failures
 *   always win; incomplete evaluators route to human_review.
 * - cast_resolver.py: cast hierarchy series → season → episode, merged
 *   field-by-field by cast_id (an episode override of `outfit` keeps the
 *   series `ref_set`). Reserved keys (locations/settings/meta/characters)
 *   are never characters. Every resolved member carries scope, defined_in,
 *   overridden_in, overrides. Episode guests never leak into other episodes
 *   because resolution always starts from the series tier.
 *
 * Everything here is pure and Electron-free so it runs under `node --test`.
 * All mutating functions take a studio block and return a NEW one; the input
 * is never modified.
 */

import { evaluateCandidate, dispositionToQaResult, reasonFromEvaluation } from './evaluationRubrics.js'
import { buildQaGraph } from './qaGraph.js'

export const STUDIO_VERSION = 1

export const QA_TRACKS = Object.freeze(['video', 'audio'])
export const QA_RESULTS = Object.freeze(['pass', 'fail', 'unverified'])
export const RUBRIC_DISPOSITIONS = Object.freeze([
  'technical_fail',
  'automated_fail',
  'automated_pass',
  'human_review',
])

// Top-level cast-file keys that are NOT characters (mirrors cast_resolver).
export const CAST_RESERVED_KEYS = Object.freeze(['locations', 'settings', 'meta', 'characters'])

export const SLOT_WHICH = Object.freeze(['first', 'last'])

// Stage rail order for flowView(). Gates are derived in flowView() below.
export const FLOW_STAGES = Object.freeze([
  'script', 'cast', 'scenes', 'storyboard', 'flf', 'video', 'review', 'edit', 'deliver',
])

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

const asString = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback
  return String(value)
}

const asNumberOrNull = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const nowIso = () => new Date().toISOString()

/** An empty, valid studio block. */
export function emptyStudio() {
  return {
    version: STUDIO_VERSION,
    cast: { series: {}, seasons: {}, episodes: {} },
    slots: [],
    qa: {},
    qaGraph: { source: 'app_graph:velorn-qa', nodes: [], edges: [], stats: { shots: 0, nodes: 0, edges: 0 } },
    edls: [],
    blockingIndex: [],
    locations: {},
  }
}

// ── normalization (tolerant reads — corrupt/missing input degrades to empty,
//    it never throws) ────────────────────────────────────────────────────────

function normalizeCastTier(raw) {
  if (!isPlainObject(raw)) return {}
  const out = {}
  // characters-list form: each item carries cast_id/id.
  const chars = raw.characters
  if (Array.isArray(chars)) {
    for (const item of chars) {
      if (!isPlainObject(item)) continue
      const cid = item.cast_id || item.id
      if (!cid) continue
      const fields = { ...item }
      delete fields.cast_id
      delete fields.id
      out[asString(cid)] = fields
    }
  }
  // mapping form keyed by cast_id (reserved keys skipped).
  for (const [key, body] of Object.entries(raw)) {
    if (CAST_RESERVED_KEYS.includes(key) || !isPlainObject(body)) continue
    if (!(key in out)) out[key] = { ...body }
  }
  return out
}

function normalizeCast(raw) {
  const cast = isPlainObject(raw) ? raw : {}
  const seasons = {}
  if (isPlainObject(cast.seasons)) {
    for (const [name, tier] of Object.entries(cast.seasons)) {
      const norm = normalizeSeason(name)
      if (norm) seasons[norm] = normalizeCastTier(tier)
    }
  }
  const episodes = {}
  if (isPlainObject(cast.episodes)) {
    for (const [name, tier] of Object.entries(cast.episodes)) {
      if (name) episodes[asString(name)] = normalizeCastTier(tier)
    }
  }
  return {
    series: normalizeCastTier(cast.series),
    seasons,
    episodes,
  }
}

function normalizeSlot(raw, index) {
  const slot = isPlainObject(raw) ? raw : {}
  const assigned = isPlainObject(slot.assigned) ? slot.assigned : {}
  return {
    slot_id: asString(slot.slot_id, `slot-${index + 1}`),
    order: asNumberOrNull(slot.order) ?? index + 1,
    action: asString(slot.action),
    audio: asString(slot.audio),
    dur_s: asNumberOrNull(slot.dur_s),
    lane: asString(slot.lane),
    board_shot: slot.board_shot === null || slot.board_shot === undefined ? null : asString(slot.board_shot),
    assigned: {
      first: assigned.first ? asString(assigned.first) : null,
      last: assigned.last ? asString(assigned.last) : null,
    },
    notes: asString(slot.notes),
    source: asString(slot.source, 'manual'),
    created: asString(slot.created, ''),
    ...(slot.orphaned ? { orphaned: true } : {}),
    ...(slot.updated ? { updated: asString(slot.updated) } : {}),
  }
}

function normalizeRubric(raw) {
  if (!isPlainObject(raw)) return null
  const disposition = RUBRIC_DISPOSITIONS.includes(raw.disposition) ? raw.disposition : null
  const mediaKind = asString(raw.mediaKind || raw.media_kind)
  const rubricVersion = asString(raw.rubricVersion || raw.rubric_version)
  if (!disposition && !rubricVersion && !mediaKind) return null
  return {
    mediaKind,
    rubricVersion,
    disposition: disposition || 'human_review',
    evaluator: isPlainObject(raw.evaluator) ? clone(raw.evaluator) : null,
    selfEvaluation: Boolean(raw.selfEvaluation || raw.self_evaluation),
    failedChecks: Array.isArray(raw.failedChecks || raw.failed_checks)
      ? (raw.failedChecks || raw.failed_checks).map(asString).filter(Boolean)
      : [],
    missingChecks: Array.isArray(raw.missingChecks || raw.missing_checks)
      ? (raw.missingChecks || raw.missing_checks).map(asString).filter(Boolean)
      : [],
    failedDimensions: Array.isArray(raw.failedDimensions || raw.failed_dimensions)
      ? (raw.failedDimensions || raw.failed_dimensions).map(asString).filter(Boolean)
      : [],
    scores: isPlainObject(raw.scores) ? clone(raw.scores) : null,
  }
}

function normalizeTrackVerdict(raw) {
  const rec = isPlainObject(raw) ? raw : {}
  const result = QA_RESULTS.includes(rec.result) ? rec.result : 'unverified'
  const rubric = normalizeRubric(rec.rubric)
  return {
    result,
    reason: asString(rec.reason),
    by: asString(rec.by),
    at: asString(rec.at),
    ...(rubric ? { rubric } : {}),
  }
}

function normalizeQaGraph(raw) {
  if (!isPlainObject(raw)) return emptyStudio().qaGraph
  const nodes = Array.isArray(raw.nodes) ? raw.nodes.filter(isPlainObject) : []
  const edges = Array.isArray(raw.edges) ? raw.edges.filter(isPlainObject) : []
  return {
    source: asString(raw.source, 'app_graph:velorn-qa'),
    nodes,
    edges,
    stats: isPlainObject(raw.stats) ? clone(raw.stats) : { shots: 0, nodes: nodes.length, edges: edges.length },
  }
}

function normalizeQa(raw) {
  if (!isPlainObject(raw)) return {}
  const out = {}
  for (const [shot, entry] of Object.entries(raw)) {
    if (!shot || !isPlainObject(entry)) continue
    out[shot] = {
      video: normalizeTrackVerdict(entry.video),
      audio: normalizeTrackVerdict(entry.audio),
    }
  }
  return out
}

/**
 * Tolerant read of any persisted studio block. Missing/corrupt input returns
 * emptyStudio(); partial input is filled in field-by-field. Never throws.
 */
export function normalizeStudio(raw) {
  const blank = emptyStudio()
  if (!isPlainObject(raw)) return blank
  const slots = (Array.isArray(raw.slots) ? raw.slots : [])
    .filter((slot) => isPlainObject(slot))
    .map((slot, i) => normalizeSlot(slot, i))
    .filter((slot) => slot.slot_id)
  slots.sort((a, b) => (a.order - b.order) || a.slot_id.localeCompare(b.slot_id))
  return {
    version: STUDIO_VERSION,
    cast: normalizeCast(raw.cast),
    slots,
    qa: normalizeQa(raw.qa),
    qaGraph: normalizeQaGraph(raw.qaGraph || raw.qa_graph),
    edls: Array.isArray(raw.edls) ? raw.edls.filter(Boolean).map(asString) : [],
    blockingIndex: Array.isArray(raw.blockingIndex) ? raw.blockingIndex.filter(Boolean).map(asString) : [],
    locations: isPlainObject(raw.locations) ? clone(raw.locations) : {},
  }
}

// ── cast ─────────────────────────────────────────────────────────────────────

/** "1" / "01" / "Season 1" / "season-01" → "season-01". Null when blank. */
export function normalizeSeason(season) {
  if (season === null || season === undefined || season === '') return null
  const m = String(season).match(/\d+/)
  if (!m) return null
  return `season-${String(parseInt(m[0], 10)).padStart(2, '0')}`
}

function displayNameFor(castId, fields) {
  const raw = fields.display_name || fields.name
  if (raw) return asString(raw).trim()
  return castId.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

const fieldChanged = (a, b) => JSON.stringify(a) !== JSON.stringify(b)

/**
 * The effective cast for an episode: series → season → episode, merged
 * field-by-field by cast_id. A later tier overrides individual FIELDS of an
 * earlier record without restating the rest, and may introduce new members —
 * those get scope 'episode' and never leak into other episodes because
 * resolution always starts from the series tier.
 *
 * defined_in / overridden_in name the originating tier ('series',
 * 'season-01', 'ep001') — the in-app analog of CDX's per-tier yaml paths.
 */
export function resolveCast(studio, { episode = null, season = null } = {}) {
  const norm = normalizeStudio(studio)
  const tiers = [['series', 'series', norm.cast.series]]
  const seasonName = normalizeSeason(season)
  if (seasonName && norm.cast.seasons[seasonName]) {
    tiers.push([seasonName, 'season', norm.cast.seasons[seasonName]])
  }
  if (episode && norm.cast.episodes[episode]) {
    tiers.push([episode, 'episode', norm.cast.episodes[episode]])
  }

  /** @type {Map<string, object>} insertion order preserved */
  const members = new Map()
  for (const [tierName, scope, tier] of tiers) {
    for (const [castId, fields] of Object.entries(tier)) {
      const existing = members.get(castId)
      if (!existing) {
        members.set(castId, {
          cast_id: castId,
          display_name: displayNameFor(castId, fields),
          scope,
          defined_in: tierName,
          overridden_in: [],
          overrides: [],
          fields: clone(fields),
        })
        continue
      }
      const changed = Object.keys(fields).filter(
        (key) => !(key in existing.fields) || fieldChanged(existing.fields[key], fields[key])
      )
      if (changed.length === 0) continue
      Object.assign(existing.fields, clone(fields))
      existing.display_name = displayNameFor(castId, existing.fields)
      existing.overridden_in.push(tierName)
      for (const key of changed) {
        if (!existing.overrides.includes(key)) existing.overrides.push(key)
      }
    }
  }
  return [...members.values()]
}

/** Count of defined members per tier (not the resolved/merged view). */
export function castCounts(studio) {
  const norm = normalizeStudio(studio)
  const count = (tier) => Object.keys(tier || {}).length
  return {
    series: count(norm.cast.series),
    seasons: Object.fromEntries(Object.entries(norm.cast.seasons).map(([k, v]) => [k, count(v)])),
    episodes: Object.fromEntries(Object.entries(norm.cast.episodes).map(([k, v]) => [k, count(v)])),
  }
}

// ── slots ────────────────────────────────────────────────────────────────────

const sortedSlots = (slots) =>
  [...slots].sort((a, b) => (a.order - b.order) || a.slot_id.localeCompare(b.slot_id))

function withSlots(studio, slots) {
  return { ...normalizeStudio(studio), slots: sortedSlots(slots) }
}

/** Append a slot (optionally after another). Throws on duplicate slot_id. */
export function addSlot(studio, slot, { after = null } = {}) {
  const norm = normalizeStudio(studio)
  const slotId = asString(slot?.slot_id).trim()
  if (!slotId) throw new Error('addSlot needs a slot_id')
  if (norm.slots.some((s) => s.slot_id === slotId)) {
    throw new Error(`slot '${slotId}' already exists`)
  }
  let order = norm.slots.length ? Math.max(...norm.slots.map((s) => s.order || 0)) + 1 : 1
  const slots = norm.slots.map((s) => ({ ...s, assigned: { ...s.assigned } }))
  if (after) {
    const ref = slots.find((s) => s.slot_id === after)
    if (ref) {
      order = (ref.order || 0) + 1
      for (const s of slots) {
        if ((s.order || 0) >= order) s.order = (s.order || 0) + 1
      }
    }
  }
  const created = normalizeSlot({ ...slot, slot_id: slotId, order, created: slot?.created || nowIso() }, order - 1)
  created.order = order
  created.created = slot?.created || nowIso()
  if (!slot?.source) created.source = 'manual'
  slots.push(created)
  return withSlots(norm, slots)
}

const SLOT_EDITABLE_FIELDS = ['action', 'audio', 'notes', 'board_shot', 'order', 'lane', 'dur_s']

/** Patch editable fields of one slot. Throws when the slot does not exist. */
export function updateSlot(studio, slotId, fields = {}) {
  const norm = normalizeStudio(studio)
  const index = norm.slots.findIndex((s) => s.slot_id === slotId)
  if (index === -1) throw new Error(`slot '${slotId}' not found`)
  const slots = norm.slots.map((s) => ({ ...s, assigned: { ...s.assigned } }))
  const slot = slots[index]
  for (const key of SLOT_EDITABLE_FIELDS) {
    if (fields[key] !== undefined && fields[key] !== null) slot[key] = fields[key]
  }
  slot.updated = nowIso()
  slots[index] = normalizeSlot(slot, index)
  return withSlots(norm, slots)
}

/** Remove a slot. Frame assets are untouched — they stay in the media pool. */
export function removeSlot(studio, slotId) {
  const norm = normalizeStudio(studio)
  const slots = norm.slots.filter((s) => s.slot_id !== slotId)
  if (slots.length === norm.slots.length) throw new Error(`slot '${slotId}' not found`)
  return withSlots(norm, slots)
}

/**
 * Fill one end of a slot with an approved frame asset (or clear it with null).
 * The asset stays in the media pool — assignment is a pointer, not a move.
 */
export function assignFrame(studio, slotId, which, assetId) {
  if (!SLOT_WHICH.includes(which)) throw new Error("which must be 'first' or 'last'")
  const norm = normalizeStudio(studio)
  const index = norm.slots.findIndex((s) => s.slot_id === slotId)
  if (index === -1) throw new Error(`slot '${slotId}' not found`)
  const slots = norm.slots.map((s) => ({ ...s, assigned: { ...s.assigned } }))
  slots[index].assigned[which] = assetId || null
  slots[index].updated = nowIso()
  return withSlots(norm, slots)
}

/**
 * Derived slot state — never stored. A slot with both ends approved is
 * 'filled', one end is 'partial', neither is 'placeholder'. When
 * approvedAssetIds is given, an assigned id that is not in the approved set
 * does not count (assignment points at a pool frame, not an approved one).
 */
export function slotState(slot, approvedAssetIds = null) {
  const assigned = isPlainObject(slot?.assigned) ? slot.assigned : {}
  const approved = approvedAssetIds ? new Set(approvedAssetIds) : null
  const has = (which) => {
    const id = assigned[which]
    if (!id) return false
    return approved ? approved.has(id) : true
  }
  const first = has('first')
  const last = has('last')
  if (first && last) return 'filled'
  if (first || last) return 'partial'
  return 'placeholder'
}

/** Slot state counts for summaries/snapshots. */
export function slotCounts(studio, approvedAssetIds = null) {
  const norm = normalizeStudio(studio)
  const counts = { slots: norm.slots.length, filled: 0, partial: 0, placeholder: 0 }
  for (const slot of norm.slots) counts[slotState(slot, approvedAssetIds)] += 1
  return counts
}

// ── QA verdicts ──────────────────────────────────────────────────────────────

/**
 * Record a verdict for one or both tracks of a shot. Tracks not named are
 * left untouched, so a later audio verdict does not clobber an earlier video
 * one. `unverified` is a first-class state, never inferred. A fail REQUIRES
 * a reason — a bare "fail" gives the next agent nothing to act on.
 *
 * Optional rubric payload (per track or shared):
 *   videoRubric / audioRubric / rubric  — completed EvaluationResult
 *   videoChecks + videoScores / audioChecks + audioScores — evaluated here
 * A rubric technical_fail / automated_fail forces that track to fail.
 */
export function recordVerdict(studio, shot, {
  video,
  audio,
  reason = '',
  videoReason = '',
  audioReason = '',
  by = 'agent',
  videoRubric,
  audioRubric,
  rubric,
  videoChecks,
  audioChecks,
  videoScores,
  audioScores,
  evaluator,
  generator,
  production,
} = {}) {
  const shotId = asString(shot).trim()
  if (!shotId) throw new Error('recordVerdict needs a shot')

  const resolved = {
    video: resolveTrackInput({
      result: video,
      reason: videoReason || reason,
      evaluation: videoRubric || (video == null && audio == null ? rubric : null),
      checks: videoChecks,
      scores: videoScores,
      evaluator,
      generator,
      mediaKind: 'video',
    }),
    audio: resolveTrackInput({
      result: audio,
      reason: audioReason || reason,
      evaluation: audioRubric || (video == null && audio == null ? rubric : null),
      checks: audioChecks,
      scores: audioScores,
      evaluator,
      generator,
      mediaKind: 'audio',
    }),
  }

  if (!resolved.video && !resolved.audio) {
    throw new Error('recordVerdict needs at least one of video or audio')
  }

  for (const track of QA_TRACKS) {
    const rec = resolved[track]
    if (!rec) continue
    if (!QA_RESULTS.includes(rec.result)) {
      throw new Error(`invalid ${track} result '${rec.result}' — expected ${QA_RESULTS.join('/')}`)
    }
    if (rec.result === 'fail' && !asString(rec.reason).trim()) {
      throw new Error(
        `a ${track} FAIL requires a reason — say what is wrong so the next ` +
        `agent can act on it (e.g. 'motion reads in reverse')`
      )
    }
  }

  const norm = normalizeStudio(studio)
  const entry = { ...(norm.qa[shotId] || {}) }
  const at = nowIso()
  const who = asString(by, 'agent')
  for (const track of QA_TRACKS) {
    const rec = resolved[track]
    if (!rec) continue
    entry[track] = {
      result: rec.result,
      reason: asString(rec.reason).trim(),
      by: who,
      at,
      ...(rec.rubric ? { rubric: rec.rubric } : {}),
    }
  }
  const next = { ...norm, qa: { ...norm.qa, [shotId]: entry } }
  next.qaGraph = buildQaGraph(next, { production })
  return next
}

function resolveTrackInput({ result, reason, evaluation, checks, scores, evaluator, generator, mediaKind }) {
  let rubric = evaluation && typeof evaluation === 'object' ? evaluation : null
  if (!rubric && (checks || scores)) {
    rubric = evaluateCandidate({
      mediaKind,
      technicalChecks: checks || {},
      scores: scores ?? null,
      evaluator,
      generator,
    })
  }
  if (rubric && !rubric.disposition && (rubric.mediaKind || rubric.rubricVersion)) {
    rubric = { ...rubric, disposition: 'human_review' }
  }
  if ((result === undefined || result === null) && !rubric) return null
  let nextResult = result
  let nextReason = reason
  if (rubric) {
    const fromRubric = dispositionToQaResult(rubric.disposition)
    if (nextResult === undefined || nextResult === null) nextResult = fromRubric
    if (fromRubric === 'fail') nextResult = 'fail'
    if (!asString(nextReason).trim()) nextReason = reasonFromEvaluation(rubric, nextReason)
  }
  if (nextResult === undefined || nextResult === null) return null
  return { result: nextResult, reason: nextReason, rubric: rubric || undefined }
}

/** Combined result: fail if EITHER track failed; pass only when BOTH passed. */
export function overallResult(tracks) {
  const results = QA_TRACKS.map((t) => tracks[t]?.result)
  if (results.includes('fail')) return 'fail'
  if (results.every((r) => r === 'pass')) return 'pass'
  return 'unverified'
}

/** Normalized verdict block for one shot — always both tracks present. */
export function verdictForShot(studio, shot) {
  const norm = normalizeStudio(studio)
  const entry = norm.qa[shot] || {}
  const out = {}
  for (const track of QA_TRACKS) out[track] = normalizeTrackVerdict(entry[track])
  out.overall = overallResult(out)
  out.needs_regen = out.overall === 'fail'
  out.regen_tracks = QA_TRACKS.filter((t) => out[t].result === 'fail')
  return out
}

/** Aggregate counts across every shot with a recorded verdict. */
export function qaSummary(studio) {
  const norm = normalizeStudio(studio)
  const counts = { pass: 0, fail: 0, unverified: 0 }
  const perTrack = { video: { ...counts }, audio: { ...counts } }
  const shots = Object.keys(norm.qa)
  for (const shot of shots) {
    const v = verdictForShot(norm, shot)
    counts[v.overall] += 1
    for (const track of QA_TRACKS) perTrack[track][v[track].result] += 1
  }
  return { shots_with_verdicts: shots.length, overall: counts, per_track: perTrack }
}

// ── flow rail ────────────────────────────────────────────────────────────────

/**
 * Stage rail for the studio pipeline view. Inspired by CDX's pipeline.py but
 * deliberately simpler: gates derive only from the studio block plus a few
 * counts the caller passes in `extras` (it owns the asset/timeline reads).
 *
 * extras (all optional):
 *   sceneCount   — scenes/blocking sheets available (defaults to blockingIndex length)
 *   videoCount   — video clips generated for this project
 *   shots        — shot ids expected in review (defaults to board_shot/slot_ids of filled slots)
 *   editClips    — clips on the edit/assembly timeline
 *   deliverables — exported deliverables
 *
 * Gate rules:
 *   script     — slots exist (the seeded beats ARE the script's cut)
 *   cast       — the series tier defines at least one member
 *   scenes     — at least one scene/blocking record
 *   storyboard — every slot has at least one approved frame assigned
 *   flf        — every slot is fully filled (first AND last frame approved)
 *   video      — at least one video clip per filled slot
 *   review     — every shot under review has QA overall 'pass'
 *                (fail or unverified blocks — unverified is NOT a pass)
 *   edit       — at least one clip on the edit timeline
 *   deliver    — at least one exported deliverable
 *
 * stage_reached is the LAST stage whose gate passes; stage_blocked_at is the
 * FIRST stage whose gate fails. They can diverge — e.g. the edit timeline can
 * have clips while storyboard slots are still placeholders — which is exactly
 * what the rail needs to show.
 */
export function flowView(studio, extras = {}) {
  const norm = normalizeStudio(studio)
  const approved = extras.approvedAssetIds || null
  const slots = norm.slots
  const states = slots.map((s) => ({ slot: s, state: slotState(s, approved) }))

  const sceneCount = Number.isFinite(Number(extras.sceneCount))
    ? Number(extras.sceneCount)
    : norm.blockingIndex.length
  const videoCount = Number(extras.videoCount) || 0
  const editClips = Number(extras.editClips) || 0
  const deliverables = Number(extras.deliverables) || 0

  const shotsUnderReview = Array.isArray(extras.shots) && extras.shots.length
    ? extras.shots
    : states.filter((s) => s.state !== 'placeholder').map((s) => s.slot.board_shot || s.slot.slot_id)
  const reviewBlockers = shotsUnderReview.filter((shot) => verdictForShot(norm, shot).overall !== 'pass')

  const unfilled = states.filter((s) => s.state === 'placeholder').map((s) => s.slot.slot_id)
  const notFull = states.filter((s) => s.state !== 'filled').map((s) => s.slot.slot_id)
  const filledCount = states.filter((s) => s.state === 'filled').length

  const nodes = [
    {
      id: 'script',
      ok: slots.length > 0,
      blockers: slots.length > 0 ? [] : ['no slots — seed from an EDL or add beats manually'],
    },
    {
      id: 'cast',
      ok: Object.keys(norm.cast.series).length > 0,
      blockers: Object.keys(norm.cast.series).length > 0 ? [] : ['no series cast defined'],
    },
    {
      id: 'scenes',
      ok: sceneCount > 0,
      blockers: sceneCount > 0 ? [] : ['no scenes/blocking records'],
    },
    {
      id: 'storyboard',
      ok: slots.length > 0 && unfilled.length === 0,
      blockers: slots.length === 0 ? ['no slots'] : unfilled.map((id) => `${id}: placeholder`),
    },
    {
      id: 'flf',
      ok: slots.length > 0 && notFull.length === 0,
      blockers: slots.length === 0 ? ['no slots'] : notFull.map((id) => `${id}: missing first/last frame`),
    },
    {
      id: 'video',
      ok: filledCount > 0 && videoCount >= filledCount,
      blockers: filledCount === 0
        ? ['no filled slots to generate from']
        : (videoCount >= filledCount ? [] : [`${filledCount - videoCount} filled slot(s) without a clip`]),
    },
    {
      id: 'review',
      ok: shotsUnderReview.length > 0 && reviewBlockers.length === 0,
      blockers: shotsUnderReview.length === 0
        ? ['no shots under review']
        : reviewBlockers.map((shot) => `${shot}: ${verdictForShot(norm, shot).overall}`),
    },
    {
      id: 'edit',
      ok: editClips > 0,
      blockers: editClips > 0 ? [] : ['edit timeline is empty'],
    },
    {
      id: 'deliver',
      ok: deliverables > 0,
      blockers: deliverables > 0 ? [] : ['nothing exported'],
    },
  ]

  const reachedNodes = nodes.filter((n) => n.ok)
  const blocked = nodes.find((n) => !n.ok) || null
  return {
    nodes,
    stage_reached: reachedNodes.length ? reachedNodes[reachedNodes.length - 1].id : null,
    stage_blocked_at: blocked ? blocked.id : null,
  }
}
