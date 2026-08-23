import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  evalG0,
  evalG1,
  evalG2,
  evalG3,
  evalG4,
  evalG5,
  evalG6,
  evaluateGates,
  frameNumberSet,
  normalizeGatePath,
} from '../src/services/blockingGates.js'
import { newBlockingDoc } from '../src/services/blockingV7.js'

const baseDoc = () => {
  const doc = newBlockingDoc()
  doc.characters = [
    { cast_id: 'stud', label: 'The Stud', position: { x_m: 0.4, y_m: 3.5, z_m: 0 }, facing_deg: 180, height_m: 1.85 },
    { cast_id: 'guy', label: 'Random Guy', position: { x_m: -0.5, y_m: 3.0, z_m: 0 }, facing_deg: 90, height_m: 1.75 },
  ]
  return doc
}

/* ── G0 env flat ──────────────────────────────────────────────────────── */

test('G0 skips when there is no environment data', () => {
  const v = evalG0(baseDoc())
  assert.equal(v.status, 'skip')
  assert.match(v.reasons[0], /no environment data/)
})

test('G0 passes with a finite footprint (z-flat by construction)', () => {
  const doc = baseDoc()
  doc.environment = { footprint: [[-4, -4], [6, -4], [6, 8], [-4, 8]] }
  assert.equal(evalG0(doc).status, 'pass')
})

test('G0 fails on non-finite footprint points or tilt > 1.5°', () => {
  const bad = baseDoc()
  bad.environment = { footprint: [[0, 0], [1, NaN], [0, 1]] }
  assert.equal(evalG0(bad).status, 'fail')
  const tilted = baseDoc()
  tilted.environment = { tilt_deg: 2.0 }
  assert.equal(evalG0(tilted).status, 'fail')
  const okTilt = baseDoc()
  okTilt.environment = { tilt_deg: 1.2 }
  assert.equal(evalG0(okTilt).status, 'pass')
})

/* ── G1 blocking exists ───────────────────────────────────────────────── */

test('G1 passes a valid doc and fails a missing/invalid one', () => {
  assert.equal(evalG1(baseDoc()).status, 'pass')
  assert.equal(evalG1(null).status, 'fail')
  const bad = baseDoc()
  bad.camera.position.z_m = 0.1 // below MIN_CAMERA_Z_M ground-plane trap
  const v = evalG1(bad)
  assert.equal(v.status, 'fail')
  assert.match(v.reasons[0], /z_m/)
})

/* ── G2 map underlay ──────────────────────────────────────────────────── */

test('G2 skips without footprint, fails with <3 points, passes with ≥3', () => {
  assert.equal(evalG2(baseDoc()).status, 'skip')
  const doc = baseDoc()
  doc.environment = { footprint: [[0, 0], [1, 1]] }
  assert.equal(evalG2(doc).status, 'fail')
  doc.environment = { footprint: [[0, 0], [4, 0], [4, 4], [0, 4]] }
  assert.equal(evalG2(doc).status, 'pass')
})

/* ── G3 character plant ───────────────────────────────────────────────── */

test('G3 passes planted characters, fails off-plane z and bad facing', () => {
  assert.equal(evalG3(baseDoc()).status, 'pass')
  const lifted = baseDoc()
  lifted.characters[0].position.z_m = 0.2
  assert.equal(evalG3(lifted).status, 'fail')
  const badFacing = baseDoc()
  badFacing.characters[1].facing_deg = 370
  assert.equal(evalG3(badFacing).status, 'fail')
})

test('G3 tolerance is a parameter (edge: exactly at tolerance passes)', () => {
  const doc = baseDoc()
  doc.characters[0].position.z_m = 0.05
  assert.equal(evalG3(doc).status, 'pass') // default 0.05, inclusive edge
  assert.equal(evalG3(doc, 0.01).status, 'fail') // tighter tolerance fails
  assert.equal(evalG3(doc, 0.5).status, 'pass') // seated-on-furniture opt-in
})

/* ── G4 t_s scrub ─────────────────────────────────────────────────────── */

test('G4 skips with no timing data or no duration', () => {
  assert.equal(evalG4(baseDoc()).status, 'skip')
  const pathsOnly = baseDoc()
  pathsOnly.characters[0].path = [{ t_s: 0, position: { x_m: 0, y_m: 3, z_m: 0 } }, { t_s: 2, position: { x_m: 1, y_m: 3, z_m: 0 } }]
  assert.equal(evalG4(pathsOnly).status, 'skip') // no duration_s to compare
})

test('G4 passes within duration +15% and fails on overrun', () => {
  const doc = baseDoc()
  doc.duration_s = 4
  doc.characters[0].path = [
    { t_s: 0, position: { x_m: 0, y_m: 3, z_m: 0 } },
    { t_s: 4.6, position: { x_m: 1, y_m: 3, z_m: 0 } }, // exactly duration × 1.15
  ]
  assert.equal(evalG4(doc).status, 'pass') // boundary is inclusive
  doc.characters[0].path[1].t_s = 4.61
  assert.equal(evalG4(doc).status, 'fail')
  // schema-1 style playback.duration_s is honored too
  const legacy = baseDoc()
  legacy.playback = { duration_s: 2 }
  legacy.camera.path = [
    { t_s: 0, position: { x_m: 0, y_m: -2, z_m: 1.55 } },
    { t_s: 2.2, position: { x_m: 0, y_m: -1, z_m: 1.55 } },
  ]
  assert.equal(evalG4(legacy).status, 'pass')
})

/* ── G5 control frame-lock ────────────────────────────────────────────── */

