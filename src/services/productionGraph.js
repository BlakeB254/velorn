/**
 * CDX Studio production graph — CreativeOps ledger + app facts → THE MAP.
 *
 * Mirrors cdx_common.app_graph semantics (World Twin / Beat Lab / Studio)
 * without importing CDX Python. Edges use graph_contract vocabulary:
 *   uses, used_by, hosts, related_to
 * Every edge carries method + confidence + evidence.
 *
 * GPU serial / drafts-only: this module never queues generation or publishes.
 */

import { LEDGER_POLICY, normalizeWorkspace, productionFromWorkspace } from './creativeOps.js'

export const GRAPH_SOURCE = {
  studio: 'app_graph:studio',
  beatlab: 'app_graph:beatlab',
  twin: 'app_graph:twin',
  velorn: 'app_graph:velorn',
}

export function provenance({ source, evidence, method = 'observed', confidence = 0.9 } = {}) {
  return {
    source: String(source || GRAPH_SOURCE.velorn),
    evidence: String(evidence || ''),
    method: String(method || 'observed'),
    confidence: Number(confidence),
  }
}

function modelNodeName(model) {
  const text = String(model || '').trim()
  if (!text) return 'unknown'
  const pretty = text.replace(/-/g, ' ')
  if (pretty.toLowerCase().startsWith('ltx ')) return `LTX ${pretty.slice(4).toUpperCase()}`
  return pretty
}

export function studioMap(productions = []) {
  const nodes = []
  const edges = []
  const seen = new Set()
  const skipped = []
  const projectPatches = []
  let owned = 0
  const rows = Array.isArray(productions) ? productions : []

  for (const prod of rows) {
    const pid = String(prod.id || '').trim()
    const slug = String(prod.slug || '').trim()
    const name = String(prod.name || slug || pid)
    const entityId = prod.entity_id ?? prod.entityId
    let models = (prod.models || []).map((item) => String(item).trim()).filter(Boolean)
    if (!models.length && (prod.default_model || prod.defaultModel)) {
      models = [String(prod.default_model || prod.defaultModel).trim()]
    }
    if (entityId === null || entityId === undefined || entityId === '') {
      skipped.push(`${slug || pid}: no entity_id`)
      continue
    }
    owned += 1
    const entityKey = `entity:${Number(entityId)}`
    if (!seen.has(entityKey)) {
      nodes.push({
        key: entityKey,
        id: Number(entityId),
        name: String(prod.entity_name || prod.entityName || `entity ${entityId}`),
        type: String(prod.entity_type || prod.entityType || 'business'),
      })
      seen.add(entityKey)
    }
    if (!models.length) {
      skipped.push(`${slug || pid}: owned but no model recorded`)
      continue
    }
    for (const model of models) {
      const modelKey = `model:${model}`
      if (!seen.has(modelKey)) {
        nodes.push({
          key: modelKey,
          name: modelNodeName(model),
          type: 'product',
          directory_scope: 'research',
          metadata: { kind: 'generative_model', catalog_id: model },
        })
        seen.add(modelKey)
      }
      edges.push({
        from: entityKey,
        to: modelKey,
        type: 'uses',
        context: `Studio production ${name} used ${model}`,
        provenance: provenance({
          source: GRAPH_SOURCE.studio,
          evidence: `studio:production:${pid || slug}`,
          method: 'observed',
          confidence: 0.9,
        }),
      })
    }
    const coreProjectId = prod.core_project_id ?? prod.coreProjectId
    if (coreProjectId !== null && coreProjectId !== undefined && coreProjectId !== '') {
      projectPatches.push({
        core_project_id: Number(coreProjectId),
        slug,
        clip_count: Number(prod.clip_count || prod.clipCount || 0),
        avg_qa: prod.avg_qa ?? prod.avgQa ?? null,
        models,
      })
    }
  }

  return {
    nodes,
    edges,
    stats: {
      productions: rows.length,
      owned,
      edges: edges.length,
      skipped,
      project_patches: projectPatches,
    },
  }
}

export function beatlabMap(catalog = [], { coreProjectId, models = ['MiniMax Music 3', 'ACE-Step 1.5'] } = {}) {
  const beats = Array.isArray(catalog) ? catalog : []
  const verdicts = {}
  const lanes = {}
  let versions = 0
  for (const beat of beats) {
    if (beat.verdict) verdicts[beat.verdict] = (verdicts[beat.verdict] || 0) + 1
    if (beat.lane) lanes[beat.lane] = (lanes[beat.lane] || 0) + 1
    versions += Number(beat.version_count || beat.versionCount || 0)
  }
  const nodes = models.map((model) => ({
    key: `model:${model}`,
    name: model,
    type: 'product',
    directory_scope: 'research',
  }))
  const edges = coreProjectId == null
    ? []
    : models.map((model) => ({
      from: `model:${model}`,
      to_project: Number(coreProjectId),
      type: 'used_by',
      context: 'generation lane in Beat Lab (cdx-beat-lab skill roster)',
      provenance: provenance({
        source: GRAPH_SOURCE.beatlab,
        evidence: 'skill:cdx-beat-lab',
        method: 'observed',
        confidence: 0.9,
      }),
    }))
  return {
    nodes,
    edges,
    stats: {
      beats: beats.length,
      verdicts,
      lanes,
      versions,
      edges: edges.length,
    },
  }
}

