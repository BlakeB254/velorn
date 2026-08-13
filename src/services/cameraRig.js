/**
 * Per-shot camera + stand-in rig.
 *
 * Matches CDX Studio blocking v6 (`blender_enu_meters`):
 *   X = east/right, Y = north/forward, Z = up
 *   yaw 0° = +Y, yaw positive = clockwise
 *   camera never starts at z=0 (ground-plane edge-on trap)
 *
 * Lexicon ids (eye-level, 35mm, slow-push-in) stay on `shotSettings`.
 * This block is the numeric handle: Blake or an agent can drag xyz / yaw /
 * pitch / roll / fov, save it, or leave a proposal the other side can apply.
 * Everything here is pure so it runs under `node --test`.
 */

export const CAMERA_RIG_VERSION = 1

export const COORDINATE_FRAME = Object.freeze({
  name: 'blender_enu_meters',
  units: 'meters',
  x_axis: 'east/right',
  y_axis: 'north/forward',
  z_axis: 'up/elevation',
  yaw_positive: 'clockwise_degrees',
  yaw_zero: 'positive_y',
})

export const EYE_HEIGHT_M = 1.55
export const DEFAULT_FOV_DEG = 40.95
export const CAMERA_HOME_Y_M = -2.0
export const CAMERA_HOME_PITCH_DEG = -4.0

const clamp = (value, lo, hi, fallback) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}

const asString = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback
  return String(value)
}

const nowIso = () => new Date().toISOString()

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

export function emptyCamera() {
  return {
    camera_id: 'CAM_canonical',
    x_m: 0,
    y_m: CAMERA_HOME_Y_M,
    z_m: EYE_HEIGHT_M,
    yaw_deg: 0,
    pitch_deg: CAMERA_HOME_PITCH_DEG,
    roll_deg: 0,
    fov_deg: DEFAULT_FOV_DEG,
  }
}

export function emptyStandIn(castId = '', index = 0) {
  const spread = 60
  const thetaDeg = -spread / 2 + (spread * (index % 5)) / 4
  const radius = 3.5 + (index % 3) * 1.25
  const theta = (thetaDeg * Math.PI) / 180
  return {
    cast_id: asString(castId),
    label: asString(castId),
    x_m: Number((radius * Math.sin(theta)).toFixed(3)),
    y_m: Number((CAMERA_HOME_Y_M + radius * Math.cos(theta)).toFixed(3)),
    z_m: 0,
    facing_deg: 180,
    height_m: 1.7,
    poseSlug: '',
    motionSlug: '',
  }
}

export function emptyCameraRig() {
  return {
    schemaVersion: CAMERA_RIG_VERSION,
    coordinateFrame: { ...COORDINATE_FRAME },
    camera: emptyCamera(),
    characters: [],
    proposal: null,
    source: 'default',
    updatedAt: '',
  }
}

function normalizeCamera(raw) {
  const base = emptyCamera()
  const src = raw && typeof raw === 'object' ? raw : {}
  const pos = src.position && typeof src.position === 'object' ? src.position : {}
  return {
    camera_id: asString(src.camera_id || src.object_name, base.camera_id),
    x_m: clamp(src.x_m ?? pos.x_m, -80, 80, base.x_m),
    y_m: clamp(src.y_m ?? pos.y_m, -80, 80, base.y_m),
    z_m: clamp(src.z_m ?? pos.z_m, 0.15, 40, base.z_m),
    yaw_deg: clamp(src.yaw_deg ?? src.facing_deg, -360, 360, base.yaw_deg),
    pitch_deg: clamp(src.pitch_deg, -89, 89, base.pitch_deg),
    roll_deg: clamp(src.roll_deg, -180, 180, base.roll_deg),
    fov_deg: clamp(src.fov_deg, 8, 170, base.fov_deg),
  }
}

