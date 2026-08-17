/**
 * Compiled agent packet for a Velorn project.
 *
 * One object an MCP/CLI client can read to understand:
 *   show → season → episode → shot
 * plus every optional extension (lexicon, camera xyz, pose/motion,
 * location depth/blender, sound) whether or not the current shot uses it.
 */

import { shotClipStatus } from './extractMediaFrame.js'
import { cameraPromptHint, cameraSummary, normalizeCameraRig } from './cameraRig.js'
import { listCuts, normalizeCutsIndex } from './productionCuts.js'
import { PRODUCTION_FLOWS, listProductionTypes } from './productionTypes.js'
import {
  CONTEXT_LAYERS,
  hydrateProductionFromProject,
  layeredContext,
  listEpisodes,
  productionSummary,
} from './productionStore.js'
import { resolveCast, normalizeStudio } from './studioStore.js'
import { checkCastRefs } from './castLock.js'
import { generateResolution, listOutputTargets, resolveOutput } from './outputRatio.js'
import {
  assembleLexiconLabels,
  assembleLexiconLine,
  FEATURED_CAMERA_MOVEMENTS,
  PROJECT_LOOK_KEYS,
  SHOT_ONLY_KEYS,
  VIDEO_ACTION_KEYS,
  getCategory,
  modeFromWorkflow,
  normalizeProjectLook,
  resolveShotSettings,
  shotSettingConflicts,
} from './shotSettings.js'

const asString = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback
  return String(value)
}

function assetName(assets, id) {
  if (!id) return ''
  const hit = (assets || []).find((asset) => asset.id === id)
  return hit?.name || ''
}

function locationResources(entry = {}, assets = []) {
  const pick = (key, extraIds = []) => {
    const id = entry[key] || extraIds.find(Boolean) || ''
    return id ? { id, name: assetName(assets, id) || asString(entry[`${key}Name`]) } : null
  }
  return {
    id: asString(entry.id),
    slug: asString(entry.slug),
    name: asString(entry.name),
    description: asString(entry.description),
    plates: {
      hero: pick('heroAssetId'),
      wide: pick('wideAssetId'),
      reverse: pick('reverseAssetId'),
      detail: pick('detailAssetId'),
      birdsEye: pick('birdsEyeAssetId', [entry.topDownAssetId]),
    },
    reconstruction: {
      depthAssetId: entry.depthAssetId || '',
      blenderPath: asString(entry.blenderPath || entry.blend || entry.blockout),
      blockingPath: asString(entry.blockingPath || entry.blocking),
      topDownAssetId: entry.topDownAssetId || entry.birdsEyeAssetId || '',
    },
  }
}

function characterPacket(entry = {}, assets = [], scope = 'series') {
  const sheets = entry.ref_set || entry.sheets || {}
  return {
    id: asString(entry.id || entry.cast_id || entry.slug),
    slug: asString(entry.slug || entry.cast_id || entry.id),
    name: asString(entry.name || entry.display_name),
    role: asString(entry.role),
    scope,
    definedIn: asString(entry.defined_in || scope),
    visualNotes: asString(entry.visualNotes || entry.prompt_fragment || entry.outfit),
    never: asString(entry.never),
    outfit: asString(entry.outfit),
    voicePreset: asString(entry.voicePreset || entry.voice),
    referenceAssetId: entry.referenceAssetId || entry.assetId || '',
    referenceName: assetName(assets, entry.referenceAssetId || entry.assetId),
    sheets: {
      front: sheets.front || entry.face_ref || '',
      threeQuarter: sheets.three_quarter || sheets.threeQuarter || '',
      full: sheets.full || '',
      face: entry.face_ref || sheets.face || '',
      faceModel: entry.face_model || '',
    },
    poseSlug: asString(entry.poseSlug),
    motionSlug: asString(entry.motionSlug),
  }
}

