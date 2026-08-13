import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildReviewTimeline,
  checkoutCut,
  cutStats,
  findCut,
  listCuts,
  loadEpisodeBoard,
  promoteCut,
  saveCut,
  snapshotLiveIntoCurrent,
  slugifyCut,
} from '../src/services/productionCuts.js'
import { shouldListProjectFolder } from '../src/services/projectListing.js'

const blakeBoard = {
  version: 1,
  cards: [
    { id: 'card-clip-1', title: 'pier broll', duration: 2, imageAssetId: 'still-1' },
    { id: 'card-clip-2', title: 'flirt', duration: 2.5, imageAssetId: 'still-2', videoAssetId: 'vid-2' },
  ],
}

const grokBoard = {
  version: 1,
  cards: [
    { id: 'card-clip-10', title: '1. COLD — punch', duration: 1.8, videoAssetId: 'punch' },
    { id: 'card-clip-5', title: '3. FLASH — insult', duration: 2.2, videoAssetId: 'insult' },
  ],
}

test('slugify and stats', () => {
  assert.equal(slugifyCut('Grok Draft 1'), 'grok-draft-1')
  assert.equal(slugifyCut('Draft 1'), 'draft-1')
  const stats = cutStats(blakeBoard)
  assert.equal(stats.cardCount, 2)
  assert.equal(stats.clipCount, 1)
  assert.equal(stats.runtimeS, 4.5)
})

test('save / checkout / promote keeps both drafts', () => {
  let index = {}
  const blake = saveCut(index, 's01e001', {
    name: 'Draft 1',
    author: 'blake',
    storyboardBoard: blakeBoard,
  })
  index = blake.index
  const grok = saveCut(index, 's01e001', {
    name: 'Grok Draft 1',
    author: 'grok',
    storyboardBoard: grokBoard,
  })
  index = grok.index
  const listed = listCuts(index, 's01e001')
  assert.equal(listed.cuts.length, 2)
  assert.equal(listed.primaryId, 'draft-1')
  assert.equal(listed.currentId, 'grok-draft-1')

  const checked = checkoutCut(index, 's01e001', 'Draft 1')
  assert.equal(checked.bucket.currentId, 'draft-1')
  assert.equal(checked.bucket.primaryId, 'draft-1')
  assert.equal(checked.cut.storyboardBoard.cards.length, 2)

  const promoted = promoteCut(checked.index, 's01e001', 'grok-draft-1')
  assert.equal(promoted.bucket.primaryId, 'grok-draft-1')
  assert.equal(promoted.bucket.currentId, 'draft-1')
  const stillBlake = findCut(promoted.index, 's01e001', 'draft-1').cut
  assert.equal(stillBlake.storyboardBoard.cards[0].title, 'pier broll')
})

test('snapshot live updates the checked-out cut only', () => {
  let index = saveCut({}, 's01e001', { name: 'Draft 1', storyboardBoard: blakeBoard }).index
  index = saveCut(index, 's01e001', { name: 'Grok Draft 1', storyboardBoard: grokBoard }).index
  const snapped = snapshotLiveIntoCurrent(index, 's01e001', {
    version: 1,
    cards: [{ id: 'card-clip-10', title: 'punch v2', duration: 1.8, videoAssetId: 'punch-2' }],
  })
  const grok = findCut(snapped.index, 's01e001', 'grok-draft-1').cut
  const blake = findCut(snapped.index, 's01e001', 'draft-1').cut
  assert.equal(grok.storyboardBoard.cards[0].title, 'punch v2')
  assert.equal(blake.storyboardBoard.cards[0].title, 'pier broll')
})

test('review timeline is sequential and watchable', () => {
  const saved = saveCut({}, 's01e001', { name: 'Grok Draft 1', storyboardBoard: grokBoard })
  const timeline = buildReviewTimeline({
    episodeId: 's01e001',
    cut: saved.cut,
    settings: { width: 1080, height: 1920, fps: 24 },
  })
  assert.equal(timeline.id, 'timeline-cut-s01e001-grok-draft-1')
  assert.equal(timeline.clips.length, 2)
  assert.equal(timeline.clips[0].type, 'video')
  assert.equal(timeline.clips[1].startTime, 1.8)
  assert.ok(timeline.duration >= 4)
})

test('episode versions stay on one show and do not leak boards', () => {
  let index = saveCut({}, 's01e001', { name: 'Draft 1', storyboardBoard: blakeBoard }).index
  index = saveCut(index, 's01e001', { name: 'Grok Draft 1', storyboardBoard: grokBoard }).index
  const ep2 = loadEpisodeBoard(index, 's01e002', { version: 1, cards: [] })
  assert.equal(ep2.created, true)
  assert.equal(ep2.cut.name, 'Draft 1')
  assert.equal(ep2.board.cards.length, 0)
  const e1 = listCuts(ep2.index, 's01e001')
  const e2 = listCuts(ep2.index, 's01e002')
  assert.equal(e1.cuts.length, 2)
  assert.equal(e2.cuts.length, 1)
  assert.equal(findCut(ep2.index, 's01e001', 'grok-draft-1').cut.storyboardBoard.cards.length, 2)
})

test('archived sibling cut folders stay off the project list', () => {
  assert.equal(shouldListProjectFolder('Chi-Town Triplets', '/home/codex450/VelornProjects/Chi-Town Triplets'), true)
  assert.equal(shouldListProjectFolder('Chi-Town Triplets Grok Cut', '/home/codex450/VelornProjects/_archive/Chi-Town Triplets Grok Cut'), false)
  assert.equal(shouldListProjectFolder('_archive', '/home/codex450/VelornProjects/_archive'), false)
})
