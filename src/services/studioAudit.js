/**
 * Velorn-native studio audit — one join that answers "what do I do next?"
 *
 * Spec (semantics only — not a port of the Studio CLI):
 *   cdx-studio-audit  +  skill cdx-studio-audit
 *
 * Reads Velorn project data (slots / storyboard / studio.qa / optional VO),
 * never the cdx-video-director MCP on :7060.
 *
 * Verdicts (same names, same priority as Studio):
 *   NEEDS_REGEN         recorded QA fail
 *   READY_TO_GENERATE   both keyframes locked, no clip
 *   DIALOGUE_BLOCKED    dialogue whose VO is not canonical
 *   NEEDS_FLF           one or both keyframes not locked
 *   DONE                clip exists — DONE ≠ PASSED (unverified until recorded)
 *
 * GPU serial / drafts-only: this module never queues generation or publishes.
 */

import { slotState, verdictForShot, normalizeStudio, QA_TRACKS } from './studioStore.js'
import { buildQaGraph } from './qaGraph.js'

export const AUDIT_VERDICTS = Object.freeze([
  'NEEDS_REGEN',
  'READY_TO_GENERATE',
  'DIALOGUE_BLOCKED',
  'NEEDS_FLF',
  'DONE',
])

const asString = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback
  return String(value)
}

export function sceneOf(shotSlug) {
  return asString(shotSlug).split('-')[0].toLowerCase()
}

export function voScene(lineId) {
  const text = asString(lineId).toLowerCase()
  const match = text.match(/^([a-z]+)0*(\d+)/)
  return match ? `${match[1]}${Number(match[2])}` : text.split('-')[0]
}

function assetExists(assets, id) {
  if (!id) return false
  if (!Array.isArray(assets) || !assets.length) return true
  return assets.some((asset) => asset.id === id)
}

function hasDialogue(card, slot, extras = {}) {
  if (extras.dialogue === true) return true
  if (asString(card?.audio || card?.dialogue || slot?.audio).trim()) return true
  const shot = shotIdOf(card, slot)
  if (Array.isArray(extras.dialogueShots) && extras.dialogueShots.includes(shot)) return true
  const scene = sceneOf(shot)
  if (Array.isArray(extras.dialogueScenes) && extras.dialogueScenes.includes(scene)) return true
  return false
}

function voCanonical(card, slot, extras = {}) {
  if (card?.voCanonical === true || slot?.voCanonical === true) return true
  if (card?.voCanonical === false || slot?.voCanonical === false) return false
  const shot = shotIdOf(card, slot)
  if (Array.isArray(extras.canonicalShots)) return extras.canonicalShots.includes(shot)
  if (Array.isArray(extras.missingCanonical)) {
    const scene = sceneOf(shot)
    return !extras.missingCanonical.map(voScene).includes(scene)
  }
  return null
}

export function shotIdOf(card, slot) {
  return asString(slot?.board_shot || card?.id || slot?.slot_id || '').trim()
}

export function matchSlot(studio, card) {
  const slots = studio?.slots || []
  if (!card) return null
  const hay = `${card.id || ''} ${card.title || ''} ${card.action || ''}`.toLowerCase()
  return slots.find((slot) => (
    slot.board_shot === card.id
    || slot.slot_id === card.id
    || hay.includes(String(slot.slot_id || '').toLowerCase())
    || (slot.board_shot && hay.includes(String(slot.board_shot).toLowerCase()))
  )) || null
}

export function spatialGates({ card, slot, studio, extras } = {}) {
  const shot = shotIdOf(card, slot)
  const blocking = Array.isArray(studio?.blockingIndex) ? studio.blockingIndex : []
  const fromExtras = extras?.spatial?.[shot] || extras?.spatialGates || {}
  const g1 = fromExtras.G1_blocking
    ?? Boolean(card?.cameraRig || card?.blockingPath || blocking.includes(shot) || blocking.includes(slot?.slot_id))
  const g2 = fromExtras.G2_map_underlay ?? Boolean(card?.mapUnderlay || extras?.hasMapUnderlay)
  const g3 = fromExtras.G3_env_plate ?? Boolean(card?.envPlate || extras?.hasEnvPlate)
  const g5 = fromExtras.G5_has_3d ?? Boolean(card?.blenderPath || extras?.has3d)
  return {
    G1_blocking: Boolean(g1),
    G2_map_underlay: Boolean(g2),
    G3_env_plate: Boolean(g3),
    G5_has_3d: Boolean(g5),
  }
}

