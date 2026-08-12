import {
  KEY_TO_CATEGORY,
  PROJECT_LOOK_KEYS,
  SCOPE_HELP,
  getOption,
  normalizeProjectLook,
} from '../../services/shotSettings'
import ShotParamsPanel from './ShotParamsPanel'

const LOOK_ONLY_MODE = 'still'

export default function ProjectLookBar({ value, onChange }) {
  const look = normalizeProjectLook(value)
  const summary = PROJECT_LOOK_KEYS
    .map((key) => getOption(KEY_TO_CATEGORY[key], look[key]))
    .filter(Boolean)
    .map((option) => option.label)
    .join(' · ')

  return (
    <details className="rounded-md border border-sf-dark-700 bg-sf-dark-900/70 px-3 py-2">
      <summary className="cursor-pointer text-[11px] text-sf-text-secondary">
        <span className="font-medium text-sf-text-primary">Project look</span>
        <span className="ml-2 text-sf-text-muted">{summary || 'Lens, lighting, grade, mood — inherited by every shot until a shot overrides.'}</span>
      </summary>
      <p className="mt-2 text-[10px] text-sf-text-muted">{SCOPE_HELP.project}</p>
      <div className="mt-2">
        <ShotParamsPanel
          mode={LOOK_ONLY_MODE}
          sections="look"
          compact
          value={{
            framing_id: '',
            camera_angle_id: '',
            camera_movement_id: '',
            ...look,
          }}
          onChange={(next) => {
            const patch = {}
            for (const key of PROJECT_LOOK_KEYS) patch[key] = next[key] || ''
            onChange(patch)
          }}
        />
      </div>
      <p className="mt-1 text-[10px] text-sf-text-muted">
        Framing, angle, and camera actions stay on the shot. Location is 1:1 per shot. Characters are 0–N.
      </p>
    </details>
  )
}
