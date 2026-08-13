/**
 * Production packet — show / season / episode hierarchy on project.comfystudio.
 *
 * A Velorn project file is the live workspace for the CURRENT episode.
 * `production` is the durable index + bible so agents understand:
 *   show concept → season arc → this episode's storyboard / sequence
 *
 * Cast merge still lives in studioStore (series → season → episode).
 * This module owns type, bible, seasons, episodes, and episode switch.
 * Pure / Electron-free so it runs under `node --test`.
 */

import { normalizeSeason as normalizeSeasonId } from './studioStore.js'
import { emptyProjectLook, normalizeProjectLook } from './shotSettings.js'

export const PRODUCTION_VERSION = 1

export const PRODUCTION_TYPES = Object.freeze([
  'show',
  'film',
  'short',
  'commercial',
  'music-video',
  'standalone',
])

export const EPISODE_STATUSES = Object.freeze([
  'bible',
  'boarded',
  'shooting',
  'review',
  'locked',
  'delivered',
])

export const CONTEXT_LAYERS = Object.freeze([
  {
    id: 'show',
    title: 'Show',
    inherits: [],
    owns: 'series identity, world, tone, house look, standing cast, visual rules',
  },
  {
    id: 'season',
    title: 'Season',
    inherits: ['show'],
    owns: 'season arc, recurring locations, season-only cast or wardrobe overrides',
  },
  {
    id: 'episode',
    title: 'Episode',
    inherits: ['show', 'season'],
    owns: 'this episode plot, guests, locations, storyboard, sequence, sound, review',
  },
  {
    id: 'shot',
    title: 'Shot',
    inherits: ['show', 'season', 'episode'],
    owns: 'one card: framing/angle/lens, camera xyz handle, 1 location, 0–N characters, pose/motion, still + clip versions',
  },
])

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const asString = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback
  return String(value)
}
const asNumber = (value, fallback = null) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}
const nowIso = () => new Date().toISOString()
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

export function slugify(value, fallback = 'item') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallback
}

export function episodeCode(seasonNumber, episodeNumber) {
  const season = Math.max(1, Number(seasonNumber) || 1)
  const episode = Math.max(1, Number(episodeNumber) || 1)
  return `s${String(season).padStart(2, '0')}e${String(episode).padStart(3, '0')}`
}

export function parseEpisodeCode(value) {
  const raw = String(value || '').trim().toLowerCase()
  const match = raw.match(/^s(\d{1,2})e(\d{1,3})$/)
  if (!match) return null
  return { season: parseInt(match[1], 10), episode: parseInt(match[2], 10), id: episodeCode(match[1], match[2]) }
}

export function normalizeEpisodeId(value, seasonHint = 1) {
  const parsed = parseEpisodeCode(value)
  if (parsed) return parsed.id
  const raw = String(value || '').trim()
  if (!raw) return ''
  const ep = raw.match(/(?:ep|episode)[^\d]*(\d+)/i) || raw.match(/^(\d+)$/)
  if (ep) {
    const season = normalizeSeasonId(seasonHint)
    const seasonNumber = season ? parseInt(season.replace(/\D/g, ''), 10) : (Number(seasonHint) || 1)
    return episodeCode(seasonNumber, ep[1])
  }
  return slugify(raw, '')
}

function emptyShow() {
  return {
    concept: '',
    world: '',
    tone: '',
    audience: '',
    logline: '',
    visualRules: '',
    continuityRules: '',
    houseStyle: '',
  }
}

function emptyEpisode(partial = {}) {
  const seasonNumber = asNumber(partial.seasonNumber, 1) || 1
  const number = asNumber(partial.number, 1) || 1
  const id = normalizeEpisodeId(partial.id, seasonNumber) || episodeCode(seasonNumber, number)
  return {
    id,
    number,
    code: `S${String(seasonNumber).padStart(2, '0')}E${String(number).padStart(2, '0')}`,
    slug: asString(partial.slug, id),
    title: asString(partial.title, `Episode ${number}`),
    logline: asString(partial.logline),
    synopsis: asString(partial.synopsis),
    status: EPISODE_STATUSES.includes(partial.status) ? partial.status : 'bible',
    locations: Array.isArray(partial.locations) ? partial.locations.filter(Boolean).map(asString) : [],
    guestCast: Array.isArray(partial.guestCast) ? partial.guestCast.filter(Boolean).map(asString) : [],
    notes: asString(partial.notes),
    workspaceSavedAt: asString(partial.workspaceSavedAt),
    hasWorkspace: Boolean(partial.hasWorkspace || partial.workspace),
  }
}

