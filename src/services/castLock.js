/**
 * CDX Studio-native cast lock + reference gate.
 *
 * Production semantics (SPEC only — not a port of the Python modules):
 *   - Rule zero: do not generate a character shot until that character has an
 *     individual, curated identity ref. Group sheets and pipeline output are
 *     not canon. "Fix the source, not the shot."
 *   - Identity-ready (`locked`) means the gate passed. Freeze (`frozen`) is
 *     the explicit approve/lock step after a human or agent reviews the refs.
 *   - Episode guests never leak: resolution still starts at the series tier.
 *   - Crowd / establishing shots with no assigned cast are allowed through.
 *
 * Everything here is pure and Electron-free so it runs under `node --test`.
 */

import { normalizeStudio, resolveCast } from './studioStore.js'
import { emptyStandIn, normalizeCameraRig } from './cameraRig.js'

export const OUTPUT_DIR_NAMES = Object.freeze(['keyframes', 'out', 'video', 'clips'])

export const PACKAGE_SLOTS = Object.freeze(['face_closeup', 'full_front', 'full_side'])

export const PACKAGE_ALIASES = Object.freeze({
  face_closeup: ['face_closeup', 'face', 'front'],
  full_front: ['full_front', 'full'],
  full_side: ['full_side', 'side', 'three_quarter', 'threeQuarter'],
})

export const GRAPH_EDGE_TYPES = Object.freeze({
  CAST_LOCK: 'cast_lock',
  REF_GATE: 'ref_gate',
  SHOT_CAST: 'shot_cast',
})

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const asString = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback
  return String(value)
}

const nowIso = () => new Date().toISOString()

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

export function emptyGraph() {
  return { edges: [] }
}

export function normalizeGraph(raw) {
  if (!isPlainObject(raw)) return emptyGraph()
  const edges = Array.isArray(raw.edges) ? raw.edges : []
  return {
    edges: edges
      .filter((edge) => isPlainObject(edge) && edge.type && edge.from && edge.to)
      .map((edge) => ({
        type: asString(edge.type),
        from: isPlainObject(edge.from) ? { kind: asString(edge.from.kind), id: asString(edge.from.id) } : { kind: '', id: asString(edge.from) },
        to: isPlainObject(edge.to) ? { kind: asString(edge.to.kind), id: asString(edge.to.id) } : { kind: '', id: asString(edge.to) },
        result: edge.result ? asString(edge.result) : '',
        reason: asString(edge.reason),
        at: asString(edge.at),
        by: asString(edge.by),
      })),
  }
}

export function appendGraphEdges(studio, edges = [], { at = nowIso(), by = 'agent' } = {}) {
  const norm = normalizeStudio(studio)
  const graph = normalizeGraph(norm.graph)
  const next = [...graph.edges]
  for (const edge of edges) {
    if (!edge || !edge.type || !edge.from || !edge.to) continue
    next.push({
      type: asString(edge.type),
      from: isPlainObject(edge.from) ? { kind: asString(edge.from.kind), id: asString(edge.from.id) } : { kind: '', id: asString(edge.from) },
      to: isPlainObject(edge.to) ? { kind: asString(edge.to.kind), id: asString(edge.to.id) } : { kind: '', id: asString(edge.to) },
      result: edge.result ? asString(edge.result) : '',
      reason: asString(edge.reason),
      at: asString(edge.at, at),
      by: asString(edge.by, by),
    })
  }
  return { ...norm, graph: { edges: next } }
}

export function isGeneratedOutputPath(raw) {
  const text = asString(raw)
  if (!text) return false
  const parts = text.split(/[\\/]+/).filter(Boolean)
  return parts.some((part) => OUTPUT_DIR_NAMES.includes(part))
}

export function resolveRefPath(projectDir, raw) {
  const text = asString(raw).trim()
  if (!text) return null
  if (text.startsWith('/') || /^[A-Za-z]:[\\/]/.test(text)) return text
  if (!projectDir) return text
  return `${asString(projectDir).replace(/\/+$/, '')}/${text.replace(/^\.\//, '')}`
}

function refSet(fields) {
  return isPlainObject(fields?.ref_set) ? fields.ref_set : {}
}

/** Ordered identity-ref candidates. First unique, curated, present one wins. */
export function identityRefCandidates(fields = {}) {
  const out = []
  const push = (kind, value) => {
    const text = asString(value).trim()
    if (!text) return
    if (out.some((item) => item.value === text)) return
    out.push({ kind, value: text })
  }
  const refs = Array.isArray(fields.face_refs) ? fields.face_refs : []
  if (refs.length) push('face_refs', refs[0])
  push('face_ref', fields.face_ref)
  push('anchor', fields.anchor)
  push('reference_image', fields.reference_image)
  const sheets = refSet(fields)
  push('ref_set.face_closeup', sheets.face_closeup)
  push('ref_set.front', sheets.front)
  return out
}

