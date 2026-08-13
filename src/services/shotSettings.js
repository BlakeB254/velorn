import catalog from '../config/cinematographyCatalog.json' with { type: 'json' }

export const SHOT_SETTING_KEYS = [
  'framing_id',
  'camera_angle_id',
  'lens_id',
  'lighting_id',
  'film_stock_id',
  'camera_movement_id',
  'mood_id',
]

export const KEY_TO_CATEGORY = {
  framing_id: 'framing',
  camera_angle_id: 'camera_angle',
  lens_id: 'lens',
  lighting_id: 'lighting',
  film_stock_id: 'film_stock',
  camera_movement_id: 'camera_movement',
  mood_id: 'mood',
}

export const STILL_KEYS = ['framing_id', 'camera_angle_id', 'lens_id', 'lighting_id', 'film_stock_id', 'mood_id']
export const VIDEO_KEYS = [...STILL_KEYS, 'camera_movement_id']

/** Look fields can live on the project and be inherited per shot. */
export const PROJECT_LOOK_KEYS = ['lens_id', 'lighting_id', 'film_stock_id', 'mood_id']
/** Always decided on the card. Empty means “not set”, not inherit. */
export const SHOT_ONLY_KEYS = ['framing_id', 'camera_angle_id']
/** Video / extend / first-last only. One primary camera action. */
export const VIDEO_ACTION_KEYS = ['camera_movement_id']

/** Common extend / i2v moves shown immediately. The rest live under Advanced. */
export const FEATURED_CAMERA_MOVEMENTS = [
  'locked-off-static',
  'slow-push-in',
  'slow-pull-back-reveal',
  'pan-left',
  'pan-right',
  'handheld-micro-motion',
  'zoom-in',
  'zoom-out',
]

export function videoFlowKind(workflow = {}) {
  const needs = workflow.needs || []
  const id = String(workflow.id || '')
  if (needs.includes('last') || id.includes('flf')) return 'flf'
  if (needs.includes('audio') || id.includes('ia2v') || id.includes('tts')) return 'audio'
  if (needs.includes('first') || id.includes('i2v') || id.includes('extend')) return 'extend'
  if (id.includes('t2v')) return 't2v'
  return 'video'
}

export const SCOPE_HELP = {
  project: 'Lens, lighting, grade, and mood default for the whole show. A shot can inherit or override.',
  shot: 'Framing and angle are per shot. A shot has exactly one location and zero or more characters.',
  video: 'Pan, zoom, dolly, orbit — one primary camera action per clip. Does not apply to stills unless Ken Burns.',
}

export function emptyProjectLook() {
  return {
    lens_id: '',
    lighting_id: '',
    film_stock_id: '',
    mood_id: '',
  }
}

export function normalizeProjectLook(raw = {}) {
  const look = emptyProjectLook()
  for (const key of PROJECT_LOOK_KEYS) {
    const value = String(raw?.[key] || '').trim()
    const category = catalog.categories[KEY_TO_CATEGORY[key]]
    const known = (category?.options || []).some((option) => option.id === value)
    look[key] = known ? value : ''
  }
  return look
}

/** Card empty look fields inherit the project default. Geometry/movement do not inherit. */
export function resolveShotSettings(cardSettings = {}, projectLook = {}) {
  const card = normalizeShotSettings(cardSettings)
  const look = normalizeProjectLook(projectLook)
  const resolved = { ...card }
  for (const key of PROJECT_LOOK_KEYS) {
    if (!resolved[key] && look[key]) resolved[key] = look[key]
  }
  return resolved
}

export function isInherited(cardSettings, projectLook, key) {
  if (!PROJECT_LOOK_KEYS.includes(key)) return false
  const card = normalizeShotSettings(cardSettings)
  const look = normalizeProjectLook(projectLook)
  return !card[key] && Boolean(look[key])
}

