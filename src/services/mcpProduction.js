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
import { discoverProduction, getProductionType } from './productionTypes.js'
import {
  applyCutsToProduction,
  buildReviewTimeline,
  checkoutCut,
  findCut,
  listCuts,
  loadEpisodeBoard,
  normalizeCutsIndex,
  promoteCut,
  saveCut,
  snapshotLiveIntoCurrent,
  summarizeCut,
  upsertReviewTimeline,
} from './productionCuts.js'
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
import {
  addShotCharacter,
  appendGraphEdges,
  checkCastRefs,
  gateGeneration,
  lockCastMembers,
  unlockCastMembers,
} from './castLock.js'
import { normalizeProjectLook, normalizeShotSettings } from './shotSettings.js'
import { applyOutputTargetToSettings, generateResolution } from './outputRatio.js'

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

export function handleListCuts(payload = {}) {
  const project = requireProject()
  const episodeId = currentEpisodeId(project, payload)
  if (!episodeId) throw new Error('list_cuts needs episodeId')
  return { action: 'list_cuts', ...listCuts(cutsIndex(), episodeId) }
}

export function handleSaveCut(payload = {}) {
  const project = requireProject()
  const episodeId = currentEpisodeId(project, payload)
  if (!episodeId) throw new Error('save_cut needs episodeId')
  const name = String(payload.name || payload.title || '').trim()
  if (!name) throw new Error('save_cut needs name')
  const board = payload.storyboardBoard || project.storyboardBoard || { version: 1, cards: [] }
  if (payload.previewOnly !== false) {
    return {
      previewOnly: true,
      action: 'save_cut',
      episodeId,
      name,
      author: payload.author || '',
      stats: { cardCount: board.cards?.length || 0 },
    }
  }
  const saved = saveCut(cutsIndex(), episodeId, {
    id: payload.id || payload.cutId,
    name,
    author: payload.author,
    notes: payload.notes,
    storyboardBoard: board,
    timelineId: payload.pinTimelineId || payload.timelineId,
    makeCurrent: payload.makeCurrent !== false,
  })
  const review = buildReviewTimeline({
    episodeId,
    cut: saved.cut,
    settings: project.settings || {},
    assets: assets(),
    pinTimelineId: payload.pinTimelineId || saved.cut.timelineId,
  })
  saved.cut.timelineId = review.id
  const withTimeline = saveCut(saved.index, episodeId, {
    ...saved.cut,
    timelineId: review.id,
    storyboardBoard: saved.cut.storyboardBoard,
    makeCurrent: payload.makeCurrent !== false,
  })
  const production = applyCutsToProduction(hydrateProductionFromProject(project), episodeId, withTimeline.bucket)
  persistCuts(withTimeline.index, {
    production,
    timelines: upsertReviewTimeline(project.timelines, review),
  })
  return {
    success: true,
    action: 'save_cut',
    created: withTimeline.created,
    cut: summarizeCut(withTimeline.cut, withTimeline.bucket),
    cuts: listCuts(withTimeline.index, episodeId),
  }
}

export function handleCheckoutCut(payload = {}) {
  const project = requireProject()
  const episodeId = currentEpisodeId(project, payload)
  const cutRef = payload.cutId || payload.id || payload.name
  if (!episodeId || !cutRef) throw new Error('checkout_cut needs episodeId and cutId')
  if (payload.previewOnly !== false) {
    const found = findCut(cutsIndex(), episodeId, cutRef)
    return { previewOnly: true, action: 'checkout_cut', episodeId, cut: summarizeCut(found.cut, found.bucket) }
  }
  let index = cutsIndex()
  if (payload.snapshotCurrent !== false) {
    const snapped = snapshotLiveIntoCurrent(index, episodeId, project.storyboardBoard)
    if (!snapped.skipped) index = snapped.index
  }
  const next = checkoutCut(index, episodeId, cutRef)
  const production = applyCutsToProduction(hydrateProductionFromProject(project), episodeId, next.bucket)
  persistCuts(next.index, {
    production,
    storyboardBoard: next.cut.storyboardBoard || { version: 1, cards: [] },
  })
  return {
    success: true,
    action: 'checkout_cut',
    cut: summarizeCut(next.cut, next.bucket),
    cardCount: next.cut.storyboardBoard?.cards?.length || 0,
    cuts: listCuts(next.index, episodeId),
  }
}