export function twinMap(project = {}, { coreProjectId } = {}) {
  const slug = project.slug || project.name || ''
  const ev = `twin:${slug}`
  const nodes = []
  const edges = []
  const region = project.region || {}
  const code = region.place_code || region.placeCode
  const name = region.name
  if (code || name) {
    const place = {
      key: `place:${code || name}`,
      name: String(name || code),
      type: 'location',
      directory_scope: 'network',
      research_role: null,
      metadata: {
        place_code: code || null,
        level: region.level || null,
        msa: region.msa || null,
        kind: 'place',
      },
    }
    nodes.push(place)
    if (coreProjectId != null) {
      edges.push({
        from: place.key,
        to_project: Number(coreProjectId),
        type: 'hosts',
        context: `World Twin region for ${slug} (${region.level || 'region'})`,
        provenance: provenance({
          source: GRAPH_SOURCE.twin,
          evidence: ev,
          method: 'observed',
          confidence: 0.95,
        }),
      })
    }
  }
  for (const src of project.official_sources || project.officialSources || []) {
    const sid = src.id
    const sname = src.name
    if (!sname) continue
    const key = `dataset:${sid || sname}`
    nodes.push({
      key,
      name: String(sname),
      type: 'organization',
      directory_scope: 'research',
      research_role: 'major_industry_participant',
      metadata: { kind: 'official_data_source', catalog_id: sid || null },
    })
    if (coreProjectId != null) {
      edges.push({
        from: key,
        to_project: Number(coreProjectId),
        type: 'used_by',
        context: `official source applied in World Twin project ${slug}`,
        provenance: provenance({
          source: GRAPH_SOURCE.twin,
          evidence: ev,
          method: 'observed',
          confidence: 0.9,
        }),
      })
    }
  }
  return { nodes, edges, stats: { nodes: nodes.length, edges: edges.length, slug } }
}

export function ledgerProductions(workspaces = [], extrasBySlug = {}) {
  return (Array.isArray(workspaces) ? workspaces : [])
    .map((item) => productionFromWorkspace(item, extrasBySlug[item.slug] || extrasBySlug[normalizeWorkspace(item).slug] || {}))
}

export function buildProductionGraph({
  studio = [],
  beatlab = [],
  twin = null,
  coreProjectId = null,
  beatlabModels,
} = {}) {
  const studioGraph = studioMap(studio)
  const includeBeat = Array.isArray(beatlab) && beatlab.length > 0
  const beatGraph = includeBeat
    ? beatlabMap(beatlab, { coreProjectId, models: beatlabModels })
    : { nodes: [], edges: [], stats: { beats: 0, verdicts: {}, lanes: {}, versions: 0, edges: 0 } }
  const twinGraph = twin ? twinMap(twin, { coreProjectId }) : { nodes: [], edges: [], stats: {} }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policy: { ...LEDGER_POLICY },
    apps: {
      studio: studioGraph.stats,
      beatlab: beatGraph.stats,
      twin: twinGraph.stats,
    },
    nodes: [...studioGraph.nodes, ...beatGraph.nodes, ...twinGraph.nodes],
    edges: [...studioGraph.edges, ...beatGraph.edges, ...twinGraph.edges],
  }
}

export function receiptFromGraph(graph, {
  cardId = '',
  board = 'cdx-creative',
  summary = 'CreativeOps ledger mapped to CDX Studio production graph',
  confidence = 0.8,
} = {}) {
  const nodes = (graph.nodes || []).map((node) => ({
    key: node.key,
    name: node.name,
    type: node.type,
    action: node.id ? 'referenced' : 'created',
  }))
  const edges = (graph.edges || []).map((edge) => ({
    from: edge.from,
    to: edge.to || (edge.to_project != null ? `project:${edge.to_project}` : ''),
    type: edge.type,
    context: edge.context || '',
    provenance: edge.provenance || provenance({ evidence: 'velorn:production-graph' }),
  }))
  return {
    card_id: cardId,
    board,
    summary,
    confidence,
    nodes,
    edges,
    artifacts: [],
  }
}
