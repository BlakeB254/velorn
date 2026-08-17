import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  studioMap,
  beatlabMap,
  twinMap,
  buildProductionGraph,
  receiptFromGraph,
  ledgerProductions,
} from '../src/services/productionGraph.js'
import { emptyWorkspace, recordGeneration } from '../src/services/creativeOps.js'

test('studioMap emits entity --uses--> model with provenance', () => {
  const { nodes, edges, stats } = studioMap([{
    id: 'demo-site-tour',
    name: 'Demo Site Tour',
    slug: 'demo-site-tour',
    entity_id: 109,
    entity_name: 'Rich Demenor Clothing',
    entity_type: 'business',
    models: ['ltx-2.3-22b'],
    clip_count: 3,
    avg_qa: 0.81,
    core_project_id: 396,
  }])
  assert.equal(stats.owned, 1)
  assert.equal(edges.length, 1)
  assert.equal(edges[0].type, 'uses')
  assert.equal(edges[0].from, 'entity:109')
  assert.equal(edges[0].to, 'model:ltx-2.3-22b')
  assert.equal(edges[0].provenance.method, 'observed')
  assert.equal(edges[0].provenance.source, 'app_graph:studio')
  assert.ok(edges[0].provenance.evidence.includes('studio:production:'))
  assert.ok(nodes.some((node) => node.key === 'entity:109'))
  assert.ok(nodes.some((node) => node.type === 'product'))
  assert.equal(stats.project_patches[0].core_project_id, 396)
})

test('unowned productions are reported, not guessed', () => {
  const { edges, stats } = studioMap([{ slug: 'orphan', models: ['ltx-2.3-22b'] }])
  assert.equal(edges.length, 0)
  assert.ok(stats.skipped[0].includes('no entity_id'))
})

test('beatlabMap and twinMap use used_by / hosts', () => {
  const beat = beatlabMap([{ verdict: 'keep', lane: 'thematic', version_count: 2 }], { coreProjectId: 12 })
  assert.equal(beat.stats.beats, 1)
  assert.equal(beat.edges[0].type, 'used_by')
  assert.equal(beat.edges[0].to_project, 12)

  const twin = twinMap({
    slug: 'north-lawndale',
    region: { place_code: 'nl', name: 'North Lawndale', level: 'neighborhood' },
    official_sources: [{ id: 'chi-311', name: 'Chicago 311' }],
  }, { coreProjectId: 44 })
  assert.equal(twin.edges[0].type, 'hosts')
  assert.equal(twin.edges[1].type, 'used_by')
  assert.equal(twin.nodes[0].type, 'location')
})

test('ledger productions feed the combined production graph', () => {
  const seeded = recordGeneration(emptyWorkspace({
    slug: 'chi-town-triplets',
    title: 'Chi-Town Triplets',
    entityId: 1,
    entityName: 'Codex Metatron',
  }), { generation_id: 'g1', model: 'ltx-2.5' })
  const productions = ledgerProductions([seeded.workspace], { 'chi-town-triplets': { coreProjectId: 396 } })
  const graph = buildProductionGraph({
    studio: productions,
    beatlab: [{ lane: 'thematic', verdict: 'keep' }],
    twin: { slug: 'nl', region: { name: 'North Lawndale', place_code: 'nl' } },
    coreProjectId: 396,
  })
  assert.ok(graph.edges.some((edge) => edge.type === 'uses'))
  assert.ok(graph.edges.some((edge) => edge.type === 'used_by'))
  assert.ok(graph.edges.some((edge) => edge.type === 'hosts'))
  assert.equal(graph.policy.outward, 'draft')
  assert.equal(graph.policy.gpuSerial, true)

  const receipt = receiptFromGraph(graph, { cardId: 't_d34b92db', board: 'cdx-creative' })
  assert.equal(receipt.card_id, 't_d34b92db')
  assert.ok(receipt.edges.length >= 3)
  assert.ok(receipt.edges.every((edge) => edge.provenance.method && edge.provenance.evidence))
})