function emptySeason(partial = {}) {
  const number = asNumber(partial.number, 1) || 1
  const id = normalizeSeasonId(partial.id || partial.number || number) || `season-${String(number).padStart(2, '0')}`
  const episodes = Array.isArray(partial.episodes)
    ? partial.episodes.filter(isPlainObject).map((ep) => emptyEpisode({ ...ep, seasonNumber: number }))
    : []
  return {
    id,
    number,
    title: asString(partial.title, `Season ${number}`),
    premise: asString(partial.premise),
    status: asString(partial.status, 'in-production'),
    episodes,
  }
}

export function emptyProduction() {
  return {
    schemaVersion: PRODUCTION_VERSION,
    type: 'standalone',
    slug: '',
    title: '',
    logline: '',
    premise: '',
    format: { aspect: '', durationHint: '', fps: null },
    look: emptyProjectLook(),
    show: emptyShow(),
    current: { seasonId: '', episodeId: '' },
    seasons: [],
    updatedAt: '',
  }
}

function normalizeShow(raw) {
  const src = isPlainObject(raw) ? raw : {}
  const bible = isPlainObject(src.bible) ? src.bible : {}
  return {
    concept: asString(src.concept || bible.seriesNotes || bible.concept),
    world: asString(src.world || bible.world),
    tone: asString(src.tone || bible.tone),
    audience: asString(src.audience || bible.audience),
    logline: asString(src.logline || bible.logline),
    visualRules: asString(src.visualRules || bible.visualRules),
    continuityRules: asString(src.continuityRules || bible.continuityRules),
    houseStyle: asString(src.houseStyle || bible.houseStyle),
  }
}

export function normalizeProduction(raw) {
  const blank = emptyProduction()
  if (!isPlainObject(raw)) return blank
  const type = PRODUCTION_TYPES.includes(raw.type) ? raw.type : blank.type
  const seasons = Array.isArray(raw.seasons)
    ? raw.seasons.filter(isPlainObject).map((season, index) => emptySeason({
      ...season,
      number: asNumber(season.number, index + 1) || index + 1,
    }))
    : []
  const currentSeasonId = asString(raw.current?.seasonId)
  const currentEpisodeId = normalizeEpisodeId(raw.current?.episodeId, currentSeasonId || 1)
  return {
    schemaVersion: PRODUCTION_VERSION,
    type,
    slug: slugify(raw.slug || raw.title, ''),
    title: asString(raw.title),
    logline: asString(raw.logline),
    premise: asString(raw.premise),
    format: {
      aspect: asString(raw.format?.aspect),
      durationHint: asString(raw.format?.durationHint || raw.format?.runtime),
      fps: asNumber(raw.format?.fps),
    },
    look: normalizeProjectLook(raw.look),
    show: normalizeShow(raw.show),
    current: {
      seasonId: currentSeasonId,
      episodeId: currentEpisodeId,
    },
    seasons,
    updatedAt: asString(raw.updatedAt),
  }
}

function inferType(project) {
  const hinted = asString(project?.cdxMigration?.type || project?.production?.type).toLowerCase()
  if (PRODUCTION_TYPES.includes(hinted)) return hinted
  if (project?.cdxMigration?.season || project?.cdxMigration?.episode) return 'show'
  if (project?.shortFilmDirector) return 'short'
  return 'standalone'
}

