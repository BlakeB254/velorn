import { useEffect, useMemo, useRef, useState } from 'react'
import {
  X, Loader2, Plus, Trash2, ChevronLeft, ChevronRight, Search, ImagePlus, FileUp, Music,
} from 'lucide-react'
import useProjectStore, { RESOLUTION_PRESETS, FPS_PRESETS } from '../stores/projectStore'
import useAssetsStore from '../stores/assetsStore'
import { getOutputTarget } from '../services/outputRatio'
import { getProductionType, listProductionTypes } from '../services/productionTypes'
import { isElectron, importAsset, getProjectFileUrl } from '../services/fileSystem'
import { acceptSlot } from '../services/referenceCards'
import {
  newWizardDraft,
  scaffoldFromWizard,
  validateDraft,
  wizardGroupForType,
  wizardStepsForType,
} from '../services/createWizard'
import {
  isFaceOption,
  isSubjectOption,
  listOfferings,
  searchEntityOptions,
} from '../services/cdxDirectory'

const PROJECT_TYPES = listProductionTypes().filter((item) => item.id !== 'animated-short')

const STEP_LABELS = {
  type: 'Type',
  details: 'Details',
  script: 'Script',
  cast: 'Cast',
  locations: 'Locations',
  props: 'Props',
  bible: 'Series bible',
  seasons: 'Seasons',
  subject: 'Subject',
  concept: 'Concept',
  faces: 'Faces',
  song: 'Song',
  artists: 'Artists',
  scenes: 'Scenes',
  review: 'Review',
}

const IMAGE_FILTERS = [
  { name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff'] },
  { name: 'All Files', extensions: ['*'] },
]
const AUDIO_FILTERS = [
  { name: 'Audio Files', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'] },
  { name: 'All Files', extensions: ['*'] },
]
const DOC_FILTERS = [
  { name: 'Documents', extensions: ['pdf', 'txt', 'md', 'doc', 'docx', 'fountain', 'fdx'] },
  { name: 'All Files', extensions: ['*'] },
]

/** Pick a file in Electron (path string) or web (File). Returns null on cancel. */
async function pickFile({ title, filters, accept }) {
  if (isElectron() && window.electronAPI?.selectFile) {
    return window.electronAPI.selectFile({ title, filters })
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] || null)
    input.click()
  })
}

const fileLabel = (file) => (typeof file === 'string' ? file.split(/[\\/]/).pop() : file?.name || '')

function applyTypeResolution(typeId, setSelectedResolution, setIsCustomResolution, setCustomWidth, setCustomHeight) {
  const def = getProductionType(typeId)
  if (!def?.outputTarget) return
  const target = getOutputTarget(def.outputTarget)
  const preset = RESOLUTION_PRESETS.find((item) => (
    item.width === target.edit.width && item.height === target.edit.height
  ))
  if (preset) {
    setSelectedResolution(preset)
    setIsCustomResolution(false)
    return
  }
  setCustomWidth(target.edit.width)
  setCustomHeight(target.edit.height)
  setIsCustomResolution(true)
}

/* ── shared micro-components ──────────────────────────────────────────── */

const inputClass = 'w-full bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-3 py-2 text-xs text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent'
const labelClass = 'block text-[11px] font-medium text-sf-text-primary mb-1.5'
const hintClass = 'text-[10px] text-sf-text-muted mt-1'

function StepShell({ title, hint, children }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-sf-text-primary">{title}</h3>
      {hint && <p className="text-[11px] text-sf-text-muted mt-0.5 mb-3">{hint}</p>}
      <div className="mt-3 space-y-4">{children}</div>
    </div>
  )
}

