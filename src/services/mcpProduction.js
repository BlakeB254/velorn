/**
 * Renderer-side MCP / CLI actions for the production packet, studio block,
 * shot settings, and camera xyz handle.
 */
import useProjectStore from '../stores/projectStore'
import useAssetsStore from '../stores/assetsStore'
import {
  applyCameraPatch,
  applyCameraProposal,
  fromBlockingDoc,
  normalizeCameraRig,
  presetFromLexicon,
  proposeCameraRig,
  rejectCameraProposal,
} from './cameraRig.js'
import {
  buildProductionPacket,
  buildShotPacket,
  listProductionCatalog,
} from './productionPacket.js'
import {
  createEpisode,
  findEpisode,
  hydrateProductionFromProject,
  listEpisodes,
  markEpisodeWorkspace,
  setCurrentEpisode,
  setProductionMeta,
  snapshotWorkspace,
  updateEpisode,
} from './productionStore.js'
import {
  addSlot,
  assignFrame,
  flowView,
  normalizeStudio,
  qaSummary,
  recordVerdict,
  resolveCast,
  updateSlot,
  removeSlot,
} from './studioStore.js'
import { normalizeProjectLook, normalizeShotSettings } from './shotSettings.js'

function requireProject() {
  const project = useProjectStore.getState().currentProject
  if (!project) throw new Error('No Velorn project is open.')
  return project
}

function assets() {
  const state = useAssetsStore.getState()
  return typeof state.getProjectData === 'function' ? state.getProjectData() : (state.assets || [])
}

function persistProduction(production, extra = {}) {
  const store = useProjectStore.getState()
  store.setProduction?.(production)
  if (extra.storyboardBoard) store.setStoryboardBoard(extra.storyboardBoard)
  if (extra.settings) {
    store.saveProject?.({ settings: { ...store.currentProject.settings, ...extra.settings } })
  }
  return production
}

function persistStudio(studio) {
  return useProjectStore.getState().setStudio(studio)
}

function findCard(project, cardId) {
  const cards = project.storyboardBoard?.cards || []
  const card = cards.find((item) => item.id === cardId || String(item.order) === String(cardId))
  if (!card) throw new Error(`Shot '${cardId}' not found on the current storyboard.`)
  return card
}

function replaceCard(project, cardId, mutator) {
  const cards = [...(project.storyboardBoard?.cards || [])]
  const index = cards.findIndex((item) => item.id === cardId || String(item.order) === String(cardId))
  if (index < 0) throw new Error(`Shot '${cardId}' not found on the current storyboard.`)
  const next = mutator(cards[index])
  cards[index] = next
  useProjectStore.getState().setStoryboardBoard({ version: 1, cards })
  return next
}

export function handleGetProductionContext(payload = {}) {
  const project = requireProject()
  const packet = buildProductionPacket(project, { assets: assets() })
  if (payload.cardId) {
    packet.focusedShot = buildShotPacket(project, payload.cardId, { assets: assets() })
  }
  return { action: 'get_production_context', ...packet }
}

export function handleListProductionCatalog() {
  return { action: 'list_production_catalog', ...listProductionCatalog() }
}

export function handleGetShotPacket(payload = {}) {
  const project = requireProject()
  const cardId = String(payload.cardId || payload.shotId || payload.id || '').trim()
  if (!cardId) throw new Error('get_shot_packet needs cardId')
  const shot = buildShotPacket(project, cardId, { assets: assets() })
  if (!shot) throw new Error(`Shot '${cardId}' not found`)
  return { action: 'get_shot_packet', ...shot }
}

export function handleListEpisodes() {
  const project = requireProject()
  const production = hydrateProductionFromProject(project)
  return { action: 'list_episodes', seasons: listEpisodes(production), current: production.current }
}