/**
 * Classify one shot. first/last "locked" = a slot has that frame assigned
 * (and, when an approved set is provided, that asset is approved).
 */
export function auditShot({ card = {}, slot = null, studio = {}, extras = {}, assets = [] } = {}) {
  const shot = shotIdOf(card, slot)
  const qa = verdictForShot(studio, shot)
  const state = slot ? slotState(slot, extras.approvedAssetIds || null) : 'placeholder'
  const firstLocked = Boolean(slot?.assigned?.first)
  const lastLocked = Boolean(slot?.assigned?.last)
  const videoId = card.videoAssetId || card.clipAssetId || extras.clipByShot?.[shot]
  const hasClip = Boolean(videoId && assetExists(assets, videoId))
  const dialogue = hasDialogue(card, slot, extras)
  const canonical = voCanonical(card, slot, extras)
  const gates = spatialGates({ card, slot, studio, extras })
  const failing = QA_TRACKS.filter((track) => qa[track].result === 'fail')
  const qaReason = failing
    .map((track) => `${track}: ${qa[track].reason}`.trim())
    .filter((text) => text && !text.endsWith(':'))
    .join('; ')

  let verdict
  let action
  if (qa.overall === 'fail' || qa.needs_regen) {
    verdict = 'NEEDS_REGEN'
    action = `regenerate — ${qaReason || 'explicit failure verdict recorded'}`
  } else if (firstLocked && lastLocked && hasClip) {
    verdict = 'DONE'
    action = qa.overall === 'pass'
      ? `QA PASSED${qaReason ? ` — ${qaReason}` : ''}`
      : 'clip exists but QA UNVERIFIED — watch it, then record a verdict'
  } else if (firstLocked && lastLocked) {
    if (dialogue && canonical === false) {
      verdict = 'DIALOGUE_BLOCKED'
      action = 'VO line not canonical — record VO before generating'
    } else {
      verdict = 'READY_TO_GENERATE'
      action = 'both keyframes locked, no clip — generate next'
    }
  } else {
    const missing = [!firstLocked && 'first', !lastLocked && 'last'].filter(Boolean)
    verdict = 'NEEDS_FLF'
    action = `keyframe(s) not locked: ${missing.join(', ') || 'none'}`
  }

  return {
    shot,
    index: card.order ?? slot?.order ?? null,
    verdict,
    action,
    first: firstLocked ? 'locked' : (slot?.assigned?.first ? 'assigned' : 'missing'),
    last: lastLocked ? 'locked' : (slot?.assigned?.last ? 'assigned' : 'missing'),
    slot_state: state,
    has_clip: hasClip,
    clip_asset_id: videoId || null,
    dialogue,
    dialogue_join: dialogue ? (canonical === false ? 'vo_not_canonical' : 'slot_or_card_audio') : null,
    lipsync_lane: dialogue ? 'LTX 2.3 + Dub-It/lipdub' : null,
    qa: {
      overall: qa.overall,
      video: qa.video.result,
      audio: qa.audio.result,
      failing_tracks: failing,
      reason: qaReason || null,
      rubrics: {
        video: qa.video.rubric || null,
        audio: qa.audio.rubric || null,
      },
    },
    spatial_gates: gates,
    spatial_ok: Boolean(gates.G1_blocking && gates.G3_env_plate),
    duration_s: card.duration ?? slot?.dur_s ?? null,
  }
}

