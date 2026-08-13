import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  applyCameraPatch,
  applyCameraProposal,
  cameraPromptHint,
  emptyCamera,
  EYE_HEIGHT_M,
  presetFromLexicon,
  proposeCameraRig,
  rejectCameraProposal,
  setStandIns,
} from '../src/services/cameraRig.js'
import {
  bootstrapProduction,
  createEpisode,
  episodeCode,
  findEpisode,
  hydrateProductionFromProject,
  layeredContext,
  listEpisodes,
  normalizeEpisodeId,
  normalizeProduction,
  productionSummary,
  setCurrentEpisode,
  setProductionMeta,
  upsertSeason,
} from '../src/services/productionStore.js'
import {
  buildProductionPacket,
  buildShotPacket,
  listProductionCatalog,
} from '../src/services/productionPacket.js'

test('episode ids normalize across loose forms', () => {
  assert.equal(episodeCode(1, 1), 's01e001')
  assert.equal(normalizeEpisodeId('S1E1'), 's01e001')
  assert.equal(normalizeEpisodeId('ep001', 1), 's01e001')
  assert.equal(normalizeEpisodeId('2', 1), 's01e002')
})

test('hydrate CTT-shaped project as a show with season 1 / episode 1', () => {
  const project = {
    name: 'Chi-Town Triplets',
    settings: { width: 1080, height: 1920, fps: 24, cinematography: { lens_id: '35mm-anamorphic' } },
    cdxMigration: {
      slug: 'chi-town-triplets',
      title: 'Chi-Town Triplets',
      type: 'show',
      season: '1',
      episode: '1',
      runtime: '30s',
    },
    shortFilmDirector: {
      draft: {
        title: 'Chi-Town Triplets',
        premise: '30s Navy Pier cotton-candy rejection skit.',
        creativeDirection: 'Photoreal Chicago urban drama, 9:16.',
        aspectRatio: 'vertical_9x16',
        runtimeSeconds: 30,
        videoFps: 24,
      },
      characters: [{ id: 'character-trip_brother', slug: 'trip_brother', name: 'Brother' }],
      locations: [{ slug: 'navy_pier_cotton_candy', name: 'Navy Pier', heroAssetId: 'asset_1' }],
    },
    storyboardBoard: { version: 1, cards: [{ id: 'card-clip-1', order: 1, title: 'pier broll' }] },
  }

  const production = hydrateProductionFromProject(project)
  assert.equal(production.type, 'show')
  assert.equal(production.slug, 'chi-town-triplets')
  assert.equal(production.seasons.length, 1)
  assert.equal(production.seasons[0].id, 'season-01')
  assert.equal(production.seasons[0].episodes[0].id, 's01e001')
  assert.equal(production.current.episodeId, 's01e001')
  assert.equal(production.look.lens_id, '35mm-anamorphic')

  const layers = layeredContext(production)
  assert.equal(layers.show.title, 'Chi-Town Triplets')
  assert.equal(layers.season.id, 'season-01')
  assert.equal(layers.episode.id, 's01e001')
  assert.ok(layers.guide.some((layer) => layer.id === 'shot'))
})

test('bootstrapProduction seeds a show with episode 1 and keeps ads non-episodic type', () => {
  const show = bootstrapProduction({ name: 'Chi-Town Triplets', type: 'show' })
  assert.equal(show.type, 'show')
  assert.equal(show.current.episodeId, 's01e001')
  assert.equal(show.seasons[0].episodes[0].title, 'Episode 1')
  const ad = bootstrapProduction({ name: 'BiscuitGifs', type: 'advertisement' })
  assert.equal(ad.type, 'commercial')
  assert.equal(ad.current.episodeId, 's01e001')
  assert.equal(ad.seasons[0].episodes[0].title, 'Main')
})

test('createEpisode upgrades standalone to show and increments ids', () => {
  const first = createEpisode(normalizeProduction({ type: 'standalone', title: 'Demo' }), {
    title: 'Pilot',
    logline: 'We meet the crew',
  })
  assert.equal(first.production.type, 'show')
  assert.equal(first.episode.id, 's01e001')
  const second = createEpisode(first.production, { title: 'Navy Pier' })
  assert.equal(second.episode.id, 's01e002')
  assert.equal(second.production.current.episodeId, 's01e002')
  assert.equal(listEpisodes(second.production)[0].episodes.length, 2)
})

test('duplicate episode id throws', () => {
  const { production } = createEpisode(normalizeProduction({ type: 'show' }), { title: 'A' })
  assert.throws(() => createEpisode(production, { id: 's01e001', title: 'Dup' }), /already exists/)
})

test('switch episode and update meta', () => {
  let { production } = createEpisode(normalizeProduction({ type: 'show', title: 'Show' }), { title: 'Ep 1' })
  production = createEpisode(production, { title: 'Ep 2' }).production
  production = setCurrentEpisode(production, 's01e001')
  assert.equal(production.current.episodeId, 's01e001')
  production = setProductionMeta(production, {
    logline: 'Chicago siblings, one night.',
    show: { tone: 'urban drama', visualRules: 'locked wardrobe' },
  })
  assert.equal(production.logline, 'Chicago siblings, one night.')
  assert.equal(production.show.tone, 'urban drama')
  assert.ok(findEpisode(production, 's01e002'))
})

