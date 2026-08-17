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
import { normalizeProjectLook, normalizeShotSettings } from './shotSettings.js'
import { applyOutputTargetToSettings, generateResolution } from './outputRatio.js'
import {
  applyCloneVoice,
  applyFoley,
  applyVoiceover,
  attachAudio,
  attachVoiceover,
  bindCanonicalAudio,
  buildVseAudioPlan,
  canonicalTake,
  expectedLinesFromCards,
  finalizeTake,
  findTake,
  lineSlugForCard,
  listVoiceProfiles,
  markCanonical,
  planCloneVoice,
  planFoley,
  planLipsyncClip,
  planVoiceover,
  readinessFor,
  takesForLine,
} from './takeChain.js'

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
  const studio = normalizeStudio(project.studio)
  const lines = expectedLinesFromCards(cards)
  return {
    action: 'studio_flow',
    flow: flowView(project.studio, extras),
    audio: {
      takeChain: readinessFor(studio.voiceover, lines.map((line) => line.lineSlug)),
      vse: buildVseAudioPlan({ cards, manifest: studio.voiceover, audio: studio.audio }),
    },
    production: hydrateProductionFromProject(project),
  }
}

function voiceoverStudio(project) {
  return normalizeStudio(project.studio)
}

function persistVoiceover(studio, manifest, audio = null) {
  let next = attachVoiceover(studio, manifest)
  if (audio) next = attachAudio(next, audio)
  persistStudio(next)
  return next
}

function resolveLineCard(project, payload = {}) {
  const cards = project.storyboardBoard?.cards || []
  const cardId = String(payload.cardId || payload.shotId || '').trim()
  if (cardId) return findCard(project, cardId)
  const slug = String(payload.lineSlug || payload.line_slug || '').trim()
  if (!slug) return null
  return cards.find((card) => lineSlugForCard(card) === slug) || null
}

export function handleListLineTakes(payload = {}) {
  const project = requireProject()
  const studio = voiceoverStudio(project)
  const card = resolveLineCard(project, payload)
  const lineSlug = String(payload.lineSlug || payload.line_slug || (card ? lineSlugForCard(card) : '')).trim()
  if (!lineSlug) throw new Error('list_line_takes needs lineSlug or cardId')
  return {
    action: 'list_line_takes',
    lineSlug,
    cardId: card?.id || null,
    takes: takesForLine(studio.voiceover, lineSlug),
    canonical: canonicalTake(studio.voiceover, lineSlug),
  }
}

export function handleListVoiceProfiles() {
  return { action: 'list_voice_profiles', profiles: listVoiceProfiles() }
}

export function handleProductionReadiness(payload = {}) {
  const project = requireProject()
  const studio = voiceoverStudio(project)
  const cards = project.storyboardBoard?.cards || []
  const lines = expectedLinesFromCards(cards)
  const slugs = Array.isArray(payload.lineSlugs) && payload.lineSlugs.length
    ? payload.lineSlugs
    : lines.map((line) => line.lineSlug)
  return {
    action: 'production_readiness',
    ...readinessFor(studio.voiceover, slugs),
    lines,
  }
}

export function handleSynthesizeVoiceover(payload = {}) {
  const project = requireProject()
  const card = resolveLineCard(project, payload)
  const plan = planVoiceover({
    lineSlug: payload.lineSlug || payload.line_slug || (card ? lineSlugForCard(card) : ''),
    text: payload.text || card?.dialogue,
    engine: payload.engine,
    targetVoice: payload.targetVoice || payload.target_voice,
    card,
  })
  if (payload.previewOnly !== false) {
    return { previewOnly: true, ...plan, queued: false }
  }
  if (!plan.ok) throw new Error(plan.reason)
  const studio = voiceoverStudio(project)
  const applied = applyVoiceover(studio.voiceover, plan, {
    cardId: card?.id,
    assetId: payload.assetId,
    audioPath: payload.audioPath,
  })
  persistVoiceover(studio, applied.manifest)
  if (card && payload.bind !== false) {
    replaceCard(project, card.id, (current) => bindCanonicalAudio(current, applied.take))
  }
  return { success: true, ...plan, take: applied.take, queued: false }
}