function collectShots(project, studio) {
  const cards = Array.isArray(project?.storyboardBoard?.cards) ? [...project.storyboardBoard.cards] : []
  cards.sort((a, b) => (a.order || 0) - (b.order || 0))
  const usedSlots = new Set()
  const rows = []
  for (const card of cards) {
    const slot = matchSlot(studio, card)
    if (slot) usedSlots.add(slot.slot_id)
    rows.push({ card, slot })
  }
  for (const slot of studio.slots || []) {
    if (usedSlots.has(slot.slot_id)) continue
    rows.push({ card: { id: slot.board_shot || slot.slot_id, order: slot.order }, slot })
  }
  return rows
}

export function auditProject(project = {}, extras = {}) {
  const studio = normalizeStudio(project.studio)
  const assets = extras.assets || project.assets || []
  const pairs = collectShots(project, studio)
  const shots = pairs.map(({ card, slot }) => auditShot({ card, slot, studio, extras, assets }))
  const filtered = extras.verdict
    ? shots.filter((row) => row.verdict === String(extras.verdict).toUpperCase())
    : shots
  const counts = {}
  for (const name of AUDIT_VERDICTS) counts[name] = 0
  for (const row of shots) counts[row.verdict] = (counts[row.verdict] || 0) + 1

  const qaCoverage = {
    verified: shots.filter((row) => row.qa.overall === 'pass' || row.qa.overall === 'fail').length,
    unverified: shots.filter((row) => row.qa.overall === 'unverified').length,
    video_failed: shots.filter((row) => row.qa.video === 'fail').length,
    audio_failed: shots.filter((row) => row.qa.audio === 'fail').length,
  }

  return {
    project: project.name || project.cdxMigration?.slug || 'untitled',
    slug: project.cdxMigration?.slug || extras.slug || null,
    shots_total: shots.length,
    counts,
    vo: {
      total_lines: extras.vo?.total_lines ?? extras.vo?.totalLines ?? null,
      canonical: extras.vo?.canonical ?? null,
      finalized: extras.vo?.finalized ?? null,
      ready: extras.vo?.ready ?? null,
    },
    shots: filtered,
    qa_coverage: qaCoverage,
    graph: extras.includeGraph === false ? null : buildQaGraph(studio, { production: project.production }),
    audit_gaps: [
      'DONE ≠ PASSED. A clip on the board is not a pass. Watch it and record studio_qa_record / velorn-studio-audit --record.',
      'VO canonical state is only known when the take-chain port (or extras.canonicalShots / extras.missingCanonical) is present. Without it, dialogue shots lock→READY_TO_GENERATE instead of guessing DIALOGUE_BLOCKED.',
      'Spatial gates are derived from Velorn blocking/camera/plates. G5_has_3d alone does not mean blocking is authored — check G1_blocking and G3_env_plate.',
      'This audit reads the open Velorn project (project.comfystudio). It does not call cdx-video-director :7060.',
    ],
    policy: { gpuSerial: true, outward: 'draft' },
  }
}

export function shotIdForClip(studio, cards, clip) {
  if (!clip) return ''
  const direct = asString(clip.shotId || clip.shot_id || clip.storyboardCardId || clip.cardId || clip.board_shot).trim()
  if (direct) return direct
  const list = Array.isArray(cards) ? cards : []
  const byAsset = list.find((card) => (
    card.videoAssetId && card.videoAssetId === clip.assetId
  ) || (card.imageAssetId && card.imageAssetId === clip.assetId))
  if (byAsset) return shotIdOf(byAsset, matchSlot(studio, byAsset))
  const name = asString(clip.name).toLowerCase()
  if (!name) return ''
  const slot = (studio?.slots || []).find((item) => (
    name.includes(asString(item.board_shot).toLowerCase())
    || name.includes(asString(item.slot_id).toLowerCase())
  ))
  if (slot) return shotIdOf(null, slot)
  const card = list.find((item) => name.includes(asString(item.id).toLowerCase()) || name.includes(asString(item.title).toLowerCase()))
  return card ? shotIdOf(card, matchSlot(studio, card)) : ''
}
