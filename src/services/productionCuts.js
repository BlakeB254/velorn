/**
 * Named episode cuts (drafts) — save / checkout / watch / promote.
 *
 * Live storyboardBoard is the checked-out cut. Each named cut is a snapshot
 * of that board plus an optional review timeline so drafts stay watchable
 * without becoming the primary version.
 *
 * Stored on the project as `productionCuts[episodeId]`, not inside
 * `production.seasons` (boards are large; the packet stays lean).
 */

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const asString = (value, fallback = '') => (value == null ? fallback : String(value))
const asNumber = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}
const nowIso = () => new Date().toISOString()
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

export function slugifyCut(value, fallback = 'draft') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallback
}

export function emptyCutStats() {
  return { cardCount: 0, clipCount: 0, stillCount: 0, runtimeS: 0 }
}

export function cutStats(board = null) {
  const cards = Array.isArray(board?.cards) ? board.cards : []
  return {
    cardCount: cards.length,
    clipCount: cards.filter((card) => card.videoAssetId).length,
    stillCount: cards.filter((card) => card.imageAssetId).length,
    runtimeS: Number(cards.reduce((sum, card) => sum + (asNumber(card.duration, 0) || 0), 0).toFixed(2)),
  }
}

export function emptyCut(partial = {}) {
  const name = asString(partial.name, 'Draft')
  const slug = slugifyCut(partial.slug || partial.id || name, 'draft')
  const id = asString(partial.id, slug)
  const board = isPlainObject(partial.storyboardBoard)
    ? clone(partial.storyboardBoard)
    : { version: 1, cards: [] }
  return {
    id,
    slug,
    name,
    author: asString(partial.author),
    notes: asString(partial.notes),
    createdAt: asString(partial.createdAt, nowIso()),
    updatedAt: asString(partial.updatedAt, nowIso()),
    timelineId: asString(partial.timelineId),
    storyboardBoard: board,
    stats: isPlainObject(partial.stats) ? { ...emptyCutStats(), ...partial.stats } : cutStats(board),
  }
}

export function emptyEpisodeCuts(partial = {}) {
  const cuts = Array.isArray(partial.cuts)
    ? partial.cuts.filter(isPlainObject).map((cut) => emptyCut(cut))
    : []
  const primaryId = asString(partial.primaryId)
  const currentId = asString(partial.currentId)
  return {
    episodeId: asString(partial.episodeId),
    primaryId: cuts.some((cut) => cut.id === primaryId) ? primaryId : (cuts[0]?.id || ''),
    currentId: cuts.some((cut) => cut.id === currentId) ? currentId : (primaryId || cuts[0]?.id || ''),
    cuts,
    updatedAt: asString(partial.updatedAt, nowIso()),
  }
}

export function normalizeCutsIndex(raw) {
  if (!isPlainObject(raw)) return {}
  const next = {}
  for (const [episodeId, bucket] of Object.entries(raw)) {
    if (!episodeId || !isPlainObject(bucket)) continue
    next[episodeId] = emptyEpisodeCuts({ ...bucket, episodeId })
  }
  return next
}

export function getEpisodeCuts(index, episodeId) {
  const id = asString(episodeId)
  const normalized = normalizeCutsIndex(index)
  return normalized[id] || emptyEpisodeCuts({ episodeId: id })
}

export function findCut(index, episodeId, cutRef) {
  const bucket = getEpisodeCuts(index, episodeId)
  const wanted = asString(cutRef).trim()
  if (!wanted) return { bucket, cut: null }
  const slug = slugifyCut(wanted, '')
  const cut = bucket.cuts.find((item) => (
    item.id === wanted
    || item.slug === wanted
    || item.slug === slug
    || item.name.toLowerCase() === wanted.toLowerCase()
  )) || null
  return { bucket, cut }
}

export function summarizeCut(cut, { primaryId = '', currentId = '' } = {}) {
  if (!cut) return null
  return {
    id: cut.id,
    slug: cut.slug,
    name: cut.name,
    author: cut.author,
    notes: cut.notes,
    createdAt: cut.createdAt,
    updatedAt: cut.updatedAt,
    timelineId: cut.timelineId,
    stats: cut.stats || emptyCutStats(),
    primary: cut.id === primaryId,
    current: cut.id === currentId,
  }
}

