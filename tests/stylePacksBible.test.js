import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  applyStyleNegative,
  applyStylePack,
  listStylePacks,
  loadStylePack,
  loraStackFor,
  packStem,
} from '../src/services/stylePacks.js'
import {
  animationStylesForApi,
  getAnimationStyle,
  listAnimationStyles,
} from '../src/services/animationStyles.js'
import {
  bindFranchise,
  checkFranchiseConsistency,
  listFranchises,
  loadFranchise,
} from '../src/services/franchises.js'
import {
  applyBibleToPrompt,
  buildBible,
  importStudioBible,
  sealBible,
  shotBrief,
  stableBibleHash,
  unsealBible,
} from '../src/services/productionBible.js'
import {
  hydrateProductionFromProject,
  setProductionMeta,
} from '../src/services/productionStore.js'
import { buildProductionPacket, listProductionCatalog } from '../src/services/productionPacket.js'

const cttProject = {
  name: 'Chi-Town Triplets',
  settings: { width: 1080, height: 1920, fps: 24 },
  cdxMigration: {
    slug: 'chi-town-triplets',
    title: 'Chi-Town Triplets',
    type: 'show',
    season: '1',
    episode: '1',
    runtime: '30s',
    franchise: 'chi-town-triplets',
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
    characters: [
      { id: 'trip-brother', slug: 'trip_brother', name: 'Brother', prompt_fragment: 'locs, AF pendant, black tee', never: 'no extra jewelry' },
    ],
    locations: [{ slug: 'navy_pier_cotton_candy', name: 'Navy Pier' }],
  },
  studio: { cast: { series: { 'trip-brother': { display_name: 'Brother', outfit: 'black tee' } } } },
  storyboardBoard: { version: 1, cards: [{ id: 'card-1', order: 1, title: 'pier broll', action: 'Brother walks the boardwalk' }] },
}

test('style pack catalog loads hex-halo-street and applies tails without duplicating', () => {
  const packs = listStylePacks()
  assert.ok(packs.some((pack) => pack.id === 'hex-halo-street'))
  const pack = loadStylePack('styles/style-packs/hex-halo-street.yaml')
  assert.equal(packStem(pack.name), 'hex-halo-street')
  assert.ok(pack.swatches.includes('#c9a227'))
  const first = applyStylePack('Brother walks the pier', pack, 'still')
  assert.match(first, /photorealistic candid street photography/)
  const second = applyStylePack(first, pack, 'still')
  assert.equal(second, first)
  const video = applyStylePack('Brother walks the pier', pack, 'video')
  assert.match(video, /subtle handheld camera sway/)
  const negative = applyStyleNegative('low quality', pack)
  assert.match(negative, /deformed hands/)
  const loras = loraStackFor(pack, 'video')
  assert.equal(loras.length, 1)
  assert.match(loras[0].file, /ltx-2\.3-22b-distilled-lora/)
  assert.deepEqual(loraStackFor(pack, 'still'), [])
})

test('animation style catalog lists classic-2d-cel in the animation family', () => {
  const style = getAnimationStyle('classic-2d-cel')
  assert.equal(style.family, 'animation')
  assert.match(style.prompt_tail, /cel animation/i)
  const api = animationStylesForApi({ family: 'animation' })
  assert.ok(api.count >= 1)
  assert.ok(listAnimationStyles({ category: '2d' }).some((item) => item.id === 'classic-2d-cel'))
})

test('franchise bind inherits house pack and flags aspect drift', () => {
  const franchise = loadFranchise('chi-town-triplets')
  assert.equal(franchise.style_pack, 'hex-halo-street')
  assert.ok(listFranchises().some((item) => item.slug === 'little-legend-riders'))
  const bound = bindFranchise({ type: 'show', format: { aspect: '' }, show: {} }, 'chi-town-triplets')
  assert.equal(bound.ok, true)
  assert.equal(bound.production.stylePack, 'hex-halo-street')
  assert.equal(bound.production.format.aspect, '9:16')
  const drifted = checkFranchiseConsistency({
    franchiseSlug: 'chi-town-triplets',
    stylePack: 'bw-detective-noir',
    type: 'show',
    format: { aspect: '16:9' },
  })
  assert.equal(drifted.ok, false)
  assert.ok(drifted.issues.some((issue) => /style pack/.test(issue)))
  assert.ok(drifted.issues.some((issue) => /aspect/.test(issue)))
})

test('hydrate CTT project attaches franchise + hex-halo-street pack', () => {
  const production = hydrateProductionFromProject(cttProject)
  assert.equal(production.franchiseSlug, 'chi-town-triplets')
  assert.equal(production.stylePack, 'hex-halo-street')
  assert.equal(production.bible.sealed, false)
})

test('bible build / seal / import / shot brief stay draft and deterministic', () => {
  const production = hydrateProductionFromProject(cttProject)
  const live = buildBible(cttProject, { production })
  assert.equal(live.identity.franchise.slug, 'chi-town-triplets')
  assert.equal(live.style.style_pack, 'hex-halo-street')
  assert.equal(live.cast.count, 1)
  assert.equal(live.constraints.gpu_serial, true)
  assert.equal(live.constraints.outward, 'draft')
  assert.equal(live.content_hash, stableBibleHash({
    identity: live.identity,
    cast: live.cast,
    locations: live.locations,
    style: live.style,
    story: live.story,
    constraints: live.constraints,
  }))
  const sealed = sealBible(cttProject, { sealedBy: 'test', production })
  assert.equal(sealed.production.bible.sealed, true)
  assert.equal(sealed.bible.sealed_by, 'test')
  const opened = unsealBible(sealed.production)
  assert.equal(opened.bible.sealed, false)
  const imported = importStudioBible({
    version: 1,
    slug: 'chi-town-triplets',
    sealed: true,
    identity: { title: 'CTT', franchise: { slug: 'chi-town-triplets' } },
    style: { style_pack: 'styles/style-packs/hex-halo-street.yaml' },
    story: { premise: 'imported' },
  })
  assert.equal(imported.stylePack, 'hex-halo-street')
  assert.equal(imported.franchiseSlug, 'chi-town-triplets')
  const brief = shotBrief(live, { shotSlug: 's01', description: 'Brother walks' })
  assert.match(brief.text, /STYLE_PACK: hex-halo-street/)
  assert.match(brief.styled.prompt, /photorealistic/)
  const applied = applyBibleToPrompt('Brother walks', live, { kind: 'video' })
  assert.match(applied.prompt, /handheld camera sway/)
})

test('set_production can assign pack and production packet exposes style layer', () => {
  const production = setProductionMeta(hydrateProductionFromProject(cttProject), {
    stylePack: 'bw-detective-noir',
    animationStyle: 'classic-2d-cel',
  })
  assert.equal(production.stylePack, 'bw-detective-noir')
  const packet = buildProductionPacket({ ...cttProject, production })
  assert.equal(packet.style.pack.id, 'bw-detective-noir')
  assert.equal(packet.franchise.slug, 'chi-town-triplets')
  assert.equal(packet.franchiseConsistency.ok, false)
  assert.ok(packet.bible.live)
  const catalog = listProductionCatalog()
  assert.ok(catalog.stylePacks.some((pack) => pack.id === 'hex-halo-street'))
  assert.ok(catalog.franchises.some((item) => item.slug === 'chi-town-triplets'))
  assert.ok(catalog.extensions.some((item) => item.id === 'style-pack'))
})
