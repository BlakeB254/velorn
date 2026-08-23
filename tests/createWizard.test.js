import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  newWizardDraft,
  scaffoldFromWizard,
  validateDraft,
  wizardGroupForType,
  wizardStepsForType,
} from '../src/services/createWizard.js'
import { CHARACTER_ANCHORS, LOCATION_SLOTS, PROP_SLOTS } from '../src/services/referenceCards.js'

test('wizard step flows per type', () => {
  assert.equal(wizardGroupForType('show'), 'show')
  assert.equal(wizardGroupForType('movie'), 'script')
  assert.equal(wizardGroupForType('narrative'), 'script')
  assert.equal(wizardGroupForType('commercial'), 'ad')
  assert.equal(wizardGroupForType('psa'), 'ad')
  assert.equal(wizardGroupForType('ig-short'), 'ad')
  assert.equal(wizardGroupForType('music-video'), 'musicVideo')
  assert.equal(wizardGroupForType('something-new'), 'script')

  assert.deepEqual(wizardStepsForType('movie'), [
    'type', 'details', 'script', 'cast', 'locations', 'props', 'review',
  ])
  assert.deepEqual(wizardStepsForType('show'), [
    'type', 'details', 'bible', 'seasons', 'cast', 'locations', 'review',
  ])
  assert.deepEqual(wizardStepsForType('commercial'), [
    'type', 'details', 'subject', 'concept', 'faces', 'review',
  ])
  assert.deepEqual(wizardStepsForType('music-video'), [
    'type', 'details', 'song', 'artists', 'scenes', 'review',
  ])
})

test('validateDraft requires a usable name', () => {
  assert.equal(validateDraft(newWizardDraft('movie')).ok, false)
  assert.equal(validateDraft({ ...newWizardDraft('movie'), name: 'bad/name' }).ok, false)
  assert.equal(validateDraft({ ...newWizardDraft('movie'), name: 'My Film' }).ok, true)
})

test('movie scaffold: script parks on the main episode, cards are empty', () => {
  const draft = {
    ...newWizardDraft('movie'),
    name: 'Night Run',
    script: 'INT. WAREHOUSE — NIGHT\nA deal goes wrong.',
    cast: [{ name: 'Mara' }, { name: 'Dex', imagePath: '/tmp/dex.png' }, { name: 'Mara' }],
    locations: ['Warehouse', 'Rooftop'],
    props: ['Briefcase'],
  }
  const scaffold = scaffoldFromWizard(draft, { now: '2026-08-20T00:00:00Z' })

  assert.equal(scaffold.production.type, 'movie')
  assert.equal(scaffold.production.title, 'Night Run')
  assert.ok(scaffold.production.current.episodeId, 'current episode must stay set')
  const mainEpisode = scaffold.production.seasons[0].episodes[0]
  assert.ok(mainEpisode.synopsis.includes('WAREHOUSE'))

  assert.equal(scaffold.references.characters.length, 2) // Mara deduped
  assert.equal(scaffold.references.characters[0].name, 'Mara')
  assert.deepEqual(
    Object.keys(scaffold.references.characters[0].slots).slice(0, 2),
    [...CHARACTER_ANCHORS],
  )
  assert.ok(scaffold.references.characters.every((card) => (
    Object.values(card.slots).every((slot) => slot.status === 'empty')
  )))
  assert.deepEqual(scaffold.references.locations.map((card) => card.name), ['Warehouse', 'Rooftop'])
  assert.deepEqual(
    Object.keys(scaffold.references.locations[0].slots),
    [...LOCATION_SLOTS],
  )
  assert.deepEqual(
    Object.keys(scaffold.references.props[0].slots),
    [...PROP_SLOTS],
  )

  assert.equal(scaffold.creation.group, 'script')
  assert.ok(scaffold.creation.script.includes('deal goes wrong'))

  assert.deepEqual(scaffold.pendingImports, [{
    role: 'cast-image', path: '/tmp/dex.png', name: 'Dex', cardId: 'cast-dex', slotId: 'close_up_face',
  }])
})

test('show scaffold: seasons and episodes rebuild the production block', () => {
  const draft = {
    ...newWizardDraft('show'),
    name: 'Gangway',
    bible: { concept: 'Dock workers scheme', world: 'Port city', tone: 'Dry', logline: '' },
    seasons: [
      { title: 'One', episodes: [{ title: 'Pilot', script: 'Cold open' }, { title: 'Cargo' }] },
      { title: 'Two', episodes: [{ title: 'Strike' }] },
    ],
    cast: [{ name: 'Captain' }],
    locations: ['The Docks'],
  }
  const scaffold = scaffoldFromWizard(draft)

  const { production } = scaffold
  assert.equal(production.type, 'show')
  assert.equal(production.show.concept, 'Dock workers scheme')
  assert.equal(production.seasons.length, 2)
  assert.equal(production.seasons[0].episodes.length, 2)
  assert.equal(production.seasons[1].episodes.length, 1)
  assert.equal(production.seasons[0].episodes[0].synopsis, 'Cold open')
  // Lands on the first episode, not a bootstrap S1E1 duplicate.
  assert.equal(production.current.episodeId, production.seasons[0].episodes[0].id)
  assert.equal(production.seasons[0].episodes[0].title, 'Pilot')
  assert.equal(scaffold.references.characters[0].name, 'Captain')
  assert.equal(scaffold.references.locations[0].name, 'The Docks')
})

