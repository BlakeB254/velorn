import { useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronRight, Circle, Layers, Wand2 } from 'lucide-react'
import useProjectStore from '../../stores/projectStore'
import {
  CONTEXT_LAYER_ORDER,
  LAYER_LABELS,
  resolveContextStack,
} from '../../services/contextStack'

/**
 * The context stack as a flow, not a list.
 *
 * Every layer that feeds a generation is drawn in the order it is applied —
 * outermost identity (franchise) to innermost action (blocking) — so the
 * cascade is visible rather than implied by a numbered list.
 *
 * Three things this fixes over the old panel:
 *
 *  1. ALL TEN layers are always drawn. The old panel filtered `inactive` out,
 *     so a project running three layers showed a green "ready" badge with no
 *     hint that seven layers were contributing nothing. Inactive layers are
 *     ghosted here, never hidden, and the header counts them.
 *  2. Prompt lines are attributed to the layer that produced them, so it is
 *     obvious which layer put a phrase in the prompt.
 *  3. Passing a `shot` resolves the shot stack AND the project stack and rings
 *     the layers that differ, making an override legible as an override.
 *
 * All the reasoning still lives in services/contextStack.js; this is a render.
 */

const TONE = {
  ready: {
    dot: 'bg-emerald-400',
    box: 'border-emerald-500/50 bg-emerald-500/5',
    text: 'text-emerald-300',
  },
  partial: {
    dot: 'bg-amber-400',
    box: 'border-amber-500/50 bg-amber-500/5',
    text: 'text-amber-300',
  },
  missing: {
    dot: 'bg-red-400',
    box: 'border-red-500/50 bg-red-500/5',
    text: 'text-red-300',
  },
  inactive: {
    dot: 'bg-sf-dark-600',
    box: 'border-sf-dark-700 border-dashed bg-transparent',
    text: 'text-sf-text-muted',
  },
}

function StatusIcon({ status }) {
  if (status === 'ready') return <Check className="w-3 h-3 text-emerald-300 shrink-0" />
  if (status === 'missing') return <AlertTriangle className="w-3 h-3 text-red-300 shrink-0" />
  if (status === 'partial') return <AlertTriangle className="w-3 h-3 text-amber-300 shrink-0" />
  return <Circle className="w-3 h-3 text-sf-text-muted shrink-0" />
}

