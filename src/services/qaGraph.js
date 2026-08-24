/**
 * QA verdicts as CDX Studio production-graph nodes/edges.
 *
 * Independent of the CreativeOps ledger port. Uses the same vocabulary
 * (related_to / uses, method + confidence + evidence) so a later graph
 * sync can ingest these edges without a reshape.
 *
 * GPU serial / drafts-only: recording a verdict never publishes.
 */

export const QA_GRAPH_SOURCE = 'app_graph:velorn-qa'

export function qaProvenance({ evidence, method = 'observed', confidence = 0.9 } = {}) {
  return {
    source: QA_GRAPH_SOURCE,
    evidence: String(evidence || ''),
    method: String(method || 'observed'),
    confidence: Number(confidence),
  }
}

function shotKey(shot) {
  return `shot:${String(shot || '').trim()}`
}

function rubricKey(version) {
  return `rubric:${String(version || '').trim()}`
}

function verdictKey(shot) {
  return `qa:${String(shot || '').trim()}`
}

/**
 * Build a production-graph snapshot from current per-shot QA + rubric evals.
 * Derived; callers persist it on studio.qaGraph after recordVerdict.
 */
export function buildQaGraph(studio = {}, { production } = {}) {
  const qa = studio?.qa && typeof studio.qa === 'object' ? studio.qa : {}
  const nodes = []
  const edges = []
  const seen = new Set()

  const addNode = (node) => {
    if (!node?.key || seen.has(node.key)) return
    seen.add(node.key)
    nodes.push(node)
  }

  const slug = String(production?.slug || production?.title || 'velorn-project')
  addNode({
    key: `production:${slug}`,
    name: String(production?.title || slug),
    type: 'product',
    metadata: { kind: 'velorn_production' },
  })

  for (const [shot, entry] of Object.entries(qa)) {
    if (!shot) continue
    const sKey = shotKey(shot)
    const vKey = verdictKey(shot)
    addNode({
      key: sKey,
      name: shot,
      type: 'product',
      metadata: { kind: 'shot' },
    })
    addNode({
      key: vKey,
      name: `${shot} QA`,
      type: 'product',
      metadata: {
        kind: 'qa_verdict',
        video: entry?.video?.result || 'unverified',
        audio: entry?.audio?.result || 'unverified',
        overall: entry?.overall || null,
      },
    })
    edges.push({
      from: sKey,
      to: vKey,
      type: 'related_to',
      context: `QA recorded for ${shot}`,
      provenance: qaProvenance({
        evidence: `velorn:qa:${shot}`,
        method: 'observed',
        confidence: 0.95,
      }),
    })
    edges.push({
      from: `production:${slug}`,
      to: sKey,
      type: 'related_to',
      context: `Production contains shot ${shot}`,
      provenance: qaProvenance({
        evidence: `velorn:production:${slug}`,
        method: 'observed',
        confidence: 0.8,
      }),
    })

    for (const track of ['video', 'audio']) {
      const rubric = entry?.[track]?.rubric
      if (!rubric?.rubricVersion) continue
      const rKey = rubricKey(rubric.rubricVersion)
      addNode({
        key: rKey,
        name: rubric.rubricVersion,
        type: 'product',
        metadata: { kind: 'evaluation_rubric', mediaKind: rubric.mediaKind || track },
      })
      edges.push({
        from: vKey,
        to: rKey,
        type: 'uses',
        context: `${shot} ${track} evaluated with ${rubric.rubricVersion} (${rubric.disposition || 'n/a'})`,
        provenance: qaProvenance({
          evidence: `velorn:qa:${shot}:${track}`,
          method: rubric.evaluator ? 'extracted' : 'observed',
          confidence: rubric.disposition === 'human_review' ? 0.5 : 0.85,
        }),
      })
    }
  }

  return {
    source: QA_GRAPH_SOURCE,
    nodes,
    edges,
    stats: {
      shots: Object.keys(qa).length,
      nodes: nodes.length,
      edges: edges.length,
    },
  }
}
