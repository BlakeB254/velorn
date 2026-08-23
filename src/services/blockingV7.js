/**
 * Blocking v7 — one JSON doc per shot (`docs/blocking/<shot>/blocking.json`).
 *
 * Single source of truth for scene blocking (see docs/blocking-v7-plan.md §4.1):
 *   - schema_version 7, coordinate_frame "blender_enu_meters"
 *     (X east, Y north, Z up; yaw 0° = +Y, clockwise)
 *   - reads accept v6 plain-dict and schema-1 (pydantic dump) shapes and
 *     upgrade in memory; writes are always v7
 *
 * Everything here is pure so it runs under `node --test`.
 */

import {
  CAMERA_HOME_PITCH_DEG,
  CAMERA_HOME_Y_M,
  DEFAULT_FOV_DEG,
  EYE_HEIGHT_M,
} from './cameraRig.js'
import lexiconGeometry from '../config/lexiconGeometry.json' with { type: 'json' }
import { normalizeFootprint } from './blockingScene.js'

export const SCHEMA_VERSION = 7
export const COORDINATE_FRAME = 'blender_enu_meters'
export const MIN_CAMERA_Z_M = lexiconGeometry.minCameraZM
export const DEFAULT_FPS = 25

const num = (value, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const str = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback
  return String(value)
}

export function newBlockingDoc() {
  return {
    schema_version: SCHEMA_VERSION,
    coordinate_frame: COORDINATE_FRAME,
    fps: DEFAULT_FPS,
    camera: {
      camera_id: 'CAM_canonical',
      position: { x_m: 0, y_m: CAMERA_HOME_Y_M, z_m: EYE_HEIGHT_M },
      facing_deg: 0,
      pitch_deg: CAMERA_HOME_PITCH_DEG,
      roll_deg: 0,
      fov_deg: DEFAULT_FOV_DEG,
      path: [],
      cuts: [],
    },
    characters: [],
    props: [],
    environment: {},
    export: null,
  }
}

function normalizeCameraV7(raw, fallback) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const pos = src.position && typeof src.position === 'object' ? src.position : {}
  return {
    camera_id: str(src.camera_id || src.object_name, fallback.camera_id),
    position: {
      x_m: num(pos.x_m ?? src.x_m, fallback.position.x_m),
      y_m: num(pos.y_m ?? src.y_m, fallback.position.y_m),
      z_m: num(pos.z_m ?? src.z_m, fallback.position.z_m),
    },
    facing_deg: num(src.facing_deg ?? src.yaw_deg, fallback.facing_deg),
    pitch_deg: num(src.pitch_deg, fallback.pitch_deg),
    roll_deg: num(src.roll_deg, fallback.roll_deg),
    fov_deg: num(src.fov_deg, fallback.fov_deg),
    path: Array.isArray(src.path) ? src.path : [],
    cuts: normalizeCuts(src.cuts, fallback),
  }
}

/**
 * Multi-camera cuts (docs/blocking-v7-plan.md §6): each cut is a full camera
 * spec rendered into its own <out>/<shot>/<camera_id> dir by the bridge.
 * camera_id falls back to '' (not the primary's) so validation can reject
 * cut entries that don't name themselves; nested cuts are stripped.
 */
function normalizeCuts(cuts, fallback) {
  if (!Array.isArray(cuts)) return []
  return cuts
    .filter((cut) => cut && typeof cut === 'object')
    .map((cut) => ({ ...normalizeCameraV7(cut, { ...fallback, camera_id: '' }), cuts: [] }))
}

function normalizeCharacterV7(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const pos = src.position && typeof src.position === 'object' ? src.position : {}
  return {
    ...src,
    cast_id: str(src.cast_id || src.castId || src.id),
    label: str(src.label || src.name || src.cast_id || src.castId || src.id),
    position: {
      x_m: num(pos.x_m ?? src.x_m, 0),
      y_m: num(pos.y_m ?? src.y_m, 0),
      z_m: num(pos.z_m ?? src.z_m, 0),
    },
    facing_deg: num(src.facing_deg ?? src.yaw_deg, 180),
    height_m: num(src.height_m, 1.7),
    pose_slug: str(src.pose_slug || src.poseSlug),
    motion_slug: str(src.motion_slug || src.motionSlug),
    bone_overrides: Array.isArray(src.bone_overrides) ? src.bone_overrides : [],
    path: Array.isArray(src.path) ? src.path : [],
    ref_set: src.ref_set && typeof src.ref_set === 'object' ? src.ref_set : {},
  }
}

/**
 * Accept a v7 doc, a v6 plain-dict (schema_version 2, camera/characters with
 * nested position + object_name), or a schema-1 pydantic dump (project_slug /
 * blocking_version_id / playback) and return a v7 doc. Never throws on
 * missing optional fields — defaults are filled from newBlockingDoc().
 */
