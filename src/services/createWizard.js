/**
 * CreateProjectWizard — pure draft/validation/scaffold logic.
 *
 * The wizard collects a draft per production type, then `scaffoldFromWizard`
 * turns it into the production block + empty reference cards + a `creation`
 * record that the project file carries. File imports picked in the wizard are
 * returned as `pendingImports` for the UI to execute post-create (best-effort).
 *
 * Type step flows (docs/ux-guided-mobile-plan.md P1):
 *   movie/narrative/animated/documentary/parody: script → cast → locations → props
 *   show:   bible → seasons(+episodes) → cast → locations
 *   commercial/psa/ig-short/…: subject (CDX org or manual) → concept → faces
 *   music-video: song → artists → scenes
 */

import {
  bootstrapProduction,
  createEpisode,
  emptyProduction,
  setCurrentEpisode,
  setProductionMeta,
  slugify,
  upsertSeason,
} from './productionStore.js'
import { newCharacterCard, newLocationCard, newPropCard } from './referenceCards.js'

export const SCRIPT_TYPES = Object.freeze([
  'movie', 'narrative', 'animated', 'animated-short', 'documentary', 'parody', 'skit',
])
export const AD_TYPES = Object.freeze([
  'commercial', 'psa', 'ig-short', 'hype-video', 'site-update', 'website-tour',
])
export const MUSIC_VIDEO_TYPES = Object.freeze(['music-video'])
export const SHOW_TYPES = Object.freeze(['show'])

export const COMMON_STEPS = Object.freeze(['type', 'details'])
export const FINAL_STEP = 'review'

const TYPE_STEPS = Object.freeze({
  script: ['script', 'cast', 'locations', 'props'],
  show: ['bible', 'seasons', 'cast', 'locations'],
  ad: ['subject', 'concept', 'faces'],
  musicVideo: ['song', 'artists', 'scenes'],
})

export function wizardGroupForType(typeId) {
  if (SHOW_TYPES.includes(typeId)) return 'show'
  if (AD_TYPES.includes(typeId)) return 'ad'
  if (MUSIC_VIDEO_TYPES.includes(typeId)) return 'musicVideo'
  return 'script'
}

export function wizardStepsForType(typeId) {
  return [...COMMON_STEPS, ...TYPE_STEPS[wizardGroupForType(typeId)], FINAL_STEP]
}