export function handlePromoteCut(payload = {}) {
  const project = requireProject()
  const episodeId = currentEpisodeId(project, payload)
  const cutRef = payload.cutId || payload.id || payload.name
  if (!episodeId || !cutRef) throw new Error('promote_cut needs episodeId and cutId')
  if (payload.previewOnly !== false) {
    const found = findCut(cutsIndex(), episodeId, cutRef)
    return { previewOnly: true, action: 'promote_cut', episodeId, cut: summarizeCut(found.cut, found.bucket) }
  }
  let index = cutsIndex()
  if (payload.checkout) {
    const snapped = snapshotLiveIntoCurrent(index, episodeId, project.storyboardBoard)
    if (!snapped.skipped) index = snapped.index
    const checked = checkoutCut(index, episodeId, cutRef)
    index = checked.index
  }
  const next = promoteCut(index, episodeId, cutRef)
  const production = applyCutsToProduction(hydrateProductionFromProject(project), episodeId, next.bucket)
  const extra = { production }
  if (payload.checkout) extra.storyboardBoard = next.cut.storyboardBoard
  persistCuts(next.index, extra)
  return {
    success: true,
    action: 'promote_cut',
    cut: summarizeCut(next.cut, next.bucket),
    cuts: listCuts(next.index, episodeId),
  }
}

export async function handleWatchCut(payload = {}) {
  const project = requireProject()
  const episodeId = currentEpisodeId(project, payload)
  const cutRef = payload.cutId || payload.id || payload.name
  if (!episodeId || !cutRef) throw new Error('watch_cut needs episodeId and cutId')
  const found = findCut(cutsIndex(), episodeId, cutRef)
  if (!found.cut) throw new Error(`Cut '${cutRef}' not found on ${episodeId}`)
  if (payload.previewOnly !== false) {
    return {
      previewOnly: true,
      action: 'watch_cut',
      cut: summarizeCut(found.cut, found.bucket),
      timelineId: found.cut.timelineId,
    }
  }
  const review = buildReviewTimeline({
    episodeId,
    cut: found.cut,
    settings: project.settings || {},
    assets: assets(),
    pinTimelineId: found.cut.timelineId,
  })
  const saved = saveCut(cutsIndex(), episodeId, {
    ...found.cut,
    timelineId: review.id,
    storyboardBoard: found.cut.storyboardBoard,
    makeCurrent: false,
  })
  persistCuts(saved.index, { timelines: upsertReviewTimeline(project.timelines, review) })
  const store = useProjectStore.getState()
  if (typeof store.switchTimeline === 'function') {
    await store.switchTimeline(review.id)
  } else {
    store.saveProject?.({ currentTimelineId: review.id })
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('comfystudio-open-sequence-tab', { detail: { timelineId: review.id } }))
  }
  return {
    success: true,
    action: 'watch_cut',
    cut: summarizeCut(saved.cut, saved.bucket),
    timelineId: review.id,
    clipCount: review.clips.length,
  }
}

export function handleListProductionCatalog() {
  return { action: 'list_production_catalog', ...listProductionCatalog() }
}

export function handleDiscoverProduction(payload = {}) {
  return discoverProduction({ query: payload.query || payload.q || '', type: payload.type || payload.productionType || '' })
}

export function handleGetShotPacket(payload = {}) {
  const project = requireProject()
  const cardId = String(payload.cardId || payload.shotId || payload.id || '').trim()
  if (!cardId) throw new Error('get_shot_packet needs cardId')
  const shot = buildShotPacket(project, cardId, { assets: assets() })
  if (!shot) throw new Error(`Shot '${cardId}' not found`)
  return { action: 'get_shot_packet', ...shot }
}

function cutsIndex() {
  return normalizeCutsIndex(useProjectStore.getState().currentProject?.productionCuts)
}

function persistCuts(index, extra = {}) {
  const store = useProjectStore.getState()
  if (!store.currentProject) throw new Error('No Velorn project is open.')
  if (extra.production) store.setProduction?.(extra.production)
  if (extra.storyboardBoard) store.setStoryboardBoard?.(extra.storyboardBoard)
  if (extra.timelines) {
    useProjectStore.setState((state) => ({
      currentProject: state.currentProject
        ? { ...state.currentProject, timelines: extra.timelines, productionCuts: index, modified: new Date().toISOString() }
        : null,
    }))
  }
  store.saveProject?.({
    productionCuts: index,
    ...(extra.production ? { production: extra.production } : {}),
    ...(extra.storyboardBoard ? { storyboardBoard: extra.storyboardBoard } : {}),
    ...(extra.productionWorkspaces ? { productionWorkspaces: extra.productionWorkspaces } : {}),
  })
  return index
}