function packageSlotValue(fields, slot) {
  const sheets = refSet(fields)
  for (const key of PACKAGE_ALIASES[slot] || [slot]) {
    if (sheets[key]) return sheets[key]
  }
  if (slot === 'face_closeup' && (fields.face_ref || (Array.isArray(fields.face_refs) && fields.face_refs[0]))) {
    return fields.face_ref || fields.face_refs[0]
  }
  return null
}

export function missingPackageSlots(fields = {}) {
  return PACKAGE_SLOTS.filter((slot) => !packageSlotValue(fields, slot))
}

function sharedIdentityValues(members) {
  const counts = new Map()
  for (const member of members) {
    for (const candidate of identityRefCandidates(member.fields || {})) {
      counts.set(candidate.value, (counts.get(candidate.value) || 0) + 1)
    }
  }
  return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([value]) => value))
}

function fileOk(path, fileExists) {
  if (typeof fileExists !== 'function') return true
  try {
    return Boolean(fileExists(path))
  } catch {
    return false
  }
}

export function matchCastMember(members, needle) {
  const raw = asString(needle).trim().toLowerCase()
  if (!raw) return null
  const compact = raw.replace(/[^a-z0-9]+/g, '')
  return members.find((member) => {
    const id = asString(member.cast_id).toLowerCase()
    const name = asString(member.display_name).toLowerCase()
    if (id === raw || name === raw) return true
    if (id.endsWith(raw) || raw.endsWith(id)) return true
    const idCompact = id.replace(/[^a-z0-9]+/g, '')
    const nameCompact = name.replace(/[^a-z0-9]+/g, '')
    return idCompact === compact || nameCompact === compact
  }) || null
}

export function shotCastIds(card = {}, members = []) {
  const ids = []
  const push = (value) => {
    const text = asString(value).trim()
    if (!text || ids.includes(text)) return
    ids.push(text)
  }
  const rig = normalizeCameraRig(card.cameraRig)
  for (const stand of rig.characters || []) push(stand.cast_id)
  for (const ref of Array.isArray(card.characterRefs) ? card.characterRefs : []) {
    const hit = matchCastMember(members, ref.cast_id || ref.castId || ref.name || ref.slug)
    if (hit) push(hit.cast_id)
  }
  return ids
}

function evaluateMember(member, { shared, projectDir, fileExists } = {}) {
  const status = {
    cast_id: member.cast_id,
    display_name: member.display_name,
    locked: false,
    frozen: Boolean(member.fields?.frozen || member.fields?.lock_frozen),
    reason: '',
    ref: null,
    refKind: '',
    derived_from_output: false,
    package_missing: missingPackageSlots(member.fields || {}),
    pendant_ref: null,
  }

  const candidates = identityRefCandidates(member.fields || {})
  for (const candidate of candidates) {
    if (shared?.has(candidate.value)) {
      status.reason = `reference ${candidate.value} is shared with another character (group sheet) — generators pick the wrong person`
      continue
    }
    const path = resolveRefPath(projectDir, candidate.value)
    if (!fileOk(path, fileExists)) {
      status.reason = `reference missing on disk: ${path}`
      continue
    }
    if (isGeneratedOutputPath(path) || isGeneratedOutputPath(candidate.value)) {
      status.derived_from_output = true
      status.reason = `reference ${candidate.value} points at GENERATED OUTPUT — canon must come from curated source material (assets/, DAM, a photo), never from a render`
      continue
    }
    status.ref = path
    status.refKind = candidate.kind
    status.locked = true
    status.reason = ''
    break
  }
  if (!status.locked && !status.reason) {
    status.reason = 'no individual reference configured'
  }

  const sheets = refSet(member.fields || {})
  const pendant = sheets.pendant || member.fields?.pendant_cutout
  if (pendant) {
    const pendantPath = resolveRefPath(projectDir, pendant)
    if (fileOk(pendantPath, fileExists)) status.pendant_ref = pendantPath
  }
  return status
}

