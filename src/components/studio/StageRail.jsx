import { flowView, FLOW_STAGES } from '../../services/studioStore'

const TONE = {
  ok: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300',
  here: 'border-amber-400/70 bg-amber-400/15 text-amber-200',
  wait: 'border-sf-dark-700 bg-sf-dark-900 text-sf-text-muted',
}

export default function StageRail({ studio, extras = {} }) {
  const flow = flowView(studio, extras)
  return (
    <div className="flex flex-wrap gap-1">
      {FLOW_STAGES.map((id) => {
        const node = flow.nodes.find((item) => item.id === id)
        const ok = Boolean(node?.ok)
        const here = flow.stage_blocked_at === id
        const tone = ok ? TONE.ok : (here ? TONE.here : TONE.wait)
        return (
          <span
            key={id}
            title={(node?.blockers || []).join('\n') || id}
            className={`px-1.5 py-0.5 rounded text-[10px] border capitalize ${tone}`}
          >
            {id}
          </span>
        )
      })}
      <span className="text-[10px] text-sf-text-muted self-center ml-1">
        {flow.stage_blocked_at ? `blocked at ${flow.stage_blocked_at}` : 'rail clear'}
      </span>
    </div>
  )
}