export function hydrateProductionFromProject(project) {
  const existing = normalizeProduction(project?.production)
  const migration = isPlainObject(project?.cdxMigration) ? project.cdxMigration : {}
  const director = isPlainObject(project?.shortFilmDirector) ? project.shortFilmDirector : {}
  const draft = isPlainObject(director.draft) ? director.draft : {}
  const settings = isPlainObject(project?.settings) ? project.settings : {}

  const type = existing.type !== 'standalone' || project?.production?.type
    ? existing.type
    : inferType(project)

  const title = existing.title || asString(migration.title || draft.title || project?.name)
  const slug = existing.slug || slugify(migration.slug || title, slugify(project?.name, 'project'))
  const premise = existing.premise || asString(draft.premise || migration.premise)
  const logline = existing.logline || asString(draft.logline || existing.show.logline)

  const look = Object.values(existing.look).some(Boolean)
    ? existing.look
    : normalizeProjectLook(settings.cinematography)

  const format = {
    aspect: existing.format.aspect || asString(draft.aspectRatio || (settings.width && settings.height ? `${settings.width}:${settings.height}` : '')),
    durationHint: existing.format.durationHint || asString(draft.runtimeSeconds ? `${draft.runtimeSeconds}s` : migration.runtime),
    fps: existing.format.fps || asNumber(draft.videoFps || settings.fps),
  }

  const show = {
    ...emptyShow(),
    ...existing.show,
    concept: existing.show.concept || premise,
    logline: existing.show.logline || logline,
    tone: existing.show.tone || asString(draft.creativeDirection),
    houseStyle: existing.show.houseStyle || asString(draft.creativeDirection),
  }

  let seasons = existing.seasons.map((season) => ({ ...season, episodes: season.episodes.map((ep) => ({ ...ep })) }))
  if (seasons.length === 0 && (type === 'show' || migration.season || migration.episode || director.shotPlan)) {
    const seasonNumber = asNumber(String(migration.season || '1').match(/\d+/)?.[0], 1) || 1
    const episodeNumber = asNumber(String(migration.episode || '1').match(/\d+/)?.[0], 1) || 1
    const episodeTitle = asString(draft.title && /ep\.?\s*0*1/i.test(draft.premise || draft.title) ? 'Accept the Rejection' : draft.title || `Episode ${episodeNumber}`)
    seasons = [emptySeason({
      number: seasonNumber,
      premise: asString(draft.creativeDirection),
      episodes: [emptyEpisode({
        seasonNumber,
        number: episodeNumber,
        title: episodeTitle,
        logline: premise,
        synopsis: asString(draft.screenplay).slice(0, 1200),
        status: Array.isArray(project?.storyboardBoard?.cards) && project.storyboardBoard.cards.length ? 'shooting' : 'bible',
        locations: (Array.isArray(director.locations) ? director.locations : []).map((item) => item.slug || item.name).filter(Boolean),
        notes: 'Hydrated from the live storyboard. Workspace is the current board, not a snapshot.',
      })],
    })]
  }

  const currentSeasonId = existing.current.seasonId || seasons[0]?.id || ''
  const currentEpisodeId = existing.current.episodeId || seasons[0]?.episodes[0]?.id || ''

  return {
    schemaVersion: PRODUCTION_VERSION,
    type,
    slug,
    title,
    logline,
    premise,
    format,
    look,
    show,
    current: { seasonId: currentSeasonId, episodeId: currentEpisodeId },
    seasons,
    updatedAt: existing.updatedAt || nowIso(),
  }
}

export function findSeason(production, seasonId) {
  const norm = normalizeProduction(production)
  const id = normalizeSeasonId(seasonId) || asString(seasonId)
  return norm.seasons.find((season) => season.id === id) || null
}

export function findEpisode(production, episodeId) {
  const norm = normalizeProduction(production)
  const wanted = normalizeEpisodeId(episodeId, norm.current.seasonId || 1)
  for (const season of norm.seasons) {
    const hit = season.episodes.find((episode) => episode.id === wanted || episode.slug === episodeId)
    if (hit) return { season, episode: hit }
  }
  return null
}

export function currentEpisode(production) {
  const norm = normalizeProduction(production)
  if (norm.current.episodeId) {
    const hit = findEpisode(norm, norm.current.episodeId)
    if (hit) return hit
  }
  const season = findSeason(norm, norm.current.seasonId) || norm.seasons[0]
  if (!season) return null
  return { season, episode: season.episodes[0] || null }
}

export function upsertSeason(production, fields = {}) {
  const norm = normalizeProduction(production)
  const idHint = normalizeSeasonId(fields.id || fields.season || fields.number)
  const existing = norm.seasons.findIndex((season) => season.id === idHint)
  const number = asNumber(
    fields.number,
    existing >= 0 ? norm.seasons[existing].number : (norm.seasons.at(-1)?.number || 0) + 1,
  ) || 1
  const id = idHint || normalizeSeasonId(number)
  const nextSeason = emptySeason({
    ...(existing >= 0 ? norm.seasons[existing] : {}),
    ...fields,
    id,
    number,
  })
  const seasons = [...norm.seasons]
  if (existing >= 0) seasons[existing] = { ...nextSeason, episodes: seasons[existing].episodes }
  else seasons.push(nextSeason)
  return { ...norm, seasons, updatedAt: nowIso() }
}

export function createEpisode(production, fields = {}) {
  const withSeason = fields.seasonId || fields.season
    ? upsertSeason(production, { id: fields.seasonId || fields.season, number: fields.seasonNumber })
    : normalizeProduction(production)
  let season = findSeason(withSeason, fields.seasonId || fields.season || withSeason.current.seasonId)
  if (!season) {
    const created = upsertSeason(withSeason, { number: 1 })
    season = created.seasons[0]
    return createEpisode(created, { ...fields, seasonId: season.id })
  }
  const nextNumber = asNumber(fields.number, (season.episodes.at(-1)?.number || 0) + 1) || 1
  const id = normalizeEpisodeId(fields.id, season.number) || episodeCode(season.number, nextNumber)
  if (season.episodes.some((episode) => episode.id === id)) {
    throw new Error(`Episode '${id}' already exists in ${season.id}`)
  }
  const episode = emptyEpisode({
    ...fields,
    id,
    number: nextNumber,
    seasonNumber: season.number,
    status: fields.status || 'bible',
  })
  const seasons = withSeason.seasons.map((item) => (
    item.id === season.id ? { ...item, episodes: [...item.episodes, episode] } : item
  ))
  const next = {
    ...withSeason,
    type: withSeason.type === 'standalone' ? 'show' : withSeason.type,
    seasons,
    updatedAt: nowIso(),
  }
  if (fields.makeCurrent !== false) {
    next.current = { seasonId: season.id, episodeId: episode.id }
  }
  return { production: next, episode, season: { ...season, episodes: [...season.episodes, episode] } }
}

