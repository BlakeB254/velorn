import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  emptyStudio,
  normalizeStudio,
  normalizeSeason,
  resolveCast,
  castCounts,
  addSlot,
  updateSlot,
  removeSlot,
  assignFrame,
  slotState,
  slotCounts,
  recordVerdict,
  verdictForShot,
  qaSummary,
  flowView,
  STUDIO_VERSION,
} from '../src/services/studioStore.js'

// Fixture mirroring ~/creative/chi-town-triplets/cast.yaml's SHAPE (trimmed
// field values, full structure — including the reserved `locations` key).
const CTT_CAST = {
  'trip-brother': {
    anchor: '/home/codex450/creative/chi-town-triplets/assets/episode-sheets/brother-sheet.png',
    comfy_ref: 'ctt-trio.png',
    face_ref: '/home/codex450/creative/chi-town-triplets/assets/ctt-brother-groupref-face.png',
    face_model: 'ctt-brother-grp1.safetensors',
    outfit: 'copper-brown locs, NO hat, black tee, AF pendant cuban link',
    never: 'hat, hoodie, glasses',
    ref_set: {
      front: 'assets/ctt-brother-ref-front.png',
      three_quarter: 'assets/ctt-brother-ref-34.png',
      full: 'assets/ctt-brother-ref-full.png',
      pendant: 'assets/ctt-brother-ref-pendant.png',
    },
    pendant_cutout: 'assets/pendant-cutouts/brother-pendant.png',
  },
  'trip-fem-sister': {
    anchor: 'assets/episode-sheets/fem-sheet-v2-patterned.png',
    comfy_ref: 'ctt-fem-sister.png',
    face_ref: 'assets/ctt-fem-groupref-face.png',
    face_model: 'ctt-fem-grp1.safetensors',
    outfit: 'pink patterned tie-dye crop top + shorts, very long dark curly hair',
    never: 'brown outfit (old v1 anchor), hat, short hair',
    ref_set: {
      front: 'assets/ctt-fem-ref-front.png',
      three_quarter: 'assets/ctt-fem-ref-34.png',
      full: 'assets/ctt-fem-ref-full.png',
      pendant: 'assets/ctt-fem-ref-pendant.png',
    },
    pendant_cutout: 'assets/pendant-cutouts/fem-pendant.png',
  },
  'trip-stud-sister': {
    anchor: 'assets/episode-sheets/stud-sheet-v3.png',
    comfy_ref: 'ctt-trio.png',
    face_ref: 'assets/ctt-stud-groupref-face.png',
    face_model: 'ctt-stud-grp1.safetensors',
    outfit: 'White Sox fitted cap over locs, TRUST NO ONE tee',
    never: 'male face, light skin, second hat in scene',
    ref_set: {
      front: 'assets/ctt-stud-ref-front.png',
      three_quarter: 'assets/ctt-stud-ref-34.png',
      full: 'assets/ctt-stud-ref-full.png',
      pendant: 'assets/ctt-stud-ref-pendant.png',
    },
    ref_set_draft: {
      full_front: 'assets/ctt-stud-ref-pack-grok/full-front.jpg',
    },
    pendant_cutout: 'assets/pendant-cutouts/stud-pendant.png',
  },
  'trip-random-guy': {
    anchor: 'assets/episode-sheets/guy-sheet.png',
    comfy_ref: 'ctt-random-guy.png',
    face_ref: 'assets/asset-2-355EE297.PNG',
    face_model: 'ctt-guy-mean4.safetensors',
    outfit: 'clean-shaven, diamond stud earring, DAMAGE pendant thin chain',
    never: 'printed DAMAGE on shirt, hat, locs, goatee',
    ref_set: {
      front: 'assets/ctt-guy-ref-front.png',
      three_quarter: 'assets/ctt-guy-ref-34.png',
      full: 'assets/ctt-guy-ref-full.png',
      pendant: 'assets/ctt-guy-ref-pendant.png',
    },
    pendant_cutout: 'assets/pendant-cutouts/guy-pendant.png',
  },
  locations: {
    'navy-pier-cotton-candy': {
      plate: 'assets/plates/plate-01-stand-daylight.png',
      comfy_ref: 'ctt-plate-stand.png',
    },
  },
}