function currentEpisodeId(project, payload = {}) {
  return String(payload.episodeId || payload.episode || project.production?.current?.episodeId || '').trim()
}

export function handleListEpisodes() {
  const project = requireProject()
  const production = hydrateProductionFromProject(project)
  const index = cutsIndex()
  const seasons = listEpisodes(production).map((season) => ({
    ...season,
    episodes: season.episodes.map((episode) => ({
      ...episode,
      cuts: listCuts(index, episode.id),
    })),
  }))
  return { action: 'list_episodes', seasons, current: production.current }
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
  const store = useProjectStore.getState()
  const settings = { ...(store.currentProject.settings || {}) }
  if (payload.look) {
    settings.cinematography = normalizeProjectLook({
      ...(settings.cinematography || {}),
      ...payload.look,
    })
  }
  const typeDef = payload.type ? getProductionType(payload.type) : null
  const targetId = payload.outputTarget || payload.format?.outputTarget || typeDef?.outputTarget
  const patched = targetId ? applyOutputTargetToSettings(settings, targetId) : settings
  if (payload.look || targetId) {
    store.saveProject?.({ settings: patched, production: { ...next, format: { ...next.format, outputTarget: patched.outputTarget || next.format.outputTarget, aspect: patched.aspectRatio || next.format.aspect } } })
  }
  return { success: true, action: 'set_production', production: next, output: generateResolution({ ...store.currentProject, settings: patched, production: next }) }
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
  let index = cutsIndex()
  const store = useProjectStore.getState()
  const workspaces = { ...(store.currentProject.productionWorkspaces || {}) }
  if (outgoingId && payload.snapshotCurrent !== false) {
    const snapped = snapshotLiveIntoCurrent(index, outgoingId, project.storyboardBoard)
    if (!snapped.skipped) index = snapped.index
    workspaces[outgoingId] = snapshotWorkspace(project)
    production = markEpisodeWorkspace(production, outgoingId, workspaces[outgoingId].savedAt)
  }
  const created = createEpisode(production, payload)
  const incoming = payload.cloneBoard
    ? snapshotWorkspace(project).storyboardBoard
    : { version: 1, cards: [] }
  const seeded = loadEpisodeBoard(index, created.episode.id, incoming)
  const nextProduction = applyCutsToProduction(created.production, created.episode.id, seeded.bucket)
  persistCuts(seeded.index, {
    production: nextProduction,
    storyboardBoard: seeded.board,
    productionWorkspaces: workspaces,
  })
  return {
    success: true,
    action: 'create_episode',
    episode: created.episode,
    production: nextProduction,
    cut: summarizeCut(seeded.cut, seeded.bucket),
    clonedBoard: Boolean(payload.cloneBoard),
  }
}

export function handleSwitchEpisode(payload = {}) {
  const project = requireProject()
  const episodeId = String(payload.episodeId || payload.id || '').trim()
  if (!episodeId) throw new Error('switch_episode needs episodeId')
  const current = hydrateProductionFromProject(project)
  const hit = findEpisode(current, episodeId)
  if (!hit) throw new Error(`Episode '${episodeId}' not found`)
  if (payload.previewOnly !== false) {
    return { previewOnly: true, action: 'switch_episode', from: current.current.episodeId, to: episodeId }
  }
  const store = useProjectStore.getState()
  const workspaces = { ...(store.currentProject.productionWorkspaces || {}) }
  let index = cutsIndex()
  if (current.current.episodeId && payload.snapshotCurrent !== false) {
    const snapped = snapshotLiveIntoCurrent(index, current.current.episodeId, project.storyboardBoard)
    if (!snapped.skipped) index = snapped.index
    workspaces[current.current.episodeId] = snapshotWorkspace(project)
  }
  const fallback = workspaces[hit.episode.id]?.storyboardBoard || { version: 1, cards: [] }
  const loaded = loadEpisodeBoard(index, hit.episode.id, fallback)
  const production = applyCutsToProduction(
    setCurrentEpisode(markEpisodeWorkspace(current, current.current.episodeId), episodeId),
    hit.episode.id,
    loaded.bucket,
  )
  persistCuts(loaded.index, {
    production,
    storyboardBoard: loaded.board,
    productionWorkspaces: workspaces,
  })
  return {
    success: true,
    action: 'switch_episode',
    production,
    cut: summarizeCut(loaded.cut, loaded.bucket),
    cardCount: loaded.board.cards?.length || 0,
  }
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
    if (payload.outputTarget !== undefined) patch.outputTarget = payload.outputTarget || ''
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
  const season = payload.season || production.current.seasonId
  const episode = payload.episode || production.current.episodeId
  const members = resolveCast(studio, { season, episode })
  const lock = checkCastRefs(studio, { season, episode, projectDir: project.path || project.projectDir || null })
  return { action: 'studio_cast_resolve', season, episode, members, lock }
}

