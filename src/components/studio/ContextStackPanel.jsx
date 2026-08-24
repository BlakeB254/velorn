import { useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Circle, Layers } from 'lucide-react'
import useProjectStore from '../../stores/projectStore'
import {
  LAYER_LABELS,
  describeContextStack,
  resolveContextStack,
} from '../../services/contextStack'

/**
 * The context stack, made visible.
 *
 * Every layer that will feed a generation — franchise, style, production
 * type, location, character, wardrobe, prop, movement, blocking — is listed
 * in the order it is applied, with what it actually contributes and why it is
 * not ready. Pass a `shot` to see the stack for that shot; omit it to see the
 * whole project's context.
 *
 * All the reasoning lives in services/contextStack.js; this is a thin render.
 */

const STATUS_TONE = {
  ready: 'text-emerald-300 border-emerald-500/50',
  partial: 'text-amber-300 border-amber-500/40',
  missing: 'text-red-300 border-red-500/40',
  inactive: 'text-sf-text-muted border-sf-dark-700',
}

function StatusIcon({ status }) {
  if (status === 'ready') return <Check className="w-3 h-3 text-emerald-300 shrink-0" />
  if (status === 'missing') return <AlertTriangle className="w-3 h-3 text-red-300 shrink-0" />
  if (status === 'partial') return <AlertTriangle className="w-3 h-3 text-amber-300 shrink-0" />
  return <Circle className="w-3 h-3 text-sf-text-muted shrink-0" />
}

export default function ContextStackPanel({ shot = null, blocking = null, showInactive = false }) {
  const currentProject = useProjectStore((s) => s.currentProject)
  const [expanded, setExpanded] = useState({})

  const stack = useMemo(() => resolveContextStack({
    references: currentProject?.references,
    production: currentProject?.production,
    shot,
    blocking,
  }), [currentProject?.references, currentProject?.production, shot, blocking])

  const visible = showInactive ? stack.layers : stack.layers.filter((l) => l.status !== 'inactive')

  return (
    <div className="space-y-2" data-testid="context-stack-panel">
      <div className="flex items-center gap-2">
        <Layers className="w-3.5 h-3.5 text-sf-accent shrink-0" />
        <span className="text-[11px] text-sf-text-primary font-medium">
          {shot ? 'Shot context' : 'Project context'}
        </span>
        <span className={`text-[9px] uppercase tracking-wide px-1 rounded border ${stack.ready ? STATUS_TONE.ready : STATUS_TONE.partial}`}>
          {stack.ready ? 'ready' : `${stack.gaps.length} gap${stack.gaps.length === 1 ? '' : 's'}`}
        </span>
        <span className="flex-1" />
        <span className="text-[9px] text-sf-text-muted font-mono" title="Context signature — recorded on each take">
          {stack.signature}
        </span>
      </div>

      <p className="text-[10px] text-sf-text-muted">
        {describeContextStack(stack) || 'Nothing in the stack yet.'}
        {stack.promptLines.length > 0 && ` · ${stack.promptLines.length} prompt line${stack.promptLines.length === 1 ? '' : 's'}`}
        {stack.referenceAssetIds.length > 0 && ` · ${stack.referenceAssetIds.length} ref image${stack.referenceAssetIds.length === 1 ? '' : 's'}`}
      </p>

      {visible.length === 0 && (
        <p className="text-[11px] text-sf-text-muted">
          No context layers are active. Link a franchise, add reference cards, or set a production type.
        </p>
      )}

      {/* Ordered outermost identity → innermost action, the order it applies. */}
      <ol className="space-y-1">
        {visible.map((layer, index) => {
          const key = `${layer.kind}:${layer.id}:${index}`
          const open = Boolean(expanded[key])
          const hasDetail = layer.contributes.promptLines.length > 0
            || layer.contributes.referenceAssetIds.length > 0
            || layer.gaps.length > 0
          return (
            <li key={key} className="rounded border border-sf-dark-700 bg-sf-dark-900">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <span className="text-[9px] text-sf-text-muted font-mono w-4 shrink-0">{index + 1}</span>
                <StatusIcon status={layer.status} />
                <span className="text-[9px] uppercase tracking-wide text-sf-text-muted shrink-0">
                  {LAYER_LABELS[layer.kind] || layer.kind}
                </span>
                <span className="text-[11px] text-sf-text-primary truncate">{layer.label}</span>
                <span className="flex-1" />
                {layer.detail && (
                  <span className="text-[9px] text-sf-text-muted truncate max-w-[45%]">{layer.detail}</span>
                )}
                {hasDetail && (
                  <button
                    type="button"
                    onClick={() => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))}
                    className="text-sf-text-muted hover:text-sf-text-primary shrink-0"
                  >
                    {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  </button>
                )}
              </div>

              {open && (
                <div className="px-2 pb-2 pt-1.5 border-t border-sf-dark-800 space-y-1.5">
                  {layer.contributes.promptLines.length > 0 && (
                    <div>
                      <p className="text-[9px] uppercase tracking-wide text-sf-text-muted mb-0.5">
                        Into the prompt
                      </p>
                      {layer.contributes.promptLines.map((line, i) => (
                        <p key={i} className="text-[10px] text-sf-text-secondary">— {line}</p>
                      ))}
                    </div>
                  )}
                  {layer.contributes.referenceAssetIds.length > 0 && (
                    <div>
                      <p className="text-[9px] uppercase tracking-wide text-sf-text-muted mb-0.5">
                        Reference images
                      </p>
                      <p className="text-[10px] text-sf-text-secondary font-mono break-all">
                        {layer.contributes.referenceAssetIds.join(', ')}
                      </p>
                    </div>
                  )}
                  {layer.gaps.map((gap, i) => (
                    <p key={i} className="text-[10px] text-amber-300">{gap.reason}</p>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