export function handleSetProduction(payload = {}) {
  const project = requireProject()
  const current = hydrateProductionFromProject(project)
  if (payload.previewOnly !== false) {
    return {
      previewOnly: true,
      action: 'set_production',
      current: current,
      next: setProductionMeta(current, payload),
    }
  }
  const next = setProductionMeta(current, payload)
  persistProduction(next)
  if (payload.look) {
    const store = useProjectStore.getState()
    const settings = { ...(store.currentProject.settings || {}), cinematography: normalizeProjectLook({
      ...(store.currentProject.settings?.cinematography || {}),
      ...payload.look,
    }) }
    store.saveProject?.({ settings })
  }
  return { success: true, action: 'set_production', production: next }
}

export function handleCreateEpisode(payload = {}) {
  const project = requireProject()
  const current = hydrateProductionFromProject(project)
  if (payload.previewOnly !== false) {
    const preview = createEpisode(current, payload)
    return { previewOnly: true, action: 'create_episode', episode: preview.episode, production: preview.production }
  }
  const outgoingId = current.current.episodeId
  let production = current
  const store = useProjectStore.getState()
  const workspaces = { ...(store.currentProject.productionWorkspaces || {}) }
  if (outgoingId && payload.snapshotCurrent !== false) {
    workspaces[outgoingId] = snapshotWorkspace(project)
    production = markEpisodeWorkspace(production, outgoingId, workspaces[outgoingId].savedAt)
  }
  const created = createEpisode(production, payload)
  const incoming = payload.cloneBoard
    ? snapshotWorkspace(project).storyboardBoard
    : { version: 1, cards: [] }
  persistProduction(created.production, { storyboardBoard: incoming })
  store.saveProject?.({ production: created.production, productionWorkspaces: workspaces, storyboardBoard: incoming })
  return {
    success: true,
    action: 'create_episode',
    episode: created.episode,
    production: created.production,
    clonedBoard: Boolean(payload.cloneBoard),
  }
}

export function handleSwitchEpisode(payload = {}) {
  const project = requireProject()
  const episodeId = String(payload.episodeId || payload.id || '').trim()
  if (!episodeId) throw new Error('switch_episode needs episodeId')
  const current = hydrateProductionFromProject(project)
  if (!findEpisode(current, episodeId)) throw new Error(`Episode '${episodeId}' not found`)
  if (payload.previewOnly !== false) {
    return { previewOnly: true, action: 'switch_episode', from: current.current.episodeId, to: episodeId }
  }
  const store = useProjectStore.getState()
  const workspaces = { ...(store.currentProject.productionWorkspaces || {}) }
  if (current.current.episodeId) {
    workspaces[current.current.episodeId] = snapshotWorkspace(project)
  }
  const incoming = workspaces[findEpisode(current, episodeId).episode.id]?.storyboardBoard || { version: 1, cards: [] }
  const production = setCurrentEpisode(markEpisodeWorkspace(current, current.current.episodeId), episodeId)
  store.saveProject?.({
    production,
    productionWorkspaces: workspaces,
    storyboardBoard: incoming,
  })
  store.setStoryboardBoard?.(incoming)
  store.setProduction?.(production)
  return { success: true, action: 'switch_episode', production, cardCount: incoming.cards?.length || 0 }
}

export function handleUpdateEpisode(payload = {}) {
  const project = requireProject()
  const episodeId = String(payload.episodeId || payload.id || project.production?.current?.episodeId || '').trim()
  if (!episodeId) throw new Error('update_episode needs episodeId')
  const current = hydrateProductionFromProject(project)
  if (payload.previewOnly !== false) {
    return { previewOnly: true, action: 'update_episode', next: updateEpisode(current, episodeId, payload) }
  }
  const next = updateEpisode(current, episodeId, payload)
  persistProduction(next)
  return { success: true, action: 'update_episode', production: next }
}