function summarizeCard(card, { projectLook = {}, assets = [], project = null } = {}) {
  const mode = modeFromWorkflow(card.videoWorkflowId || card.workflowId || '', card.videoAssetId ? 'video' : 'still')
  const settings = resolveShotSettings(card.shotSettings, projectLook)
  const rig = normalizeCameraRig(card.cameraRig)
  const status = shotClipStatus(card)
  return {
    id: card.id,
    order: card.order,
    title: card.title || `Shot ${card.order}`,
    status: card.status || 'draft',
    clipStatus: status,
    action: asString(card.action),
    dialogue: asString(card.dialogue),
    soundNotes: asString(card.soundNotes),
    duration: Number(card.duration) || 5,
    location: card.locationRef ? { assetId: card.locationRef.assetId, name: card.locationRef.name } : null,
    characters: Array.isArray(card.characterRefs)
      ? card.characterRefs.map((item) => ({ assetId: item.assetId, name: item.name }))
      : [],
    motionSlug: asString(card.motionSlug),
    still: {
      assetId: card.imageAssetId || null,
      name: assetName(assets, card.imageAssetId),
      versions: Array.isArray(card.versions) ? card.versions.length : 0,
    },
    clip: {
      assetId: card.videoAssetId || null,
      name: assetName(assets, card.videoAssetId),
      lastFrameAssetId: card.lastFrameAssetId || null,
      versions: Array.isArray(card.videoVersions) ? card.videoVersions.length : 0,
    },
    audio: {
      voAssetId: card.audioAssetId || null,
      musicAssetId: card.musicAssetId || null,
    },
    settings,
    lexicon: assembleLexiconLabels(settings, mode, projectLook),
    lexiconLine: assembleLexiconLine(settings, mode, projectLook),
    conflicts: shotSettingConflicts(settings, mode, projectLook),
    camera: cameraSummary(rig),
    cameraHint: cameraPromptHint(rig),
    workflowId: card.workflowId || '',
    videoWorkflowId: card.videoWorkflowId || '',
    output: project ? resolveOutput(project, card) : null,
    generate: project ? generateResolution(project, card) : null,
  }
}

function sequenceRollup(cards = []) {
  const counts = { empty: 0, still: 0, review: 0, accepted: 0, generating: 0, rejected: 0 }
  for (const card of cards) {
    if (card.status === 'rejected') counts.rejected += 1
    const status = shotClipStatus(card)
    counts[status] = (counts[status] || 0) + 1
  }
  return {
    total: cards.length,
    haveClip: cards.filter((card) => card.videoAssetId).length,
    missingClip: cards.filter((card) => !card.videoAssetId).length,
    haveStill: cards.filter((card) => card.imageAssetId).length,
    pendingReview: cards.filter((card) => card.status === 'pending-review').length,
    accepted: counts.accepted,
    generating: counts.generating,
    counts,
  }
}

const LEXICON_CATEGORY_IDS = ['framing', 'camera_angle', 'lens', 'lighting', 'film_stock', 'camera_movement', 'mood']

export function listProductionCatalog() {
  const categories = {}
  for (const id of LEXICON_CATEGORY_IDS) {
    const category = getCategory(id)
    if (!category) continue
    categories[id] = {
      id,
      label: category.label,
      exclusive: category.exclusive !== false,
      options: (category.options || []).map((option) => ({
        id: option.id,
        label: option.label,
        tagline: option.tagline || '',
        appliesTo: option.appliesTo || [],
        featured: id === 'camera_movement' && FEATURED_CAMERA_MOVEMENTS.includes(option.id),
      })),
    }
  }
  return {
    lexicon: {
      version: 2,
      assemblyOrder: LEXICON_CATEGORY_IDS,
      exclusiveGroups: LEXICON_CATEGORY_IDS,
      overlapGroups: [
        ['framing', 'camera_angle', 'lens'],
        ['lighting', 'film_stock', 'mood'],
        ['framing', 'camera_movement'],
      ],
      categories,
    },
    inherit: {
      projectLook: PROJECT_LOOK_KEYS,
      shotOnly: SHOT_ONLY_KEYS,
      videoOnly: VIDEO_ACTION_KEYS,
    },
    motions: {
      libraryPath: '/home/codex450/creative/_library/motions/catalog.json',
      assignOn: 'card.motionSlug',
      files: ['pose.png', 'preview.mp4', 'skeleton.mp4', 'depth.mp4'],
    },
    outputTargets: listOutputTargets(),
    types: listProductionTypes(),
    aliases: {
      advertisement: 'commercial',
      ad: 'commercial',
      film: 'movie',
      standalone: 'narrative',
      short: 'ig-short',
    },
    flows: PRODUCTION_FLOWS,
    extensions: [
      { id: 'output-ratio', required: true, when: 'every generate and edit', use: 'mobile 9:16 vs computer 16:9 (project default, shot can override)' },
      { id: 'lexicon', required: false, when: 'any still or clip', use: 'framing / angle / lens / light / grade / move ids' },
      { id: 'camera-rig', required: false, when: 'reblocking, proposing an angle, Blender env', use: 'xyz + yaw/pitch/roll/fov handle; propose/apply' },
      { id: 'pose-motion', required: false, when: 'character action must match a rig', use: 'motionSlug + pose still + skeleton/depth movies' },
      { id: 'location-depth', required: false, when: 'plate → depth → Blender env → top-down', use: 'location reconstruction fields' },
      { id: 'flf-last-frame', required: false, when: 'first/last or extend continuity', use: 'lastFrameAssetId + videoWorkflowId' },
      { id: 'sound', required: false, when: 'VO / lipsync / music bed', use: 'dialogue, soundNotes, audioAssetId, musicAssetId' },
      { id: 'multi-angles', required: false, when: 'need 8 coverage angles from one still', use: 'workflow multi-angles / multi-angles-scene' },
    ],
    layers: CONTEXT_LAYERS,
  }
}