export const OVERLAP_NOTE = [
  { group: 'Camera geometry', keys: ['framing_id', 'camera_angle_id', 'lens_id'], rule: 'One pick each. They stack: size + angle + glass.' },
  { group: 'Look', keys: ['lighting_id', 'film_stock_id', 'mood_id'], rule: 'One pick each. Light + grade + mood stack.' },
  { group: 'Camera action', keys: ['camera_movement_id'], rule: 'Video / extend / first-last only. One primary move. Not used on stills unless Ken Burns.' },
]

export function emptyShotSettings() {
  return {
    framing_id: '',
    camera_angle_id: '',
    lens_id: '',
    lighting_id: '',
    film_stock_id: '',
    camera_movement_id: '',
    mood_id: '',
  }
}

export function defaultShotSettings() {
  const defaults = catalog.defaults || {}
  return {
    framing_id: defaults.framing || 'tight-medium',
    camera_angle_id: defaults.camera_angle || 'eye-level',
    lens_id: defaults.lens || '35mm-anamorphic',
    lighting_id: defaults.lighting || 'golden-hour-rim',
    film_stock_id: defaults.film_stock || 'kodak-5219-teal-orange',
    camera_movement_id: defaults.camera_movement || 'locked-off-static',
    mood_id: defaults.mood || 'narrative-character',
  }
}

export function normalizeShotSettings(raw = {}) {
  const base = emptyShotSettings()
  for (const key of SHOT_SETTING_KEYS) {
    const value = String(raw?.[key] || '').trim()
    const category = catalog.categories[KEY_TO_CATEGORY[key]]
    const known = (category?.options || []).some((option) => option.id === value)
    base[key] = known ? value : ''
  }
  return base
}

export function getCategory(categoryId) {
  return catalog.categories[categoryId] || null
}

export function getOption(categoryId, optionId) {
  if (!optionId) return null
  return (getCategory(categoryId)?.options || []).find((option) => option.id === optionId) || null
}

export function optionsForMode(categoryId, mode, { featuredOnly = false } = {}) {
  const options = getCategory(categoryId)?.options || []
  const filtered = !mode
    ? options
    : options.filter((option) => (option.appliesTo || []).includes(mode) || (mode === 'extend' && (option.appliesTo || []).includes('i2v')))
  if (featuredOnly && categoryId === 'camera_movement') {
    const featured = new Set(FEATURED_CAMERA_MOVEMENTS)
    return filtered.filter((option) => featured.has(option.id))
  }
  return filtered
}

export function modeFromWorkflow(workflowId = '', kind = 'still') {
  const id = String(workflowId || '')
  if (kind === 'still') {
    if (id.includes('ken-burns')) return 'still'
    return 'still'
  }
  if (id.includes('flf')) return 'flf'
  if (id.includes('i2v') || id.includes('extend')) return 'i2v'
  return 'video'
}

export function movementAllowed(mode, movementId) {
  if (!movementId) return true
  if (mode !== 'still') return true
  return movementId === 'ken-burns-zoomout' || movementId === 'locked-off-static'
}

export const CATEGORY_TO_KEY = {
  framing: 'framing_id',
  camera_angle: 'camera_angle_id',
  lens: 'lens_id',
  lighting: 'lighting_id',
  film_stock: 'film_stock_id',
  camera_movement: 'camera_movement_id',
  mood: 'mood_id',
}

export function assembleLexiconFragments(settings, mode = 'still', projectLook = {}) {
  const normalized = resolveShotSettings(settings, projectLook)
  const fragments = []
  const order = mode === 'still'
    ? ['framing', 'camera_angle', 'lens', 'lighting', 'film_stock', 'mood']
    : (catalog.assemblyOrder || Object.keys(CATEGORY_TO_KEY))
  for (const categoryId of order) {
    const mapped = CATEGORY_TO_KEY[categoryId]
    const optionId = normalized[mapped]
    if (!optionId) continue
    if (categoryId === 'camera_movement' && !movementAllowed(mode, optionId)) continue
    const option = getOption(categoryId, optionId)
    if (!option) continue
    if (mode && option.appliesTo?.length && !option.appliesTo.includes(mode) && !(mode === 'extend' && option.appliesTo.includes('i2v'))) {
      continue
    }
    fragments.push({
      categoryId,
      id: option.id,
      label: option.label,
      prompt: option.prompt,
    })
  }
  return fragments
}

