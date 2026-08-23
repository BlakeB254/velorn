import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_CAM_NAME,
  blockingDirRel,
  camNameForDoc,
  controlDirRel,
  frameRangeForDoc,
  listControlFrames,
  renderBlockingControl,
} from '../src/services/blockingRender.js'
import { newBlockingDoc } from '../src/services/blockingV7.js'

const baseDoc = () => {
  const doc = newBlockingDoc()
  doc.characters = [
    { cast_id: 'stud', label: 'The Stud', position: { x_m: 0.4, y_m: 3.5, z_m: 0 }, facing_deg: 180, height_m: 1.85 },
  ]
  return doc
}

/** Mock electronAPI with a scripted blockingRender + directory listings. */
function mockApi({ renderResult, listings = {} } = {}) {
  const calls = { blockingRender: [], listDirectory: [] }
  return {
    calls,
    pathJoin: async (...parts) => parts.join('/'),
    blockingRender: async (payload) => {
      calls.blockingRender.push(payload)
      return renderResult ?? { success: true, controlDir: '/p/docs/blocking/shot/control', frames: { start: 1, end: 9, fps: 25 } }
    },
    listDirectory: async (dir) => {
      calls.listDirectory.push(dir)
      const names = listings[dir]
      return names ? { success: true, items: names.map((name) => ({ name })) } : { success: false, error: 'missing' }
    },
  }
}

function withApi(api, fn) {
  globalThis.window = { electronAPI: api }
  return Promise.resolve()
    .then(fn)
    .finally(() => { delete globalThis.window })
}

/* ── pure path helpers ────────────────────────────────────────────────── */

test('blockingDirRel slugifies the shot slug', () => {
  assert.equal(blockingDirRel('S1 SH 2'), 'docs/blocking/S1-SH-2')
  assert.equal(blockingDirRel('shot_01'), 'docs/blocking/shot_01')
})

test('camNameForDoc honors camera_id, falls back to CAM_canonical', () => {
  assert.equal(camNameForDoc({ camera: { camera_id: 'CAM_hero' } }), 'CAM_hero')
  assert.equal(camNameForDoc({ camera: {} }), DEFAULT_CAM_NAME)
  assert.equal(camNameForDoc(null), DEFAULT_CAM_NAME)
})

test('controlDirRel matches the bridge contract <out>/<shot>/<CAM>', () => {
  assert.equal(controlDirRel('shot_01'), 'docs/blocking/shot_01/control/shot_01/CAM_canonical')
  assert.equal(controlDirRel('shot_01', 'CAM_hero'), 'docs/blocking/shot_01/control/shot_01/CAM_hero')
})

/* ── frameRangeForDoc ─────────────────────────────────────────────────── */

test('frameRangeForDoc derives frames from duration_s × fps', () => {
  assert.deepEqual(frameRangeForDoc({ fps: 25, duration_s: 4 }), { fps: 25, start: 1, frames: 100 })
  assert.deepEqual(frameRangeForDoc({ fps: 30, playback: { duration_s: 2 } }), { fps: 30, start: 1, frames: 60 })
})

test('frameRangeForDoc falls back to 25 fps / 25 frames', () => {
  assert.deepEqual(frameRangeForDoc({}), { fps: 25, start: 1, frames: 25 })
  assert.deepEqual(frameRangeForDoc({ duration_s: 0.2 }), { fps: 25, start: 1, frames: 5 })
})

/* ── listControlFrames ────────────────────────────────────────────────── */

test('listControlFrames reads the three pass dirs', async () => {
  const base = '/p/docs/blocking/shot_01/control/shot_01/CAM_canonical'
  const api = mockApi({
    listings: {
      [`${base}/green`]: ['f0001.png', 'f0002.png'],
      [`${base}/pose`]: ['f0001.png', 'f0002.png'],
      [`${base}/depth`]: ['f0001.png', 'f0002.png'],
    },
  })
  const listing = await listControlFrames(api, '/p', 'shot_01')
  assert.deepEqual(listing, {
    green: ['f0001.png', 'f0002.png'],
    pose: ['f0001.png', 'f0002.png'],
    depth: ['f0001.png', 'f0002.png'],
  })
})

test('listControlFrames returns null when a pass dir is missing', async () => {
  const api = mockApi({ listings: {} })
  assert.equal(await listControlFrames(api, '/p', 'shot_01'), null)
  assert.equal(await listControlFrames(null, '/p', 'shot_01'), null)
})

/* ── renderBlockingControl orchestration ──────────────────────────────── */

test('renderBlockingControl fails closed without the desktop api', async () => {
  const outcome = await renderBlockingControl({ projectPath: '/p', shotSlug: 's', doc: baseDoc() })
  assert.equal(outcome.ok, false)
  assert.match(outcome.error, /desktop app/)
})