export function checkCastRefs(studio, {
  season = null,
  episode = null,
  castIds = null,
  projectDir = null,
  fileExists = null,
} = {}) {
  const members = resolveCast(studio, { season, episode })
  const wanted = Array.isArray(castIds) && castIds.length
    ? castIds.map((id) => asString(id).trim()).filter(Boolean)
    : members.map((member) => member.cast_id)
  const byId = new Map(members.map((member) => [member.cast_id, member]))
  const shared = sharedIdentityValues(members)
  const characters = wanted.map((castId) => {
    const member = byId.get(castId) || matchCastMember(members, castId)
    if (!member) {
      return {
        cast_id: castId,
        display_name: castId,
        locked: false,
        frozen: false,
        reason: 'not in resolved cast',
        ref: null,
        refKind: '',
        derived_from_output: false,
        package_missing: [],
        pendant_ref: null,
      }
    }
    return evaluateMember(member, { shared, projectDir, fileExists })
  })

  const blockers = characters.filter((item) => !item.locked).map((item) => `${item.cast_id}: ${item.reason}`)
  const warnings = []
  for (const item of characters) {
    if (!item.locked) continue
    if (!item.pendant_ref) {
      warnings.push(`${item.cast_id}: no wardrobe/pendant enforcement ref — lettered jewelry may render as printed text`)
    }
    if (item.package_missing.length) {
      warnings.push(`${item.cast_id}: incomplete character package — missing ${item.package_missing.join(', ')} (need face_closeup + full_front + full_side)`)
    }
  }

  return {
    ok: characters.length > 0 && blockers.length === 0,
    empty: characters.length === 0,
    season,
    episode,
    characters,
    blockers,
    warnings,
    derived_from_output: characters.filter((item) => item.derived_from_output).map((item) => item.cast_id),
    summary: blockers.length === 0
      ? (characters.length
        ? `cast refs locked (${characters.length} character${characters.length === 1 ? '' : 's'})`
        : 'no cast to gate')
      : `cast ref gate blocked: ${blockers.join('; ')}`,
  }
}

export function gateGeneration(studio, {
  season = null,
  episode = null,
  card = null,
  cards = null,
  castIds = null,
  projectDir = null,
  fileExists = null,
  requireFrozen = false,
} = {}) {
  const members = resolveCast(studio, { season, episode })
  if (!members.length) {
    return { ok: true, skipped: true, reason: 'no series cast defined', report: checkCastRefs(studio, { season, episode, castIds: [], projectDir, fileExists }) }
  }

  let ids = Array.isArray(castIds) ? [...castIds] : []
  const shotCards = []
  if (card) shotCards.push(card)
  if (Array.isArray(cards)) shotCards.push(...cards)
  for (const item of shotCards) {
    for (const id of shotCastIds(item, members)) {
      if (!ids.includes(id)) ids.push(id)
    }
  }

  if (!ids.length) {
    return {
      ok: true,
      skipped: true,
      reason: 'no cast assigned to this shot (crowd / establishing path)',
      report: checkCastRefs(studio, { season, episode, castIds: [], projectDir, fileExists }),
    }
  }

  const report = checkCastRefs(studio, { season, episode, castIds: ids, projectDir, fileExists })
  if (!report.ok) return { ok: false, skipped: false, reason: report.summary, report }
  if (requireFrozen) {
    const unfrozen = report.characters.filter((item) => !item.frozen)
    if (unfrozen.length) {
      return {
        ok: false,
        skipped: false,
        reason: `cast not frozen: ${unfrozen.map((item) => item.cast_id).join(', ')} — run studio_cast_lock after refs pass`,
        report,
      }
    }
  }
  return { ok: true, skipped: false, reason: report.summary, report }
}

function writeMemberPatch(studio, member, patch) {
  const norm = normalizeStudio(studio)
  const cast = clone(norm.cast)
  const id = member.cast_id
  const definedIn = member.defined_in || 'series'
  if (definedIn === 'series') {
    cast.series[id] = { ...(cast.series[id] || {}), ...patch }
  } else if (asString(definedIn).startsWith('season-')) {
    cast.seasons[definedIn] = { ...(cast.seasons[definedIn] || {}) }
    cast.seasons[definedIn][id] = { ...(cast.seasons[definedIn][id] || {}), ...patch }
  } else {
    cast.episodes[definedIn] = { ...(cast.episodes[definedIn] || {}) }
    cast.episodes[definedIn][id] = { ...(cast.episodes[definedIn][id] || {}), ...patch }
  }
  return { ...norm, cast }
}

