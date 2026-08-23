import { test } from 'node:test'
import assert from 'node:assert/strict'

import { presetFromLexicon } from '../src/services/cameraRig.js'
import {
  DEFAULT_FPS,
  MIN_CAMERA_Z_M,
  SCHEMA_VERSION,
  newBlockingDoc,
  upgradeBlockingDoc,
  validateBlockingDoc,
} from '../src/services/blockingV7.js'

test('presetFromLexicon returns canonical lens fov values', () => {
  assert.equal(presetFromLexicon({ lens_id: '85mm-portrait' }).camera.fov_deg, 24)
  assert.equal(presetFromLexicon({ lens_id: '135mm-long' }).camera.fov_deg, 15)
  assert.equal(presetFromLexicon({ lens_id: 'macro-ecu' }).camera.fov_deg, 10)
  assert.equal(presetFromLexicon({ lens_id: 'fish-eye' }).camera.fov_deg, 120)
  assert.equal(presetFromLexicon({ lens_id: '24mm-wide' }).camera.fov_deg, 74)
})

test('presetFromLexicon returns canonical angle poses', () => {
  const bird = presetFromLexicon({ camera_angle_id: 'birds-eye' })
  assert.equal(bird.camera.pitch_deg, -75)
  assert.equal(bird.camera.z_m, 8.0)
  const high = presetFromLexicon({ camera_angle_id: 'high-angle' })
  assert.equal(high.camera.pitch_deg, -30)
  assert.equal(high.camera.z_m, 2.6)
  const low = presetFromLexicon({ camera_angle_id: 'low-angle' })
  assert.equal(low.camera.pitch_deg, 12)
  assert.equal(low.camera.z_m, 0.7)
  // Velorn-only ids stay supported, canonical-style (never under min camera z)
  const worms = presetFromLexicon({ camera_angle_id: 'worms-eye' })
  assert.ok(worms.camera.z_m >= MIN_CAMERA_Z_M)
  assert.ok(worms.camera.pitch_deg > 0)
  const topDown = presetFromLexicon({ camera_angle_id: 'top-down' })
  assert.equal(topDown.camera.z_m, 8.0)
  assert.ok(topDown.camera.pitch_deg <= -75)
})

test('presetFromLexicon moves the camera to canonical framing distances', () => {
  assert.equal(presetFromLexicon({ framing_id: 'wide-establishing' }).camera.y_m, -9)
  assert.equal(presetFromLexicon({ framing_id: 'extreme-close-up' }).camera.y_m, -0.5)
  assert.equal(presetFromLexicon({ framing_id: 'medium-shot' }).camera.y_m, -2.5)
})

test('presetFromLexicon keeps the default camera for unknown ids', () => {
  const rig = presetFromLexicon({
    camera_angle_id: 'three-quarter',
    framing_id: 'two-shot',
    lens_id: 'spherical-clean',
  })
  assert.equal(rig.camera.fov_deg, 40.95)
  assert.equal(rig.camera.z_m, 1.55)
  assert.equal(rig.camera.pitch_deg, -4)
  assert.equal(rig.source, 'lexicon-preset')
})

test('newBlockingDoc matches the cameraRig defaults', () => {
  const doc = newBlockingDoc()
  assert.equal(doc.schema_version, SCHEMA_VERSION)
  assert.equal(doc.coordinate_frame, 'blender_enu_meters')
  assert.equal(doc.fps, DEFAULT_FPS)
  assert.deepEqual(doc.camera.position, { x_m: 0, y_m: -2, z_m: 1.55 })
  assert.equal(doc.camera.pitch_deg, -4)
  assert.equal(doc.camera.fov_deg, 40.95)
  assert.deepEqual(validateBlockingDoc(doc), [])
})

test('upgradeBlockingDoc upgrades a v6 plain-dict doc', () => {
  const v6 = {
    schema_version: 2,
    shot_slug: 'shot-01',
    coordinate_frame: { name: 'blender_enu_meters' },
    camera: {
      camera_id: 'CAM_canonical',
      object_name: 'CAM_canonical',
      label: 'CAM_canonical',
      fov_deg: 54,
      position: { x_m: 1, y_m: -3, z_m: 2.2 },
      facing_deg: 90,
      pitch_deg: -30,
      roll_deg: 0,
      cuts: [],
      path: [{ t_s: 0, position: { x_m: 1, y_m: -3, z_m: 2.2 } }],
    },
    characters: [
      {
        cast_id: 'stud',
        label: 'The Stud',
        object_name: 'RIG_stud',
        color: '#7c5cff',
        height_m: 1.85,
        facing_deg: 180,
        locked: false,
        position: { x_m: 0.4, y_m: 3.5, z_m: 0 },
        path: [],
      },
    ],
    props: [],
  }
  const doc = upgradeBlockingDoc(v6)
  assert.equal(doc.schema_version, SCHEMA_VERSION)
  assert.equal(doc.coordinate_frame, 'blender_enu_meters')
  assert.equal(doc.shot_slug, 'shot-01')
  assert.equal(doc.camera.fov_deg, 54)
  assert.deepEqual(doc.camera.position, { x_m: 1, y_m: -3, z_m: 2.2 })
  assert.equal(doc.camera.facing_deg, 90)
  assert.equal(doc.camera.path.length, 1)
  assert.equal(doc.characters.length, 1)
  const stud = doc.characters[0]
  assert.equal(stud.cast_id, 'stud')
  assert.equal(stud.height_m, 1.85)
  assert.equal(stud.pose_slug, '')
  assert.equal(stud.motion_slug, '')
  assert.deepEqual(stud.bone_overrides, [])
  assert.deepEqual(stud.ref_set, {})
  // v6 extras survive the upgrade
  assert.equal(stud.object_name, 'RIG_stud')
  assert.deepEqual(validateBlockingDoc(doc), [])
})