test('renderBlockingControl aborts on failing gates without spawning the bridge', async () => {
  const doc = baseDoc()
  doc.characters[0].position.z_m = 0.4 // G3 plant violation
  const api = mockApi()
  const outcome = await withApi(api, () => renderBlockingControl(
    { projectPath: '/p', shotSlug: 'shot_01', doc },
    { saveBlockingDoc: async () => {}, loadBlockingDoc: async () => null },
  ))
  assert.equal(outcome.ok, false)
  assert.match(outcome.error, /G3/)
  assert.equal(api.calls.blockingRender.length, 0)
})

test('renderBlockingControl saves, renders, reloads and passes G5', async () => {
  const base = '/p/docs/blocking/shot_01/control/shot_01/CAM_canonical'
  const passes = ['f0001.png', 'f0002.png', 'f0003.png']
  const api = mockApi({
    listings: { [`${base}/green`]: passes, [`${base}/pose`]: passes, [`${base}/depth`]: passes },
  })
  let saved = 0
  const outcome = await withApi(api, () => renderBlockingControl(
    { projectPath: '/p', shotSlug: 'shot_01', doc: { ...baseDoc(), fps: 25, duration_s: 0.12 } },
    { saveBlockingDoc: async () => { saved += 1 }, loadBlockingDoc: async () => null },
  ))
  assert.equal(outcome.ok, true, outcome.error)
  assert.equal(saved, 1)
  assert.equal(api.calls.blockingRender.length, 1)
  const payload = api.calls.blockingRender[0]
  assert.equal(payload.projectPath, '/p')
  assert.equal(payload.shotSlug, 'shot_01')
  assert.deepEqual([payload.start, payload.frames, payload.fps], [1, 3, 25])
  assert.equal(outcome.gates.ready, true)
  assert.equal(outcome.gates.gates.find((g) => g.gate === 'G5').status, 'pass')
})

test('renderBlockingControl reports bridge failure with the log tail', async () => {
  const api = mockApi({ renderResult: { success: false, error: 'render_apply failed (blender exit 1)', log: 'Traceback…' } })
  const outcome = await withApi(api, () => renderBlockingControl(
    { projectPath: '/p', shotSlug: 'shot_01', doc: baseDoc() },
    { saveBlockingDoc: async () => {}, loadBlockingDoc: async () => null },
  ))
  assert.equal(outcome.ok, false)
  assert.match(outcome.error, /render_apply failed/)
  assert.equal(outcome.log, 'Traceback…')
})

test('renderBlockingControl surfaces a G5 frame-lock failure after render', async () => {
  const base = '/p/docs/blocking/shot_01/control/shot_01/CAM_canonical'
  const api = mockApi({
    listings: {
      [`${base}/green`]: ['f0001.png', 'f0002.png'],
      [`${base}/pose`]: ['f0001.png'],
      [`${base}/depth`]: ['f0001.png', 'f0002.png'],
    },
  })
  const outcome = await withApi(api, () => renderBlockingControl(
    { projectPath: '/p', shotSlug: 'shot_01', doc: baseDoc() },
    { saveBlockingDoc: async () => {}, loadBlockingDoc: async () => null },
  ))
  assert.equal(outcome.ok, false)
  assert.match(outcome.error, /G5/)
})

/* ── multi-camera cuts ────────────────────────────────────────────────── */

test('camNamesForDoc returns primary plus unique cut ids', async () => {
  const { camNamesForDoc } = await import('../src/services/blockingRender.js')
  assert.deepEqual(camNamesForDoc(baseDoc()), ['CAM_canonical'])
  const doc = baseDoc()
  doc.camera.cuts = [
    { camera_id: 'CAM_close' },
    { camera_id: 'CAM_close' },
    { camera_id: '' },
    { camera_id: 'CAM_wide' },
  ]
  assert.deepEqual(camNamesForDoc(doc), ['CAM_canonical', 'CAM_close', 'CAM_wide'])
})

test('renderBlockingControl checks G5 across all doc cameras', async () => {
  const doc = baseDoc()
  doc.camera.cuts = [{ camera_id: 'CAM_close', position: { x_m: 0.5, y_m: 1.5, z_m: 1.6 }, fov_deg: 28 }]
  const passes = ['f0001.png']
  const listings = {}
  for (const cam of ['CAM_canonical', 'CAM_close']) {
    for (const p of ['green', 'pose', 'depth']) {
      listings[`/p/docs/blocking/shot_01/control/shot_01/${cam}/${p}`] = passes
    }
  }
  const api = mockApi({ listings })
  const outcome = await withApi(api, () => renderBlockingControl(
    { projectPath: '/p', shotSlug: 'shot_01', doc },
    { saveBlockingDoc: async () => {}, loadBlockingDoc: async () => null },
  ))
  assert.equal(outcome.ok, true, outcome.error)
  const g5 = outcome.gates.gates.find((g) => g.gate === 'G5')
  assert.equal(g5.status, 'pass')
  assert.ok(g5.reasons[0].includes('2 camera'))
})