test('upsertSeason keeps existing episodes', () => {
  let { production } = createEpisode(normalizeProduction({ type: 'show' }), { title: 'A' })
  production = upsertSeason(production, { number: 1, title: 'Year One', premise: 'origin' })
  assert.equal(production.seasons[0].title, 'Year One')
  assert.equal(production.seasons[0].episodes.length, 1)
})

test('camera never starts on the ground plane', () => {
  const cam = emptyCamera()
  assert.ok(cam.z_m >= EYE_HEIGHT_M)
  const low = presetFromLexicon({ camera_angle_id: 'low-angle', framing_id: 'tight-medium', lens_id: '24mm-wide' })
  assert.ok(low.camera.z_m < 1)
  assert.ok(low.camera.pitch_deg > 0)
  const bird = presetFromLexicon({ camera_angle_id: 'birds-eye' })
  assert.ok(bird.camera.z_m > 4)
  assert.ok(bird.camera.pitch_deg < -70)
})

test('camera propose / apply / reject', () => {
  let rig = applyCameraPatch(undefined, { x_m: 0, y_m: -2, z_m: 1.55 })
  rig = proposeCameraRig(rig, { camera: { ...rig.camera, x_m: 1.2, pitch_deg: 8 }, note: 'slide right, look up', by: 'director' })
  assert.equal(rig.proposal.note, 'slide right, look up')
  assert.equal(rig.camera.x_m, 0)
  rig = applyCameraProposal(rig)
  assert.equal(rig.camera.x_m, 1.2)
  assert.equal(rig.proposal, null)
  rig = proposeCameraRig(rig, { camera: { x_m: 9 }, note: 'nope' })
  rig = rejectCameraProposal(rig)
  assert.equal(rig.proposal, null)
  assert.equal(rig.camera.x_m, 1.2)
  assert.match(cameraPromptHint(rig), /1\.20m right/)
})

test('stand-ins keep cast ids', () => {
  const rig = setStandIns(undefined, [{ cast_id: 'trip-brother', label: 'Brother' }, { castId: 'trip-fem-sister' }])
  assert.equal(rig.characters.length, 2)
  assert.equal(rig.characters[0].cast_id, 'trip-brother')
})

test('production packet compiles layers, shots, catalog extensions', () => {
  const project = {
    name: 'Chi-Town Triplets',
    settings: { cinematography: { mood_id: 'narrative-character' } },
    cdxMigration: { slug: 'chi-town-triplets', type: 'show', season: '1', episode: '1' },
    shortFilmDirector: {
      draft: { premise: 'Navy Pier skit', creativeDirection: '9:16 photoreal' },
      characters: [{ slug: 'trip_brother', name: 'Brother', referenceAssetId: 'a1' }],
      locations: [{ slug: 'navy_pier', name: 'Navy Pier', heroAssetId: 'a2', depthAssetId: 'a3', blenderPath: '/tmp/pier.blend' }],
    },
    storyboardBoard: {
      version: 1,
      cards: [{
        id: 'card-clip-1',
        order: 1,
        title: 'pier broll',
        action: 'crowd moves',
        imageAssetId: 'still1',
        videoAssetId: 'vid1',
        status: 'pending-review',
        shotSettings: { framing_id: 'wide-establishing', camera_angle_id: 'eye-level' },
        cameraRig: presetFromLexicon({ framing_id: 'wide-establishing', camera_angle_id: 'eye-level' }),
        characterRefs: [],
        locationRef: { assetId: 'a2', name: 'Navy Pier' },
      }],
    },
  }
  const packet = buildProductionPacket(project, { assets: [{ id: 'a2', name: 'pier-plate.png' }] })
  assert.equal(packet.production.type, 'show')
  assert.equal(packet.layers.episode.id, 's01e001')
  assert.equal(packet.storyboard.cardCount, 1)
  assert.equal(packet.sequence.haveClip, 1)
  assert.equal(packet.locations[0].reconstruction.blenderPath, '/tmp/pier.blend')
  assert.ok(packet.catalog.extensions.some((item) => item.id === 'camera-rig'))
  assert.ok(packet.howToRead.length >= 4)

  const shot = buildShotPacket(project, 'card-clip-1')
  assert.equal(shot.shot.clipStatus, 'review')
  assert.ok(shot.cameraRig.camera.z_m > 0)

  const catalog = listProductionCatalog()
  assert.ok(catalog.lexicon.categories.framing.options.length > 3)
  assert.equal(catalog.motions.assignOn, 'card.motionSlug')
})

test('hydrate does not clobber an existing production packet', () => {
  const project = {
    production: {
      type: 'show',
      title: 'Kept',
      current: { seasonId: 'season-02', episodeId: 's02e003' },
      seasons: [{
        id: 'season-02',
        number: 2,
        episodes: [{ id: 's02e003', number: 3, title: 'Later' }],
      }],
    },
    cdxMigration: { type: 'show', season: '1', episode: '1' },
  }
  const production = hydrateProductionFromProject(project)
  assert.equal(production.current.episodeId, 's02e003')
  assert.equal(production.seasons[0].episodes[0].title, 'Later')
})

test('productionSummary is lean for get_project', () => {
  const summary = productionSummary(hydrateProductionFromProject({
    name: 'X',
    cdxMigration: { type: 'show', slug: 'x', season: '1', episode: '1' },
  }))
  assert.equal(summary.type, 'show')
  assert.equal(summary.episodeCount, 1)
  assert.deepEqual(summary.layers, ['show', 'season', 'episode', 'shot'])
})