export function listCuts(index, episodeId) {
  const bucket = getEpisodeCuts(index, episodeId)
  return {
    episodeId: bucket.episodeId,
    primaryId: bucket.primaryId,
    currentId: bucket.currentId,
    cuts: bucket.cuts.map((cut) => summarizeCut(cut, bucket)),
  }
}

function writeBucket(index, episodeId, bucket) {
  return {
    ...normalizeCutsIndex(index),
    [episodeId]: { ...bucket, episodeId, updatedAt: nowIso() },
  }
}

export function saveCut(index, episodeId, fields = {}) {
  const idHint = asString(fields.id || fields.slug || fields.name)
  if (!idHint && !fields.storyboardBoard) {
    throw new Error('save_cut needs a name (or id) and a storyboard snapshot')
  }
  const bucket = getEpisodeCuts(index, episodeId)
  const slug = slugifyCut(fields.slug || fields.id || fields.name, 'draft')
  const existing = bucket.cuts.find((cut) => (
    cut.id === fields.id || cut.slug === slug || (fields.name && cut.name.toLowerCase() === String(fields.name).toLowerCase())
  ))
  const nextCut = emptyCut({
    ...(existing || {}),
    ...fields,
    id: existing?.id || asString(fields.id, slug),
    slug: existing?.slug || slug,
    name: asString(fields.name, existing?.name || 'Draft'),
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
    storyboardBoard: fields.storyboardBoard || existing?.storyboardBoard,
    stats: fields.stats || cutStats(fields.storyboardBoard || existing?.storyboardBoard),
  })
  const cuts = existing
    ? bucket.cuts.map((cut) => (cut.id === existing.id ? nextCut : cut))
    : [...bucket.cuts, nextCut]
  const nextBucket = {
    ...bucket,
    cuts,
    primaryId: bucket.primaryId || nextCut.id,
    currentId: fields.makeCurrent === false ? (bucket.currentId || nextCut.id) : nextCut.id,
  }
  return {
    index: writeBucket(index, episodeId, nextBucket),
    cut: nextCut,
    bucket: nextBucket,
    created: !existing,
  }
}

export function checkoutCut(index, episodeId, cutRef) {
  const { bucket, cut } = findCut(index, episodeId, cutRef)
  if (!cut) throw new Error(`Cut '${cutRef}' not found on ${episodeId}`)
  const nextBucket = { ...bucket, currentId: cut.id }
  return {
    index: writeBucket(index, episodeId, nextBucket),
    cut,
    bucket: nextBucket,
  }
}

export function promoteCut(index, episodeId, cutRef) {
  const { bucket, cut } = findCut(index, episodeId, cutRef)
  if (!cut) throw new Error(`Cut '${cutRef}' not found on ${episodeId}`)
  const nextBucket = { ...bucket, primaryId: cut.id }
  return {
    index: writeBucket(index, episodeId, nextBucket),
    cut,
    bucket: nextBucket,
  }
}

export function loadEpisodeBoard(index, episodeId, fallbackBoard = { version: 1, cards: [] }) {
  const bucket = getEpisodeCuts(index, episodeId)
  if (!bucket.cuts.length) {
    const saved = saveCut(index, episodeId, {
      name: 'Draft 1',
      storyboardBoard: isPlainObject(fallbackBoard) ? fallbackBoard : { version: 1, cards: [] },
    })
    return {
      index: saved.index,
      board: saved.cut.storyboardBoard,
      cut: saved.cut,
      bucket: saved.bucket,
      created: true,
    }
  }
  const wanted = bucket.cuts.find((cut) => cut.id === bucket.currentId)
    || bucket.cuts.find((cut) => cut.id === bucket.primaryId)
    || bucket.cuts[0]
  const next = checkoutCut(index, episodeId, wanted.id)
  return {
    index: next.index,
    board: next.cut.storyboardBoard || { version: 1, cards: [] },
    cut: next.cut,
    bucket: next.bucket,
    created: false,
  }
}

