import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  PRODUCTION_TYPES,
  applyTypeDefaults,
  discoverProduction,
  normalizeProductionType,
} from '../src/services/productionTypes.js'
import { listProductionCatalog } from '../src/services/productionPacket.js'
import { normalizeProduction, setProductionMeta } from '../src/services/productionStore.js'

test('aliases map CDX Studio names onto canonical types', () => {
  assert.equal(normalizeProductionType('advertisement'), 'commercial')
  assert.equal(normalizeProductionType('ad'), 'commercial')
  assert.equal(normalizeProductionType('film'), 'movie')
  assert.equal(normalizeProductionType('standalone'), 'narrative')
  assert.equal(normalizeProductionType('mv'), 'music-video')
  assert.equal(normalizeProductionType('short'), 'ig-short')
  assert.ok(PRODUCTION_TYPES.includes('commercial'))
  assert.ok(PRODUCTION_TYPES.includes('music-video'))
  assert.ok(PRODUCTION_TYPES.includes('ig-short'))
  assert.ok(PRODUCTION_TYPES.includes('psa'))
  assert.ok(PRODUCTION_TYPES.includes('website-tour'))
})

test('type defaults set mobile 9:16 for ads and computer 16:9 for movies', () => {
  assert.equal(applyTypeDefaults('commercial').outputTarget, 'mobile')
  assert.equal(applyTypeDefaults('movie').outputTarget, 'computer')
  const production = setProductionMeta(normalizeProduction({ type: 'narrative' }), { type: 'advertisement' })
  assert.equal(production.type, 'commercial')
  assert.equal(production.format.outputTarget, 'mobile')
})

test('discover_production finds advertisement and music video flows', () => {
  const ad = discoverProduction({ type: 'advertisement' })
  assert.equal(ad.type, 'commercial')
  assert.ok(ad.flows.some((flow) => flow.id === 'commercial'))
  const mv = discoverProduction({ query: 'music video' })
  assert.ok(mv.types.some((item) => item.id === 'music-video') || mv.flows.some((flow) => flow.id === 'music-video'))
})

test('catalog lists every production type and flow', () => {
  const catalog = listProductionCatalog()
  assert.equal(catalog.types.length, PRODUCTION_TYPES.length)
  assert.ok(catalog.flows.length >= 6)
  assert.equal(catalog.aliases.advertisement, 'commercial')
})
