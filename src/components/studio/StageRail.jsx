import { flowView, FLOW_STAGES } from '../../services/studioStore'

const TONE = {
  ok: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300',
  here: 'border-amber-400/70 bg-amber-400/15 text-amber-200',
  wait: 'border-sf-dark-700 bg-sf-dark-900 text-sf-text-muted',
}

/**
 * The rail is the readiness meter: script → cast → scenes → storyboard → flf →
 * video → review → edit → deliver.
 *
 * It used to state "blocked at storyboard" and leave the operator to hunt for
 * the fix, with the blockers hidden in a title tooltip. The blocked stage is now
 * a button that reports why inline and calls `onStageClick`, so the rail points
 * at the work instead of only naming it.
 */
export default function StageRail({ studio, extras = {}, onStageClick }) {
  const flow = flowView(studio, extras)
  const blockedAt = flow.stage_blocked_at
  const blockedNode = blockedAt ? flow.nodes.find((item) => item.id === blockedAt) : null
  const blockers = blockedNode?.blockers || []
  const clickable = typeof onStageClick === 'function'

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1 items-center">
        {FLOW_STAGES.map((id) => {
          const node = flow.nodes.find((item) => item.id === id)
          const ok = Boolean(node?.ok)
          const here = blockedAt === id
          const tone = ok ? TONE.ok : (here ? TONE.here : TONE.wait)
          const label = (node?.blockers || []).join('\n') || id
          if (!clickable) {
            return (
              <span
                key={id}
                title={label}
                className={`px-1.5 py-0.5 rounded text-[10px] border capitalize ${tone}`}
              >
                {id}
              </span>
            )
          }
          return (
            <button
              key={id}
              type="button"
              title={label}
              onClick={() => onStageClick(id)}
              className={`px-1.5 py-0.5 rounded text-[10px] border capitalize transition-colors hover:brightness-125 ${tone} ${
                here ? 'ring-1 ring-amber-400/70 font-medium' : ''
              }`}
            >
              {id}
            </button>
          )
        })}
        <span className="text-[10px] text-sf-text-muted self-center ml-1">
          {blockedAt ? `blocked at ${blockedAt}` : 'rail clear'}
        </span>
      </div>

      {/* Say why, here, rather than only in a tooltip. */}
      {blockers.length > 0 && (
        <ul className="space-y-0.5">
          {blockers.map((blocker, index) => (
            <li key={index} className="flex items-start gap-1.5">
              <span className="text-[10px] text-amber-300/80 leading-snug">·</span>
              <span className="text-[10px] text-sf-text-muted leading-snug flex-1">{blocker}</span>
              {clickable && (
                <button
                  type="button"
                  onClick={() => onStageClick(blockedAt)}
                  className="text-[10px] text-sf-accent hover:underline shrink-0"
                >
                  go
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