const makeStudio = (overrides = {}) => normalizeStudio({
  version: STUDIO_VERSION,
  cast: { series: CTT_CAST, seasons: {}, episodes: {} },
  ...overrides,
})

// ── empty / normalize ────────────────────────────────────────────────────────

test('emptyStudio is a valid blank block', () => {
  const s = emptyStudio()
  assert.equal(s.version, STUDIO_VERSION)
  assert.deepEqual(s.cast, { series: {}, seasons: {}, episodes: {} })
  assert.deepEqual(s.slots, [])
  assert.deepEqual(s.qa, {})
})

test('normalizeStudio never throws on corrupt input', () => {
  for (const bad of [null, undefined, 42, 'junk', [], { slots: 'nope' }, { cast: [1] }, { qa: 'x' }]) {
    const s = normalizeStudio(bad)
    assert.equal(s.version, STUDIO_VERSION)
    assert.deepEqual(s.slots, [])
  }
  // null entries drop out; a dict without slot_id gets a synthetic id
  const s = normalizeStudio({ slots: [{ slot_id: 'b', order: 2 }, { slot_id: 'a', order: 1 }, null, { action: 'no id' }] })
  assert.deepEqual(s.slots.map((x) => x.slot_id), ['a', 'b', 'slot-3'])
  assert.equal(s.slots[0].assigned.first, null)
  assert.equal(s.slots[0].board_shot, null)
})

test('normalizeStudio drops invalid QA results to unverified', () => {
  const s = normalizeStudio({ qa: { s1: { video: { result: 'maybe', reason: 'x' }, audio: 'garbage' } } })
  const v = verdictForShot(s, 's1')
  assert.equal(v.video.result, 'unverified')
  assert.equal(v.audio.result, 'unverified')
})

// ── cast ─────────────────────────────────────────────────────────────────────

test('resolveCast: series members resolve with scope and provenance', () => {
  const members = resolveCast(makeStudio())
  assert.equal(members.length, 4)
  const brother = members.find((m) => m.cast_id === 'trip-brother')
  assert.equal(brother.scope, 'series')
  assert.equal(brother.defined_in, 'series')
  assert.deepEqual(brother.overridden_in, [])
  assert.deepEqual(brother.overrides, [])
  assert.equal(brother.display_name, 'Trip Brother')
  assert.equal(brother.fields.ref_set.front, 'assets/ctt-brother-ref-front.png')
})

test('resolveCast: reserved keys never become characters', () => {
  const members = resolveCast(makeStudio())
  assert.equal(members.find((m) => m.cast_id === 'locations'), undefined)
  assert.equal(members.length, 4)
})

test('resolveCast: characters-list form is accepted', () => {
  const s = normalizeStudio({
    cast: { series: { characters: [{ id: 'guest-1', outfit: 'red jacket' }] }, seasons: {}, episodes: {} },
  })
  const members = resolveCast(s)
  assert.equal(members.length, 1)
  assert.equal(members[0].cast_id, 'guest-1')
  assert.equal(members[0].fields.outfit, 'red jacket')
})