test('upgradeBlockingDoc upgrades a schema-1 pydantic dump', () => {
  const schema1 = {
    schema_version: 1,
    project_slug: 'demo',
    shot_slug: 'shot-02',
    blocking_version_id: 'blocking-v001',
    coordinate_frame: { name: 'blender_enu_meters', bounds_m: { x: 10, y: 10 } },
    environment: { id: 'loc', label: 'Location', footprint: [] },
    camera: {
      camera_id: 'CAM_A',
      label: 'CAM_A',
      object_name: 'CAM_A',
      position: { x_m: 0, y_m: -2, z_m: 1.55 },
      facing_deg: 0,
      pitch_deg: -4,
      roll_deg: 0,
      fov_deg: 40,
      path: [],
      cuts: [],
    },
    characters: [],
    playback: { duration_s: 5, fps: 24 },
    approval: { state: 'draft' },
  }
  const doc = upgradeBlockingDoc(schema1)
  assert.equal(doc.schema_version, SCHEMA_VERSION)
  assert.equal(doc.fps, 24)
  assert.equal(doc.project_slug, 'demo')
  assert.equal(doc.camera.camera_id, 'CAM_A')
  assert.equal(doc.environment.id, 'loc')
  assert.deepEqual(validateBlockingDoc(doc), [])
})

test('upgradeBlockingDoc fills defaults instead of throwing', () => {
  assert.equal(upgradeBlockingDoc(null).schema_version, SCHEMA_VERSION)
  assert.equal(upgradeBlockingDoc({}).schema_version, SCHEMA_VERSION)
  const doc = upgradeBlockingDoc({ schema_version: 2, characters: [{ cast_id: 'kim' }] })
  assert.equal(doc.camera.position.z_m, 1.55)
  assert.equal(doc.characters[0].facing_deg, 180)
  assert.equal(doc.characters[0].height_m, 1.7)
  assert.deepEqual(validateBlockingDoc(doc), [])
})

test('upgradeBlockingDoc is idempotent on v7 docs', () => {
  const once = upgradeBlockingDoc(newBlockingDoc())
  const twice = upgradeBlockingDoc(once)
  assert.deepEqual(twice, once)
})

test('validateBlockingDoc catches a ground-plane camera', () => {
  const doc = newBlockingDoc()
  doc.camera.position.z_m = 0
  const problems = validateBlockingDoc(doc)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /ground-plane/)
})

test('validateBlockingDoc catches fov out of range, missing cast_id, unordered paths', () => {
  const doc = newBlockingDoc()
  doc.camera.fov_deg = 200
  doc.camera.path = [{ t_s: 2 }, { t_s: 1 }]
  doc.characters = [{ label: 'no id' }, { cast_id: 'kim', path: [{ t_s: 0 }] }]
  const problems = validateBlockingDoc(doc)
  assert.ok(problems.some((p) => p.includes('fov_deg')))
  assert.ok(problems.some((p) => p.includes('missing cast_id')))
  assert.ok(problems.some((p) => p.includes('out of order')))
})

test('upgradeBlockingDoc normalizes environment.footprint points canonically', () => {
  const doc = upgradeBlockingDoc({
    environment: { footprint: [[0, 0], { x_m: 4, y_m: 0 }, { x: 4, y: 3 }, null] },
  })
  assert.deepEqual(doc.environment.footprint, [
    { x_m: 0, y_m: 0 },
    { x_m: 4, y_m: 0 },
    { x_m: 4, y_m: 3 },
  ])
  assert.deepEqual(validateBlockingDoc(doc), [])
  // Absent footprint = no underlay, no complaint.
  assert.deepEqual(validateBlockingDoc(upgradeBlockingDoc({ environment: {} })), [])
})