/** One node in the pipeline. */
function LayerNode({ layer, isLast, isDelta, onClick }) {
  const tone = TONE[layer.status] || TONE.inactive
  const lines = layer.contributes?.promptLines?.length || 0
  const refs = layer.contributes?.referenceAssetIds?.length || 0
  const interactive = typeof onClick === 'function'
  return (
    <div className="flex items-center shrink-0">
      <button
        type="button"
        onClick={interactive ? () => onClick(layer) : undefined}
        disabled={!interactive}
        title={layer.detail || layer.label}
        className={`w-[104px] text-left rounded border px-2 py-1.5 transition-colors ${tone.box} ${
          isDelta ? 'ring-1 ring-sf-accent' : ''
        } ${interactive ? 'hover:border-sf-accent/60 cursor-pointer' : 'cursor-default'}`}
      >
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone.dot}`} />
          <span className="text-[9px] uppercase tracking-wide text-sf-text-muted truncate">
            {LAYER_LABELS[layer.kind] || layer.kind}
          </span>
        </div>
        <div className="text-[11px] text-sf-text-primary truncate mt-0.5">
          {layer.status === 'inactive' ? '—' : (layer.label || '—')}
        </div>
        <div className="text-[9px] text-sf-text-muted mt-0.5 truncate">
          {layer.status === 'inactive'
            ? 'inactive'
            : [lines ? `${lines} line${lines === 1 ? '' : 's'}` : null,
               refs ? `${refs} ref${refs === 1 ? '' : 's'}` : null]
                .filter(Boolean).join(' · ') || layer.status}
        </div>
      </button>
      {!isLast && <ChevronRight className="w-3 h-3 text-sf-dark-600 mx-0.5 shrink-0" />}
    </div>
  )
}

/** Prompt lines, attributed to the layer that produced each one. */
function PromptAssembly({ layers }) {
  const rows = []
  layers.forEach((layer) => {
    (layer.contributes?.promptLines || []).forEach((line) => {
      rows.push({ kind: layer.kind, line })
    })
  })
  if (!rows.length) return null
  return (
    <div className="rounded border border-sf-dark-700 bg-sf-dark-900">
      <div className="px-2 py-1.5 border-b border-sf-dark-800 flex items-center gap-2">
        <Wand2 className="w-3 h-3 text-sf-accent shrink-0" />
        <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">
          Prompt assembly — {rows.length} line{rows.length === 1 ? '' : 's'}, in order
        </span>
      </div>
      <ol className="divide-y divide-sf-dark-800">
        {rows.map((row, index) => (
          <li key={`${row.kind}-${index}`} className="flex gap-2 px-2 py-1">
            <span className="text-[9px] uppercase tracking-wide text-sf-text-muted w-16 shrink-0 pt-0.5">
              {LAYER_LABELS[row.kind] || row.kind}
            </span>
            <span className="text-[10px] text-sf-text-secondary leading-snug">{row.line}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Gaps, each with a way to reach the panel that fixes it. */
function GapList({ gaps, onLayerClick }) {
  if (!gaps.length) return null
  return (
    <ul className="space-y-1">
      {gaps.map((gap, index) => (
        <li
          key={`${gap.kind}-${gap.id}-${index}`}
          className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1"
        >
          <AlertTriangle className="w-3 h-3 text-amber-300 shrink-0 mt-0.5" />
          <span className="text-[10px] text-sf-text-secondary flex-1 leading-snug">{gap.reason}</span>
          {typeof onLayerClick === 'function' && (
            <button
              type="button"
              onClick={() => onLayerClick({ kind: gap.kind, id: gap.id })}
              className="text-[10px] text-sf-accent hover:underline shrink-0"
            >
              fix
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

export default function ContextFlow({
  shot = null,
  blocking = null,
  compact = false,
  onLayerClick,
}) {
  const currentProject = useProjectStore((s) => s.currentProject)
  const [showPrompt, setShowPrompt] = useState(false)

  const base = {
    references: currentProject?.references,
    production: currentProject?.production,
    creation: currentProject?.creation,
  }

  const projectStack = useMemo(
    () => resolveContextStack(base),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentProject?.references, currentProject?.production, currentProject?.creation],
  )

  const shotStack = useMemo(
    () => (shot ? resolveContextStack({ ...base, shot, blocking }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentProject?.references, currentProject?.production, currentProject?.creation, shot, blocking],
  )

  const stack = shotStack || projectStack

  // Which layers this shot changes relative to the project baseline.
  const delta = useMemo(() => {
    if (!shotStack) return new Set()
    const baseline = new Map(projectStack.layers.map((l) => [l.kind, l]))
    return new Set(
      shotStack.layers
        .filter((l) => {
          const p = baseline.get(l.kind)
          return !p || p.id !== l.id || p.status !== l.status
        })
        .map((l) => l.kind),
    )
  }, [projectStack, shotStack])

  // Always draw all ten, in canonical order. Hiding inactive layers is exactly
  // how a three-layer project came to read as "ready".
  const ordered = useMemo(() => {
    const byKind = new Map()
    stack.layers.forEach((layer) => {
      if (!byKind.has(layer.kind)) byKind.set(layer.kind, layer)
    })
    return CONTEXT_LAYER_ORDER.map(
      (kind) => byKind.get(kind) || {
        kind,
        id: '',
        label: '',
        status: 'inactive',
        detail: '',
        contributes: { promptLines: [], referenceAssetIds: [] },
        gaps: [],
      },
    )
  }, [stack])

  // Count what is actually drawn. resolveContextStack omits layers that do not
  // apply at all (brand on a non-ad production), so its `counts.total` can be
  // nine while ten nodes are on screen — a denominator that does not match the
  // picture is worse than no denominator.
  const total = ordered.length
  const active = ordered.filter((layer) => layer.status !== 'inactive').length
  const inactive = total - active
  const gaps = stack.gaps || []

  const header = (
    <div className="flex items-center gap-2 flex-wrap">
      <Layers className="w-3.5 h-3.5 text-sf-accent shrink-0" />
      <span className="text-[11px] text-sf-text-primary font-medium">
        {shot ? 'Shot context' : 'Project context'}
      </span>
      <span className="text-[10px] text-sf-text-muted">
        {active}/{total} active
        {inactive > 0 && ` · ${inactive} inactive`}
        {gaps.length > 0
          ? ` · ${gaps.length} gap${gaps.length === 1 ? '' : 's'}`
          : ' · no gaps'}
      </span>
      <span className="flex-1" />
      <span
        className="text-[9px] text-sf-text-muted font-mono"
        title="Context signature — recorded on each take"
      >
        {stack.signature}
      </span>
    </div>
  )

  if (compact) {
    return (
      <div className="space-y-1.5" data-testid="context-flow-compact">
        {header}
        <div className="flex gap-0.5">
          {ordered.map((layer) => {
            const tone = TONE[layer.status] || TONE.inactive
            return (
              <span
                key={layer.kind}
                title={`${LAYER_LABELS[layer.kind] || layer.kind}: ${layer.status}${layer.label ? ` — ${layer.label}` : ''}`}
                className={`h-1.5 flex-1 rounded-sm ${tone.dot}`}
              />
            )
          })}
        </div>
        {gaps.length > 0 && (
          <p className="text-[10px] text-amber-300 leading-snug">
            {gaps[0].reason}
            {gaps.length > 1 && ` · +${gaps.length - 1} more`}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2" data-testid="context-flow">
      {header}

      <div className="overflow-x-auto pb-1">
        <div className="flex items-stretch">
          {ordered.map((layer, index) => (
            <LayerNode
              key={layer.kind}
              layer={layer}
              isLast={index === ordered.length - 1}
              isDelta={delta.has(layer.kind)}
              onClick={onLayerClick}
            />
          ))}
        </div>
      </div>

      {shotStack && delta.size > 0 && (
        <p className="text-[10px] text-sf-text-muted">
          <span className="text-sf-accent">Ringed</span> layers differ from the project baseline.
        </p>
      )}

      <GapList gaps={gaps} onLayerClick={onLayerClick} />

      {stack.promptLines?.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowPrompt((v) => !v)}
            className="text-[10px] text-sf-text-muted hover:text-sf-text-primary"
          >
            {showPrompt ? 'Hide' : 'Show'} prompt assembly ({stack.promptLines.length} line
            {stack.promptLines.length === 1 ? '' : 's'})
            {stack.referenceAssetIds?.length > 0 &&
              ` · ${stack.referenceAssetIds.length} ref image${stack.referenceAssetIds.length === 1 ? '' : 's'}`}
          </button>
          {showPrompt && (
            <div className="mt-1.5">
              <PromptAssembly layers={ordered} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
