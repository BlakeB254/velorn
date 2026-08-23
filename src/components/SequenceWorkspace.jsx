import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, CheckCircle2, ChevronDown, Loader2, Play, RefreshCw, Sparkles } from 'lucide-react'
import useProjectStore from '../stores/projectStore'
import useAssetsStore from '../stores/assetsStore'
import { useTimelineStore } from '../stores/timelineStore'
import useGenerationMonitorStore from '../stores/generationMonitorStore'
import { getProjectFileUrl, importAsset } from '../services/fileSystem'
import { ensureGenerateWorkspace } from '../services/ensureGenerateWorkspace'
import { extractMediaFrame, shotClipStatus } from '../services/extractMediaFrame'
import { getComfyNativeTemplate } from '../config/comfyNativeTemplates'
import MotionPicker from './storyboard/MotionPicker'
import ShotParamsPanel from './storyboard/ShotParamsPanel'
import ProjectLookBar from './storyboard/ProjectLookBar'
import OutputRatioBar from './storyboard/OutputRatioBar'
import CutBar from './storyboard/CutBar'
import { generateResolution } from '../services/outputRatio'
import { findMotion, loadMotionCatalog } from '../services/motionLibrary'
import { assembleLexiconLabels, modeFromWorkflow, normalizeProjectLook } from '../services/shotSettings'
import {
  AssetPicker,
  DEFAULT_FLF_WORKFLOW,
  DEFAULT_VIDEO_WORKFLOW,
  RefChips,
  VIDEO_WORKFLOW_GROUP_LABELS,
  composeGenerationPrompt,
  directorRefsForCard,
  emptyBoard,
  findVideoWorkflow,
  groupedVideoWorkflows,
  isFlfWorkflow,
  numberCards,
  primaryRefIds,
  seedFromProject,
  sortAssetsForRole,
  videoWorkflowKind,
} from './storyboard/boardShared'

function statusLabel(status) {
  if (status === 'done') return 'Finished'
  if (status === 'error') return 'Failed'
  if (status === 'queued') return 'Queued'
  if (status === 'uploading') return 'Uploading still…'
  if (status === 'configuring') return 'Loading ComfyUI workflow…'
  if (status === 'queuing') return 'Sending to ComfyUI…'
  if (status === 'running') return 'Generating…'
  return status || 'In progress'
}

