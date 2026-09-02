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
      className={`px-2 py-0.5 rounded border text-xs font-medium ${
        ready 
          ? 'border-sf-success/50 bg-sf-success/10 text-sf-success' 
          : 'border-sf-warning/50 bg-sf-warning/10 text-sf-warning'
      }`}
    >
      VO {take.stage}
    </span>
  )
}