test('resolveCast: field-by-field episode override keeps the series ref_set', () => {
  const s = makeStudio({
    cast: {
      series: CTT_CAST,
      seasons: {},
      episodes: {
        ep001: {
          'trip-brother': { outfit: 'funeral black suit' },
          'ep001-guest': { display_name: 'One-off Guest', outfit: 'hi-vis vest' },
        },
      },
    },
  })
  const members = resolveCast(s, { episode: 'ep001' })
  const brother = members.find((m) => m.cast_id === 'trip-brother')
  assert.equal(brother.scope, 'series')
  assert.equal(brother.defined_in, 'series')
  assert.deepEqual(brother.overridden_in, ['ep001'])
  assert.deepEqual(brother.overrides, ['outfit'])
  assert.equal(brother.fields.outfit, 'funeral black suit')
  assert.equal(brother.fields.ref_set.front, 'assets/ctt-brother-ref-front.png')
  assert.equal(brother.fields.face_model, 'ctt-brother-grp1.safetensors')
  const guest = members.find((m) => m.cast_id === 'ep001-guest')
  assert.equal(guest.scope, 'episode')
  assert.equal(guest.defined_in, 'ep001')
})

test('resolveCast: episode guests do not leak into other episodes', () => {
  const s = makeStudio({
    cast: {
      series: CTT_CAST,
      seasons: {},
      episodes: { ep001: { 'ep001-guest': { outfit: 'hi-vis' } } },
    },
  })
  const ep002 = resolveCast(s, { episode: 'ep002' })
  assert.equal(ep002.find((m) => m.cast_id === 'ep001-guest'), undefined)
  assert.equal(ep002.length, 4)
  const none = resolveCast(s)
  assert.equal(none.find((m) => m.cast_id === 'ep001-guest'), undefined)
})

test('resolveCast: season tier merges between series and episode', () => {
  const s = makeStudio({
    cast: {
      series: CTT_CAST,
      seasons: {
        'season-01': { 'trip-brother': { face_model: 'ctt-brother-s01.safetensors' } },
      },
      episodes: { ep001: { 'trip-brother': { outfit: 'ep outfit' } } },
    },
  })
  const m = resolveCast(s, { season: '1', episode: 'ep001' }).find((x) => x.cast_id === 'trip-brother')
  assert.equal(m.fields.face_model, 'ctt-brother-s01.safetensors')
  assert.equal(m.fields.outfit, 'ep outfit')
  assert.deepEqual(m.overridden_in, ['season-01', 'ep001'])
  assert.deepEqual(m.overrides, ['face_model', 'outfit'])
})

test('normalizeSeason accepts loose forms', () => {
  assert.equal(normalizeSeason('1'), 'season-01')
  assert.equal(normalizeSeason('01'), 'season-01')
  assert.equal(normalizeSeason('Season 2'), 'season-02')
  assert.equal(normalizeSeason('season-12'), 'season-12')
  assert.equal(normalizeSeason(''), null)
  assert.equal(normalizeSeason(null), null)
})

test('castCounts reports per-tier counts', () => {
  const s = makeStudio({
    cast: { series: CTT_CAST, seasons: { 'season-01': { x: {} } }, episodes: { ep001: { g: {}, h: {} } } },
  })
  const counts = castCounts(s)
  assert.equal(counts.series, 4)
  assert.deepEqual(counts.seasons, { 'season-01': 1 })
  assert.deepEqual(counts.episodes, { ep001: 2 })
})

// ── slots ────────────────────────────────────────────────────────────────────

test('addSlot / updateSlot / removeSlot lifecycle', () => {
  let s = emptyStudio()
  s = addSlot(s, { slot_id: 'o1-arrival', action: 'doors open' })
  s = addSlot(s, { slot_id: 'o2-branch', action: 'siblings split' }, { after: 'o1-arrival' })
  assert.deepEqual(s.slots.map((x) => x.slot_id), ['o1-arrival', 'o2-branch'])
  assert.equal(s.slots[0].source, 'manual')
  assert.throws(() => addSlot(s, { slot_id: 'o1-arrival' }), /already exists/)

  s = updateSlot(s, 'o1-arrival', { action: 'G Wagon doors open', lane: 'H3 FL2VA', dur_s: 1.5 })
  assert.equal(s.slots[0].action, 'G Wagon doors open')
  assert.equal(s.slots[0].lane, 'H3 FL2VA')
  assert.equal(s.slots[0].dur_s, 1.5)
  assert.throws(() => updateSlot(s, 'nope', { action: 'x' }), /not found/)

  s = removeSlot(s, 'o2-branch')
  assert.equal(s.slots.length, 1)
  assert.throws(() => removeSlot(s, 'nope'), /not found/)
})

