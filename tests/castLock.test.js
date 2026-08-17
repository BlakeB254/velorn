import { test } from 'node:test'
import assert from 'node:assert/strict'

import { emptyStudio, normalizeStudio } from '../src/services/studioStore.js'
import {
  addShotCharacter,
  appendGraphEdges,
  checkCastRefs,
  gateGeneration,
  GRAPH_EDGE_TYPES,
  isGeneratedOutputPath,
  lockCastMembers,
  unlockCastMembers,
} from '../src/services/castLock.js'

const uniqueCast = {
  hero: {
    anchor: 'assets/hero-front.png',
    face_ref: 'assets/hero-face.png',
    outfit: 'black tee',
    never: 'hat',
    ref_set: {
      face_closeup: 'assets/hero-face.png',
      full_front: 'assets/hero-full.png',
      full_side: 'assets/hero-side.png',
      pendant: 'assets/hero-pendant.png',
    },
  },
  guest: {
    anchor: 'assets/guest-front.png',
    face_ref: 'assets/guest-face.png',
    outfit: 'red jacket',
    ref_set: {
      front: 'assets/guest-front.png',
      full: 'assets/guest-full.png',
      three_quarter: 'assets/guest-34.png',
    },
  },
}

const makeStudio = (series = uniqueCast, extras = {}) => normalizeStudio({
  cast: { series, seasons: {}, episodes: {} },
  ...extras,
})

const existing = new Set([
  'assets/hero-front.png',
  'assets/hero-face.png',
  'assets/hero-full.png',
  'assets/hero-side.png',
  'assets/hero-pendant.png',
  'assets/guest-front.png',
  'assets/guest-face.png',
  'assets/guest-full.png',
  'assets/guest-34.png',
])
const fileExists = (path) => existing.has(path)

test('isGeneratedOutputPath flags pipeline dirs only', () => {
  assert.equal(isGeneratedOutputPath('assets/hero-front.png'), false)
  assert.equal(isGeneratedOutputPath('keyframes/clean/g-s2-last.png'), true)
  assert.equal(isGeneratedOutputPath('/proj/out/clip.mp4'), true)
  assert.equal(isGeneratedOutputPath('video/pool/take.mp4'), true)
  assert.equal(isGeneratedOutputPath('clips/x.png'), true)
})

test('checkCastRefs: unique curated refs pass', () => {
  const report = checkCastRefs(makeStudio(), { fileExists })
  assert.equal(report.ok, true)
  assert.equal(report.characters.length, 2)
  assert.ok(report.characters.every((item) => item.locked))
  assert.equal(report.blockers.length, 0)
})

test('checkCastRefs: shared group sheet is a blocker when it is the only ref', () => {
  const studio = makeStudio({
    a: { anchor: 'assets/trio.png' },
    b: { anchor: 'assets/trio.png' },
  })
  const report = checkCastRefs(studio, { fileExists: () => true })
  assert.equal(report.ok, false)
  assert.ok(report.blockers.every((line) => /group sheet/.test(line)))
})

test('checkCastRefs: generated-output canon is a blocker', () => {
  const studio = makeStudio({
    hero: { anchor: 'keyframes/clean/hero-last.png' },
  })
  const report = checkCastRefs(studio, { fileExists: () => true })
  assert.equal(report.ok, false)
  assert.ok(report.characters[0].derived_from_output)
  assert.match(report.blockers[0], /GENERATED OUTPUT/)
})

test('checkCastRefs: missing on-disk ref is a blocker when fileExists is provided', () => {
  const studio = makeStudio({ hero: { anchor: 'assets/missing.png' } })
  const report = checkCastRefs(studio, { fileExists: () => false })
  assert.equal(report.ok, false)
  assert.match(report.blockers[0], /missing on disk/)
})

test('checkCastRefs: unknown cast id is a blocker', () => {
  const report = checkCastRefs(makeStudio(), { castIds: ['ghost'], fileExists })
  assert.equal(report.ok, false)
  assert.match(report.blockers[0], /not in resolved cast/)
})

