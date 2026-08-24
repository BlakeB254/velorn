import { useEffect, useState } from 'react'
import { Building2, Check, ExternalLink } from 'lucide-react'
import useProjectStore from '../../stores/projectStore'
import { listOfferings } from '../../services/cdxDirectory'
import { isAdType, subjectFromProject } from '../../services/projectListing'

/**
 * Brand context for ad-style productions.
 *
 * The creation wizard links a CDX org and the offerings a commercial is
 * selling (createWizard.js → creation.ad.subject), then nothing ever showed
 * them again — the only reader was the ad easy-mode concept seed. This panel
 * puts that link back in front of you and refreshes the org's offerings live
 * from the CDX directory (core-api :7017), so the catalog can move without
 * the project going stale.
 *
 * The stored names still drive the brand context layer when the directory is
 * unreachable; this panel is the live view, not the source of truth.
 */
export default function BrandContextPanel() {
  const currentProject = useProjectStore((s) => s.currentProject)
  const subject = subjectFromProject(currentProject || {})
  const productionType = currentProject?.production?.type || ''

  const [live, setLive] = useState({ state: 'idle', items: [], error: '' })

  useEffect(() => {
    const orgId = subject?.orgId
    if (!orgId) {
      setLive({ state: 'idle', items: [], error: '' })
      return undefined
    }
    const controller = new AbortController()
    setLive((prev) => ({ ...prev, state: 'loading', error: '' }))
    listOfferings(orgId, { signal: controller.signal })
      .then((result) => {
        setLive({ state: 'ready', items: result?.items || [], error: '' })
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setLive({ state: 'error', items: [], error: error?.message || 'directory unreachable' })
      })
    return () => controller.abort()
  }, [subject?.orgId])

  if (!subject) {
    return (
      <p className="text-[11px] text-sf-text-muted">
        No brand linked. Ad-style projects pick a CDX org and its offerings in the creation wizard.
      </p>
    )
  }

  const selectedIds = new Set((subject.offerings || []).map((item) => item.id).filter(Boolean))
  const selectedNames = (subject.offerings || []).map((item) => item.name).filter(Boolean)

  return (
    <div className="space-y-2" data-testid="brand-context-panel">
      <div className="flex items-center gap-2">
        <Building2 className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
        <span className="text-[11px] text-sf-text-primary font-medium truncate">
          {subject.orgName || 'Linked org'}
        </span>
        {subject.orgId && (
          <span className="text-[9px] text-sf-text-muted font-mono">CDX #{subject.orgId}</span>
        )}
        <span className="flex-1" />
        <span className="text-[9px] uppercase tracking-wide text-sf-text-muted">{subject.mode}</span>
      </div>

      {!isAdType(productionType) && (
        <p className="text-[10px] text-amber-300">
          This project is typed “{productionType || 'untyped'}”, not an ad type — the brand still
          feeds the context stack, but the ad flow will not apply.
        </p>
      )}

      <div>
        <p className="text-[9px] uppercase tracking-wide text-sf-text-muted mb-1">
          Offerings in this production
        </p>
        {selectedNames.length === 0 ? (
          <p className="text-[10px] text-sf-text-muted">
            None selected — the commercial will not name a specific product.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {selectedNames.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-emerald-500/50 text-[10px] text-emerald-300"
              >
                <Check className="w-3 h-3" />
                {name}
              </span>
            ))}
          </div>
        )}
      </div>

      {subject.orgId && (
        <div>
          <p className="text-[9px] uppercase tracking-wide text-sf-text-muted mb-1">
            Everything on file for this org
            {live.state === 'loading' && <span className="normal-case"> · loading…</span>}
          </p>
          {live.state === 'error' && (
            <p className="text-[10px] text-red-300">
              CDX directory unreachable ({live.error}). Stored names are still driving the context stack.
            </p>
          )}
          {live.state === 'ready' && live.items.length === 0 && (
            <p className="text-[10px] text-sf-text-muted">No offerings on file for this org.</p>
          )}
          {live.state === 'ready' && live.items.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {live.items.map((offering) => {
                const on = selectedIds.has(offering.id)
                return (
                  <span
                    key={offering.id}
                    title={offering.description || ''}
                    className={`px-1.5 py-0.5 rounded border text-[10px] ${on
                      ? 'border-emerald-500/50 text-emerald-300'
                      : 'border-sf-dark-600 text-sf-text-muted'}`}
                  >
                    {offering.name}
                  </span>
                )
              })}
            </div>
          )}
          {/* A drifted link is worth surfacing: the wizard stored a name that
              the directory no longer has. */}
          {live.state === 'ready' && selectedNames.length > 0 && (
            (() => {
              const liveIds = new Set(live.items.map((item) => item.id))
              const drifted = (subject.offerings || []).filter((item) => item.id && !liveIds.has(item.id))
              if (!drifted.length) return null
              return (
                <p className="mt-1 text-[10px] text-amber-300 inline-flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" />
                  {drifted.map((item) => item.name || item.id).join(', ')} no longer on file for this org.
                </p>
              )
            })()
          )}
        </div>
      )}
    </div>
  )
}