export function handleUpdateShot(payload = {}) {
  const project = requireProject()
  const cardId = String(payload.cardId || payload.shotId || payload.id || '').trim()
  if (!cardId) throw new Error('update_shot needs cardId')
  if (payload.previewOnly !== false) {
    return { previewOnly: true, action: 'update_shot', card: findCard(project, cardId), patch: payload }
  }
  const next = replaceCard(project, cardId, (card) => {
    const patch = { ...card }
    for (const key of ['title', 'description', 'prompt', 'action', 'dialogue', 'soundNotes', 'motionSlug', 'status']) {
      if (payload[key] !== undefined) patch[key] = payload[key]
    }
    if (payload.duration !== undefined) patch.duration = Number(payload.duration) || card.duration
    if (payload.shotSettings) patch.shotSettings = normalizeShotSettings({ ...card.shotSettings, ...payload.shotSettings })
    if (payload.locationRef) patch.locationRef = payload.locationRef
    if (payload.clearLocation) {
      patch.locationRef = null
      patch.sceneRefs = []
    }
    if (Array.isArray(payload.characterRefs)) patch.characterRefs = payload.characterRefs
    if (payload.camera) patch.cameraRig = applyCameraPatch(card.cameraRig, payload.camera)
    if (payload.lexiconPreset) {
      patch.cameraRig = presetFromLexicon({ ...normalizeShotSettings(patch.shotSettings), ...payload.shotSettings })
    }
    return patch
  })
  return { success: true, action: 'update_shot', card: next }
}

export function handleProposeShotCamera(payload = {}) {
  const project = requireProject()
  const cardId = String(payload.cardId || payload.shotId || '').trim()
  if (!cardId) throw new Error('propose_shot_camera needs cardId')
  if (payload.previewOnly !== false) {
    return { previewOnly: true, action: 'propose_shot_camera', cardId, camera: payload.camera, note: payload.note }
  }
  const next = replaceCard(project, cardId, (card) => ({
    ...card,
    cameraRig: proposeCameraRig(card.cameraRig, {
      camera: payload.camera,
      characters: payload.characters,
      note: payload.note,
      by: payload.by || 'agent',
    }),
  }))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('comfystudio-focus-storyboard-card', { detail: { cardId: next.id } }))
    window.dispatchEvent(new CustomEvent('comfystudio-focus-camera-rig', { detail: { cardId: next.id, proposal: next.cameraRig.proposal } }))
  }
  return { success: true, action: 'propose_shot_camera', cardId: next.id, cameraRig: next.cameraRig }
}

export function handleApplyShotCameraProposal(payload = {}) {
  const project = requireProject()
  const cardId = String(payload.cardId || payload.shotId || '').trim()
  if (!cardId) throw new Error('apply_shot_camera_proposal needs cardId')
  if (payload.previewOnly !== false) {
    const card = findCard(project, cardId)
    return { previewOnly: true, action: 'apply_shot_camera_proposal', proposal: normalizeCameraRig(card.cameraRig).proposal }
  }
  const next = replaceCard(project, cardId, (card) => ({
    ...card,
    cameraRig: payload.reject ? rejectCameraProposal(card.cameraRig) : applyCameraProposal(card.cameraRig),
  }))
  return { success: true, action: 'apply_shot_camera_proposal', cameraRig: next.cameraRig, rejected: Boolean(payload.reject) }
}

export function handleImportShotBlocking(payload = {}) {
  const project = requireProject()
  const cardId = String(payload.cardId || payload.shotId || '').trim()
  if (!cardId) throw new Error('import_shot_blocking needs cardId')
  const doc = payload.blocking || payload.doc
  if (!doc) throw new Error('import_shot_blocking needs a blocking.json object')
  if (payload.previewOnly !== false) {
    return { previewOnly: true, action: 'import_shot_blocking', cameraRig: fromBlockingDoc(doc) }
  }
  const next = replaceCard(project, cardId, (card) => ({ ...card, cameraRig: fromBlockingDoc(doc) }))
  return { success: true, action: 'import_shot_blocking', cameraRig: next.cameraRig }
}