test('checkCastRefs: episode guests do not leak into the gate for another episode', () => {
  const studio = makeStudio(uniqueCast, {
    cast: {
      series: uniqueCast,
      seasons: {},
      episodes: { ep001: { walkon: { anchor: 'assets/walkon.png' } } },
    },
  })
  const ep002 = checkCastRefs(studio, { episode: 'ep002', castIds: ['walkon'], fileExists })
  assert.equal(ep002.ok, false)
  assert.match(ep002.blockers[0], /not in resolved cast/)
})

test('lockCastMembers freezes passing refs and writes production graph edges', () => {
  const locked = lockCastMembers(makeStudio(), { by: 'blake', fileExists })
  assert.equal(locked.cast.series.hero.frozen, true)
  assert.equal(locked.cast.series.hero.lock_frozen, true)
  assert.equal(locked.cast.series.hero.locked_by, 'blake')
  assert.ok(locked.graph.edges.some((edge) => edge.type === GRAPH_EDGE_TYPES.CAST_LOCK && edge.from.id === 'hero'))
  const report = checkCastRefs(locked, { fileExists })
  assert.ok(report.characters.every((item) => item.frozen))
})

test('lockCastMembers refuses an invalid cast', () => {
  const studio = makeStudio({ hero: { anchor: 'keyframes/bad.png' } })
  assert.throws(() => lockCastMembers(studio, { fileExists: () => true }), /ref gate/)
})

test('unlockCastMembers clears the freeze', () => {
  const locked = lockCastMembers(makeStudio(), { fileExists })
  const unlocked = unlockCastMembers(locked, { castIds: ['hero'] })
  assert.equal(unlocked.cast.series.hero.frozen, false)
  assert.equal(unlocked.cast.series.guest.frozen, true)
})

test('addShotCharacter refuses unknown and invalid casts, accepts a locked one', () => {
  const studio = makeStudio()
  const card = { id: 's1', cameraRig: { characters: [] } }
  assert.throws(() => addShotCharacter(card, studio, 'ghost', { fileExists }), /not in the resolved cast/)
  const bad = makeStudio({ hero: { anchor: 'assets/trio.png' }, guest: { anchor: 'assets/trio.png' } })
  assert.throws(() => addShotCharacter(card, bad, 'hero', { fileExists: () => true }), /group sheet/)
  const added = addShotCharacter(card, studio, 'hero', { fileExists })
  assert.equal(added.card.cameraRig.characters[0].cast_id, 'hero')
  assert.equal(added.edge.type, GRAPH_EDGE_TYPES.SHOT_CAST)
  assert.throws(() => addShotCharacter(added.card, studio, 'hero', { fileExists }), /already in this shot/)
})

test('gateGeneration allows crowd shots and blocks invalid assigned casts', () => {
  const studio = makeStudio()
  const crowd = gateGeneration(studio, { card: { id: 'wide', cameraRig: { characters: [] } }, fileExists })
  assert.equal(crowd.ok, true)
  assert.equal(crowd.skipped, true)

  const good = gateGeneration(studio, {
    card: { id: 'cu', cameraRig: { characters: [{ cast_id: 'hero' }] } },
    fileExists,
  })
  assert.equal(good.ok, true)
  assert.equal(good.skipped, false)

  const badStudio = makeStudio({ hero: { anchor: 'out/render.png' } })
  const blocked = gateGeneration(badStudio, {
    card: { id: 'cu', cameraRig: { characters: [{ cast_id: 'hero' }] } },
    fileExists: () => true,
  })
  assert.equal(blocked.ok, false)
  assert.match(blocked.reason, /GENERATED OUTPUT/)
})

test('appendGraphEdges is immutable and skips junk', () => {
  const s0 = emptyStudio()
  const frozen = JSON.stringify(s0)
  const next = appendGraphEdges(s0, [
    { type: 'ref_gate', from: { kind: 'shot', id: 's1' }, to: { kind: 'character', id: 'hero' }, result: 'block' },
    { type: '', from: { kind: 'x', id: 'y' }, to: { kind: 'a', id: 'b' } },
  ])
  assert.equal(JSON.stringify(s0), frozen)
  assert.equal(next.graph.edges.length, 1)
  assert.equal(next.graph.edges[0].type, 'ref_gate')
})