test('validateBlockingDoc catches malformed environment.footprint', () => {
  const notArray = newBlockingDoc()
  notArray.environment = { footprint: 'nope' }
  assert.ok(validateBlockingDoc(notArray).some((p) => p.includes('environment.footprint')))

  const tooFew = newBlockingDoc()
  tooFew.environment = { footprint: [{ x_m: 0, y_m: 0 }, { x_m: 1, y_m: 0 }] }
  assert.ok(validateBlockingDoc(tooFew).some((p) => p.includes('at least 3 points')))

  const junkPoint = newBlockingDoc()
  junkPoint.environment = { footprint: [{ x_m: 0, y_m: 0 }, { x_m: 1, y_m: 0 }, { x_m: 'x' }] }
  assert.ok(validateBlockingDoc(junkPoint).some((p) => p.includes('finite')))
})

test('upgradeBlockingDoc preserves duration_s (direct and playback)', () => {
  assert.equal(upgradeBlockingDoc({ duration_s: 0.2 }).duration_s, 0.2)
  assert.equal(upgradeBlockingDoc({ playback: { duration_s: 3.5 } }).duration_s, 3.5)
  // Absent or non-positive duration stays absent (defaults come from fps).
  assert.equal('duration_s' in upgradeBlockingDoc({}), false)
  assert.equal('duration_s' in upgradeBlockingDoc({ duration_s: 0 }), false)
})

test('upgradeBlockingDoc normalizes camera.cuts (and strips nested cuts)', () => {
  const doc = upgradeBlockingDoc({
    camera: {
      camera_id: 'CAM_canonical',
      position: { x_m: 0, y_m: -2, z_m: 1.55 },
      cuts: [
        { camera_id: 'CAM_close', position: { x_m: 0.5, y_m: 1.5, z_m: 1.6 }, fov_deg: 28,
          cuts: [{ camera_id: 'CAM_nested' }] },
        'junk',
      ],
    },
  })
  assert.equal(doc.camera.cuts.length, 1)
  const cut = doc.camera.cuts[0]
  assert.equal(cut.camera_id, 'CAM_close')
  assert.equal(cut.position.x_m, 0.5)
  assert.equal(cut.fov_deg, 28)
  assert.deepEqual(cut.cuts, [])
})

test('validateBlockingDoc checks cuts camera_id uniqueness and pose', () => {
  const ok = upgradeBlockingDoc({
    camera: { position: { z_m: 1.55 }, fov_deg: 40,
      cuts: [{ camera_id: 'CAM_close', position: { z_m: 1.6 }, fov_deg: 28 }] },
  })
  assert.deepEqual(validateBlockingDoc(ok), [])

  const dup = upgradeBlockingDoc({
    camera: { position: { z_m: 1.55 }, fov_deg: 40,
      cuts: [{ camera_id: 'CAM_canonical', position: { z_m: 1.6 }, fov_deg: 28 }] },
  })
  assert.ok(validateBlockingDoc(dup).some((p) => p.includes('duplicates camera_id')))

  const nameless = upgradeBlockingDoc({
    camera: { position: { z_m: 1.55 }, fov_deg: 40,
      cuts: [{ position: { z_m: 1.6 }, fov_deg: 28 }] },
  })
  assert.ok(validateBlockingDoc(nameless).some((p) => p.includes('missing camera_id')))

  const lowCut = upgradeBlockingDoc({
    camera: { position: { z_m: 1.55 }, fov_deg: 40,
      cuts: [{ camera_id: 'CAM_low', position: { z_m: 0 }, fov_deg: 28 }] },
  })
  assert.ok(validateBlockingDoc(lowCut).some((p) => p.includes('ground-plane edge-on trap')))
})

test('applyRigToBlocking / ensureBlockingCamera preserve camera path and cuts', async () => {
  const { applyRigToBlocking, ensureBlockingCamera } = await import('../src/services/blockingStore.js')
  const doc = upgradeBlockingDoc({
    camera: {
      camera_id: 'CAM_canonical',
      position: { x_m: 0, y_m: -2, z_m: 1.55 },
      fov_deg: 40,
      path: [{ t_s: 0, position: { x_m: 0, y_m: -2, z_m: 1.55 } }],
      cuts: [{ camera_id: 'CAM_close', position: { x_m: 0.5, y_m: 1.5, z_m: 1.6 }, fov_deg: 28 }],
    },
  })
  const rig = { camera: { camera_id: 'CAM_canonical', x_m: 1, y_m: -2, z_m: 1.55, yaw_deg: 0, pitch_deg: 0, roll_deg: 0, fov_deg: 40 } }
  for (const out of [ensureBlockingCamera(doc), applyRigToBlocking(doc, rig)]) {
    assert.equal(out.camera.cuts.length, 1)
    assert.equal(out.camera.cuts[0].camera_id, 'CAM_close')
    assert.equal(out.camera.path.length, 1)
  }
})