export function handleCloneVoice(payload = {}) {
  const project = requireProject()
  const studio = voiceoverStudio(project)
  const card = resolveLineCard(project, payload)
  const plan = planCloneVoice(studio.voiceover, {
    lineSlug: payload.lineSlug || payload.line_slug || (card ? lineSlugForCard(card) : ''),
    sourceTakeId: payload.sourceTakeId || payload.source_take_id,
    targetVoice: payload.targetVoice || payload.target_voice,
    engine: payload.engine,
  })
  if (payload.previewOnly !== false) {
    return { previewOnly: true, ...plan, queued: false }
  }
  if (!plan.ok) throw new Error(plan.reason)
  const applied = applyCloneVoice(studio.voiceover, plan, { audioPath: payload.audioPath })
  persistVoiceover(studio, applied.manifest)
  return { success: true, ...plan, take: applied.take, queued: false }
}

export function handleMarkTakeCanonical(payload = {}) {
  const project = requireProject()
  const takeId = String(payload.takeId || payload.take_id || '').trim()
  if (!takeId) throw new Error('mark_take_canonical needs takeId')
  if (payload.previewOnly !== false) {
    return { previewOnly: true, action: 'mark_take_canonical', takeId }
  }
  const studio = voiceoverStudio(project)
  const marked = markCanonical(studio.voiceover, takeId)
  persistVoiceover(studio, marked.manifest)
  return { success: true, action: 'mark_take_canonical', take: marked.take }
}

export function handleFinalizeTake(payload = {}) {
  const project = requireProject()
  const takeId = String(payload.takeId || payload.take_id || '').trim()
  if (!takeId) throw new Error('finalize_take needs takeId')
  if (payload.previewOnly !== false) {
    return { previewOnly: true, action: 'finalize_take', takeId }
  }
  const studio = voiceoverStudio(project)
  const locked = finalizeTake(studio.voiceover, takeId)
  persistVoiceover(studio, locked.manifest)
  const card = resolveLineCard(project, { lineSlug: locked.take.line_slug, cardId: payload.cardId })
  if (card) replaceCard(project, card.id, (current) => bindCanonicalAudio(current, locked.take))
  return { success: true, action: 'finalize_take', take: locked.take }
}

export function handleGenerateLipsyncClip(payload = {}) {
  const project = requireProject()
  const card = resolveLineCard(project, payload)
  if (!card && !payload.takeId) throw new Error('generate_lipsync_clip needs cardId or lineSlug')
  const studio = voiceoverStudio(project)
  const take = payload.takeId
    ? findTake(studio.voiceover, payload.takeId)
    : canonicalTake(studio.voiceover, lineSlugForCard(card || { title: payload.lineSlug }))
  const plan = planLipsyncClip({
    card: card || {},
    take,
    offScreen: payload.offScreen,
  })
  return {
    previewOnly: payload.previewOnly !== false,
    ...plan,
    queued: false,
    note: 'Does not queue GPU. Use queue_prompt_generation_batch with workflowId after approval.',
  }
}

export function handleGenerateFoley(payload = {}) {
  const project = requireProject()
  const card = resolveLineCard(project, payload)
  if (!card) throw new Error('generate_foley needs cardId or lineSlug')
  const plan = planFoley({
    card: { ...card, silentVideoPath: payload.silentVideoPath },
    tags: payload.tags,
  })
  if (payload.previewOnly !== false) {
    return { previewOnly: true, ...plan, queued: false }
  }
  if (!plan.ok) {
    const err = new Error(plan.reason)
    err.status = plan.status
    throw err
  }
  const studio = voiceoverStudio(project)
  const applied = applyFoley(studio.audio, plan, {
    cardId: card.id,
    assetId: payload.assetId,
    path: payload.audioPath,
  })
  persistVoiceover(studio, studio.voiceover, applied.audio)
  if (payload.bind !== false) {
    replaceCard(project, card.id, (current) => ({ ...current, foleyAssetId: applied.track.assetId || current.foleyAssetId }))
  }
  return { success: true, ...plan, track: applied.track, queued: false }
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
    case 'studio_slots_list':
      return handleStudioSlotsList()
    case 'studio_slots_mutate':
      return handleStudioSlotsMutate(payload)
    case 'studio_qa_record':
      return handleStudioQaRecord(payload)
    case 'studio_flow':
      return handleStudioFlow(payload)
    case 'list_line_takes':
      return handleListLineTakes(payload)
    case 'list_voice_profiles':
      return handleListVoiceProfiles()
    case 'production_readiness':
      return handleProductionReadiness(payload)
    case 'synthesize_voiceover':
      return handleSynthesizeVoiceover(payload)
    case 'clone_voice':
      return handleCloneVoice(payload)
    case 'mark_take_canonical':
      return handleMarkTakeCanonical(payload)
    case 'finalize_take':
      return handleFinalizeTake(payload)
    case 'generate_lipsync_clip':
      return handleGenerateLipsyncClip(payload)
    case 'generate_foley':
      return handleGenerateFoley(payload)
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