export function buildShotPacket(project, cardId, { assets = [] } = {}) {
  const production = hydrateProductionFromProject(project)
  const look = normalizeProjectLook(project?.settings?.cinematography || production.look)
  const cards = project?.storyboardBoard?.cards || []
  const card = cards.find((item) => item.id === cardId) || null
  if (!card) return null
  return {
    production: productionSummary(production),
    layers: layeredContext(production),
    shot: summarizeCard(card, { projectLook: look, assets, project }),
    cameraRig: normalizeCameraRig(card.cameraRig),
    neighbors: {
      prev: cards.find((item) => item.order === card.order - 1)?.id || null,
      next: cards.find((item) => item.order === card.order + 1)?.id || null,
    },
  }
}

export function buildProductionPacket(project, { assets = [] } = {}) {
  const production = hydrateProductionFromProject(project)
  const studio = normalizeStudio(project?.studio)
  const look = normalizeProjectLook(project?.settings?.cinematography || production.look)
  const current = layeredContext(production)
  const cards = Array.isArray(project?.storyboardBoard?.cards) ? [...project.storyboardBoard.cards] : []
  cards.sort((a, b) => (a.order || 0) - (b.order || 0))

  const director = project?.shortFilmDirector || {}
  const directorCast = Array.isArray(director.characters) ? director.characters : []
  const resolved = resolveCast(studio, {
    season: production.current.seasonId,
    episode: production.current.episodeId,
  })

  const characters = directorCast.length
    ? directorCast.map((entry) => characterPacket(entry, assets, 'series'))
    : resolved.map((entry) => characterPacket({ ...entry.fields, ...entry }, assets, entry.scope))

  const locations = (Array.isArray(director.locations) ? director.locations : Object.values(studio.locations || {}))
    .map((entry) => locationResources(entry, assets))

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    howToRead: [
      'Start at layers.show. That is the series bible and house look.',
      'layers.season is the arc for the current season only.',
      'layers.episode is the live workspace (storyboard + sequence) in this project file.',
      'cuts[] are named drafts of this episode. save_cut / checkout_cut / watch_cut / promote_cut. Primary is the official version; checkout is what is on the live board.',
      'Each shot inherits show look unless it overrides. Framing/angle never inherit.',
      'camera.x_m/y_m/z_m is the handle. Propose with propose_shot_camera; Blake can apply or drag.',
      'extensions listed in catalog are optional. Use them when the shot needs them, do not dump them into every prompt.',
    ],
    production: productionSummary(production),
    layers: current,
    seasons: listEpisodes(production),
    cuts: listCuts(normalizeCutsIndex(project?.productionCuts), production.current.episodeId),
    output: resolveOutput(project),
    generate: generateResolution(project),
    look,
    characters,
    locations,
    castLock: checkCastRefs(studio, {
      season: production.current.seasonId,
      episode: production.current.episodeId,
    }),
    storyboard: {
      cardCount: cards.length,
      cards: cards.map((card) => summarizeCard(card, { projectLook: look, assets, project })),
    },
    sequence: sequenceRollup(cards),
    catalog: listProductionCatalog(),
    source: {
      cdxSlug: project?.cdxMigration?.slug || production.slug,
      hasDirector: Boolean(director.draft || director.characters),
      studioCastTiers: {
        series: Object.keys(studio.cast.series || {}).length,
        seasons: Object.keys(studio.cast.seasons || {}).length,
        episodes: Object.keys(studio.cast.episodes || {}).length,
      },
    },
  }
}