test('slot ops are immutable — input studio is untouched', () => {
  const s0 = addSlot(emptyStudio(), { slot_id: 'a' })
  const frozen = JSON.stringify(s0)
  assignFrame(s0, 'a', 'first', 'asset_1')
  updateSlot(s0, 'a', { action: 'changed' })
  removeSlot(s0, 'a')
  assert.equal(JSON.stringify(s0), frozen)
})

test('slotState derives filled/partial/placeholder from assigned approved frames', () => {
  const slot = { slot_id: 'x', assigned: { first: null, last: null } }
  assert.equal(slotState(slot), 'placeholder')
  slot.assigned.first = 'asset_a'
  assert.equal(slotState(slot), 'partial')
  slot.assigned.last = 'asset_b'
  assert.equal(slotState(slot), 'filled')
  // approved filter: an assignment pointing at a non-approved asset doesn't count
  assert.equal(slotState(slot, ['asset_a']), 'partial')
  assert.equal(slotState(slot, ['asset_a', 'asset_b']), 'filled')
  assert.equal(slotState(slot, []), 'placeholder')
})

test('assignFrame fills and clears first/last', () => {
  let s = addSlot(emptyStudio(), { slot_id: 's1' })
  s = assignFrame(s, 's1', 'first', 'asset_123')
  assert.equal(s.slots[0].assigned.first, 'asset_123')
  assert.equal(slotState(s.slots[0], ['asset_123']), 'partial')
  s = assignFrame(s, 's1', 'first', null)
  assert.equal(s.slots[0].assigned.first, null)
  assert.throws(() => assignFrame(s, 's1', 'middle', 'x'), /first.*last/)
  assert.throws(() => assignFrame(s, 'ghost', 'first', 'x'), /not found/)
})

// ── QA ───────────────────────────────────────────────────────────────────────

test('recordVerdict: unverified is the default and is not a pass', () => {
  const s = emptyStudio()
  const v = verdictForShot(s, 's1-approach')
  assert.equal(v.video.result, 'unverified')
  assert.equal(v.audio.result, 'unverified')
  assert.equal(v.overall, 'unverified')
  assert.equal(v.needs_regen, false)
})

test('recordVerdict: fail without a reason throws', () => {
  const s = emptyStudio()
  assert.throws(() => recordVerdict(s, 's1', { video: 'fail' }), /FAIL requires a reason/)
  assert.throws(() => recordVerdict(s, 's1', { audio: 'fail', reason: '  ' }), /FAIL requires a reason/)
  const ok = recordVerdict(s, 's1', { audio: 'fail', reason: 'placeholder VO' })
  assert.equal(ok.qa.s1.audio.result, 'fail')
})

test('recordVerdict: needs at least one track and valid results', () => {
  const s = emptyStudio()
  assert.throws(() => recordVerdict(s, 's1', {}), /at least one/)
  assert.throws(() => recordVerdict(s, 's1', { video: 'great' }), /invalid video result/)
})

test('recordVerdict: tracks are independent — one does not clobber the other', () => {
  let s = emptyStudio()
  s = recordVerdict(s, 's1-decline', { video: 'pass', by: 'director' })
  s = recordVerdict(s, 's1-decline', { audio: 'fail', reason: 'placeholder; needs final VO' })
  const v = verdictForShot(s, 's1-decline')
  assert.equal(v.video.result, 'pass')
  assert.equal(v.audio.result, 'fail')
  assert.equal(v.overall, 'fail')
  assert.equal(v.needs_regen, true)
  assert.deepEqual(v.regen_tracks, ['audio'])
})

