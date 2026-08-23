import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  enuFacingToThreeYaw,
  enuToThree,
  frustumRaysEnu,
  lerpAngle,
  normPathKey,
  normalizeFootprint,
  samplePath,
  threeDirToEnuFacing,
  threeToEnu,
} from '../src/services/blockingScene.js'

const closeTo = (actual, expected, eps = 1e-6) => {
  assert.ok(Math.abs(actual - expected) < eps, `expected ${actual} ≈ ${expected}`)
}

const wrap360 = (deg) => ((deg % 360) + 360) % 360

test('enuToThree / threeToEnu are the documented inverse mapping', () => {
  const three = enuToThree({ x_m: 1, y_m: 2, z_m: 3 })
  assert.deepEqual(three, { x: 1, y: 3, z: -2 }) // (x, z, −y)
  assert.deepEqual(threeToEnu(three), { x_m: 1, y_m: 2, z_m: 3 })
  assert.deepEqual(enuToThree({}), { x: 0, y: 0, z: 0 })
})

test('facing maps to rotation.y = −θ and back', () => {
  closeTo(enuFacingToThreeYaw(0), 0)
  closeTo(enuFacingToThreeYaw(90), -Math.PI / 2)
  closeTo(enuFacingToThreeYaw(-90), Math.PI / 2)
  // three facing −Z (north) at yaw 0; east-facing dir maps back to 90°
  closeTo(threeDirToEnuFacing(0, -1), 0)
  closeTo(threeDirToEnuFacing(1, 0), 90)
  closeTo(threeDirToEnuFacing(0, 1), 180)
})

test('normPathKey flattens v7 nested position and keeps v6 flat keys', () => {
  const nested = normPathKey({ t_s: 1.5, position: { x_m: 1, y_m: 2, z_m: 3 }, facing_deg: 90 })
  assert.deepEqual(nested, { t_s: 1.5, x_m: 1, y_m: 2, z_m: 3, facing_deg: 90 })
  const flat = normPathKey({ t_s: 0, x_m: -1, y_m: -2, z_m: 0.5, pitch_deg: -30, fov_deg: 24 })
  assert.deepEqual(flat, { t_s: 0, x_m: -1, y_m: -2, z_m: 0.5, pitch_deg: -30, fov_deg: 24 })
})

test('samplePath clamps outside the key range and returns base without keys', () => {
  const keys = [{ t_s: 1, x_m: 0, y_m: 0, z_m: 0 }, { t_s: 3, x_m: 2, y_m: 4, z_m: 0 }]
  assert.equal(samplePath([], 1, { x_m: 7 }).x_m, 7)
  assert.equal(samplePath(keys, 0, {}).x_m, 0) // before first key
  assert.equal(samplePath(keys, 9, {}).x_m, 2) // after last key
})

test('samplePath lerps positions linearly mid-segment', () => {
  const keys = [{ t_s: 0, x_m: 0, y_m: 0, z_m: 0 }, { t_s: 2, x_m: 2, y_m: 4, z_m: 1 }]
  const mid = samplePath(keys, 1, {})
  closeTo(mid.x_m, 1)
  closeTo(mid.y_m, 2)
  closeTo(mid.z_m, 0.5)
})

test('samplePath interpolates angles on the shortest arc (wraparound)', () => {
  // Midpoint of 350° → 10° is 0° (returned as 360°, same heading as the bridge).
  closeTo(wrap360(lerpAngle(350, 10, 0.5)), 0)
  closeTo(wrap360(lerpAngle(10, 350, 0.5)), 0)
  closeTo(Math.abs(lerpAngle(-170, 170, 0.5)), 180) // ±180° is the same heading
  const keys = [
    { t_s: 0, x_m: 0, y_m: 0, z_m: 0, facing_deg: 350 },
    { t_s: 2, x_m: 0, y_m: 0, z_m: 0, facing_deg: 10 },
  ]
  closeTo(wrap360(samplePath(keys, 1, {}).facing_deg), 0)
})

test('samplePath sorts unordered keys like the bridge does', () => {
  const keys = [{ t_s: 2, x_m: 4, y_m: 0, z_m: 0 }, { t_s: 0, x_m: 0, y_m: 0, z_m: 0 }]
  closeTo(samplePath(keys, 1, {}).x_m, 2)
})

test('frustumRaysEnu: fov controls horizontal/vertical spread at level pitch', () => {
  const rays = frustumRaysEnu({ fovDeg: 90, aspect: 1, length: 1 })
  assert.equal(rays.length, 4)
  for (const r of rays) closeTo(Math.hypot(r.x, r.y, r.z), 1)
  // tan(45°) = 1 → all components equal magnitude; forward is +Y (north) at yaw 0.
  for (const r of rays) {
    closeTo(Math.abs(r.x), Math.abs(r.y))
    closeTo(Math.abs(r.y), Math.abs(r.z))
    assert.ok(r.y > 0, 'level camera looks north')
  }
  // Narrower fov → less spread: forward component dominates.
  const narrow = frustumRaysEnu({ fovDeg: 20, aspect: 1, length: 1 })
  assert.ok(narrow[0].y > 0.95)
})

test('frustumRaysEnu: pitch −90 points the frustum at the ground', () => {
  const rays = frustumRaysEnu({ fovDeg: 60, aspect: 1, pitchDeg: -90, length: 1 })
  const center = rays.reduce((acc, r) => ({ x: acc.x + r.x / 4, y: acc.y + r.y / 4, z: acc.z + r.z / 4 }), { x: 0, y: 0, z: 0 })
  closeTo(center.x, 0, 1e-9)
  closeTo(center.y, 0, 1e-9)
  // Corner rays are off-axis, so the centroid is shorter than a unit vector
  // but must point straight down: −1/√(1 + 2·tan²30°) ≈ −0.7746.
  closeTo(center.z, -1 / Math.sqrt(1 + 2 * Math.tan(Math.PI / 6) ** 2), 1e-9)
  assert.ok(center.z < -0.75)
})

test('frustumRaysEnu: yaw 90 turns the frustum east, clockwise from +Y', () => {
  const rays = frustumRaysEnu({ fovDeg: 40, aspect: 1, yawDeg: 90, length: 1 })
  const center = rays.reduce((acc, r) => ({ x: acc.x + r.x / 4, y: acc.y + r.y / 4, z: acc.z + r.z / 4 }), { x: 0, y: 0, z: 0 })
  closeTo(center.x, 1 / Math.sqrt(1 + 2 * Math.tan((20 * Math.PI) / 180) ** 2), 1e-9)
  closeTo(center.y, 0, 1e-9)
  assert.ok(center.x > 0.85, `expected east, got ${JSON.stringify(center)}`)
})

test('normalizeFootprint accepts objects and pairs, drops junk', () => {
  assert.deepEqual(
    normalizeFootprint([{ x_m: 1, y_m: 2 }, [3, 4], { x: 5, y: 6 }, null, ['a', 1], [7]]),
    [{ x_m: 1, y_m: 2 }, { x_m: 3, y_m: 4 }, { x_m: 5, y_m: 6 }],
  )
  assert.deepEqual(normalizeFootprint(undefined), [])
  assert.deepEqual(normalizeFootprint('nope'), [])
})