function normalizeStandIn(raw, index) {
  const base = emptyStandIn(raw?.cast_id || raw?.castId || raw?.id, index)
  const src = raw && typeof raw === 'object' ? raw : {}
  const pos = src.position && typeof src.position === 'object' ? src.position : {}
  return {
    cast_id: asString(src.cast_id || src.castId || src.id, base.cast_id),
    label: asString(src.label || src.name, base.label),
    x_m: clamp(src.x_m ?? pos.x_m, -80, 80, base.x_m),
    y_m: clamp(src.y_m ?? pos.y_m, -80, 80, base.y_m),
    z_m: clamp(src.z_m ?? pos.z_m, 0, 8, base.z_m),
    facing_deg: clamp(src.facing_deg ?? src.yaw_deg, -360, 360, base.facing_deg),
    height_m: clamp(src.height_m, 0.3, 3.5, base.height_m),
    poseSlug: asString(src.poseSlug || src.pose_slug),
    motionSlug: asString(src.motionSlug || src.motion_slug),
  }
}

export function normalizeCameraRig(raw) {
  const blank = emptyCameraRig()
  if (!raw || typeof raw !== 'object') return blank
  const characters = Array.isArray(raw.characters)
    ? raw.characters.map((item, index) => normalizeStandIn(item, index)).filter((item) => item.cast_id)
    : []
  const proposal = raw.proposal && typeof raw.proposal === 'object'
    ? {
      by: asString(raw.proposal.by, 'agent'),
      at: asString(raw.proposal.at, ''),
      note: asString(raw.proposal.note),
      camera: normalizeCamera(raw.proposal.camera),
      characters: Array.isArray(raw.proposal.characters)
        ? raw.proposal.characters.map((item, index) => normalizeStandIn(item, index))
        : undefined,
    }
    : null
  return {
    schemaVersion: CAMERA_RIG_VERSION,
    coordinateFrame: { ...COORDINATE_FRAME },
    camera: normalizeCamera(raw.camera),
    characters,
    proposal,
    source: asString(raw.source, 'manual') || 'manual',
    updatedAt: asString(raw.updatedAt),
  }
}

/**
 * Map film-lexicon angle / framing / lens onto a starting rig.
 * Does not invent a new language — it only places the numeric handle so a
 * "low angle + 24mm" still has xyz the Blender / pose lane can use.
 */
export function presetFromLexicon({ camera_angle_id = '', framing_id = '', lens_id = '' } = {}) {
  const camera = emptyCamera()
  const angle = String(camera_angle_id || '')
  const framing = String(framing_id || '')
  const lens = String(lens_id || '')

  if (angle === 'low-angle' || angle === 'worms-eye' || framing === 'wide-low-angle') {
    camera.z_m = angle === 'worms-eye' ? 0.35 : 0.75
    camera.pitch_deg = angle === 'worms-eye' ? 28 : 16
    camera.y_m = -2.4
  } else if (angle === 'high-angle') {
    camera.z_m = 2.6
    camera.pitch_deg = -22
    camera.y_m = -2.2
  } else if (angle === 'birds-eye' || angle === 'top-down' || angle === 'overhead') {
    camera.z_m = 6.5
    camera.pitch_deg = -88
    camera.y_m = 0.2
    camera.x_m = 0
  } else if (angle === 'dutch-angle') {
    camera.roll_deg = 18
  } else if (angle === 'profile-90') {
    camera.x_m = 3.2
    camera.y_m = 0.4
    camera.yaw_deg = -90
  } else if (angle === 'pov') {
    camera.z_m = 1.6
    camera.y_m = 0.4
    camera.pitch_deg = 0
  }

  if (framing === 'extreme-close-up' || framing === 'insert-detail') {
    camera.y_m = Math.max(camera.y_m, -0.85)
    camera.fov_deg = 28
  } else if (framing === 'tight-medium' || framing === 'medium-close-up') {
    camera.y_m = Math.min(camera.y_m, -1.4)
  } else if (framing === 'wide-establishing' || framing === 'extreme-wide' || framing === 'full-shot') {
    camera.y_m = Math.min(camera.y_m, -5.5)
    camera.fov_deg = 55
  }

  if (lens.includes('24mm') || lens.includes('fish-eye') || lens === 'macro-ecu') {
    camera.fov_deg = lens.includes('fish') ? 110 : (lens === 'macro-ecu' ? 24 : 74)
  } else if (lens.includes('85mm') || lens.includes('135mm') || lens.includes('portrait')) {
    camera.fov_deg = lens.includes('135') ? 18 : 24
  } else if (lens.includes('35mm')) {
    camera.fov_deg = 54
  }

  return {
    ...emptyCameraRig(),
    camera,
    source: 'lexicon-preset',
    updatedAt: nowIso(),
  }
}