export function handleStudioCastResolve(payload = {}) {
  const project = requireProject()
  const studio = normalizeStudio(project.studio)
  const production = hydrateProductionFromProject(project)
  const members = resolveCast(studio, {
    season: payload.season || production.current.seasonId,
    episode: payload.episode || production.current.episodeId,
  })
  return { action: 'studio_cast_resolve', season: payload.season || production.current.seasonId, episode: payload.episode || production.current.episodeId, members }
}

export function handleStudioSlotsList() {
  const project = requireProject()
  const studio = normalizeStudio(project.studio)
  return { action: 'studio_slots_list', slots: studio.slots, qa: qaSummary(studio) }
}

export function handleStudioSlotsMutate(payload = {}) {
  const project = requireProject()
  const op = String(payload.op || payload.action || '').trim()
  if (payload.previewOnly !== false) {
    return { previewOnly: true, action: 'studio_slots_mutate', op, payload }
  }
  let studio = normalizeStudio(project.studio)
  if (op === 'add') studio = addSlot(studio, payload.slot || payload)
  else if (op === 'update') studio = updateSlot(studio, payload.slot_id || payload.slotId, payload.fields || payload)
  else if (op === 'remove' || op === 'delete') {
    if (payload.confirm !== true) throw new Error('Deleting a slot requires confirm=true. Frames stay in the media pool.')
    studio = removeSlot(studio, payload.slot_id || payload.slotId)
  }
  else if (op === 'assign') studio = assignFrame(studio, payload.slot_id || payload.slotId, payload.which, payload.assetId)
  else throw new Error("studio_slots_mutate op must be add, update, remove, or assign")
  persistStudio(studio)
  return { success: true, action: 'studio_slots_mutate', op, studio }
}

export function handleStudioQaRecord(payload = {}) {
  const project = requireProject()
  if (payload.previewOnly !== false) {
    return { previewOnly: true, action: 'studio_qa_record', shot: payload.shot, video: payload.video, audio: payload.audio }
  }
  const studio = recordVerdict(project.studio, payload.shot, payload)
  persistStudio(studio)
  return { success: true, action: 'studio_qa_record', qa: qaSummary(studio) }
}

export function handleStudioFlow(payload = {}) {
  const project = requireProject()
  const cards = project.storyboardBoard?.cards || []
  const extras = {
    sceneCount: payload.sceneCount,
    videoCount: payload.videoCount ?? cards.filter((card) => card.videoAssetId).length,
    editClips: payload.editClips,
    deliverables: payload.deliverables,
  }
  return {
    action: 'studio_flow',
    flow: flowView(project.studio, extras),
    production: hydrateProductionFromProject(project),
  }
}

export function handleProductionAction(action, payload = {}) {
  switch (action) {
    case 'get_production_context':
      return handleGetProductionContext(payload)
    case 'list_production_catalog':
      return handleListProductionCatalog()
    case 'get_shot_packet':
      return handleGetShotPacket(payload)
    case 'list_episodes':
      return handleListEpisodes()
    case 'set_production':
      return handleSetProduction(payload)
    case 'create_episode':
      return handleCreateEpisode(payload)
    case 'switch_episode':
      return handleSwitchEpisode(payload)
    case 'update_episode':
      return handleUpdateEpisode(payload)
    case 'update_shot':
      return handleUpdateShot(payload)
    case 'propose_shot_camera':
      return handleProposeShotCamera(payload)
    case 'apply_shot_camera_proposal':
      return handleApplyShotCameraProposal(payload)
    case 'import_shot_blocking':
      return handleImportShotBlocking(payload)
    case 'studio_cast_resolve':
      return handleStudioCastResolve(payload)
    case 'studio_slots_list':
      return handleStudioSlotsList()
    case 'studio_slots_mutate':
      return handleStudioSlotsMutate(payload)
    case 'studio_qa_record':
      return handleStudioQaRecord(payload)
    case 'studio_flow':
      return handleStudioFlow(payload)
    default:
      throw new Error(`Unknown production action: ${action}`)
  }
}
