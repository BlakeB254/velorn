import { canonicalTake, lineSlugForCard, takeSummary } from '../../services/takeChain'

export default function TakeChip({ card, studio }) {
  if (!card?.dialogue) return null
  const take = canonicalTake(studio?.voiceover, lineSlugForCard(card))
  if (!take) {
    return (
      <span className="px-1.5 py-0.5 rounded border border-dashed border-sf-dark-500 text-sf-text-muted" title="No canonical take yet">
        VO missing
      </span>
    )
  }
  const ready = take.stage === 'finalized'
  return (
    <span
      title={takeSummary(take)}
      className={`px-1.5 py-0.5 rounded border ${
        ready ? 'border-emerald-500/50 text-emerald-300' : 'border-amber-400/50 text-amber-200'
      }`}
    >
      VO {take.stage}
    </span>
  )
}