export function snapshotLiveIntoCurrent(index, episodeId, storyboardBoard, extra = {}) {
  const bucket = getEpisodeCuts(index, episodeId)
  const current = bucket.cuts.find((cut) => cut.id === bucket.currentId)
  if (!current) return { index: normalizeCutsIndex(index), cut: null, skipped: true }
  return saveCut(index, episodeId, {
    id: current.id,
    name: current.name,
    author: current.author,
    notes: current.notes,
    timelineId: extra.timelineId !== undefined ? extra.timelineId : current.timelineId,
    storyboardBoard,
    makeCurrent: false,
  })
}

const DEFAULT_TRANSFORM = Object.freeze({
  positionX: 0,
  positionY: 0,
  scaleX: 100,
  scaleY: 100,
  scaleLinked: true,
  rotation: 0,
  anchorX: 50,
  anchorY: 50,
  opacity: 100,
  flipH: false,
  flipV: false,
  cropTop: 0,
  cropBottom: 0,
  cropLeft: 0,
  cropRight: 0,
  blendMode: 'normal',
  blur: 0,
})

export function reviewTimelineId(episodeId, cut) {
  return `timeline-cut-${slugifyCut(episodeId)}-${cut.slug || slugifyCut(cut.name)}`
}

export function buildReviewTimeline({ episodeId, cut, settings = {}, assets = [], pinTimelineId = '' } = {}) {
  if (!cut) throw new Error('buildReviewTimeline needs a cut')
  const fps = asNumber(settings.fps, 24) || 24
  const width = asNumber(settings.width, 1080) || 1080
  const height = asNumber(settings.height, 1920) || 1920
  const cards = Array.isArray(cut.storyboardBoard?.cards) ? cut.storyboardBoard.cards : []
  const assetById = new Map((assets || []).map((asset) => [asset.id, asset]))
  let cursor = 0
  const clips = []
  cards.forEach((card, index) => {
    const assetId = card.videoAssetId || card.imageAssetId
    if (!assetId) return
    const duration = asNumber(card.duration, 2) || 2
    const asset = assetById.get(assetId)
    const type = card.videoAssetId ? 'video' : 'image'
    const sourceDuration = asNumber(asset?.duration, duration) || duration
    clips.push({
      id: `cutclip-${cut.slug}-${index + 1}`,
      trackId: 'video-1',
      assetId,
      name: asString(card.title || card.description, `Shot ${index + 1}`),
      startTime: cursor,
      duration,
      sourceDuration,
      trimStart: 0,
      trimEnd: duration,
      sourceFps: fps,
      timelineFps: fps,
      sourceTimeScale: 1,
      speed: 1,
      reverse: false,
      color: type === 'video' ? '#3d7080' : '#5a5a5a',
      type,
      enabled: true,
      metadata: { cutId: cut.id, cardId: card.id, source: 'production-cut' },
      transform: { ...DEFAULT_TRANSFORM },
    })
    cursor += duration
  })
  const id = asString(pinTimelineId || cut.timelineId || reviewTimelineId(episodeId, cut))
  return {
    id,
    name: `${episodeId} · ${cut.name}`,
    created: cut.createdAt || nowIso(),
    modified: nowIso(),
    width,
    height,
    fps,
    duration: Math.max(cursor, 8),
    zoom: 100,
    tracks: [
      { id: 'video-1', name: 'Video 1', type: 'video', muted: false, locked: false, visible: true },
      { id: 'audio-1', name: 'Audio 1', type: 'audio', channels: 'stereo', muted: false, locked: false, visible: true },
    ],
    clips,
    transitions: [],
    clipCounter: clips.length + 1,
    transitionCounter: 1,
    snappingEnabled: true,
    snappingThreshold: 10,
    rippleEditMode: false,
    cutId: cut.id,
    episodeId,
    color: '#3d7080',
  }
}

export function upsertReviewTimeline(timelines, review) {
  const list = Array.isArray(timelines) ? [...timelines] : []
  const index = list.findIndex((item) => item.id === review.id)
  if (index >= 0) list[index] = { ...list[index], ...review, id: review.id }
  else list.push(review)
  return list
}

export function applyCutsToProduction(production, episodeId, bucket) {
  if (!production || !episodeId || !bucket) return production
  const current = { ...(production.current || {}), cutId: bucket.currentId || '' }
  return {
    ...production,
    current,
    updatedAt: nowIso(),
  }
}