export function upgradeBlockingDoc(doc) {
  const out = newBlockingDoc()
  if (!doc || typeof doc !== 'object') return out
  out.fps = num(doc.fps ?? (doc.playback && doc.playback.fps), DEFAULT_FPS)
  // Preserve shot duration: G4 (timing gate) and the bridge frame range read
  // it; dropping it on upgrade silently degraded G4 to skip and made bridge
  // renders fall back to the 25-frame default.
  const duration = Number(doc.duration_s ?? (doc.playback && doc.playback.duration_s))
  if (Number.isFinite(duration) && duration > 0) out.duration_s = duration
  if (doc.shot_slug) out.shot_slug = str(doc.shot_slug)
  if (doc.project_slug) out.project_slug = str(doc.project_slug)
  out.camera = normalizeCameraV7(doc.camera, out.camera)
  out.characters = (Array.isArray(doc.characters) ? doc.characters : []).map(normalizeCharacterV7)
  out.props = Array.isArray(doc.props) ? doc.props : []
  out.environment = doc.environment && typeof doc.environment === 'object' ? { ...doc.environment } : {}
  // Optional ground-plan underlay. Points may be {x_m, y_m} objects or
  // [x, y] pairs; stored canonically as {x_m, y_m}. Absent = no underlay.
  if ('footprint' in out.environment) {
    out.environment.footprint = normalizeFootprint(out.environment.footprint)
  }
  out.export = doc.export && typeof doc.export === 'object' ? doc.export : null
  return out
}

function checkPathOrder(path, label, problems) {
  if (!Array.isArray(path)) return
  let prev = -Infinity
  path.forEach((key, index) => {
    const t = Number(key && key.t_s)
    if (!Number.isFinite(t)) {
      problems.push(`${label}[${index}] is missing t_s`)
      return
    }
    if (t < prev) problems.push(`${label} keys out of order at index ${index} (t_s ${t} < ${prev})`)
    if (t > prev) prev = t
  })
}

/**
 * List of problems with a v7 doc (empty = valid). Reports, never throws.
 */
export function validateBlockingDoc(doc) {
  const problems = []
  if (!doc || typeof doc !== 'object') return ['blocking doc is not an object']
  const camera = doc.camera && typeof doc.camera === 'object' ? doc.camera : {}
  const z = Number(camera.position && camera.position.z_m)
  if (!Number.isFinite(z)) {
    problems.push('camera.position.z_m is missing')
  } else if (z < MIN_CAMERA_Z_M) {
    problems.push(`camera z_m ${z} is below ${MIN_CAMERA_Z_M} (ground-plane edge-on trap)`)
  }
  const fov = Number(camera.fov_deg)
  if (!Number.isFinite(fov) || fov < 1 || fov > 179) {
    problems.push(`camera fov_deg ${camera.fov_deg} is out of range 1-179`)
  }
  checkPathOrder(camera.path, 'camera.path', problems)
  const cuts = Array.isArray(camera.cuts) ? camera.cuts : []
  const seenCamIds = new Set([str(camera.camera_id || 'CAM_canonical')])
  cuts.forEach((cut, index) => {
    const id = cut && typeof cut === 'object' ? str(cut.camera_id) : ''
    if (!id) {
      problems.push(`camera.cuts[${index}] is missing camera_id`)
    } else if (seenCamIds.has(id)) {
      problems.push(`camera.cuts[${index}] duplicates camera_id '${id}'`)
    } else {
      seenCamIds.add(id)
    }
    const cutZ = cut && cut.position && Number(cut.position.z_m)
    if (!Number.isFinite(cutZ)) {
      problems.push(`camera.cuts[${index}].position.z_m is missing`)
    } else if (cutZ < MIN_CAMERA_Z_M) {
      problems.push(`camera.cuts[${index}] z_m ${cutZ} is below ${MIN_CAMERA_Z_M} (ground-plane edge-on trap)`)
    }
    const cutFov = cut && Number(cut.fov_deg)
    if (!Number.isFinite(cutFov) || cutFov < 1 || cutFov > 179) {
      problems.push(`camera.cuts[${index}] fov_deg ${cut && cut.fov_deg} is out of range 1-179`)
    }
    checkPathOrder(cut && cut.path, `camera.cuts[${index}].path`, problems)
  })
  const characters = Array.isArray(doc.characters) ? doc.characters : []
  characters.forEach((character, index) => {
    const castId = character && typeof character === 'object' ? str(character.cast_id) : ''
    if (!castId) problems.push(`characters[${index}] is missing cast_id`)
    checkPathOrder(character && character.path, `characters.${castId || index}.path`, problems)
  })
  const environment = doc.environment && typeof doc.environment === 'object' ? doc.environment : {}
  if (environment.footprint !== undefined && environment.footprint !== null) {
    if (!Array.isArray(environment.footprint)) {
      problems.push('environment.footprint must be an array of [x, y] / {x_m, y_m} points')
    } else {
      const usable = normalizeFootprint(environment.footprint)
      if (usable.length !== environment.footprint.length) {
        problems.push('environment.footprint has points that are not finite [x, y] / {x_m, y_m}')
      }
      if (usable.length > 0 && usable.length < 3) {
        problems.push(`environment.footprint needs at least 3 points, got ${usable.length}`)
      }
    }
  }
  return problems
}
