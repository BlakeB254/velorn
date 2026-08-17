import { useEffect, useMemo, useState } from 'react'
import { getAbsoluteFileUrl } from '../../services/fileSystem'
import {
  CATEGORY_TO_KEY,
  OVERLAP_NOTE,
  PROJECT_LOOK_KEYS,
  assembleLexiconLabels,
  assembleLexiconLine,
  getCategory,
  getLexiconPreviewUrl,
  isInherited,
  normalizeShotSettings,
  optionsForMode,
  resolveShotSettings,
  shotSettingConflicts,
} from '../../services/shotSettings'

const GEOMETRY_GROUPS = [
  {
    title: 'Frame (distance)',
    help: 'How close we are — one size. Not the same as optical zoom.',
    keys: ['framing'],
  },
  {
    title: 'Angle',
    help: 'Where the camera sits relative to the subject. Stacks with size and lens.',
    keys: ['camera_angle'],
  },
]

const CAMERA_GROUPS = [
  ...GEOMETRY_GROUPS,
  {
    title: 'Lens (optical zoom)',
    help: 'Compression / FOV. 24mm vs 85mm at the same size are different pictures.',
    keys: ['lens'],
  },
]

const LOOK_GROUPS = [
  { title: 'Lighting', help: 'One key. Stacks with grade.', keys: ['lighting'] },
  { title: 'Grade / stock', help: 'One look. B&W and teal-orange cannot both be on.', keys: ['film_stock'] },
  { title: 'Mood', help: 'Soft register. Stacks with light and grade.', keys: ['mood'] },
]

function ChipRow({ categoryId, value, mode, onChange, inherited = false, featuredOnly = false }) {
  const category = getCategory(categoryId)
  const options = optionsForMode(categoryId, mode, { featuredOnly })
  const [urls, setUrls] = useState({})

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const next = {}
      for (const option of options.slice(0, 24)) {
        if (!option.preview) continue
        try {
          const bundled = getLexiconPreviewUrl(option.preview)
          const url = bundled.startsWith('/') || bundled.startsWith('.') || /^(https?:|comfystudio:|blob:|data:)/i.test(bundled)
            ? bundled
            : await getAbsoluteFileUrl(option.preview)
          if (!cancelled && url) next[option.id] = url
        } catch (_) { /* ignore */ }
      }
      if (!cancelled) setUrls((prev) => ({ ...prev, ...next }))
    }
    run()
    return () => { cancelled = true }
  }, [categoryId, mode, options])

  if (!category) return null

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => onChange('')}
          className={`px-1.5 py-0.5 rounded text-[10px] border ${
            !value ? 'border-sf-accent bg-sf-accent/15 text-sf-text-primary' : 'border-sf-dark-700 text-sf-text-muted'
          }`}
        >
          None
        </button>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            title={option.tagline || option.prompt}
            onClick={() => onChange(option.id === value ? '' : option.id)}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border max-w-[11rem] ${
              value === option.id
                ? inherited
                  ? 'border-sf-accent/50 bg-sf-accent/10 text-sf-text-primary'
                  : 'border-sf-accent bg-sf-accent/15 text-sf-text-primary'
                : 'border-sf-dark-700 text-sf-text-secondary hover:border-sf-dark-500'
            }`}
          >
            {urls[option.id] ? (
              <img src={urls[option.id]} alt="" className="w-4 h-4 rounded-sm object-cover flex-shrink-0" />
            ) : null}
            <span className="truncate">{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function Section({ title, help, children }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">{title}</span>
        <span className="text-[9px] text-sf-text-muted truncate">{help}</span>
      </div>
      {children}
    </div>
  )
}

export default function ShotParamsPanel({
  value,
  onChange,
  mode = 'still',
  compact = false,
  projectLook = {},
  sections = 'all',
  featuredMovement = false,
  showNotes = true,
  showSummary = true,
}) {
  const cardSettings = useMemo(() => normalizeShotSettings(value), [value])
  const settings = useMemo(() => resolveShotSettings(cardSettings, projectLook), [cardSettings, projectLook])
  const conflicts = useMemo(() => shotSettingConflicts(cardSettings, mode, projectLook), [cardSettings, mode, projectLook])
  const line = assembleLexiconLine(cardSettings, mode, projectLook)
  const labels = assembleLexiconLabels(cardSettings, mode, projectLook)
  const showMovement = mode !== 'still'
  const cameraGroups = sections === 'geometry' ? GEOMETRY_GROUPS : CAMERA_GROUPS
  const showCamera = sections === 'all' || sections === 'camera' || sections === 'geometry'
  const showLook = sections === 'all' || sections === 'look'
  const showAction = showMovement && (sections === 'all' || sections === 'movement' || (sections !== 'look' && sections !== 'geometry'))

  const patch = (key, next) => onChange({ ...cardSettings, [key]: next })
  const settingValue = (key) => settings[key] || ''
  const inherited = (key) => isInherited(cardSettings, projectLook, key)

  return (
    <div className={`space-y-2 ${compact ? '' : 'rounded border border-sf-dark-700 bg-sf-dark-950 p-2'}`}>
      {showNotes && !compact && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-sf-text-muted">
          {OVERLAP_NOTE.filter((note) => showMovement || note.group !== 'Camera action').map((note) => (
            <span key={note.group}>
              <span className="text-sf-text-secondary">{note.group}:</span> {note.rule}
            </span>
          ))}
        </div>
      )}

      {showCamera && cameraGroups.map((group) => (
        <Section key={group.title} title={group.title} help={group.help}>
          {group.keys.map((categoryId) => (
            <ChipRow
              key={categoryId}
              categoryId={categoryId}
              mode={mode}
              value={settingValue(CATEGORY_TO_KEY[categoryId])}
              inherited={inherited(CATEGORY_TO_KEY[categoryId])}
              onChange={(next) => patch(CATEGORY_TO_KEY[categoryId], next)}
            />
          ))}
        </Section>
      ))}

      {showLook && LOOK_GROUPS.map((group) => (
        <Section key={group.title} title={group.title} help={group.help}>
          {group.keys.map((categoryId) => (
            <ChipRow
              key={categoryId}
              categoryId={categoryId}
              mode={mode}
              value={settingValue(CATEGORY_TO_KEY[categoryId])}
              inherited={inherited(CATEGORY_TO_KEY[categoryId])}
              onChange={(next) => patch(CATEGORY_TO_KEY[categoryId], next)}
            />
          ))}
        </Section>
      ))}

      {showAction && (
        <Section
          title="Camera action"
          help="One primary move. Zoom is optical; push/pull is the camera traveling. They replace each other."
        >
          <ChipRow
            categoryId="camera_movement"
            mode={mode === 'extend' ? 'i2v' : mode}
            featuredOnly={featuredMovement}
            value={settingValue('camera_movement_id')}
            onChange={(next) => patch('camera_movement_id', next)}
          />
        </Section>
      )}

      {conflicts.length > 0 && (
        <ul className="space-y-0.5">
          {conflicts.map((note) => (
            <li
              key={note.message}
              className={`text-[10px] ${note.level === 'warn' ? 'text-amber-300' : 'text-sf-text-muted'}`}
            >
              {note.message}
            </li>
          ))}
        </ul>
      )}

      {showSummary && (
        <div className="rounded bg-black/20 px-2 py-1.5">
          <div className="text-[10px] text-sf-text-secondary">{labels || 'Using project look / unset.'}</div>
          {!compact && line && (
            <p className="mt-0.5 text-[10px] text-sf-text-muted whitespace-pre-wrap">{line}</p>
          )}
        </div>
      )}
    </div>
  )
}