function castScope(payload = {}) {
  const project = requireProject()
  const production = hydrateProductionFromProject(project)
  return {
    project,
    studio: normalizeStudio(project.studio),
    season: payload.season || production.current.seasonId,
    episode: payload.episode || production.current.episodeId,
    projectDir: payload.projectDir || project.path || project.projectDir || null,
  }
}

export function handleStudioRefGate(payload = {}) {
  const { project, studio, season, episode, projectDir } = castScope(payload)
  let castIds = Array.isArray(payload.castIds) ? payload.castIds : (payload.castId ? [payload.castId] : null)
  let card = null
  if (payload.cardId) {
    card = findCard(project, payload.cardId)
    if (!castIds) {
      const gate = gateGeneration(studio, { season, episode, card, projectDir })
      return { action: 'studio_ref_gate', season, episode, cardId: card.id, ...gate }
    }
  }
  const report = checkCastRefs(studio, { season, episode, castIds, projectDir })
  return { action: 'studio_ref_gate', season, episode, ok: report.ok, skipped: report.empty, reason: report.summary, report }
}

export function handleStudioCastLock(payload = {}) {
  const { studio, season, episode, projectDir } = castScope(payload)
  const op = String(payload.op || payload.action || 'status').trim()
  const castIds = Array.isArray(payload.castIds) ? payload.castIds : (payload.castId ? [payload.castId] : null)
  if (op === 'status' || payload.previewOnly !== false) {
    const report = checkCastRefs(studio, { season, episode, castIds, projectDir })
    return {
      previewOnly: payload.previewOnly !== false && op !== 'status',
      action: 'studio_cast_lock',
      op,
      season,
      episode,
      report,
    }
  }
  const next = op === 'unlock'
    ? unlockCastMembers(studio, { season, episode, castIds, by: payload.by || 'agent' })
    : lockCastMembers(studio, { season, episode, castIds, by: payload.by || 'agent', projectDir })
  persistStudio(next)
  return {
    success: true,
    action: 'studio_cast_lock',
    op,
    season,
    episode,
    report: checkCastRefs(next, { season, episode, castIds, projectDir }),
    graph: next.graph,
  }
}

export function handleStudioBlockingAddCharacter(payload = {}) {
  const { project, studio, season, episode, projectDir } = castScope(payload)
  const cardId = String(payload.cardId || payload.shotId || '').trim()
  if (!cardId) throw new Error('studio_blocking_add_character needs cardId')
  const card = findCard(project, cardId)
  if (payload.previewOnly !== false) {
    const preview = addShotCharacter(card, studio, payload.castId || payload.cast_id, { season, episode, projectDir })
    return {
      previewOnly: true,
      action: 'studio_blocking_add_character',
      cardId: card.id,
      member: preview.member,
      report: preview.report,
    }
  }
  const added = addShotCharacter(card, studio, payload.castId || payload.cast_id, {
    season,
    episode,
    projectDir,
    by: payload.by || 'agent',
  })
  replaceCard(project, card.id, () => added.card)
  persistStudio(appendGraphEdges(studio, [added.edge], { by: payload.by || 'agent' }))
  return {
    success: true,
    action: 'studio_blocking_add_character',
    cardId: card.id,
    castId: added.member.cast_id,
    cameraRig: added.card.cameraRig,
    edge: added.edge,
  }
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
    case 'discover_production':
      return handleDiscoverProduction(payload)
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
    case 'studio_ref_gate':
      return handleStudioRefGate(payload)
    case 'studio_cast_lock':
      return handleStudioCastLock(payload)
    case 'studio_blocking_add_character':
      return handleStudioBlockingAddCharacter(payload)
    case 'studio_slots_list':
      return handleStudioSlotsList()
    case 'studio_slots_mutate':
      return handleStudioSlotsMutate(payload)
    case 'studio_qa_record':
      return handleStudioQaRecord(payload)
    case 'studio_flow':
      return handleStudioFlow(payload)
    case 'list_cuts':
      return handleListCuts(payload)
    case 'save_cut':
      return handleSaveCut(payload)
    case 'checkout_cut':
      return handleCheckoutCut(payload)
    case 'promote_cut':
      return handlePromoteCut(payload)
    case 'watch_cut':
      return handleWatchCut(payload)
    default:
      throw new Error(`Unknown production action: ${action}`)
  }
}