test('frameNumberSet only counts f%04d.png names', () => {
  const set = frameNumberSet(['f0001.png', 'f0002.png', 'notes.txt', 'f0003.exr', 'f1.png', 'f00012.png'])
  assert.deepEqual([...set].sort(), ['0001', '0002'])
})

test('G5 skips without a listing and passes identical frame sets', () => {
  assert.equal(evalG5(null).status, 'skip')
  const frames = { green: ['f0001.png', 'f0002.png'], pose: ['f0002.png', 'f0001.png'], depth: ['f0001.png', 'f0002.png'] }
  const v = evalG5(frames)
  assert.equal(v.status, 'pass')
  assert.equal(v.details.frames, 2)
})

test('G5 fails on mismatched sets, missing pass dirs, and empty passes', () => {
  const missing = { green: ['f0001.png', 'f0002.png'], pose: ['f0001.png'], depth: ['f0001.png', 'f0002.png'] }
  const v1 = evalG5(missing)
  assert.equal(v1.status, 'fail')
  assert.match(v1.reasons[0], /pose missing frame\(s\) 0002/)
  const extra = { green: ['f0001.png'], pose: ['f0001.png'], depth: ['f0001.png', 'f0002.png'] }
  assert.equal(evalG5(extra).status, 'fail')
  assert.equal(evalG5({ green: ['f0001.png'], pose: ['f0001.png'] }).status, 'fail') // no depth dir
  assert.equal(evalG5({ green: [], pose: ['f0001.png'], depth: ['f0001.png'] }).status, 'fail')
})

/* ── G6 identity refs ─────────────────────────────────────────────────── */

test('G6 skips when no character carries a ref', () => {
  const v = evalG6(baseDoc(), { approvedRoots: ['/proj'] })
  assert.equal(v.status, 'skip')
  assert.deepEqual(v.details.skipped, ['stud', 'guy'])
})

test('G6 passes refs under the approved root that exist (project-relative via baseDir)', () => {
  const doc = baseDoc()
  doc.characters[0].ref_set = { front: 'assets/stud-front.png' }
  const v = evalG6(doc, {
    approvedRoots: ['/proj'],
    baseDir: '/proj',
    fileExists: (p) => p === '/proj/assets/stud-front.png',
  })
  assert.equal(v.status, 'pass')
  assert.deepEqual(v.details.skipped, ['guy']) // per-character skip, not a fail
})

test('G6 fails refs outside the root or missing on disk', () => {
  const doc = baseDoc()
  doc.characters[0].ref_set = { front: '/tmp/invented-face.png' }
  const v1 = evalG6(doc, { approvedRoots: ['/proj'], fileExists: () => true })
  assert.equal(v1.status, 'fail')
  assert.match(v1.reasons[0], /outside the approved cast-ref roots/)
  const doc2 = baseDoc()
  doc2.characters[0].ref_set = { front: 'assets/gone.png' }
  const v2 = evalG6(doc2, { approvedRoots: ['/proj'], baseDir: '/proj', fileExists: () => false })
  assert.equal(v2.status, 'fail')
  assert.match(v2.reasons[0], /not found/)
})

test('G6 path traversal cannot escape the approved root', () => {
  assert.equal(normalizeGatePath('/proj/assets/../secret.png'), '/proj/secret.png')
  const doc = baseDoc()
  doc.characters[0].ref_set = { front: 'assets/../../etc/faces/x.png' }
  const v = evalG6(doc, { approvedRoots: ['/proj'], baseDir: '/proj', fileExists: () => true })
  assert.equal(v.status, 'fail')
})

/* ── evaluateGates ────────────────────────────────────────────────────── */

test('evaluateGates: ready means no fail — skips do not block', () => {
  const clean = evaluateGates(baseDoc()) // G0/G2/G4/G5/G6 skip, G1/G3 pass
  assert.equal(clean.gates.length, 7)
  assert.equal(clean.ready, true)
  const bad = baseDoc()
  bad.camera.fov_deg = 200
  assert.equal(evaluateGates(bad).ready, false)
})

/* ── G5 multi-camera cuts ─────────────────────────────────────────────── */

test('G5 multi: all-null listings skip, missing cam dir fails, per-cam lock passes', async () => {
  const { evalG5Multi } = await import('../src/services/blockingGates.js')
  // nothing rendered yet
  assert.equal(evalG5Multi({ CAM_canonical: null, CAM_close: null }).status, 'skip')
  // one cam missing its dir after a render -> fail (never a free pass)
  const good = { green: ['f0001.png'], pose: ['f0001.png'], depth: ['f0001.png'] }
  const missing = evalG5Multi({ CAM_canonical: good, CAM_close: null })
  assert.equal(missing.status, 'fail')
  assert.ok(missing.reasons[0].includes('CAM_close'))
  // per-cam frame-lock failure surfaces the cam name
  const badPose = { green: ['f0001.png'], pose: [], depth: ['f0001.png'] }
  const bad = evalG5Multi({ CAM_canonical: good, CAM_close: badPose })
  assert.equal(bad.status, 'fail')
  assert.ok(bad.reasons[0].includes('CAM_close'))
  // both locked -> pass
  const ok = evalG5Multi({ CAM_canonical: good, CAM_close: good })
  assert.equal(ok.status, 'pass')
  assert.ok(ok.reasons[0].includes('2 camera'))
})

test('evaluateGates prefers controlFramesByCam when provided', async () => {
  const doc = baseDoc()
  const good = { green: ['f0001.png'], pose: ['f0001.png'], depth: ['f0001.png'] }
  const out = evaluateGates(doc, { controlFramesByCam: { CAM_canonical: good, CAM_close: good } })
  const g5 = out.gates.find((g) => g.gate === 'G5')
  assert.equal(g5.status, 'pass')
  assert.ok(g5.reasons[0].includes('2 camera'))
})
