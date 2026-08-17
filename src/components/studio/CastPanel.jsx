import { resolveCast, castCounts } from '../../services/studioStore'
import { checkCastRefs, lockCastMembers, unlockCastMembers } from '../../services/castLock'
import { loadFranchise } from '../../services/franchises'
import { loadStylePack } from '../../services/stylePacks'

function badgeFor(status) {
  if (!status) return { label: 'open', tone: 'text-sf-text-muted border-sf-dark-600' }
  if (status.frozen && status.locked) return { label: 'frozen', tone: 'text-emerald-300 border-emerald-500/50' }
  if (status.locked) return { label: 'ready', tone: 'text-sky-300 border-sky-500/40' }
  return { label: 'blocked', tone: 'text-red-300 border-red-500/40' }
}

export default function CastPanel({ studio, season, episode, production, onStudioChange }) {
  const members = resolveCast(studio, { season, episode })
  const counts = castCounts(studio)
  const report = checkCastRefs(studio, { season, episode })
  const byId = Object.fromEntries(report.characters.map((item) => [item.cast_id, item]))
  const franchise = production?.franchiseSlug ? loadFranchise(production.franchiseSlug) : null
  const pack = production?.stylePack ? loadStylePack(production.stylePack) : null

  const mutate = (op, castId) => {
    if (typeof onStudioChange !== 'function') return
    try {
      const next = op === 'unlock'
        ? unlockCastMembers(studio, { season, episode, castIds: [castId], by: 'storyboard' })
        : lockCastMembers(studio, { season, episode, castIds: [castId], by: 'storyboard' })
      onStudioChange(next)
    } catch (error) {
      window.alert?.(error?.message || 'Cast lock failed')
    }
  }

  if (!members.length && !franchise) {
    return <p className="text-[11px] text-sf-text-muted">No series cast in the studio block yet.</p>
  }
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-sf-text-muted">
        Series {counts.series}
        {Object.keys(counts.seasons).length ? ` · seasons ${Object.keys(counts.seasons).join(', ')}` : ''}
        {episode ? ` · resolving ${episode}` : ''}. Editing series changes every episode.
        {report.ok ? ' · refs ready' : ` · gate: ${report.blockers.length} blocker${report.blockers.length === 1 ? '' : 's'}`}
        {franchise ? ` · franchise ${franchise.name}` : ''}
        {pack ? ` · pack ${pack.name}` : ''}
        {production?.bible?.sealed ? ' · bible sealed' : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        {members.map((member) => {
          const status = byId[member.cast_id]
          const badge = badgeFor(status)
          return (
            <div key={member.cast_id} className="rounded border border-sf-dark-700 bg-sf-dark-900 px-2 py-1.5 min-w-[160px]">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-sf-text-primary font-medium">{member.display_name}</span>
                <span className="text-[9px] uppercase tracking-wide text-sf-text-muted">{member.scope}</span>
                <span className={`text-[9px] uppercase tracking-wide px-1 rounded border ${badge.tone}`}>{badge.label}</span>
              </div>
              {member.fields.outfit && (
                <p className="text-[10px] text-sf-text-secondary mt-0.5 line-clamp-2">{member.fields.outfit}</p>
              )}
              {status?.reason && !status.locked && (
                <p className="text-[9px] text-red-300 mt-0.5 line-clamp-3">{status.reason}</p>
              )}
              {status?.locked && status.package_missing?.length > 0 && (
                <p className="text-[9px] text-amber-300 mt-0.5">missing {status.package_missing.join(', ')}</p>
              )}
              {member.overrides?.length > 0 && (
                <p className="text-[9px] text-amber-300 mt-0.5">overrides: {member.overrides.join(', ')}</p>
              )}
              {typeof onStudioChange === 'function' && status?.locked && (
                <button
                  type="button"
                  onClick={() => mutate(status.frozen ? 'unlock' : 'lock', member.cast_id)}
                  className="mt-1 text-[9px] uppercase tracking-wide text-sf-text-secondary hover:text-sf-text-primary"
                >
                  {status.frozen ? 'Unlock refs' : 'Freeze refs'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