export function applyCameraPatch(rig, patch = {}) {
  const next = normalizeCameraRig(rig)
  next.camera = normalizeCamera({ ...next.camera, ...patch, position: patch.position })
  next.source = asString(patch.source, 'manual') || 'manual'
  next.updatedAt = nowIso()
  return next
}

export function setStandIns(rig, characters = []) {
  const next = normalizeCameraRig(rig)
  next.characters = characters.map((item, index) => normalizeStandIn(item, index)).filter((item) => item.cast_id)
  next.updatedAt = nowIso()
  return next
}

export function proposeCameraRig(rig, { camera, characters, note = '', by = 'agent' } = {}) {
  const next = normalizeCameraRig(rig)
  next.proposal = {
    by: asString(by, 'agent'),
    at: nowIso(),
    note: asString(note),
    camera: normalizeCamera(camera || next.camera),
    characters: Array.isArray(characters)
      ? characters.map((item, index) => normalizeStandIn(item, index))
      : undefined,
  }
  next.updatedAt = nowIso()
  return next
}

export function applyCameraProposal(rig) {
  const next = normalizeCameraRig(rig)
  if (!next.proposal) throw new Error('No camera proposal to apply')
  next.camera = normalizeCamera(next.proposal.camera)
  if (Array.isArray(next.proposal.characters)) {
    next.characters = next.proposal.characters.map((item, index) => normalizeStandIn(item, index))
  }
  next.source = 'agent-proposal'
  next.proposal = null
  next.updatedAt = nowIso()
  return next
}

export function rejectCameraProposal(rig) {
  const next = normalizeCameraRig(rig)
  next.proposal = null
  next.updatedAt = nowIso()
  return next
}

export function cameraPromptHint(rig) {
  const norm = normalizeCameraRig(rig)
  const cam = norm.camera
  const bits = [
    `camera at ${cam.x_m.toFixed(2)}m right, ${cam.y_m.toFixed(2)}m forward, ${cam.z_m.toFixed(2)}m up`,
    `yaw ${cam.yaw_deg.toFixed(1)}°, pitch ${cam.pitch_deg.toFixed(1)}°, roll ${cam.roll_deg.toFixed(1)}°`,
    `fov ${cam.fov_deg.toFixed(1)}°`,
  ]
  if (norm.characters.length) {
    bits.push(`${norm.characters.length} blocked stand-in${norm.characters.length === 1 ? '' : 's'}`)
  }
  if (norm.proposal) bits.push(`pending ${norm.proposal.by} proposal: ${norm.proposal.note || 'no note'}`)
  return bits.join('; ')
}

export function cameraSummary(rig) {
  const norm = normalizeCameraRig(rig)
  const cam = norm.camera
  return {
    x_m: cam.x_m,
    y_m: cam.y_m,
    z_m: cam.z_m,
    yaw_deg: cam.yaw_deg,
    pitch_deg: cam.pitch_deg,
    roll_deg: cam.roll_deg,
    fov_deg: cam.fov_deg,
    standIns: norm.characters.length,
    hasProposal: Boolean(norm.proposal),
    source: norm.source,
    hint: cameraPromptHint(norm),
  }
}

export function toBlockingCamera(rig) {
  const cam = normalizeCameraRig(rig).camera
  return {
    camera_id: cam.camera_id,
    object_name: cam.camera_id,
    label: cam.camera_id,
    fov_deg: cam.fov_deg,
    position: { x_m: cam.x_m, y_m: cam.y_m, z_m: cam.z_m },
    facing_deg: ((cam.yaw_deg % 360) + 360) % 360,
    pitch_deg: cam.pitch_deg,
    roll_deg: cam.roll_deg,
    cuts: [],
    path: [],
  }
}

export function fromBlockingDoc(doc) {
  if (!doc || typeof doc !== 'object') return emptyCameraRig()
  return normalizeCameraRig({
    camera: doc.camera,
    characters: doc.characters,
    source: 'blocking-import',
    updatedAt: nowIso(),
  })
}

export function cloneCameraRig(rig) {
  return clone(normalizeCameraRig(rig))
}