/** Simple list of names with add/remove. */
function NameListEditor({ items, onChange, placeholder, addLabel = 'Add' }) {
  const [value, setValue] = useState('')
  const add = () => {
    const name = value.trim()
    if (!name) return
    if (items.some((item) => item.name.toLowerCase() === name.toLowerCase())) return
    onChange([...items, { name }])
    setValue('')
  }
  return (
    <div>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder={placeholder}
          className={inputClass}
        />
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1 px-3 py-2 bg-sf-dark-800 border border-sf-dark-600 hover:border-sf-dark-500 rounded-lg text-xs text-sf-text-secondary transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {addLabel}
        </button>
      </div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {items.map((item, index) => (
            <span
              key={`${item.name}-${index}`}
              className="inline-flex items-center gap-1.5 px-2 py-1 bg-sf-dark-800 border border-sf-dark-600 rounded-md text-[11px] text-sf-text-primary"
            >
              {item.name}
              <button
                type="button"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                className="text-sf-text-muted hover:text-sf-error transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** People list (cast / artists / faces) with optional reference image per row. */
function PeopleEditor({ items, onChange, placeholder, pickedImages, onPickImage }) {
  const [value, setValue] = useState('')
  const add = (name) => {
    const clean = String(name || '').trim()
    if (!clean) return
    if (items.some((item) => item.name.toLowerCase() === clean.toLowerCase())) return
    onChange([...items, { name: clean }])
  }
  return (
    <div>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(value); setValue('') } }}
          placeholder={placeholder}
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => { add(value); setValue('') }}
          className="flex items-center gap-1 px-3 py-2 bg-sf-dark-800 border border-sf-dark-600 hover:border-sf-dark-500 rounded-lg text-xs text-sf-text-secondary transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add
        </button>
      </div>
      {items.length > 0 && (
        <div className="space-y-1.5 mt-2">
          {items.map((item, index) => {
            const picked = pickedImages?.[item.name]
            return (
              <div
                key={`${item.name}-${index}`}
                className="flex items-center gap-2 px-2.5 py-1.5 bg-sf-dark-800 border border-sf-dark-600 rounded-lg"
              >
                <span className="flex-1 text-[11px] text-sf-text-primary truncate">{item.name}</span>
                {picked && (
                  <span className="text-[10px] text-sf-accent truncate max-w-[140px]">{fileLabel(picked)}</span>
                )}
                {onPickImage && (
                  <button
                    type="button"
                    onClick={() => onPickImage(item)}
                    className="flex items-center gap-1 px-2 py-1 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-[10px] text-sf-text-secondary transition-colors"
                  >
                    <ImagePlus className="w-3 h-3" />
                    {picked ? 'Swap' : 'Image'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onChange(items.filter((_, i) => i !== index))}
                  className="text-sf-text-muted hover:text-sf-error transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Debounced CDX entity search box. onSelect receives { id, name, group }. */
function CdxSearchBox({ placeholder, filter, onSelect }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const handleChange = (next) => {
    setQuery(next)
    clearTimeout(timerRef.current)
    if (!next.trim()) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    timerRef.current = setTimeout(async () => {
      const { items } = await searchEntityOptions(next)
      const filtered = filter ? items.filter(filter) : items
      setResults(filtered.slice(0, 8))
      setSearching(false)
    }, 300)
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-sf-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          className={`${inputClass} pl-8`}
        />
      </div>
      {(searching || results.length > 0) && query.trim() && (
        <div className="absolute z-10 left-0 right-0 mt-1 bg-sf-dark-850 border border-sf-dark-600 rounded-lg shadow-xl overflow-hidden">
          {searching && (
            <p className="px-3 py-2 text-[10px] text-sf-text-muted">Searching CDX platform…</p>
          )}
          {!searching && results.map((item) => (
            <button
              key={`${item.group}-${item.id}`}
              type="button"
              onClick={() => {
                onSelect(item)
                setQuery('')
                setResults([])
              }}
              className="w-full px-3 py-2 text-left hover:bg-sf-dark-700 transition-colors"
            >
              <span className="text-[11px] text-sf-text-primary">{item.name}</span>
              {item.group && (
                <span className="ml-2 text-[10px] text-sf-text-muted">{item.group}</span>
              )}
            </button>
          ))}
          {!searching && results.length === 0 && (
            <p className="px-3 py-2 text-[10px] text-sf-text-muted">
              No CDX matches — you can still enter it manually below.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/* ── step bodies ──────────────────────────────────────────────────────── */

function TypeStep({ draft, onType }) {
  return (
    <StepShell title="What are we making?" hint="The type picks the guided steps that follow.">
      <div className="grid grid-cols-2 gap-2">
        {PROJECT_TYPES.map((item) => {
          const selected = draft.type === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onType(item.id)}
              className={`px-3 py-2 rounded-lg text-left transition-colors ${
                selected
                  ? 'bg-sf-accent text-white'
                  : 'bg-sf-dark-800 border border-sf-dark-600 text-sf-text-primary hover:border-sf-dark-500'
              }`}
            >
              <p className="text-xs font-medium">{item.label}</p>
              <p className={`text-[10px] leading-snug ${selected ? 'opacity-80' : 'opacity-70'}`}>
                {item.description}
              </p>
            </button>
          )
        })}
      </div>
    </StepShell>
  )
}

function DetailsStep({
  draft, onPatch, error,
  selectedResolution, setSelectedResolution,
  customWidth, setCustomWidth, customHeight, setCustomHeight,
  isCustomResolution, setIsCustomResolution,
  selectedFps, setSelectedFps,
}) {
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b))
  const aspect = (w, h) => `${w / gcd(w, h)}:${h / gcd(w, h)}`
  return (
    <StepShell title="Project details" hint="Name it and set the canvas. Everything else can change later.">
      {error && (
        <div className="p-3 bg-sf-error/20 border border-sf-error/50 rounded-lg">
          <p className="text-xs text-sf-error">{error}</p>
        </div>
      )}
      <div>
        <label className={labelClass}>Project name</label>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          placeholder="Enter project name..."
          className={inputClass}
          autoFocus
        />
      </div>
      <div>
        <label className={labelClass}>Logline (optional)</label>
        <input
          type="text"
          value={draft.logline}
          onChange={(e) => onPatch({ logline: e.target.value })}
          placeholder="One line about the project..."
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>Resolution</label>
        <div className="grid grid-cols-2 gap-2 mb-2">
          {RESOLUTION_PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              onClick={() => { setSelectedResolution(preset); setIsCustomResolution(false) }}
              className={`px-3 py-2 rounded-lg text-left transition-colors ${
                !isCustomResolution && selectedResolution.name === preset.name
                  ? 'bg-sf-accent text-white'
                  : 'bg-sf-dark-800 border border-sf-dark-600 text-sf-text-primary hover:border-sf-dark-500'
              }`}
            >
              <p className="text-xs font-medium">{preset.name}</p>
              <p className="text-[10px] opacity-70">{preset.width}x{preset.height} ({preset.aspect})</p>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setIsCustomResolution(true)}
            className={`px-3 py-2 rounded-lg text-left transition-colors ${
              isCustomResolution
                ? 'bg-sf-accent text-white'
                : 'bg-sf-dark-800 border border-sf-dark-600 text-sf-text-primary hover:border-sf-dark-500'
            }`}
          >
            <p className="text-xs font-medium">Custom</p>
            <p className="text-[10px] opacity-70">
              {isCustomResolution ? `${customWidth}x${customHeight}` : 'Enter dimensions'}
            </p>
          </button>
        </div>
        {isCustomResolution && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={customWidth}
              onChange={(e) => setCustomWidth(Math.max(1, parseInt(e.target.value) || 1))}
              min="1"
              max="7680"
              className={`flex-1 ${inputClass}`}
              placeholder="Width"
            />
            <span className="text-sf-text-muted">×</span>
            <input
              type="number"
              value={customHeight}
              onChange={(e) => setCustomHeight(Math.max(1, parseInt(e.target.value) || 1))}
              min="1"
              max="4320"
              className={`flex-1 ${inputClass}`}
              placeholder="Height"
            />
            <span className="text-[10px] text-sf-text-muted w-16 text-right">
              {aspect(customWidth, customHeight)}
            </span>
          </div>
        )}
      </div>
      <div>
        <label className={labelClass}>Frame rate</label>
        <div className="grid grid-cols-3 gap-2">
          {FPS_PRESETS.map((fps) => (
            <button
              key={fps.value}
              type="button"
              onClick={() => setSelectedFps(fps)}
              className={`px-3 py-2 rounded-lg text-center transition-colors ${
                selectedFps.value === fps.value
                  ? 'bg-sf-accent text-white'
                  : 'bg-sf-dark-800 border border-sf-dark-600 text-sf-text-primary hover:border-sf-dark-500'
              }`}
            >
              <p className="text-xs font-medium">{fps.value} fps</p>
            </button>
          ))}
        </div>
      </div>
    </StepShell>
  )
}

function ScriptStep({ draft, onPatch }) {
  return (
    <StepShell title="Script" hint="Paste a script or treatment now — or skip and write it in the project.">
      <textarea
        value={draft.script}
        onChange={(e) => onPatch({ script: e.target.value })}
        placeholder="INT. WAREHOUSE — NIGHT..."
        rows={10}
        className={`${inputClass} resize-y font-mono text-[11px] leading-relaxed`}
      />
    </StepShell>
  )
}

function BibleStep({ draft, onPatch }) {
  const patchBible = (fields) => onPatch({ bible: { ...draft.bible, ...fields } })
  return (
    <StepShell title="Series bible" hint="The standing rules of the show. Short is fine.">
      {[
        ['concept', 'Concept', 'What is the show?'],
        ['world', 'World', 'Where and when does it live?'],
        ['tone', 'Tone', 'How does it feel?'],
        ['logline', 'Show logline', 'One line for the whole series.'],
      ].map(([key, label, placeholder]) => (
        <div key={key}>
          <label className={labelClass}>{label}</label>
          <textarea
            value={draft.bible[key]}
            onChange={(e) => patchBible({ [key]: e.target.value })}
            placeholder={placeholder}
            rows={2}
            className={`${inputClass} resize-y`}
          />
        </div>
      ))}
    </StepShell>
  )
}

function SeasonsStep({ draft, onPatch }) {
  const seasons = draft.seasons.length > 0
    ? draft.seasons
    : [{ title: 'Season 1', episodes: [{ title: 'Episode 1', script: '' }] }]
  const setSeasons = (next) => onPatch({ seasons: next })

  useEffect(() => {
    if (draft.seasons.length === 0) setSeasons(seasons)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const patchSeason = (index, fields) => setSeasons(
    seasons.map((season, i) => (i === index ? { ...season, ...fields } : season)),
  )
  const patchEpisode = (sIndex, eIndex, fields) => patchSeason(sIndex, {
    episodes: seasons[sIndex].episodes.map((episode, i) => (i === eIndex ? { ...episode, ...fields } : episode)),
  })

  return (
    <StepShell title="Seasons & episodes" hint="Scaffold the run now; scripts per episode are optional.">
      <div className="space-y-3">
        {seasons.map((season, sIndex) => (
          <div key={sIndex} className="bg-sf-dark-850 border border-sf-dark-700 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={season.title}
                onChange={(e) => patchSeason(sIndex, { title: e.target.value })}
                placeholder={`Season ${sIndex + 1}`}
                className={`flex-1 ${inputClass}`}
              />
              {seasons.length > 1 && (
                <button
                  type="button"
                  onClick={() => setSeasons(seasons.filter((_, i) => i !== sIndex))}
                  className="text-sf-text-muted hover:text-sf-error transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="space-y-1.5 pl-2 border-l border-sf-dark-700">
              {season.episodes.map((episode, eIndex) => (
                <div key={eIndex} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={episode.title}
                      onChange={(e) => patchEpisode(sIndex, eIndex, { title: e.target.value })}
                      placeholder={`Episode ${eIndex + 1} title`}
                      className={`flex-1 ${inputClass}`}
                    />
                    {season.episodes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => patchSeason(sIndex, {
                          episodes: season.episodes.filter((_, i) => i !== eIndex),
                        })}
                        className="text-sf-text-muted hover:text-sf-error transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <textarea
                    value={episode.script}
                    onChange={(e) => patchEpisode(sIndex, eIndex, { script: e.target.value })}
                    placeholder="Script / synopsis for this episode (optional)"
                    rows={2}
                    className={`${inputClass} resize-y text-[11px]`}
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() => patchSeason(sIndex, {
                  episodes: [...season.episodes, { title: '', script: '' }],
                })}
                className="flex items-center gap-1 text-[10px] text-sf-accent hover:text-sf-accent-hover transition-colors"
              >
                <Plus className="w-3 h-3" />
                Add episode
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setSeasons([...seasons, { title: `Season ${seasons.length + 1}`, episodes: [{ title: '', script: '' }] }])}
          className="flex items-center gap-1 px-3 py-2 bg-sf-dark-800 border border-sf-dark-600 hover:border-sf-dark-500 rounded-lg text-xs text-sf-text-secondary transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add season
        </button>
      </div>
    </StepShell>
  )
}

function SubjectStep({ draft, onPatch, cdxAvailable }) {
  const subject = draft.subject
  const setSubject = (fields) => onPatch({ subject: { ...subject, ...fields } })
  const [offerings, setOfferings] = useState([])
  const [loadingOfferings, setLoadingOfferings] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (subject.mode === 'cdx' && subject.orgId) {
      setLoadingOfferings(true)
      listOfferings(subject.orgId).then(({ items }) => {
        if (!cancelled) {
          setOfferings(items)
          setLoadingOfferings(false)
        }
      })
    } else {
      setOfferings([])
    }
    return () => { cancelled = true }
  }, [subject.mode, subject.orgId])

  const modes = [
    ['cdx', 'CDX platform org', 'Search the platform directory and link offerings.'],
    ['manual', 'Manual / made-up', 'Any company name — internal or invented.'],
    ['none', 'No subject', 'Skip — decide inside the project.'],
  ]

  return (
    <StepShell title="Who is this ad for?" hint="Pick an org from the CDX platform, type any name, or skip.">
      <div className="grid grid-cols-3 gap-2">
        {modes.map(([mode, label, description]) => {
          const selected = subject.mode === mode
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setSubject({ mode })}
              className={`px-3 py-2 rounded-lg text-left transition-colors ${
                selected
                  ? 'bg-sf-accent text-white'
                  : 'bg-sf-dark-800 border border-sf-dark-600 text-sf-text-primary hover:border-sf-dark-500'
              }`}
            >
              <p className="text-xs font-medium">{label}</p>
              <p className={`text-[10px] leading-snug ${selected ? 'opacity-80' : 'opacity-70'}`}>{description}</p>
            </button>
          )
        })}
      </div>

      {subject.mode === 'cdx' && (
        <div className="space-y-3">
          {!cdxAvailable && (
            <p className={hintClass}>
              CDX platform not reachable — search will come up empty. Manual entry still works.
            </p>
          )}
          <CdxSearchBox
            placeholder="Search CDX orgs, businesses, products…"
            filter={isSubjectOption}
            onSelect={(item) => setSubject({ orgId: item.id, orgName: item.name, offerings: [] })}
          />
          {subject.orgName && (
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-sf-dark-800 border border-sf-accent/50 rounded-lg">
              <span className="flex-1 text-[11px] text-sf-text-primary">{subject.orgName}</span>
              <span className="text-[10px] text-sf-accent">CDX #{subject.orgId}</span>
              <button
                type="button"
                onClick={() => setSubject({ orgId: '', orgName: '', offerings: [] })}
                className="text-sf-text-muted hover:text-sf-error transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          {subject.orgId && (
            <div>
              <label className={labelClass}>Offerings to feature (optional, multi-select)</label>
              {loadingOfferings && <p className={hintClass}>Loading offerings…</p>}
              {!loadingOfferings && offerings.length === 0 && (
                <p className={hintClass}>No offerings on file for this org.</p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {offerings.map((offering) => {
                  const selected = subject.offerings.some((item) => item.id === offering.id)
                  return (
                    <button
                      key={offering.id}
                      type="button"
                      onClick={() => setSubject({
                        offerings: selected
                          ? subject.offerings.filter((item) => item.id !== offering.id)
                          : [...subject.offerings, { id: offering.id, name: offering.name }],
                      })}
                      className={`px-2 py-1 rounded-md text-[11px] transition-colors ${
                        selected
                          ? 'bg-sf-accent text-white'
                          : 'bg-sf-dark-800 border border-sf-dark-600 text-sf-text-primary hover:border-sf-dark-500'
                      }`}
                      title={offering.description}
                    >
                      {offering.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {subject.mode === 'manual' && (
        <div>
          <label className={labelClass}>Company / brand name</label>
          <input
            type="text"
            value={subject.orgName}
            onChange={(e) => setSubject({ orgName: e.target.value })}
            placeholder="Any name — real, client, or made up..."
            className={inputClass}
          />
        </div>
      )}
    </StepShell>
  )
}

function ConceptStep({ draft, onPatch, pickedFile, onPickFile }) {
  const concept = draft.concept
  const setConcept = (fields) => onPatch({ concept: { ...concept, ...fields } })
  const modes = [
    ['none', 'Skip', 'Decide inside the project.'],
    ['paste', 'Paste script', 'Drop in an existing concept or script.'],
    ['file', 'Upload file', 'Script, brief, or treatment document.'],
    ['prompt', 'Prompt it', 'Describe the ad; generate the concept later.'],
  ]
  return (
    <StepShell title="Concept" hint="Where does the creative come from?">
      <div className="grid grid-cols-4 gap-2">
        {modes.map(([mode, label, description]) => {
          const selected = concept.mode === mode
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setConcept({ mode })}
              className={`px-3 py-2 rounded-lg text-left transition-colors ${
                selected
                  ? 'bg-sf-accent text-white'
                  : 'bg-sf-dark-800 border border-sf-dark-600 text-sf-text-primary hover:border-sf-dark-500'
              }`}
            >
              <p className="text-xs font-medium">{label}</p>
              <p className={`text-[10px] leading-snug ${selected ? 'opacity-80' : 'opacity-70'}`}>{description}</p>
            </button>
          )
        })}
      </div>
      {concept.mode === 'paste' && (
        <textarea
          value={concept.text}
          onChange={(e) => setConcept({ text: e.target.value })}
          placeholder="Paste the concept, script, or brief..."
          rows={8}
          className={`${inputClass} resize-y`}
        />
      )}
      {concept.mode === 'file' && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPickFile}
            className="flex items-center gap-2 px-3 py-2 bg-sf-dark-800 border border-sf-dark-600 hover:border-sf-dark-500 rounded-lg text-xs text-sf-text-secondary transition-colors"
          >
            <FileUp className="w-3.5 h-3.5" />
            {pickedFile ? 'Swap file' : 'Choose file'}
          </button>
          {pickedFile && (
            <span className="text-[11px] text-sf-text-primary truncate">{fileLabel(pickedFile)}</span>
          )}
        </div>
      )}
      {concept.mode === 'prompt' && (
        <div>
          <textarea
            value={concept.prompt}
            onChange={(e) => setConcept({ prompt: e.target.value })}
            placeholder="A punchy 15s vertical spot for the spring launch — upbeat, product-first, one clear CTA..."
            rows={5}
            className={`${inputClass} resize-y`}
          />
          <p className={hintClass}>
            Used as the brief for ad-style concept generation (ComfyUI flows) inside the project.
          </p>
        </div>
      )}
    </StepShell>
  )
}

function FacesStep({ draft, onPatch, pickedImages, onPickImage }) {
  return (
    <StepShell
      title="Faces (optional)"
      hint="People the ad can feature — search CDX platform people or add anyone manually. Their reference cards drive on-screen likeness."
    >
      <CdxSearchBox
        placeholder="Search CDX people…"
        filter={isFaceOption}
        onSelect={(item) => {
          if (draft.faces.some((face) => face.name.toLowerCase() === item.name.toLowerCase())) return
          onPatch({
            faces: [...draft.faces, {
              id: `face-${item.id}`,
              name: item.name,
              ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
            }],
          })
        }}
      />
      <PeopleEditor
        items={draft.faces}
        onChange={(faces) => onPatch({ faces })}
        placeholder="Or type a name and press Enter…"
        pickedImages={pickedImages}
        onPickImage={onPickImage}
      />
    </StepShell>
  )
}

function SongStep({ draft, onPatch, pickedFile, onPickFile }) {
  return (
    <StepShell title="Song" hint="The audio the video is cut to. You can also import it later in Music Video mode.">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPickFile}
          className="flex items-center gap-2 px-3 py-2 bg-sf-dark-800 border border-sf-dark-600 hover:border-sf-dark-500 rounded-lg text-xs text-sf-text-secondary transition-colors"
        >
          <Music className="w-3.5 h-3.5" />
          {pickedFile ? 'Swap song' : 'Choose audio file'}
        </button>
        {pickedFile && (
          <span className="text-[11px] text-sf-text-primary truncate">{fileLabel(pickedFile)}</span>
        )}
      </div>
      {draft.song.fileName && !pickedFile && (
        <p className={hintClass}>Selected: {draft.song.fileName}</p>
      )}
    </StepShell>
  )
}

function ReviewStep({ draft, steps }) {
  const group = wizardGroupForType(draft.type)
  const lines = []
  const typeLabel = getProductionType(draft.type)?.label || draft.type
  lines.push(['Type', typeLabel])
  lines.push(['Name', draft.name.trim() || '—'])
  if (draft.logline.trim()) lines.push(['Logline', draft.logline.trim()])
  if (group === 'script' && draft.script.trim()) lines.push(['Script', `${draft.script.trim().length} chars`])
  if (group === 'show' && draft.bible.concept.trim()) lines.push(['Bible concept', draft.bible.concept.trim().slice(0, 80)])
  if (group === 'show' && draft.seasons.length > 0) {
    lines.push(['Seasons', `${draft.seasons.length} · ${draft.seasons.reduce((n, s) => n + s.episodes.filter((e) => e.title.trim()).length, 0)} episodes`])
  }
  if (group !== 'musicVideo' && group !== 'ad' && draft.cast.length > 0) lines.push(['Cast', draft.cast.map((c) => c.name).join(', ')])
  if ((group === 'script' || group === 'show') && draft.locations.length > 0) lines.push(['Locations', draft.locations.map((l) => l.name).join(', ')])
  if (group === 'script' && draft.props.length > 0) lines.push(['Props', draft.props.map((p) => p.name).join(', ')])
  if (group === 'ad' && draft.subject.mode === 'cdx' && draft.subject.orgName) {
    lines.push(['Subject', `${draft.subject.orgName} (CDX${draft.subject.offerings.length ? ` · ${draft.subject.offerings.length} offerings` : ''})`])
  }
  if (group === 'ad' && draft.subject.mode === 'manual' && draft.subject.orgName.trim()) {
    lines.push(['Subject', `${draft.subject.orgName.trim()} (manual)`])
  }
  if (group === 'ad' && draft.concept.mode !== 'none') lines.push(['Concept', draft.concept.mode])
  if (group === 'ad' && draft.faces.length > 0) lines.push(['Faces', draft.faces.map((f) => f.name).join(', ')])
  if (group === 'musicVideo' && draft.song.fileName) lines.push(['Song', draft.song.fileName])
  if (group === 'musicVideo' && draft.artists.length > 0) lines.push(['Artists', draft.artists.map((a) => a.name).join(', ')])
  if (group === 'musicVideo' && draft.scenes.length > 0) lines.push(['Scenes', draft.scenes.map((s) => s.name).join(', ')])

  return (
    <StepShell title="Review" hint="Create scaffolds the production, empty reference cards, and imports any picked files.">
      <div className="bg-sf-dark-800 rounded-lg divide-y divide-sf-dark-700">
        {lines.map(([label, value]) => (
          <div key={label} className="flex gap-3 px-3 py-2">
            <span className="w-20 shrink-0 text-[10px] uppercase tracking-wide text-sf-text-muted pt-0.5">{label}</span>
            <span className="text-[11px] text-sf-text-primary break-words">{value}</span>
          </div>
        ))}
      </div>
      <p className={hintClass}>
        Steps: {steps.map((step) => STEP_LABELS[step] || step).join(' → ')}
      </p>
    </StepShell>
  )
}

/* ── the wizard ───────────────────────────────────────────────────────── */

function CreateProjectWizard({ isOpen, onClose }) {
  const { createProject, defaultResolution, defaultFps } = useProjectStore()
  const [draft, setDraft] = useState(() => newWizardDraft('show'))
  const [stepIndex, setStepIndex] = useState(0)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState(null)
  const [cdxAvailable, setCdxAvailable] = useState(true)
  // Picked files live outside the pure draft: File objects (web) or path strings (Electron).
  const [songFile, setSongFile] = useState(null)
  const [conceptFile, setConceptFile] = useState(null)
  const [peopleImages, setPeopleImages] = useState({}) // { [personName]: File|string }

  const [selectedResolution, setSelectedResolution] = useState(() => {
    const preset = RESOLUTION_PRESETS.find((p) => p.name === (defaultResolution || 'HD 1080p'))
    return preset || RESOLUTION_PRESETS[0]
  })
  const [customWidth, setCustomWidth] = useState(1920)
  const [customHeight, setCustomHeight] = useState(1080)
  const [isCustomResolution, setIsCustomResolution] = useState(false)
  const [selectedFps, setSelectedFps] = useState(() => {
    const preset = FPS_PRESETS.find((f) => f.value === (defaultFps ?? 24))
    return preset || FPS_PRESETS[2]
  })

  const steps = useMemo(() => wizardStepsForType(draft.type), [draft.type])
  const stepId = steps[Math.min(stepIndex, steps.length - 1)]

  // Probe the CDX directory once per open so the subject step can warn early.
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    searchEntityOptions('').then(({ ok }) => { if (!cancelled) setCdxAvailable(ok) })
    return () => { cancelled = true }
  }, [isOpen])

  // Reset when opened
  useEffect(() => {
    if (!isOpen) return
    setDraft(newWizardDraft('show'))
    setStepIndex(0)
    setError(null)
    setIsCreating(false)
    setSongFile(null)
    setConceptFile(null)
    setPeopleImages({})
    const resPreset = RESOLUTION_PRESETS.find((p) => p.name === (defaultResolution || 'HD 1080p')) || RESOLUTION_PRESETS[0]
    const fpsPreset = FPS_PRESETS.find((f) => f.value === (defaultFps ?? 24)) || FPS_PRESETS[2]
    setSelectedResolution(resPreset)
    setSelectedFps(fpsPreset)
    setCustomWidth(1920)
    setCustomHeight(1080)
    setIsCustomResolution(false)
    applyTypeResolution('show', setSelectedResolution, setIsCustomResolution, setCustomWidth, setCustomHeight)
  }, [isOpen, defaultResolution, defaultFps])

  if (!isOpen) return null

  const patchDraft = (fields) => setDraft((prev) => ({ ...prev, ...fields }))
  const handleType = (typeId) => {
    patchDraft({ type: typeId })
    applyTypeResolution(typeId, setSelectedResolution, setIsCustomResolution, setCustomWidth, setCustomHeight)
    setStepIndex(1) // advance to details
  }

  const pickSong = async () => {
    const file = await pickFile({
      title: 'Select song audio',
      filters: AUDIO_FILTERS,
      accept: 'audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus',
    })
    if (!file) return
    setSongFile(file)
    patchDraft({ song: { filePath: typeof file === 'string' ? file : file.name, fileName: fileLabel(file) } })
  }

  const pickConceptFile = async () => {
    const file = await pickFile({
      title: 'Select concept / script file',
      filters: DOC_FILTERS,
      accept: '.pdf,.txt,.md,.doc,.docx,.fountain,.fdx',
    })
    if (!file) return
    setConceptFile(file)
    patchDraft({
      concept: {
        ...draft.concept,
        filePath: typeof file === 'string' ? file : file.name,
        fileName: fileLabel(file),
      },
    })
  }

  const pickPersonImage = (listKey) => async (person) => {
    const file = await pickFile({
      title: `Reference image for ${person.name}`,
      filters: IMAGE_FILTERS,
      accept: 'image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff',
    })
    if (!file) return
    setPeopleImages((prev) => ({ ...prev, [person.name]: file }))
    const list = draft[listKey].map((entry) => (
      entry.name === person.name
        ? { ...entry, imagePath: typeof file === 'string' ? file : file.name }
        : entry
    ))
    patchDraft({ [listKey]: list })
  }

  const finalWidth = isCustomResolution ? customWidth : selectedResolution.width
  const finalHeight = isCustomResolution ? customHeight : selectedResolution.height

  /** Post-create: import picked files into the new project, accept image slots. Best-effort. */
  const runPendingImports = async (scaffold, projectData) => {
    if (!scaffold.pendingImports.length) return
    const { currentProjectHandle, saveProject } = useProjectStore.getState()
    if (!currentProjectHandle) return
    const { addAsset } = useAssetsStore.getState()
    const now = new Date().toISOString()
    let references = projectData.references
    let creation = projectData.creation
    let changed = false

    for (const item of scaffold.pendingImports) {
      let file = item.role === 'song'
        ? songFile
        : item.role === 'concept-file'
          ? conceptFile
          : peopleImages[item.name]
      if (!file && item.role === 'face-image-url' && item.url) {
        // KB face picked with a remote image — pull it in like a picked file.
        try {
          const response = await fetch(item.url)
          if (!response?.ok) throw new Error(`HTTP ${response?.status || 0}`)
          const blob = await response.blob()
          const extension = String(blob.type || '').split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
          const baseName = String(item.name || 'face').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'face'
          file = new File([blob], `${baseName}.${extension}`, { type: blob.type || 'image/jpeg' })
        } catch (fetchError) {
          console.warn('[CreateProjectWizard] KB face image fetch failed (non-fatal):', item.url, fetchError)
        }
      }
      if (!file) continue
      try {
        if (item.role === 'song') {
          const info = await importAsset(currentProjectHandle, file, 'audio')
          addAsset({
            ...info,
            type: 'audio',
            url: info.url || '',
            settings: { ...(info.settings || {}), duration: info.duration },
          })
        } else if (item.role === 'concept-file') {
          const info = await importAsset(currentProjectHandle, file, 'documents')
          creation = {
            ...creation,
            ad: { ...creation.ad, concept: { ...creation.ad.concept, importedPath: info.path || '' } },
          }
          changed = true
        } else {
          const info = await importAsset(currentProjectHandle, file, 'images')
          let url = info.url || ''
          if (!url && info.path) {
            try { url = await getProjectFileUrl(currentProjectHandle, info.path) } catch (_) { /* best-effort */ }
          }
          if (!url && typeof file !== 'string') {
            try { url = URL.createObjectURL(file) } catch (_) { /* best-effort */ }
          }
          const asset = addAsset({ ...info, type: 'image', url, isImported: true })
          references = {
            ...references,
            characters: references.characters.map((card) => (
              card.id === item.cardId ? acceptSlot(card, item.slotId, asset.id, { now }) : card
            )),
          }
          changed = true
        }
      } catch (importError) {
        console.warn('[CreateProjectWizard] import failed (non-fatal):', item.role, importError)
      }
    }

    try {
      await saveProject(changed ? { references, creation } : {})
    } catch (saveError) {
      console.warn('[CreateProjectWizard] post-create save failed (non-fatal):', saveError)
    }
  }

  const handleCreate = async () => {
    const validation = validateDraft(draft)
    if (!validation.ok) {
      setError(validation.errors[0])
      setStepIndex(1) // details step holds the name field
      return
    }
    setIsCreating(true)
    setError(null)
    try {
      const scaffold = scaffoldFromWizard(draft, { now: new Date().toISOString() })
      const projectData = await createProject({
        name: draft.name.trim(),
        width: finalWidth,
        height: finalHeight,
        fps: selectedFps.value,
        type: draft.type,
        scaffold,
      })
      if (!projectData) {
        setError('Failed to create project. Please try again.')
        setIsCreating(false)
        return
      }
      await runPendingImports(scaffold, projectData)
      onClose()
    } catch (createError) {
      setError(createError.message || 'An error occurred while creating the project.')
      setIsCreating(false)
    }
  }

  const isLastStep = stepIndex >= steps.length - 1
  const canNext = stepId !== 'details' || validateDraft(draft).ok

  const goNext = () => {
    if (stepId === 'details' && !validateDraft(draft).ok) {
      setError('Give the project a name first (no < > : " / \\ | ? * characters).')
      return
    }
    setError(null)
    setStepIndex((index) => Math.min(index + 1, steps.length - 1))
  }
  const goBack = () => {
    setError(null)
    setStepIndex((index) => Math.max(index - 1, 0))
  }

  const renderStep = () => {
    switch (stepId) {
      case 'type':
        return <TypeStep draft={draft} onType={handleType} />
      case 'details':
        return (
          <DetailsStep
            draft={draft}
            onPatch={patchDraft}
            error={error}
            selectedResolution={selectedResolution}
            setSelectedResolution={setSelectedResolution}
            customWidth={customWidth}
            setCustomWidth={setCustomWidth}
            customHeight={customHeight}
            setCustomHeight={setCustomHeight}
            isCustomResolution={isCustomResolution}
            setIsCustomResolution={setIsCustomResolution}
            selectedFps={selectedFps}
            setSelectedFps={setSelectedFps}
          />
        )
      case 'script':
        return <ScriptStep draft={draft} onPatch={patchDraft} />
      case 'cast':
        return (
          <StepShell title="Cast" hint="Characters get reference cards — add names now, images optional.">
            <PeopleEditor
              items={draft.cast}
              onChange={(cast) => patchDraft({ cast })}
              placeholder="Character name…"
              pickedImages={peopleImages}
              onPickImage={pickPersonImage('cast')}
            />
          </StepShell>
        )
      case 'locations':
        return (
          <StepShell title="Locations" hint="Each becomes a location reference card (wide / medium / detail / birds-eye).">
            <NameListEditor
              items={draft.locations}
              onChange={(locations) => patchDraft({ locations })}
              placeholder="Location name…"
            />
          </StepShell>
        )
      case 'props':
        return (
          <StepShell title="Props" hint="Hero props get their own reference cards.">
            <NameListEditor
              items={draft.props}
              onChange={(props) => patchDraft({ props })}
              placeholder="Prop name…"
            />
          </StepShell>
        )
      case 'bible':
        return <BibleStep draft={draft} onPatch={patchDraft} />
      case 'seasons':
        return <SeasonsStep draft={draft} onPatch={patchDraft} />
      case 'subject':
        return <SubjectStep draft={draft} onPatch={patchDraft} cdxAvailable={cdxAvailable} />
      case 'concept':
        return <ConceptStep draft={draft} onPatch={patchDraft} pickedFile={conceptFile} onPickFile={pickConceptFile} />
      case 'faces':
        return (
          <FacesStep
            draft={draft}
            onPatch={patchDraft}
            pickedImages={peopleImages}
            onPickImage={pickPersonImage('faces')}
          />
        )
      case 'song':
        return <SongStep draft={draft} onPatch={patchDraft} pickedFile={songFile} onPickFile={pickSong} />
      case 'artists':
        return (
          <StepShell title="Artists" hint="Who performs — reference images drive lipsync and likeness.">
            <PeopleEditor
              items={draft.artists}
              onChange={(artists) => patchDraft({ artists })}
              placeholder="Artist / performer name…"
              pickedImages={peopleImages}
              onPickImage={pickPersonImage('artists')}
            />
          </StepShell>
        )
      case 'scenes':
        return (
          <StepShell title="Scenes / style refs" hint="Places or looks the video moves through — each becomes a location card.">
            <NameListEditor
              items={draft.scenes}
              onChange={(scenes) => patchDraft({ scenes })}
              placeholder="Scene or setting…"
            />
          </StepShell>
        )
      case 'review':
        return <ReviewStep draft={draft} steps={steps} />
      default:
        return null
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-sf-dark-900 border border-sf-dark-700 w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden shadow-2xl flex flex-col rounded-xl max-sm:mx-0 max-sm:max-h-none max-sm:h-full max-sm:rounded-none max-sm:border-0">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-sf-dark-700">
          <div>
            <h2 className="text-lg font-semibold text-sf-text-primary">New Project</h2>
            <p className="text-[10px] text-sf-text-muted mt-0.5">
              {getProductionType(draft.type)?.label || draft.type}
            </p>
          </div>
          <button
            onClick={() => { if (!isCreating) onClose() }}
            disabled={isCreating}
            className="p-1.5 hover:bg-sf-dark-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5 text-sf-text-muted" />
          </button>
        </div>

        {/* Step rail */}
        <div className="flex items-center gap-1 px-5 py-2.5 border-b border-sf-dark-700 overflow-x-auto">
          {steps.map((step, index) => {
            const active = index === stepIndex
            const done = index < stepIndex
            return (
              <button
                key={step}
                type="button"
                onClick={() => { if (!isCreating && index < stepIndex) setStepIndex(index) }}
                className={`shrink-0 px-2 py-1 rounded-md text-[10px] transition-colors ${
                  active
                    ? 'bg-sf-accent text-white'
                    : done
                      ? 'text-sf-accent hover:bg-sf-dark-700'
                      : 'text-sf-text-muted'
                }`}
              >
                {STEP_LABELS[step] || step}
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto flex-1">
          {renderStep()}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-sf-dark-700 bg-sf-dark-850">
          <button
            onClick={goBack}
            disabled={stepIndex === 0 || isCreating}
            className="flex items-center gap-1 px-3 py-2 text-sm text-sf-text-secondary hover:text-sf-text-primary transition-colors disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          <div className="flex items-center gap-3">
            {!isLastStep && stepId !== 'type' && stepId !== 'details' && (
              <button
                onClick={goNext}
                disabled={isCreating}
                className="px-3 py-2 text-sm text-sf-text-muted hover:text-sf-text-primary transition-colors disabled:opacity-50"
              >
                Skip
              </button>
            )}
            {isLastStep ? (
              <button
                onClick={handleCreate}
                disabled={isCreating}
                className="flex items-center gap-2 px-5 py-2 bg-sf-blue hover:bg-sf-blue-hover disabled:bg-sf-dark-700 disabled:cursor-not-allowed rounded-lg text-sm text-white font-medium transition-colors"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Project'
                )}
              </button>
            ) : (
              <button
                onClick={goNext}
                disabled={isCreating || !canNext}
                className="flex items-center gap-1 px-5 py-2 bg-sf-blue hover:bg-sf-blue-hover disabled:bg-sf-dark-700 disabled:cursor-not-allowed rounded-lg text-sm text-white font-medium transition-colors"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default CreateProjectWizard