export function updateEpisode(production, episodeId, fields = {}) {
  const norm = normalizeProduction(production)
  const hit = findEpisode(norm, episodeId)
  if (!hit) throw new Error(`Episode '${episodeId}' not found`)
  const nextEpisode = emptyEpisode({
    ...hit.episode,
    ...fields,
    id: hit.episode.id,
    number: asNumber(fields.number, hit.episode.number) || hit.episode.number,
    seasonNumber: hit.season.number,
  })
  const seasons = norm.seasons.map((season) => (
    season.id === hit.season.id
      ? { ...season, episodes: season.episodes.map((episode) => (episode.id === hit.episode.id ? nextEpisode : episode)) }
      : season
  ))
  return { ...norm, seasons, updatedAt: nowIso() }
}

export function setCurrentEpisode(production, episodeId) {
  const hit = findEpisode(production, episodeId)
  if (!hit) throw new Error(`Episode '${episodeId}' not found`)
  return {
    ...normalizeProduction(production),
    current: { seasonId: hit.season.id, episodeId: hit.episode.id },
    updatedAt: nowIso(),
  }
}

export function setProductionMeta(production, fields = {}) {
  const norm = normalizeProduction(production)
  const next = { ...norm, updatedAt: nowIso() }
  if (fields.type && PRODUCTION_TYPES.includes(fields.type)) next.type = fields.type
  if (fields.slug !== undefined) next.slug = slugify(fields.slug, next.slug)
  if (fields.title !== undefined) next.title = asString(fields.title)
  if (fields.logline !== undefined) next.logline = asString(fields.logline)
  if (fields.premise !== undefined) next.premise = asString(fields.premise)
  if (isPlainObject(fields.format)) {
    next.format = {
      aspect: asString(fields.format.aspect, next.format.aspect),
      durationHint: asString(fields.format.durationHint || fields.format.runtime, next.format.durationHint),
      fps: asNumber(fields.format.fps, next.format.fps),
    }
  }
  if (isPlainObject(fields.look)) next.look = normalizeProjectLook({ ...next.look, ...fields.look })
  if (isPlainObject(fields.show)) next.show = normalizeShow({ ...next.show, ...fields.show })
  return next
}

export function snapshotWorkspace(project) {
  return {
    storyboardBoard: clone(project?.storyboardBoard || { version: 1, cards: [] }),
    savedAt: nowIso(),
  }
}

export function markEpisodeWorkspace(production, episodeId, savedAt = nowIso()) {
  return updateEpisode(production, episodeId, { workspaceSavedAt: savedAt, hasWorkspace: true })
}

export function productionSummary(production) {
  const norm = normalizeProduction(production)
  const current = currentEpisode(norm)
  return {
    type: norm.type,
    slug: norm.slug,
    title: norm.title,
    logline: norm.logline,
    seasonCount: norm.seasons.length,
    episodeCount: norm.seasons.reduce((sum, season) => sum + season.episodes.length, 0),
    currentSeasonId: norm.current.seasonId,
    currentEpisodeId: norm.current.episodeId,
    currentEpisodeTitle: current?.episode?.title || '',
    currentEpisodeStatus: current?.episode?.status || '',
    layers: CONTEXT_LAYERS.map((layer) => layer.id),
  }
}

export function layeredContext(production) {
  const norm = normalizeProduction(production)
  const current = currentEpisode(norm)
  return {
    guide: CONTEXT_LAYERS,
    show: {
      type: norm.type,
      slug: norm.slug,
      title: norm.title,
      logline: norm.logline,
      premise: norm.premise,
      format: norm.format,
      look: norm.look,
      ...norm.show,
    },
    season: current?.season
      ? {
        id: current.season.id,
        number: current.season.number,
        title: current.season.title,
        premise: current.season.premise,
        status: current.season.status,
        episodeCount: current.season.episodes.length,
      }
      : null,
    episode: current?.episode || null,
  }
}

export function listEpisodes(production) {
  const norm = normalizeProduction(production)
  return norm.seasons.map((season) => ({
    id: season.id,
    number: season.number,
    title: season.title,
    premise: season.premise,
    status: season.status,
    episodes: season.episodes.map((episode) => ({
      ...episode,
      current: episode.id === norm.current.episodeId,
    })),
  }))
}