export function lockCastMembers(studio, {
  season = null,
  episode = null,
  castIds = null,
  by = 'agent',
  at = nowIso(),
  projectDir = null,
  fileExists = null,
} = {}) {
  const members = resolveCast(studio, { season, episode })
  const wanted = Array.isArray(castIds) && castIds.length
    ? castIds
    : members.map((member) => member.cast_id)
  const report = checkCastRefs(studio, { season, episode, castIds: wanted, projectDir, fileExists })
  if (!report.ok) {
    const error = new Error(report.summary)
    error.code = 'ref_gate_blocked'
    error.report = report
    throw error
  }

  let next = normalizeStudio(studio)
  const edges = []
  for (const status of report.characters) {
    const member = members.find((item) => item.cast_id === status.cast_id)
    if (!member) continue
    next = writeMemberPatch(next, member, {
      frozen: true,
      lock_frozen: true,
      locked_at: at,
      locked_by: by,
      locked_ref: status.ref,
    })
    edges.push({
      type: GRAPH_EDGE_TYPES.CAST_LOCK,
      from: { kind: 'character', id: status.cast_id },
      to: { kind: 'ref', id: status.ref || status.cast_id },
      result: 'pass',
      reason: 'frozen after ref gate',
      at,
      by,
    })
  }
  return appendGraphEdges(next, edges, { at, by })
}

export function unlockCastMembers(studio, {
  season = null,
  episode = null,
  castIds = null,
  by = 'agent',
  at = nowIso(),
} = {}) {
  const members = resolveCast(studio, { season, episode })
  const wanted = new Set(
    (Array.isArray(castIds) && castIds.length ? castIds : members.map((member) => member.cast_id)).map((id) => asString(id))
  )
  let next = normalizeStudio(studio)
  const edges = []
  for (const member of members) {
    if (!wanted.has(member.cast_id)) continue
    next = writeMemberPatch(next, member, {
      frozen: false,
      lock_frozen: false,
      locked_at: '',
      locked_by: '',
      locked_ref: '',
    })
    edges.push({
      type: GRAPH_EDGE_TYPES.CAST_LOCK,
      from: { kind: 'character', id: member.cast_id },
      to: { kind: 'ref', id: member.fields?.locked_ref || member.cast_id },
      result: 'unlock',
      reason: 'cast unlocked',
      at,
      by,
    })
  }
  return appendGraphEdges(next, edges, { at, by })
}

export function addShotCharacter(card, studio, castId, {
  season = null,
  episode = null,
  projectDir = null,
  fileExists = null,
  at = nowIso(),
  by = 'agent',
} = {}) {
  const id = asString(castId).trim()
  if (!id) throw new Error('studio_blocking_add_character needs castId')
  const members = resolveCast(studio, { season, episode })
  const member = matchCastMember(members, id) || members.find((item) => item.cast_id === id)
  if (!member) {
    const error = new Error(`cast_id ${id} is not in the resolved cast for this episode`)
    error.code = 'unknown_cast'
    throw error
  }
  const report = checkCastRefs(studio, { season, episode, castIds: [member.cast_id], projectDir, fileExists })
  if (!report.ok) {
    const error = new Error(report.summary)
    error.code = 'ref_gate_blocked'
    error.report = report
    throw error
  }
  const rig = normalizeCameraRig(card?.cameraRig)
  if (rig.characters.some((stand) => stand.cast_id === member.cast_id)) {
    const error = new Error(`cast_id ${member.cast_id} is already in this shot's blocking`)
    error.code = 'duplicate_cast'
    throw error
  }
  const stand = emptyStandIn(member.cast_id, rig.characters.length)
  stand.label = member.display_name || member.cast_id
  const nextCard = {
    ...card,
    cameraRig: {
      ...rig,
      characters: [...rig.characters, stand],
      source: 'cast-lock',
      updatedAt: at,
    },
    characterRefs: [
      ...(Array.isArray(card?.characterRefs) ? card.characterRefs : []),
      { cast_id: member.cast_id, name: member.display_name || member.cast_id },
    ],
  }
  return {
    card: nextCard,
    member,
    report,
    edge: {
      type: GRAPH_EDGE_TYPES.SHOT_CAST,
      from: { kind: 'shot', id: asString(card?.id || card?.slot_id || 'shot') },
      to: { kind: 'character', id: member.cast_id },
      result: 'pass',
      reason: 'stand-in added after ref gate',
      at,
      by,
    },
  }
}

export function flowCastLockExtras(studio, extras = {}) {
  const report = checkCastRefs(studio, {
    season: extras.season,
    episode: extras.episode,
    projectDir: extras.projectDir,
    fileExists: extras.fileExists,
  })
  return { report, enforce: extras.enforceRefGate === true }
}