export function assembleLexiconLine(settings, mode = 'still', projectLook = {}) {
  return assembleLexiconFragments(settings, mode, projectLook).map((item) => item.prompt).filter(Boolean).join(', ')
}

export function assembleLexiconLabels(settings, mode = 'still', projectLook = {}) {
  return assembleLexiconFragments(settings, mode, projectLook).map((item) => item.label).join(' · ')
}

export function shotSettingConflicts(settings, mode = 'still', projectLook = {}) {
  const s = resolveShotSettings(settings, projectLook)
  const notes = []

  if (s.framing_id === 'wide-low-angle' && s.camera_angle_id && !['low-angle', 'worms-eye'].includes(s.camera_angle_id)) {
    notes.push({
      level: 'warn',
      message: 'Wide low-angle framing already looks up. Use low-angle, or pick a different size.',
    })
  }
  if (s.framing_id === 'insert-detail' && s.lens_id && !['macro-ecu', '85mm-portrait', '135mm-long'].includes(s.lens_id)) {
    notes.push({
      level: 'info',
      message: 'Insert / detail usually wants macro or a longer lens.',
    })
  }
  if (s.lens_id === 'dutch-tilt' && s.camera_angle_id && s.camera_angle_id !== 'dutch-angle') {
    notes.push({
      level: 'warn',
      message: 'Dutch-tilt glass pairs with dutch-angle. Angle and lens are fighting.',
    })
  }
  if (s.lens_id === 'macro-ecu' && s.framing_id && !['extreme-close-up', 'insert-detail', 'tight-medium'].includes(s.framing_id)) {
    notes.push({
      level: 'info',
      message: 'Macro ECU on a wide shot will look like a mistake. Tighten framing or change glass.',
    })
  }
  if (s.camera_movement_id === 'zoom-in' && s.framing_id === 'extreme-close-up') {
    notes.push({
      level: 'warn',
      message: 'Already an ECU — a zoom-in will crush the frame. Use a push-in from a wider size, or stay locked.',
    })
  }
  if (s.camera_movement_id === 'zoom-out' && ['wide-establishing', 'extreme-wide'].includes(s.framing_id)) {
    notes.push({
      level: 'info',
      message: 'Starting already wide — zoom-out has little room left.',
    })
  }
  if (s.framing_id === 'hidden-cam-static' && s.camera_movement_id && !['locked-off-static', 'handheld-micro-motion'].includes(s.camera_movement_id)) {
    notes.push({
      level: 'warn',
      message: 'Hidden-camera framing wants locked-off or tiny handheld, not a dolly/orbit.',
    })
  }
  if (s.camera_movement_id === 'ken-burns-zoomout' && s.framing_id && s.framing_id !== 'face-stack-vertical') {
    notes.push({
      level: 'info',
      message: 'Ken Burns is built for the vertical face-stack still. Other sizes work, but that pairing is the intended one.',
    })
  }
  if (mode === 'still' && s.camera_movement_id && !movementAllowed(mode, s.camera_movement_id)) {
    notes.push({
      level: 'warn',
      message: 'Camera action is a video setting. Stills keep size, angle, and lens only — movement is ignored until Sequence.',
    })
  }
  if (['black-and-white', 'film-noir-bw', 'monochrome-cyan'].includes(s.film_stock_id) && s.lighting_id === 'red-blue-strobe') {
    notes.push({
      level: 'warn',
      message: 'Strobe RGB lighting will not read on a black-and-white grade.',
    })
  }
  return notes
}

export function shotSettingsSummary(settings, mode = 'still') {
  const labels = assembleLexiconLabels(settings, mode)
  return labels || 'No camera / look settings yet'
}
