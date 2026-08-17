import { resolveCast, castCounts } from '../../services/studioStore'
import { loadFranchise } from '../../services/franchises'
import { loadStylePack } from '../../services/stylePacks'

export default function CastPanel({ studio, season, episode, production }) {
  const members = resolveCast(studio, { season, episode })
  const counts = castCounts(studio)
  const franchise = production?.franchiseSlug ? loadFranchise(production.franchiseSlug) : null
  const pack = production?.stylePack ? loadStylePack(production.stylePack) : null
  if (!members.length && !franchise) {
    return <p className="text-[11px] text-sf-text-muted">No series cast in the studio block yet.</p>
  }
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-sf-text-muted">
        Series {counts.series}
        {Object.keys(counts.seasons).length ? ` · seasons ${Object.keys(counts.seasons).join(', ')}` : ''}
        {episode ? ` · resolving ${episode}` : ''}. Editing series changes every episode.
        {franchise ? ` · franchise ${franchise.name}` : ''}
        {pack ? ` · pack ${pack.name}` : ''}
        {production?.bible?.sealed ? ' · bible sealed' : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        {members.map((member) => (
          <div key={member.cast_id} className="rounded border border-sf-dark-700 bg-sf-dark-900 px-2 py-1.5 min-w-[140px]">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-sf-text-primary font-medium">{member.display_name}</span>
              <span className="text-[9px] uppercase tracking-wide text-sf-text-muted">{member.scope}</span>
            </div>
            {member.fields.outfit && (
              <p className="text-[10px] text-sf-text-secondary mt-0.5 line-clamp-2">{member.fields.outfit}</p>
            )}
            {member.overrides?.length > 0 && (
              <p className="text-[9px] text-amber-300 mt-0.5">overrides: {member.overrides.join(', ')}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
