import { applyOutputTargetToSettings, inferOutputTarget, listOutputTargets } from '../../services/outputRatio'

export default function OutputRatioBar({ settings = {}, onChange, shotValue = '', onShotChange = null }) {
  const projectTarget = inferOutputTarget(settings)
  const targets = listOutputTargets()
  const active = shotValue || projectTarget.id

  return (
    <div className="rounded-md border border-sf-dark-700 bg-sf-dark-900/70 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-sf-text-primary">Output</span>
        {targets.map((target) => {
          const selected = active === target.id
          return (
            <button
              key={target.id}
              type="button"
              title={target.hint}
              onClick={() => {
                if (onShotChange) onShotChange(target.id === projectTarget.id ? '' : target.id)
                else onChange?.(applyOutputTargetToSettings(settings, target.id))
              }}
              className={`px-2 py-1 rounded text-[11px] border ${
                selected
                  ? 'border-sf-accent bg-sf-accent/15 text-sf-text-primary'
                  : 'border-sf-dark-600 text-sf-text-muted hover:text-sf-text-secondary'
              }`}
            >
              {target.label}
              <span className="ml-1 text-[10px] text-sf-text-muted">{target.aspect}</span>
            </button>
          )
        })}
        <span className="text-[10px] text-sf-text-muted">
          {onShotChange
            ? (shotValue ? `shot override · ${active}` : `inherits project · ${projectTarget.label}`)
            : `${projectTarget.edit.width}×${projectTarget.edit.height} edit · gen ${projectTarget.generate.width}×${projectTarget.generate.height}`}
        </span>
      </div>
    </div>
  )
}