const INVALID_NAME_CHARS = /[<>:"/\\|?*]/

function cleanName(value) {
  return String(value || '').trim()
}

function cleanList(list) {
  return (Array.isArray(list) ? list : [])
    .map((entry) => (typeof entry === 'string' ? cleanName(entry) : cleanName(entry?.name)))
    .filter(Boolean)
}

function dedupeById(items) {
  const seen = new Set()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

export function newWizardDraft(typeId = 'show') {
  return {
    type: typeId,
    name: '',
    logline: '',
    // script group
    script: '',
    cast: [], // [{ id, name, imagePath? }]
    locations: [], // [name]
    props: [], // [name]
    // show group
    bible: { concept: '', world: '', tone: '', logline: '' },
    seasons: [], // [{ title, episodes: [{ title, script }] }]
    // ad group
    subject: { mode: 'none', orgId: '', orgName: '', offerings: [] }, // offerings: [{ id, name }]
    concept: { mode: 'none', text: '', prompt: '', filePath: '', fileName: '' },
    faces: [], // [{ id, name, imagePath?, imageUrl? }]
    // music-video group
    song: { filePath: '', fileName: '' },
    artists: [], // [{ id, name, imagePath? }]
    scenes: [], // [name]
  }
}

export function validateDraft(draft) {
  const errors = []
  const name = cleanName(draft?.name)
  if (!name) errors.push('Project name is required')
  if (INVALID_NAME_CHARS.test(name)) errors.push('Project name cannot contain < > : " / \\ | ? *')
  return { ok: errors.length === 0, errors }
}

function personEntries(list, fallbackPrefix) {
  return dedupeById(
    (Array.isArray(list) ? list : [])
      .map((entry) => {
        const name = cleanName(typeof entry === 'string' ? entry : entry?.name)
        if (!name) return null
        return {
          id: cleanName(entry?.id) || `${fallbackPrefix}-${slugify(name)}`,
          name,
          imagePath: cleanName(entry?.imagePath),
          // CDX-picked people may carry a remote reference image (KB face picker).
          imageUrl: cleanName(entry?.imageUrl),
        }
      })
      .filter(Boolean),
  )
}

function buildShowProduction(draft) {
  const seasons = (Array.isArray(draft.seasons) ? draft.seasons : [])
    .map((season) => ({
      title: cleanName(season?.title),
      episodes: (Array.isArray(season?.episodes) ? season.episodes : [])
        .map((episode) => ({
          title: cleanName(episode?.title),
          script: String(episode?.script || ''),
        }))
        .filter((episode) => episode.title),
    }))
    .filter((season) => season.episodes.length > 0)
  if (seasons.length === 0) return null

  let production = setProductionMeta(emptyProduction(), {
    type: 'show',
    title: cleanName(draft.name),
    slug: draft.name,
    logline: cleanName(draft.logline),
    premise: cleanName(draft.bible?.concept),
    show: {
      concept: String(draft.bible?.concept || ''),
      world: String(draft.bible?.world || ''),
      tone: String(draft.bible?.tone || ''),
      logline: String(draft.bible?.logline || draft.logline || ''),
    },
  })

  const seasonIds = seasons.map((_, index) => {
    production = upsertSeason(production, { number: index + 1 })
    return production.seasons.at(-1).id
  })

  let firstEpisodeId = ''
  seasons.forEach((season, seasonIndex) => {
    season.episodes.forEach((episode, episodeIndex) => {
      const created = createEpisode(production, {
        seasonId: seasonIds[seasonIndex],
        number: episodeIndex + 1,
        title: episode.title,
        synopsis: episode.script.slice(0, 1200),
        makeCurrent: false,
      })
      production = created.production
      if (!firstEpisodeId) firstEpisodeId = created.episode.id
    })
  })
  if (firstEpisodeId) production = setCurrentEpisode(production, firstEpisodeId)
  return production
}

/**
 * Build the scaffold for projectStore.createProject's `scaffold` param.
 * Returns { production, references, creation, pendingImports }.
 */
export function scaffoldFromWizard(draft, { now } = {}) {
  const group = wizardGroupForType(draft.type)
  const name = cleanName(draft.name)

  // --- production block ---
  let production = null
  if (group === 'show') production = buildShowProduction(draft)
  if (!production) {
    production = bootstrapProduction({ name, type: draft.type })
    if (group === 'script' && cleanName(draft.script)) {
      // Park the pasted script on the main episode so it travels with the production.
      const episodeId = production.current.episodeId
      production = {
        ...production,
        seasons: production.seasons.map((season) => ({
          ...season,
          episodes: season.episodes.map((episode) => (
            episode.id === episodeId
              ? { ...episode, synopsis: String(draft.script).slice(0, 1200) }
              : episode
          )),
        })),
      }
    }
  }

  // --- reference cards ---
  const peopleSource = group === 'musicVideo' ? draft.artists : group === 'ad' ? [...draft.cast, ...draft.faces] : draft.cast
  const peoplePrefix = group === 'ad' ? 'face' : 'cast'
  const castPeople = personEntries(peopleSource, peoplePrefix)
  const characters = castPeople.map((person) => newCharacterCard({ id: person.id, name: person.name }))
  const locationNames = dedupeById(
    cleanList([...(draft.locations || []), ...(group === 'musicVideo' ? draft.scenes || [] : [])])
      .map((locationName) => ({ id: locationName })),
  )
  const locations = locationNames.map((entry) => (
    newLocationCard({ id: `loc-${entry.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name: entry.id })
  ))
  const props = cleanList(draft.props).map((propName, index) => (
    newPropCard({ id: `prop-${index + 1}`, name: propName })
  ))

  // --- creation record ---
  const creation = {
    wizard: true,
    type: draft.type,
    group,
    createdAt: now || null,
    script: group === 'script' ? String(draft.script || '') : '',
    next: group === 'musicVideo'
      ? { flow: 'music-video-easy-mode' }
      : group === 'ad'
        ? { flow: 'ad-easy-mode' }
        : { flow: 'reference-cards' },
  }
  if (group === 'ad') {
    creation.ad = {
      subject: {
        mode: draft.subject?.mode === 'cdx' || draft.subject?.mode === 'manual' ? draft.subject.mode : 'none',
        orgId: cleanName(draft.subject?.orgId),
        orgName: cleanName(draft.subject?.orgName),
        offerings: (Array.isArray(draft.subject?.offerings) ? draft.subject.offerings : [])
          .map((offering) => ({ id: cleanName(offering?.id), name: cleanName(offering?.name) }))
          .filter((offering) => offering.id || offering.name),
      },
      concept: {
        mode: ['paste', 'file', 'prompt'].includes(draft.concept?.mode) ? draft.concept.mode : 'none',
        text: String(draft.concept?.text || ''),
        prompt: String(draft.concept?.prompt || ''),
        fileName: cleanName(draft.concept?.fileName),
      },
      faceCardIds: personEntries(draft.faces, 'face').map((face) => (
        // Faces with no explicit id land in `characters` under the same face-<slug> id.
        castPeople.find((person) => person.name === face.name)?.id || face.id
      )),
    }
  }
  if (group === 'musicVideo') {
    creation.musicVideo = {
      songFileName: cleanName(draft.song?.fileName),
      artistCardIds: castPeople.map((artist) => artist.id),
      scenes: cleanList(draft.scenes),
    }
  }

  // --- pending file imports for the UI to execute post-create ---
  const pendingImports = []
  if (group === 'musicVideo' && cleanName(draft.song?.filePath)) {
    pendingImports.push({
      role: 'song',
      path: draft.song.filePath,
      name: cleanName(draft.song.fileName) || 'song',
    })
  }
  if (group === 'ad' && draft.concept?.mode === 'file' && cleanName(draft.concept?.filePath)) {
    pendingImports.push({
      role: 'concept-file',
      path: draft.concept.filePath,
      name: cleanName(draft.concept.fileName) || 'concept',
    })
  }
  castPeople.forEach((person) => {
    if (person.imagePath) {
      pendingImports.push({
        role: group === 'musicVideo' ? 'artist-image' : group === 'ad' ? 'face-image' : 'cast-image',
        path: person.imagePath,
        name: person.name,
        cardId: person.id,
        slotId: 'close_up_face',
      })
      return
    }
    if (group === 'ad' && person.imageUrl) {
      // KB face picked with a remote image — the UI fetches it post-create.
      pendingImports.push({
        role: 'face-image-url',
        url: person.imageUrl,
        name: person.name,
        cardId: person.id,
        slotId: 'close_up_face',
      })
    }
  })

  return {
    production,
    references: { characters, locations, props },
    creation,
    pendingImports,
  }
}