test('verdictForShot: overall is fail if either fails, pass only if both pass', () => {
  let s = emptyStudio()
  s = recordVerdict(s, 'a', { video: 'pass', audio: 'pass' })
  assert.equal(verdictForShot(s, 'a').overall, 'pass')
  s = recordVerdict(s, 'b', { video: 'pass' })
  assert.equal(verdictForShot(s, 'b').overall, 'unverified')
})

test('qaSummary aggregates overall and per-track counts', () => {
  let s = emptyStudio()
  s = recordVerdict(s, 'pass-shot', { video: 'pass', audio: 'pass' })
  s = recordVerdict(s, 'fail-shot', { video: 'pass', audio: 'fail', reason: 'bad VO' })
  s = recordVerdict(s, 'half-reviewed', { video: 'pass' })
  const sum = qaSummary(s)
  assert.equal(sum.shots_with_verdicts, 3)
  assert.deepEqual(sum.overall, { pass: 1, fail: 1, unverified: 1 })
  assert.deepEqual(sum.per_track.video, { pass: 3, fail: 0, unverified: 0 })
  assert.deepEqual(sum.per_track.audio, { pass: 1, fail: 1, unverified: 1 })
})

// ── flow rail ────────────────────────────────────────────────────────────────

test('flowView: empty studio blocks at script, reaches nothing', () => {
  const view = flowView(emptyStudio())
  assert.deepEqual(view.nodes.map((n) => n.id), [
    'script', 'cast', 'scenes', 'storyboard', 'flf', 'video', 'review', 'edit', 'deliver',
  ])
  assert.equal(view.stage_reached, null)
  assert.equal(view.stage_blocked_at, 'script')
  assert.ok(view.nodes[0].blockers.length > 0)
})

test('flowView: full pipeline reaches deliver when everything passes', () => {
  let s = addSlot(emptyStudio(), { slot_id: 'o1', board_shot: 's1-ots' })
  s = assignFrame(s, 'o1', 'first', 'asset_f')
  s = assignFrame(s, 'o1', 'last', 'asset_l')
  s = { ...s, cast: { series: CTT_CAST, seasons: {}, episodes: {} } }
  s = normalizeStudio(s)
  s = recordVerdict(s, 's1-ots', { video: 'pass', audio: 'pass' })
  const view = flowView(s, { sceneCount: 3, videoCount: 1, editClips: 5, deliverables: 1 })
  assert.equal(view.stage_blocked_at, null)
  assert.equal(view.stage_reached, 'deliver')
  assert.ok(view.nodes.every((n) => n.ok))
})

test('flowView: reached vs blocked diverge — edit can exist while storyboard blocks', () => {
  let s = addSlot(emptyStudio(), { slot_id: 'o1' }) // placeholder slot
  s = { ...s, cast: { series: CTT_CAST, seasons: {}, episodes: {} } }
  s = normalizeStudio(s)
  const view = flowView(s, { sceneCount: 1, editClips: 4 })
  const byId = Object.fromEntries(view.nodes.map((n) => [n.id, n]))
  assert.equal(byId.storyboard.ok, false)
  assert.equal(byId.edit.ok, true)
  assert.equal(view.stage_blocked_at, 'storyboard')
  assert.equal(view.stage_reached, 'edit')
})

test('flowView: review blocks on unverified shots, not just fails', () => {
  let s = addSlot(emptyStudio(), { slot_id: 'o1', board_shot: 'shot-a' })
  s = assignFrame(s, 'o1', 'first', 'asset_f')
  s = assignFrame(s, 'o1', 'last', 'asset_l')
  s = { ...s, cast: { series: CTT_CAST, seasons: {}, episodes: {} } }
  s = normalizeStudio(s)
  // shot-a has no verdict at all → unverified → review not ok
  const view = flowView(s, { sceneCount: 1, videoCount: 1 })
  const review = view.nodes.find((n) => n.id === 'review')
  assert.equal(review.ok, false)
  assert.deepEqual(review.blockers, ['shot-a: unverified'])
})