export default function SequenceWorkspace() {
  const currentProject = useProjectStore((state) => state.currentProject)
  const currentProjectHandle = useProjectStore((state) => state.currentProjectHandle)
  const setStoryboardBoard = useProjectStore((state) => state.setStoryboardBoard)
  const updateProjectSettings = useProjectStore((state) => state.updateProjectSettings)
  const saveProject = useProjectStore((state) => state.saveProject)
  const createTimeline = useProjectStore((state) => state.createTimeline)
  const switchTimeline = useProjectStore((state) => state.switchTimeline)
  const addClip = useTimelineStore((state) => state.addClip)
  const assets = useAssetsStore((state) => state.assets)
  const folders = useAssetsStore((state) => state.folders)
  const addAsset = useAssetsStore((state) => state.addAsset)
  const monitorJobs = useGenerationMonitorStore((state) => state.jobs)
  const comfyConnected = useGenerationMonitorStore((state) => state.isConnected)

  const [openId, setOpenId] = useState(null)
  const [advancedId, setAdvancedId] = useState(null)
  const [focusId, setFocusId] = useState(null)
  const [reelIndex, setReelIndex] = useState(null)
  const workflowGroups = useMemo(() => groupedVideoWorkflows(), [])
  const [mediaPicker, setMediaPicker] = useState(null)
  const [error, setError] = useState('')
  const [urls, setUrls] = useState({})
  const [submittingId, setSubmittingId] = useState(null)
  const [motionCatalog, setMotionCatalog] = useState({ items: [] })
  const rowRefs = useRef({})

  const board = useMemo(
    () => (currentProject ? seedFromProject(currentProject) : emptyBoard()),
    [currentProject]
  )

  useEffect(() => {
    loadMotionCatalog().then(setMotionCatalog)
  }, [])

  const projectLook = useMemo(
    () => normalizeProjectLook(currentProject?.settings?.cinematography),
    [currentProject?.settings?.cinematography]
  )

  useEffect(() => {
    if (!currentProject) return
    if (!currentProject.storyboardBoard?.cards?.length && board.cards.length) {
      setStoryboardBoard(board)
    }
  }, [currentProject, board, setStoryboardBoard])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!currentProjectHandle) return
      const next = {}
      for (const card of board.cards) {
        const versionIds = (card.videoVersions || []).map((item) => item.assetId)
        const ids = [card.imageAssetId, card.lastFrameAssetId, card.videoAssetId, card.audioAssetId, card.musicAssetId, ...versionIds]
        for (const assetId of ids) {
          if (!assetId || next[assetId]) continue
          const asset = assets.find((item) => item.id === assetId)
          const path = asset?.path || asset?.absolutePath
          if (!path && asset?.url) {
            next[assetId] = asset.url
            continue
          }
          if (!path) continue
          try {
            const url = await getProjectFileUrl(currentProjectHandle, path)
            if (!cancelled && url) next[assetId] = url
          } catch (_) { /* ignore */ }
        }
      }
      if (!cancelled) setUrls((prev) => ({ ...prev, ...next }))
    }
    run()
    return () => { cancelled = true }
  }, [board.cards, assets, currentProjectHandle])

  const persist = useCallback((next) => {
    setStoryboardBoard({ ...next, cards: numberCards(next.cards || []) })
  }, [setStoryboardBoard])

  const updateCard = useCallback((cardId, patch) => {
    persist({
      ...board,
      cards: board.cards.map((card) => (card.id === cardId ? { ...card, ...patch } : card)),
    })
  }, [board, persist])

  const imageAssets = useMemo(() => (assets || []).filter((asset) => asset.type === 'image'), [assets])
  const audioAssets = useMemo(() => (assets || []).filter((asset) => asset.type === 'audio'), [assets])
  const videoAssets = useMemo(() => (assets || []).filter((asset) => asset.type === 'video'), [assets])

  useEffect(() => {
    if (!board.cards.length || !assets.length) return
    let changed = false
    const nextCards = board.cards.map((card) => {
      if (card.videoAssetId) return card
      const match = assets.find((asset) => (
        asset.type === 'video' && (asset.storyboardCardId === card.id || asset.settings?.storyboardCardId === card.id)
      ))
      if (!match) return card
      changed = true
      const versions = Array.isArray(card.videoVersions) ? [...card.videoVersions] : []
      if (!versions.some((item) => item.assetId === match.id)) {
        versions.push({
          assetId: match.id,
          createdAt: match.createdAt || new Date().toISOString(),
          kind: 'sequence-clip',
        })
      }
      return {
        ...card,
        videoAssetId: match.id,
        videoVersions: versions,
        hasGeneration: true,
        status: card.status === 'accepted' ? 'accepted' : 'pending-review',
      }
    })
    if (changed) persist({ ...board, cards: nextCards })
  }, [assets, board, persist])

  const assetName = useCallback((assetId) => {
    if (!assetId) return ''
    return assets.find((item) => item.id === assetId)?.name || assetId
  }, [assets])

  const frameUrl = (assetId) => {
    if (!assetId) return ''
    const asset = assets.find((item) => item.id === assetId)
    return urls[assetId] || asset?.url || ''
  }

  const jobForCard = (cardId) => (
    [...monitorJobs]
      .filter((job) => job.storyboardCardId === cardId)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null
  )

  const togglePicker = (cardId, slot) => {
    setMediaPicker((current) => (
      current?.cardId === cardId && current?.slot === slot ? null : { cardId, slot }
    ))
  }

  const addRef = (card, key, asset) => {
    const next = [...(card[key] || [])]
    if (!next.some((item) => item.assetId === asset.id)) {
      next.push({ assetId: asset.id, name: asset.name })
    }
    return next
  }

  const applyPickedAsset = (cardId, slot, asset) => {
    const card = board.cards.find((item) => item.id === cardId)
    if (!card) return
    if (slot === 'audio') updateCard(cardId, { audioAssetId: asset.id })
    else if (slot === 'music') updateCard(cardId, { musicAssetId: asset.id })
    else if (slot === 'last') updateCard(cardId, { lastFrameAssetId: asset.id })
    else if (slot === 'character') updateCard(cardId, { characterRefs: addRef(card, 'characterRefs', asset) })
    else if (slot === 'location' || slot === 'scene') updateCard(cardId, { locationRef: { assetId: asset.id, name: asset.name }, sceneRefs: [{ assetId: asset.id, name: asset.name }] })
    else if (slot === 'prop') updateCard(cardId, { propRefs: addRef(card, 'propRefs', asset) })
    else if (slot === 'clip') {
      const versions = Array.isArray(card.videoVersions) ? [...card.videoVersions] : []
      if (!versions.some((item) => item.assetId === asset.id)) {
        versions.push({
          assetId: asset.id,
          createdAt: asset.createdAt || new Date().toISOString(),
          workflowId: asset.workflowId || '',
          kind: 'sequence-clip',
        })
      }
      updateCard(cardId, {
        videoAssetId: asset.id,
        videoVersions: versions,
        hasGeneration: true,
        status: 'pending-review',
      })
    }
    setMediaPicker(null)
  }

  const submitVideo = async (card, nextCard) => {
    const workflow = findVideoWorkflow(card.videoWorkflowId || DEFAULT_VIDEO_WORKFLOW)
    const needs = workflow.needs || []
    const firstId = card.imageAssetId || card.sourceAssetId || null
    const lastId = card.lastFrameAssetId || (needs.includes('last') ? nextCard?.imageAssetId : null) || null
    if (needs.includes('first') && !firstId) {
      setError(`Shot ${card.order} needs a still before you can run ${workflow.label}.`)
      setOpenId(card.id)
      return
    }
    if (needs.includes('last') && !lastId) {
      setError('First/last needs a last frame — pick one or add a still on the next shot.')
      setOpenId(card.id)
      return
    }
    if (needs.includes('audio') && !card.audioAssetId) {
      setError('This workflow needs a dialogue or VO audio clip.')
      setOpenId(card.id)
      return
    }
    const references = currentProject?.references
    const refs = primaryRefIds(card, references)
    const motion = findMotion(card.motionSlug, motionCatalog)
    const prompt = composeGenerationPrompt(card, {
      motionTitle: motion?.title || '',
      mode: modeFromWorkflow(workflow.id, 'video'),
      projectLook,
      references,
      bridge: needs.includes('last') && nextCard
        ? `Last frame is shot ${nextCard.order}: ${nextCard.title}. ${nextCard.description || ''}`
        : '',
    })
    setError('')
    setSubmittingId(card.id)
    updateCard(card.id, { status: 'generating', lastGenerationError: '' })
    try {
      await ensureGenerateWorkspace()
      window.dispatchEvent(new CustomEvent('comfystudio-mcp-prepare-generation', {
        detail: {
          workflowId: workflow.id,
          category: getComfyNativeTemplate(workflow.id)?.category || 'video',
          prompt,
          duration: Number(card.duration) || 5,
          selectedAssetId: firstId,
          selectedAudioAssetId: card.audioAssetId || null,
          referenceAssetId1: needs.includes('last') ? lastId : refs.first,
          referenceAssetId2: refs.second || null,
          selectedAssetFieldIds: {
            ...(firstId ? { image: firstId, firstFrame: firstId } : {}),
            ...(lastId ? { lastFrame: lastId, lastImage: lastId } : {}),
            ...(refs.first ? { referenceImage1: refs.first } : {}),
            ...(refs.second ? { referenceImage2: refs.second } : {}),
          },
          storyboardCardId: card.id,
          resolution: generateResolution(currentProject, card),
          placement: 'sequence-clip',
          velornMeta: {
            placement: 'sequence-clip',
            cardId: card.id,
            cardTitle: card.title || '',
            cardOrder: card.order || null,
            motionSlug: card.motionSlug || '',
            ...directorRefsForCard(currentProject, card),
          },
          autoQueue: true,
        },
      }))
    } catch (err) {
      setError(err?.message || 'Could not start the generation.')
      updateCard(card.id, { status: 'draft', lastGenerationError: err?.message || '' })
    } finally {
      setSubmittingId(null)
    }
  }

  const mediaUrl = useCallback((assetId) => {
    if (!assetId) return ''
    const asset = assets.find((item) => item.id === assetId)
    return urls[assetId] || asset?.url || ''
  }, [assets, urls])

  const acceptClip = (card) => {
    updateCard(card.id, { status: 'accepted' })
  }

  const rejectClip = (card) => {
    updateCard(card.id, { status: 'rejected' })
  }

  const selectVersion = (card, assetId) => {
    if (!assetId) return
    updateCard(card.id, { videoAssetId: assetId, status: 'pending-review' })
  }

  const grabEndFrame = async (card) => {
    const url = mediaUrl(card.videoAssetId)
    if (!url || !currentProjectHandle) {
      throw new Error('Play or generate a clip first, then grab its last frame.')
    }
    const file = await extractMediaFrame(url, {
      position: 'end',
      filename: `shot-${card.order || 'x'}-end.png`,
    })
    const imported = await importAsset(currentProjectHandle, file, 'images')
    const asset = addAsset({
      ...imported,
      name: `end-shot-${card.order || ''}`,
      type: 'image',
    })
    updateCard(card.id, { lastFrameAssetId: asset.id })
    return asset
  }

  const extendFromEnd = async (card) => {
    try {
      const end = card.lastFrameAssetId ? { id: card.lastFrameAssetId } : await grabEndFrame(card)
      updateCard(card.id, {
        imageAssetId: end.id,
        videoWorkflowId: DEFAULT_VIDEO_WORKFLOW,
        status: 'draft',
      })
      setOpenId(card.id)
      setAdvancedId(null)
      setError('')
    } catch (err) {
      setError(err?.message || 'Could not grab the last frame.')
    }
  }

  const cutToNext = (card, nextCard) => {
    updateCard(card.id, { status: 'accepted' })
    if (!nextCard) return
    setFocusId(nextCard.id)
    setOpenId(nextCard.id)
    setAdvancedId(null)
    rowRefs.current[nextCard.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const lastFrameIntoNext = async (card, nextCard, as = 'first') => {
    if (!nextCard) {
      setError('This is the last shot — add another card on Storyboard to continue.')
      return
    }
    try {
      const end = card.lastFrameAssetId
        ? { id: card.lastFrameAssetId }
        : await grabEndFrame(card)
      updateCard(card.id, { status: 'accepted', lastFrameAssetId: end.id })
      if (as === 'last') {
        updateCard(nextCard.id, { lastFrameAssetId: end.id, videoWorkflowId: DEFAULT_FLF_WORKFLOW })
      } else {
        updateCard(nextCard.id, { imageAssetId: end.id, sourceAssetId: end.id, videoWorkflowId: DEFAULT_VIDEO_WORKFLOW })
      }
      setFocusId(nextCard.id)
      setOpenId(nextCard.id)
      rowRefs.current[nextCard.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch (err) {
      setError(err?.message || 'Could not pass the last frame to the next shot.')
    }
  }

  useEffect(() => {
    const handler = (event) => {
      const cardId = event?.detail?.cardId
      if (!cardId) return
      setFocusId(cardId)
      setOpenId(cardId)
      window.setTimeout(() => {
        rowRefs.current[cardId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 40)
    }
    window.addEventListener('comfystudio-focus-sequence-card', handler)
    return () => window.removeEventListener('comfystudio-focus-sequence-card', handler)
  }, [])

  useEffect(() => {
    const done = [...monitorJobs]
      .filter((job) => job.status === 'done' && job.storyboardCardId)
      .sort((a, b) => (b.completedAt || b.createdAt || 0) - (a.completedAt || a.createdAt || 0))[0]
    if (!done?.storyboardCardId) return
    setFocusId(done.storyboardCardId)
    const card = board.cards.find((item) => item.id === done.storyboardCardId)
    const resultId = (done.resultAssetIds || []).find((id) => assets.some((asset) => asset.id === id && asset.type === 'video'))
    if (card && !card.videoAssetId && resultId) {
      const versions = Array.isArray(card.videoVersions) ? [...card.videoVersions] : []
      if (!versions.some((item) => item.assetId === resultId)) {
        versions.push({ assetId: resultId, createdAt: new Date().toISOString(), kind: 'sequence-clip' })
      }
      updateCard(card.id, {
        videoAssetId: resultId,
        videoVersions: versions,
        status: 'pending-review',
        hasGeneration: true,
      })
    }
    window.setTimeout(() => {
      rowRefs.current[done.storyboardCardId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
  }, [assets, board.cards, monitorJobs, updateCard])

  const rollup = useMemo(() => {
    const counts = { empty: 0, still: 0, review: 0, accepted: 0, generating: 0 }
    for (const card of board.cards) counts[shotClipStatus(card)] += 1
    return counts
  }, [board.cards])

  const acceptedReel = useMemo(
    () => board.cards.filter((card) => card.videoAssetId && card.status === 'accepted'),
    [board.cards]
  )

  const assembleAcceptedTimeline = async () => {
    if (acceptedReel.length === 0) {
      setError('Accept at least one clip before assembling the Sequence timeline.')
      return
    }
    const project = useProjectStore.getState().currentProject
    let timeline = (project?.timelines || []).find((item) => (
      item.id === 'timeline-sequence' || String(item.name || '').toLowerCase() === 'sequence'
    ))
    if (!timeline) timeline = createTimeline({ name: 'Sequence' })
    if (!timeline) {
      setError('Could not create a Sequence timeline.')
      return
    }
    await switchTimeline(timeline.id)
    const fps = currentProject?.settings?.fps || 24
    const empty = {
      ...timeline,
      clips: [],
      clipCounter: 1,
      tracks: [
        { id: 'video-1', name: 'Picture', type: 'video', muted: false, locked: false, visible: true },
        { id: 'audio-1', name: 'Dialogue / VO', type: 'audio', channels: 'stereo', muted: false, locked: false, visible: true },
        { id: 'audio-2', name: 'Music', type: 'audio', channels: 'stereo', muted: false, locked: false, visible: true },
      ],
    }
    useTimelineStore.getState().loadFromProject(empty, assets, fps)
    let cursor = 0
    for (const card of acceptedReel) {
      const video = assets.find((asset) => asset.id === card.videoAssetId)
      if (!video) continue
      const duration = Number(video.duration || video.settings?.duration || card.duration || 5)
      addClip('video-1', video, cursor, fps, {
        duration,
        saveHistory: false,
        metadata: { storyboardCardId: card.id, shotOrder: card.order },
      })
      if (card.audioAssetId) {
        const vo = assets.find((asset) => asset.id === card.audioAssetId)
        if (vo) addClip('audio-1', vo, cursor, fps, { saveHistory: false })
      }
      if (card.musicAssetId) {
        const music = assets.find((asset) => asset.id === card.musicAssetId)
        if (music) addClip('audio-2', music, cursor, fps, { saveHistory: false })
      }
      cursor += duration
    }
    window.dispatchEvent(new CustomEvent('comfystudio-reveal-asset'))
    await saveProject?.()
  }

  if (!currentProject) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-sf-text-muted">
        Open a project to work the sequence.
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-sf-dark-950">
      <div className="flex items-center justify-between px-5 py-3 border-b border-sf-dark-800">
        <div>
          <h1 className="text-sm font-semibold text-sf-text-primary">Sequence</h1>
          <p className="text-[11px] text-sf-text-muted">
            Play each take, approve or reject it, then cut / extend / pass the last frame into the next shot.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] ${comfyConnected ? 'text-emerald-400' : 'text-amber-300'}`}>
            {comfyConnected ? 'ComfyUI connected' : 'ComfyUI not connected yet'}
          </span>
          <button
            type="button"
            disabled={acceptedReel.length === 0}
            onClick={() => setReelIndex(0)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-md border border-sf-dark-600 text-sf-text-secondary hover:bg-sf-dark-800 disabled:opacity-40"
          >
            <Play className="w-3 h-3" />
            Play accepted ({acceptedReel.length})
          </button>
          <button
            type="button"
            disabled={acceptedReel.length === 0}
            onClick={() => { void assembleAcceptedTimeline() }}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-md border border-sf-dark-600 text-sf-text-secondary hover:bg-sf-dark-800 disabled:opacity-40"
          >
            Assemble on timeline
          </button>
          <button
            type="button"
            onClick={() => saveProject?.()}
            className="px-3 py-1.5 text-[11px] rounded-md border border-sf-dark-600 text-sf-text-secondary hover:bg-sf-dark-800"
          >
            Save
          </button>
        </div>
      </div>
      <div className="px-5 py-2 border-b border-sf-dark-800 flex flex-wrap items-center gap-2">
        <span className="text-[10px] text-sf-text-muted">
          {rollup.accepted} accepted · {rollup.review} to review · {rollup.generating} generating · {rollup.still + rollup.empty} need a clip
        </span>
        <div className="flex flex-wrap gap-1">
          {board.cards.map((card) => {
            const status = shotClipStatus(card)
            const tone = status === 'accepted'
              ? 'bg-emerald-500'
              : status === 'review'
                ? 'bg-amber-400'
                : status === 'generating'
                  ? 'bg-sky-400 animate-pulse'
                  : status === 'still'
                    ? 'bg-sf-dark-500'
                    : 'bg-sf-dark-700'
            return (
              <button
                key={card.id}
                type="button"
                title={`${card.order}. ${card.title} (${status})`}
                onClick={() => {
                  setFocusId(card.id)
                  rowRefs.current[card.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }}
                className={`h-2.5 min-w-[1.25rem] rounded-sm ${tone} ${focusId === card.id ? 'ring-1 ring-white' : ''}`}
              />
            )
          })}
        </div>
      </div>
      <div className="px-5 py-2 border-b border-sf-dark-800 space-y-2">
        <OutputRatioBar
          settings={currentProject?.settings || {}}
          onChange={(next) => {
            updateProjectSettings(next)
            const production = useProjectStore.getState().getProduction?.()
            if (production) {
              useProjectStore.getState().setProduction?.({
                ...production,
                format: { ...production.format, outputTarget: next.outputTarget, aspect: next.aspectRatio },
              })
            }
          }}
        />
        <CutBar />
        <ProjectLookBar
          value={projectLook}
          onChange={(look) => updateProjectSettings({ cinematography: look })}
        />
      </div>
      <div className="flex-1 overflow-auto p-5 space-y-3">
        {error && <p className="text-sm text-red-400">{error}</p>}
        {board.cards.length === 0 ? (
          <p className="text-sm text-sf-text-muted">Add and order cards in Storyboard first.</p>
        ) : board.cards.map((card, index) => {
          const next = board.cards[index + 1]
          const workflow = findVideoWorkflow(card.videoWorkflowId || DEFAULT_VIDEO_WORKFLOW)
          const needs = workflow.needs || []
          const flf = isFlfWorkflow(workflow.id)
          const panelOpen = openId === card.id
          const pickerFor = (slot) => mediaPicker?.cardId === card.id && mediaPicker?.slot === slot
          const lastId = card.lastFrameAssetId || next?.imageAssetId || null
          const job = jobForCard(card.id)
          const clipUrl = mediaUrl(card.videoAssetId)
          const clipStatus = shotClipStatus(card)
          const needsReview = Boolean(card.videoAssetId) && card.status !== 'accepted' && card.status !== 'generating'
          const promptPreview = composeGenerationPrompt(card)
          const included = [
            { label: 'Workflow', value: workflow.label },
            { label: 'Duration', value: `${card.duration || 5}s` },
            { label: 'This frame', value: assetName(card.imageAssetId) || 'missing' },
            flf ? { label: 'Last frame', value: assetName(lastId) || 'missing' } : null,
            card.dialogue?.trim() ? { label: 'Dialogue', value: card.dialogue.trim() } : null,
            card.action?.trim() ? { label: 'Action', value: card.action.trim() } : null,
            { label: 'Characters', value: (card.characterRefs || []).length ? (card.characterRefs || []).map((item) => item.name).join(', ') : 'none' },
            { label: 'Location', value: card.locationRef?.name || (card.sceneRefs || [])[0]?.name || 'none' },
            (card.propRefs || []).length ? { label: 'Props', value: (card.propRefs || []).map((item) => item.name).join(', ') } : null,
            card.motionSlug ? { label: 'Motion', value: findMotion(card.motionSlug, motionCatalog)?.title || card.motionSlug } : null,
            { label: 'Camera', value: assembleLexiconLabels(card.shotSettings, modeFromWorkflow(card.videoWorkflowId || DEFAULT_VIDEO_WORKFLOW, 'video'), projectLook) || 'project look / unset' },
          ].filter(Boolean)
          return (
            <div
              key={card.id}
              ref={(node) => { rowRefs.current[card.id] = node }}
              className={`rounded-xl border bg-sf-dark-900 p-3 flex gap-3 ${
                focusId === card.id ? 'border-sf-accent' : 'border-sf-dark-700'
              }`}
            >
              <div className={`${flf ? 'w-24' : 'w-32'} aspect-[9/16] rounded bg-sf-dark-800 overflow-hidden flex-shrink-0 relative`}>
                {frameUrl(card.imageAssetId) ? (
                  <img src={frameUrl(card.imageAssetId)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] text-sf-text-muted px-1 text-center">No frame</div>
                )}
                <span className="absolute top-1 right-1 min-w-[1.25rem] h-5 px-1 rounded bg-black/75 text-white text-[10px] font-semibold flex items-center justify-center">
                  {card.order || index + 1}
                </span>
                <span className={`absolute bottom-1 left-1 right-1 text-center text-[9px] rounded px-1 py-0.5 ${
                  clipStatus === 'accepted' ? 'bg-emerald-600/80 text-white'
                    : clipStatus === 'review' ? 'bg-amber-500/80 text-black'
                      : clipStatus === 'generating' ? 'bg-sky-500/80 text-white'
                        : 'bg-black/70 text-white/80'
                }`}>
                  {clipStatus === 'accepted' ? 'accepted' : clipStatus === 'review' ? 'review' : clipStatus === 'generating' ? 'generating' : clipStatus === 'still' ? 'still only' : 'no clip'}
                </span>
                {job && job.status !== 'done' && job.status !== 'error' && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-sf-accent" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium text-sf-text-primary truncate">
                    {card.order || index + 1}. {card.title}
                  </div>
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new CustomEvent('comfystudio-open-storyboard-tab', { detail: { cardId: card.id } }))}
                    className="text-[10px] text-sf-accent hover:underline flex-shrink-0"
                  >
                    Storyboard
                  </button>
                </div>
                <p className="text-[11px] text-sf-text-secondary whitespace-pre-wrap">
                  {card.description || 'No scenery description yet — write it on Storyboard or here in Sequence.'}
                </p>
                {clipUrl && (
                  <div className="rounded-md overflow-hidden bg-black max-w-sm">
                    <video
                      key={card.videoAssetId}
                      src={clipUrl}
                      controls
                      playsInline
                      className="w-full max-h-64 object-contain bg-black"
                    />
                  </div>
                )}
                {(card.videoVersions || []).length > 1 && (
                  <div className="flex flex-wrap gap-1">
                    {(card.videoVersions || []).map((version, versionIndex) => (
                      <button
                        key={`${version.assetId}-${versionIndex}`}
                        type="button"
                        onClick={() => selectVersion(card, version.assetId)}
                        className={`px-1.5 py-0.5 rounded text-[10px] border ${
                          version.assetId === card.videoAssetId
                            ? 'border-sf-accent bg-sf-accent/15 text-sf-text-primary'
                            : 'border-sf-dark-600 text-sf-text-muted'
                        }`}
                      >
                        v{versionIndex + 1}
                      </button>
                    ))}
                  </div>
                )}
                {needsReview && (
                  <div className="rounded-md border border-amber-400/40 bg-amber-400/10 p-2 space-y-2">
                    <div className="text-[11px] font-medium text-amber-100">Review this take</div>
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" onClick={() => acceptClip(card)} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600/80 hover:bg-emerald-600 text-white text-[11px]">
                        <Check className="w-3 h-3" /> Accept as this shot
                      </button>
                      <button type="button" onClick={() => rejectClip(card)} className="px-2 py-1 rounded bg-sf-dark-700 text-[11px] text-sf-text-primary">
                        Reject
                      </button>
                      <button type="button" onClick={() => { setOpenId(card.id); submitVideo(card, next) }} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-sf-accent/80 text-white text-[11px]">
                        <RefreshCw className="w-3 h-3" /> Regen
                      </button>
                    </div>
                  </div>
                )}
                {card.status === 'accepted' && card.videoAssetId && (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 space-y-1.5">
                    <div className="text-[11px] font-medium text-emerald-200">This shot is locked. Next:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {next && (
                        <button type="button" onClick={() => cutToNext(card, next)} className="px-2 py-1 rounded bg-sf-dark-800 border border-sf-dark-600 text-[11px] text-sf-text-primary">
                          Cut → generate shot {next.order}
                        </button>
                      )}
                      <button type="button" onClick={() => extendFromEnd(card)} className="px-2 py-1 rounded bg-sf-dark-800 border border-sf-dark-600 text-[11px] text-sf-text-primary">
                        Extend from last frame
                      </button>
                      {next && (
                        <button type="button" onClick={() => lastFrameIntoNext(card, next, 'first')} className="px-2 py-1 rounded bg-sf-dark-800 border border-sf-dark-600 text-[11px] text-sf-text-primary">
                          Last frame → shot {next.order} start
                        </button>
                      )}
                      {next && (
                        <button type="button" onClick={() => lastFrameIntoNext(card, next, 'last')} className="px-2 py-1 rounded bg-sf-dark-800 border border-sf-dark-600 text-[11px] text-sf-text-primary">
                          Last frame → shot {next.order} FLF
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {job && (
                  <div className={`rounded-md border px-2.5 py-2 text-[11px] ${
                    job.status === 'error'
                      ? 'border-red-500/40 bg-red-500/10 text-red-200'
                      : job.status === 'done'
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                        : 'border-amber-400/40 bg-amber-400/10 text-amber-100'
                  }`}
                  >
                    <div className="flex items-center gap-2 font-medium">
                      {job.status === 'error' ? <AlertCircle className="w-3.5 h-3.5" /> : null}
                      {job.status === 'done' ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}
                      {job.status !== 'error' && job.status !== 'done' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      {statusLabel(job.status)}
                      {job.workflowLabel ? <span className="font-normal opacity-80">· {job.workflowLabel}</span> : null}
                    </div>
                    {job.status !== 'error' && job.status !== 'done' && (
                      <div className="mt-1.5 h-1.5 rounded bg-black/30 overflow-hidden">
                        <div className="h-full bg-sf-accent" style={{ width: `${Math.max(8, job.progress || 0)}%` }} />
                      </div>
                    )}
                    {job.error && <p className="mt-1.5 whitespace-pre-wrap">{job.error}</p>}
                    {job.status !== 'error' && job.status !== 'done' && (
                      <p className="mt-1 opacity-80">Stay on this page. The job is running in ComfyUI.</p>
                    )}
                    {job.status === 'done' && (card.videoVersions || []).length > 0 && (
                      <p className="mt-1 opacity-80">{card.videoVersions.length} version{card.videoVersions.length === 1 ? '' : 's'} saved to this shot.</p>
                    )}
                  </div>
                )}
                {!job && (card.videoVersions || []).length > 0 && (
                  <p className="text-[10px] text-sf-text-muted">{card.videoVersions.length} generated clip version{card.videoVersions.length === 1 ? '' : 's'} in the Video folder.</p>
                )}

                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">Dialogue</span>
                    <textarea
                      value={card.dialogue || ''}
                      onChange={(event) => updateCard(card.id, { dialogue: event.target.value })}
                      placeholder="Spoken line for this shot…"
                      rows={2}
                      className="w-full resize-none bg-sf-dark-800 border border-sf-dark-700 rounded-md px-2 py-1.5 text-[11px] text-sf-text-primary placeholder:text-sf-text-muted outline-none"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">Action / camera / character</span>
                    <textarea
                      value={card.action || ''}
                      onChange={(event) => updateCard(card.id, { action: event.target.value })}
                      placeholder="What happens as this frame continues…"
                      rows={2}
                      className="w-full resize-none bg-sf-dark-800 border border-sf-dark-700 rounded-md px-2 py-1.5 text-[11px] text-sf-text-primary placeholder:text-sf-text-muted outline-none"
                    />
                  </label>
                  <label className="block space-y-1 sm:col-span-2">
                    <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">Sound notes (foley / bed / room)</span>
                    <textarea
                      value={card.soundNotes || ''}
                      onChange={(event) => updateCard(card.id, { soundNotes: event.target.value })}
                      placeholder="Pier crowd, cotton-candy motor, punch impact, no music under dialogue…"
                      rows={2}
                      className="w-full resize-none bg-sf-dark-800 border border-sf-dark-700 rounded-md px-2 py-1.5 text-[11px] text-sf-text-primary placeholder:text-sf-text-muted outline-none"
                    />
                  </label>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">Dialogue / VO clip</span>
                      <button type="button" onClick={() => togglePicker(card.id, 'audio')} className="text-[10px] text-sf-accent hover:underline">
                        {card.audioAssetId ? 'Change' : 'Assign'}
                      </button>
                    </div>
                    <p className="text-[11px] text-sf-text-secondary">{assetName(card.audioAssetId) || 'None — attach the spoken line when you have it'}</p>
                    {pickerFor('audio') && (
                      <AssetPicker
                        assets={audioAssets}
                        type="audio"
                        accept="audio/*"
                        empty="No audio clips yet."
                        onPick={(asset) => applyPickedAsset(card.id, 'audio', asset)}
                      />
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">Music bed</span>
                      <button type="button" onClick={() => togglePicker(card.id, 'music')} className="text-[10px] text-sf-accent hover:underline">
                        {card.musicAssetId ? 'Change' : 'Assign'}
                      </button>
                    </div>
                    <p className="text-[11px] text-sf-text-secondary">{assetName(card.musicAssetId) || 'Optional underscore for this shot'}</p>
                    {pickerFor('music') && (
                      <AssetPicker
                        assets={audioAssets}
                        type="audio"
                        accept="audio/*"
                        empty="No audio clips yet."
                        onPick={(asset) => applyPickedAsset(card.id, 'music', asset)}
                      />
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => togglePicker(card.id, 'clip')}
                    className="px-2.5 py-1.5 rounded-md bg-sf-dark-800 border border-sf-dark-600 text-[11px] text-sf-text-primary hover:border-sf-accent"
                  >
                    {card.videoAssetId ? 'Replace clip' : 'Assign clip'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      updateCard(card.id, { videoWorkflowId: DEFAULT_VIDEO_WORKFLOW })
                      setOpenId(card.id)
                      setAdvancedId(null)
                      setError('')
                    }}
                    className="px-2.5 py-1.5 rounded-md bg-sf-dark-800 border border-sf-dark-600 text-[11px] text-sf-text-primary hover:border-sf-accent"
                  >
                    Extend this frame
                  </button>
                  {next && (
                    <button
                      type="button"
                      onClick={() => {
                        updateCard(card.id, {
                          videoWorkflowId: DEFAULT_FLF_WORKFLOW,
                          lastFrameAssetId: card.lastFrameAssetId || next.imageAssetId || null,
                        })
                        setOpenId(card.id)
                        setAdvancedId(null)
                        setError('')
                      }}
                      className="px-2.5 py-1.5 rounded-md bg-sf-accent/80 hover:bg-sf-accent text-white text-[11px]"
                    >
                      First/last → shot {next.order}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setOpenId(panelOpen ? null : card.id)
                      setAdvancedId(panelOpen ? null : card.id)
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-sf-dark-600 text-[11px] text-sf-text-secondary hover:text-sf-text-primary"
                  >
                    More flows
                    <ChevronDown className={`w-3 h-3 transition-transform ${panelOpen ? 'rotate-180' : ''}`} />
                  </button>
                </div>
                {pickerFor('clip') && (
                  <AssetPicker
                    assets={videoAssets}
                    value={card.videoAssetId}
                    type="video"
                    accept="video/*"
                    preferredFolderNames={['Video', 'Generated', 'Pool']}
                    empty="No video clips in this project yet."
                    onPick={(asset) => applyPickedAsset(card.id, 'clip', asset)}
                  />
                )}

                {panelOpen && (
                  <div className="rounded-md border border-sf-dark-600 bg-sf-dark-950 p-2 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium text-sf-text-primary">
                          {videoWorkflowKind(workflow) === 'flf' ? 'First / last' : videoWorkflowKind(workflow) === 'audio' ? 'Dialogue clip' : 'Extend'}
                          <span className="font-normal text-sf-text-muted"> · {workflow.label}</span>
                        </div>
                        <p className="text-[10px] text-sf-text-muted">{workflow.description}</p>
                      </div>
                      <label className="flex items-center gap-1 text-[11px] text-sf-text-secondary flex-shrink-0">
                        <span>Duration</span>
                        <input
                          type="number"
                          min="2"
                          max="15"
                          value={card.duration || 5}
                          onChange={(event) => updateCard(card.id, { duration: Number(event.target.value) || 5 })}
                          className="w-14 bg-sf-dark-800 border border-sf-dark-600 rounded px-1.5 py-1 text-[11px] text-sf-text-primary"
                        />
                        <span>s</span>
                      </label>
                    </div>

                    {needs.includes('first') && (
                      <p className="text-[11px] text-sf-text-secondary">
                        Starting frame: {assetName(card.imageAssetId) || 'add a still on Storyboard first'}
                      </p>
                    )}
                    {flf && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">Last frame</span>
                          <button type="button" onClick={() => togglePicker(card.id, 'last')} className="text-[10px] text-sf-accent hover:underline">
                            {lastId ? 'Change' : 'Select'}
                          </button>
                        </div>
                        <p className="text-[11px] text-sf-text-secondary">
                          {assetName(lastId) || 'Pick an image or use the next shot'}
                        </p>
                        {pickerFor('last') && (
                          <AssetPicker
                            assets={imageAssets}
                            value={lastId}
                            preferredFolderNames={['Keyframes', 'Storyboard', 'Cast']}
                            empty="No images in this project yet."
                            onPick={(asset) => applyPickedAsset(card.id, 'last', asset)}
                          />
                        )}
                      </div>
                    )}
                    {needs.includes('audio') && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">Dialogue / VO audio *</span>
                          <button type="button" onClick={() => togglePicker(card.id, 'audio')} className="text-[10px] text-sf-accent hover:underline">
                            {card.audioAssetId ? 'Change' : 'Select'}
                          </button>
                        </div>
                        <p className="text-[11px] text-sf-text-secondary">{assetName(card.audioAssetId) || 'Required'}</p>
                        {pickerFor('audio') && (
                          <AssetPicker
                            assets={audioAssets}
                            type="audio"
                            accept="audio/*"
                            empty="No audio clips yet."
                            onPick={(asset) => applyPickedAsset(card.id, 'audio', asset)}
                          />
                        )}
                      </div>
                    )}

                    <ShotParamsPanel
                      mode={modeFromWorkflow(card.videoWorkflowId || DEFAULT_VIDEO_WORKFLOW, 'video')}
                      projectLook={projectLook}
                      value={card.shotSettings}
                      onChange={(shotSettings) => updateCard(card.id, { shotSettings })}
                      sections="movement"
                      featuredMovement
                      compact
                      showNotes={false}
                      showSummary={false}
                    />

                    <button
                      type="button"
                      disabled={submittingId === card.id}
                      onClick={() => submitVideo(card, next)}
                      className="inline-flex items-center justify-center gap-1.5 w-full px-2 py-1.5 rounded-md bg-sf-accent text-white text-[11px] disabled:opacity-50"
                    >
                      {submittingId === card.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      {submittingId === card.id ? 'Starting…' : `Generate ${flf ? 'first/last' : 'extend'} here`}
                    </button>

                    <details
                      className="rounded border border-sf-dark-700 bg-black/20 px-2 py-1.5"
                      open={advancedId === card.id}
                      onToggle={(event) => setAdvancedId(event.currentTarget.open ? card.id : null)}
                    >
                      <summary className="cursor-pointer text-[11px] text-sf-text-secondary">
                        Advanced options
                        <span className="ml-2 text-[10px] text-sf-text-muted">workflow, cast, look, motion</span>
                      </summary>
                      <div className="mt-2 space-y-2">
                        <label className="block space-y-1">
                          <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">Video workflow</span>
                          <select
                            value={workflow.id}
                            onChange={(event) => updateCard(card.id, { videoWorkflowId: event.target.value })}
                            className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5 text-[11px] text-sf-text-primary"
                          >
                            {Object.entries(workflowGroups).map(([kind, items]) => (
                              items.length > 0 ? (
                                <optgroup key={kind} label={VIDEO_WORKFLOW_GROUP_LABELS[kind] || kind}>
                                  {items.map((item) => (
                                    <option key={item.id} value={item.id}>{item.label}</option>
                                  ))}
                                </optgroup>
                              ) : null
                            ))}
                          </select>
                        </label>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">Location (one)</span>
                            <button type="button" onClick={() => togglePicker(card.id, 'location')} className="text-[10px] text-sf-accent hover:underline">
                              {card.locationRef ? 'Change' : 'Select'}
                            </button>
                          </div>
                          {card.locationRef ? (
                            <RefChips items={[card.locationRef]} onRemove={() => updateCard(card.id, { locationRef: null, sceneRefs: [] })} />
                          ) : (
                            <span className="text-[10px] text-amber-300">No location — 1:1 with this shot</span>
                          )}
                          {pickerFor('location') && (
                            <AssetPicker
                              assets={sortAssetsForRole(imageAssets, folders, 'scene')}
                              preferredFolderNames={['Plates']}
                              empty="No location plates yet."
                              onPick={(asset) => applyPickedAsset(card.id, 'location', asset)}
                            />
                          )}
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">Characters (0–N)</span>
                            <button type="button" onClick={() => togglePicker(card.id, 'character')} className="text-[10px] text-sf-accent hover:underline">Add</button>
                          </div>
                          <RefChips
                            items={card.characterRefs}
                            onRemove={(assetId) => updateCard(card.id, {
                              characterRefs: (card.characterRefs || []).filter((item) => item.assetId !== assetId),
                            })}
                          />
                          {pickerFor('character') && (
                            <AssetPicker
                              assets={sortAssetsForRole(imageAssets, folders, 'character')}
                              preferredFolderNames={['Cast']}
                              empty="No cast images yet."
                              onPick={(asset) => applyPickedAsset(card.id, 'character', asset)}
                            />
                          )}
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">Props</span>
                            <button type="button" onClick={() => togglePicker(card.id, 'prop')} className="text-[10px] text-sf-accent hover:underline">Add</button>
                          </div>
                          <RefChips
                            items={card.propRefs}
                            onRemove={(assetId) => updateCard(card.id, {
                              propRefs: (card.propRefs || []).filter((item) => item.assetId !== assetId),
                            })}
                          />
                          {pickerFor('prop') && (
                            <AssetPicker
                              assets={sortAssetsForRole(imageAssets, folders, 'prop')}
                              preferredFolderNames={['Other', 'Pool']}
                              empty="No prop images yet."
                              onPick={(asset) => applyPickedAsset(card.id, 'prop', asset)}
                            />
                          )}
                        </div>
                        <ShotParamsPanel
                          mode={modeFromWorkflow(card.videoWorkflowId || DEFAULT_VIDEO_WORKFLOW, 'video')}
                          projectLook={projectLook}
                          value={card.shotSettings}
                          onChange={(shotSettings) => updateCard(card.id, { shotSettings })}
                          sections="geometry"
                          compact
                          showNotes={false}
                        />
                        <ShotParamsPanel
                          mode={modeFromWorkflow(card.videoWorkflowId || DEFAULT_VIDEO_WORKFLOW, 'video')}
                          projectLook={projectLook}
                          value={card.shotSettings}
                          onChange={(shotSettings) => updateCard(card.id, { shotSettings })}
                          sections="look"
                          compact
                        />
                        <div className="space-y-1">
                          <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">Motion / pose</span>
                          <MotionPicker
                            value={card.motionSlug || ''}
                            onChange={(slug) => updateCard(card.id, { motionSlug: slug })}
                          />
                        </div>
                        <div className="rounded-md border border-sf-dark-600 bg-black/20 p-2 space-y-1">
                          <div className="text-[10px] uppercase tracking-wide text-sf-text-muted">Included on submit</div>
                          {included.map((item) => (
                            <div key={item.label} className="flex gap-2 text-[11px]">
                              <span className="text-sf-text-muted w-20 flex-shrink-0">{item.label}</span>
                              <span className="text-sf-text-primary break-words">{item.value}</span>
                            </div>
                          ))}
                          {promptPreview ? (
                            <p className="text-[11px] text-sf-text-secondary whitespace-pre-wrap pt-1 border-t border-sf-dark-700">
                              {promptPreview}
                            </p>
                          ) : (
                            <p className="text-[11px] text-amber-200">No prompt yet — write action or dialogue above, or a description on Storyboard.</p>
                          )}
                        </div>
                      </div>
                    </details>
                  </div>
                )}
              </div>
              {flf && (
                <div className="w-24 aspect-[9/16] rounded bg-sf-dark-800 overflow-hidden flex-shrink-0 relative">
                  {frameUrl(lastId) ? (
                    <img src={frameUrl(lastId)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] text-sf-text-muted px-1 text-center">Last</div>
                  )}
                  <span className="absolute bottom-1 left-1 right-1 text-center text-[9px] text-white/80">Last</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {reelIndex != null && acceptedReel[reelIndex] && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6" onClick={() => setReelIndex(null)}>
          <div className="max-w-md w-full space-y-2" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between text-[11px] text-white">
              <span>{acceptedReel[reelIndex].order}. {acceptedReel[reelIndex].title}</span>
              <button type="button" onClick={() => setReelIndex(null)} className="text-white/70 hover:text-white">Close</button>
            </div>
            <video
              key={acceptedReel[reelIndex].videoAssetId}
              src={mediaUrl(acceptedReel[reelIndex].videoAssetId)}
              controls
              autoPlay
              className="w-full max-h-[70vh] bg-black rounded"
              onEnded={() => {
                if (reelIndex + 1 < acceptedReel.length) setReelIndex(reelIndex + 1)
              }}
            />
            <div className="flex justify-between text-[11px] text-white/80">
              <button type="button" disabled={reelIndex === 0} onClick={() => setReelIndex((value) => Math.max(0, value - 1))}>Prev</button>
              <span>{reelIndex + 1} / {acceptedReel.length}</span>
              <button type="button" disabled={reelIndex >= acceptedReel.length - 1} onClick={() => setReelIndex((value) => value + 1)}>Next</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