test('show scaffold without seasons falls back to bootstrap', () => {
  const draft = { ...newWizardDraft('show'), name: 'Empty Show' }
  const scaffold = scaffoldFromWizard(draft)
  assert.equal(scaffold.production.type, 'show')
  assert.equal(scaffold.production.seasons.length, 1)
  assert.equal(scaffold.production.seasons[0].episodes.length, 1)
  assert.ok(scaffold.production.current.episodeId)
})

test('ad scaffold: cdx subject + offerings + prompt concept + faces', () => {
  const draft = {
    ...newWizardDraft('commercial'),
    name: 'Acme Spring Spot',
    subject: {
      mode: 'cdx', orgId: '42', orgName: 'Acme',
      offerings: [{ id: '7', name: 'Pro Plan' }, { id: '8', name: 'Add-on' }],
    },
    concept: { mode: 'prompt', prompt: 'A upbeat 15s spot about saving time' },
    faces: [{ id: 'person-9', name: 'Jane Face' }],
  }
  const scaffold = scaffoldFromWizard(draft)

  assert.equal(scaffold.production.type, 'commercial')
  assert.equal(scaffold.creation.group, 'ad')
  assert.equal(scaffold.creation.next.flow, 'ad-easy-mode')
  assert.deepEqual(scaffold.creation.ad.subject, {
    mode: 'cdx', orgId: '42', orgName: 'Acme',
    offerings: [{ id: '7', name: 'Pro Plan' }, { id: '8', name: 'Add-on' }],
  })
  assert.equal(scaffold.creation.ad.concept.mode, 'prompt')
  assert.ok(scaffold.creation.ad.concept.prompt.includes('upbeat'))
  assert.deepEqual(scaffold.creation.ad.faceCardIds, ['person-9'])
  assert.equal(scaffold.references.characters[0].id, 'person-9')
  assert.equal(scaffold.pendingImports.length, 0)
})

test('ad scaffold: KB face with imageUrl queues a face-image-url import', () => {
  const draft = {
    ...newWizardDraft('commercial'),
    name: 'KB Face Spot',
    faces: [
      { id: 'face-p1', name: 'Jane Face', imageUrl: 'https://cdn.example.com/jane.jpg' },
      { id: 'face-p2', name: 'Name Only' },
    ],
  }
  const scaffold = scaffoldFromWizard(draft)
  assert.deepEqual(scaffold.pendingImports, [{
    role: 'face-image-url',
    url: 'https://cdn.example.com/jane.jpg',
    name: 'Jane Face',
    cardId: 'face-p1',
    slotId: 'close_up_face',
  }])
})

test('ad scaffold: manual company + uploaded concept file', () => {
  const draft = {
    ...newWizardDraft('commercial'),
    name: 'Made Up Co Spot',
    subject: { mode: 'manual', orgName: 'Totally Made Up Co' },
    concept: { mode: 'file', filePath: '/tmp/concept.pdf', fileName: 'concept.pdf' },
  }
  const scaffold = scaffoldFromWizard(draft)
  assert.equal(scaffold.creation.ad.subject.mode, 'manual')
  assert.equal(scaffold.creation.ad.subject.orgName, 'Totally Made Up Co')
  assert.equal(scaffold.creation.ad.concept.mode, 'file')
  assert.deepEqual(scaffold.pendingImports, [{
    role: 'concept-file', path: '/tmp/concept.pdf', name: 'concept.pdf',
  }])
})

test('music-video scaffold: song import, artists as character cards, scenes as location cards', () => {
  const draft = {
    ...newWizardDraft('music-video'),
    name: 'Midnight MV',
    song: { filePath: '/tmp/song.wav', fileName: 'song.wav' },
    artists: [{ name: 'The Singer', imagePath: '/tmp/singer.png' }],
    scenes: ['Neon Alley', 'Rooftop'],
  }
  const scaffold = scaffoldFromWizard(draft)

  assert.equal(scaffold.production.type, 'music-video')
  assert.equal(scaffold.creation.group, 'musicVideo')
  assert.equal(scaffold.creation.next.flow, 'music-video-easy-mode')
  assert.deepEqual(scaffold.creation.musicVideo, {
    songFileName: 'song.wav',
    artistCardIds: ['cast-the-singer'],
    scenes: ['Neon Alley', 'Rooftop'],
  })
  assert.equal(scaffold.references.characters[0].name, 'The Singer')
  assert.deepEqual(scaffold.references.locations.map((card) => card.name), ['Neon Alley', 'Rooftop'])

  assert.deepEqual(scaffold.pendingImports, [
    { role: 'song', path: '/tmp/song.wav', name: 'song.wav' },
    { role: 'artist-image', path: '/tmp/singer.png', name: 'The Singer', cardId: 'cast-the-singer', slotId: 'close_up_face' },
  ])
})

test('scaffold with bare name still produces a valid production', () => {
  const scaffold = scaffoldFromWizard({ ...newWizardDraft('ig-short'), name: 'Quick Hype' })
  assert.equal(scaffold.production.type, 'ig-short')
  assert.ok(scaffold.production.current.episodeId)
  assert.deepEqual(scaffold.references, { characters: [], locations: [], props: [] })
  assert.equal(scaffold.creation.ad.subject.mode, 'none')
  assert.equal(scaffold.creation.ad.concept.mode, 'none')
})
