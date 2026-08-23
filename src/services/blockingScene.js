/**
 * Blocking v7 — pure scene math for the studio blocking panel.
 *
 * THE coordinate conversion (house trap §5.8 of the blocking-v7 plan):
 * blocking.json lives in blender_enu_meters: X east/right, Y north/forward,
 * Z up, yaw CLOCKWISE with 0° = +Y. three.js is Y-up, and its cameras look
 * down -Z with rotation.y = 0. The ONE mapping used by every pane:
 *
 *   position:  (x, y, z)_enu  →  (x, z, -y)_three      (north = into screen)
 *   yaw θ°:    facing vector (sinθ, cosθ, 0)_enu
 *                            →  (sinθ, 0, -cosθ)_three  =  rotation.y = −θ
 *
 * Dragging runs the exact inverse (threeToEnu / threeDirToEnuFacing).
 * Do not add a second convention anywhere.
 *
 * samplePath is a faithful port of the Blender bridge's sample_path
 * (linear positions/fov, shortest-arc angles) so the panel scrubs exactly
 * what the bridge renders.
 *
 * Everything here is pure so it runs under `node --test`.
 */

export function enuToThree(pos) {
  return { x: Number(pos?.x_m) || 0, y: Number(pos?.z_m) || 0, z: 0 - (Number(pos?.y_m) || 0) }
}

export function threeToEnu(v) {
  return { x_m: v.x, y_m: -v.z, z_m: v.y }
}

export function enuFacingToThreeYaw(facingDeg) {
  return (-(Number(facingDeg) || 0) * Math.PI) / 180
}

/** From a three-space ground direction back to an ENU facing in degrees. */
export function threeDirToEnuFacing(dx, dz) {
  return ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360
}

/** v7 path keys nest position; v6 export keys carry x_m/y_m/z_m flat. */
export function normPathKey(key) {
  const src = key && typeof key === 'object' ? key : {}
  const pos = src.position && typeof src.position === 'object' ? src.position : src
  const out = {
    t_s: Number(src.t_s) || 0,
    x_m: Number(pos.x_m) || 0,
    y_m: Number(pos.y_m) || 0,
    z_m: Number(pos.z_m) || 0,
  }
  for (const field of ['facing_deg', 'pitch_deg', 'roll_deg', 'fov_deg']) {
    if (src[field] !== null && src[field] !== undefined && Number.isFinite(Number(src[field]))) {
      out[field] = Number(src[field])
    }
  }
  return out
}

const lerp = (a, b, u) => a + (b - a) * u

/** Shortest-arc angle lerp (degrees): 350° → 10° passes through 0°, not 180°. */
export function lerpAngle(a, b, u) {
  return a + ((((b - a + 180) % 360) + 360) % 360 - 180) * u
}

const LINEAR_KEYS = ['x_m', 'y_m', 'z_m', 'fov_deg']
const ANGLE_KEYS = ['facing_deg', 'pitch_deg', 'roll_deg']

/**
 * Sample a path at time t (seconds). `keys` are raw v7/v6 path keys (nested
 * or flat — normalized here); `base` holds the static fallbacks. Keys outside
 * the path range clamp to the first/last key. Linear for positions and fov,
 * shortest-arc for angles — identical to the bridge's sample_path.
 */
export function samplePath(keys, t, base = {}) {
  const path = (Array.isArray(keys) ? keys : []).map(normPathKey).sort((a, b) => a.t_s - b.t_s)
  if (!path.length) return { ...base }
  const time = Number(t) || 0
  if (time <= path[0].t_s) return { ...base, ...path[0] }
  if (time >= path[path.length - 1].t_s) return { ...base, ...path[path.length - 1] }
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    if (a.t_s <= time && time <= b.t_s) {
      const u = (time - a.t_s) / (b.t_s - a.t_s || 1e-9)
      const out = { ...base }
      for (const key of LINEAR_KEYS) {
        if (key in a || key in b) {
          out[key] = lerp(a[key] ?? base[key] ?? 0, b[key] ?? base[key] ?? 0, u)
        }
      }
      for (const key of ANGLE_KEYS) {
        if (key in a || key in b) {
          out[key] = lerpAngle(a[key] ?? base[key] ?? 0, b[key] ?? base[key] ?? 0, u)
        }
      }
      return out
    }
  }
  return { ...base }
}

/**
 * Camera frustum corner rays in ENU space, from fov/pitch/yaw/roll.
 * Returns the four far-plane corner direction vectors (length `length`)
 * in ENU coordinates: [{x, y, z} × 4] in order TL, TR, BR, BL.
 * fovDeg is the VERTICAL field of view (v7 camera.fov_deg convention).
 */
export function frustumRaysEnu({ fovDeg = 40.95, aspect = 16 / 9, yawDeg = 0, pitchDeg = 0, length = 3 } = {}) {
  const halfH = Math.tan((Number(fovDeg) / 2) * (Math.PI / 180))
  const halfW = halfH * aspect
  const pitch = (Number(pitchDeg) * Math.PI) / 180
  const yaw = (Number(yawDeg) * Math.PI) / 180
  // Camera-local corners, forward = -Z (three convention).
  const local = [
    [-halfW, halfH, -1],
    [halfW, halfH, -1],
    [halfW, -halfH, -1],
    [-halfW, -halfH, -1],
  ]
  return local.map(([lx, ly, lz]) => {
    // Pitch about camera X (positive = look up).
    const py = ly * Math.cos(pitch) - lz * Math.sin(pitch)
    const pz = ly * Math.sin(pitch) + lz * Math.cos(pitch)
    // Camera/three space → ENU: (X, Y, Z)_three → (X, -Z, Y)_enu.
    let ex = lx
    let ey = -pz
    let ez = py
    // Yaw about ENU up (+Z), clockwise with 0° = +Y → rotate by −θ.
    const rx = ex * Math.cos(-yaw) - ey * Math.sin(-yaw)
    const ry = ex * Math.sin(-yaw) + ey * Math.cos(-yaw)
    const norm = Math.hypot(rx, ry, ez) || 1
    const scale = length / norm
    return { x: rx * scale, y: ry * scale, z: ez * scale }
  })
}

/**
 * Normalize an environment footprint point. Accepts `{x_m, y_m}` objects
 * (legacy/v7 convention) or `[x, y]` pairs. Returns null when unusable.
 */
export function normFootprintPoint(point) {
  if (Array.isArray(point)) {
    const [x, y] = point
    if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
      return { x_m: Number(x), y_m: Number(y) }
    }
    return null
  }
  if (point && typeof point === 'object') {
    const x = Number(point.x_m ?? point.x)
    const y = Number(point.y_m ?? point.y)
    if (Number.isFinite(x) && Number.isFinite(y)) return { x_m: x, y_m: y }
  }
  return null
}

/** Canonical footprint: array of {x_m, y_m}, invalid points dropped. */
export function normalizeFootprint(footprint) {
  if (!Array.isArray(footprint)) return []
  return footprint.map(normFootprintPoint).filter(Boolean)
}
