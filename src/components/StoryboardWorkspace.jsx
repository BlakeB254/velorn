import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, GripVertical, ImageOff, ImagePlus, Loader2, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import useProjectStore from '../stores/projectStore'
import useAssetsStore from '../stores/assetsStore'
import useGenerationMonitorStore from '../stores/generationMonitorStore'
import { getProjectFileUrl, importAsset } from '../services/fileSystem'
import { ensureGenerateWorkspace } from '../services/ensureGenerateWorkspace'
import { getComfyNativeTemplate } from '../config/comfyNativeTemplates'
import { setPendingMaskDataUrl } from '../services/comfyTemplateRunner'
import InpaintEditor from './storyboard/InpaintEditor'
import MotionPicker from './storyboard/MotionPicker'
import ShotParamsPanel from './storyboard/ShotParamsPanel'
import ProjectLookBar from './storyboard/ProjectLookBar'
import { findMotion, loadMotionCatalog, motionPosePrompt, POSE_STILL_WORKFLOW } from '../services/motionLibrary'
import { modeFromWorkflow, normalizeProjectLook } from '../services/shotSettings'
import { generateResolution } from '../services/outputRatio'
import OutputRatioBar from './storyboard/OutputRatioBar'
import CutBar from './storyboard/CutBar'
import { normalizeStudio } from '../services/studioStore'
import { cardSlotView } from '../services/studioUi'
import StageRail from './studio/StageRail'
import CastPanel from './studio/CastPanel'
import BlockingPanel from './studio/BlockingPanel'
import {
  AssetPicker,
  DEFAULT_FRAME_WORKFLOW,
  FRAME_WORKFLOWS,
  RefChips,
  composeGenerationPrompt,
  directorRefsForCard,
  emptyBoard,
  findFrameWorkflow,
  frameWorkflowSlots,
  isGeneratingStatus,
  isReviewStatus,
  newCard,
  numberCards,
  primaryRefIds,
  seedFromProject,
  sortAssetsForRole,
} from './storyboard/boardShared'

function statusTone(status) {
  if (status === 'accepted') return 'border-emerald-500/70 bg-emerald-500/10 text-emerald-300'
  if (status === 'rejected') return 'border-red-500/60 bg-red-500/10 text-red-300'
  if (status === 'generating') return 'border-amber-400/70 bg-amber-400/10 text-amber-200'
  return 'border-sf-dark-600 bg-sf-dark-800 text-sf-text-muted'
}

export default function StoryboardWorkspace() {
  const currentProject = useProjectStore((state) => state.currentProject)
  const currentProjectHandle = useProjectStore((state) => state.currentProjectHandle)
  const setStoryboardBoard = useProjectStore((state) => state.setStoryboardBoard)
  const updateProjectSettings = useProjectStore((state) => state.updateProjectSettings)
  const saveProject = useProjectStore((state) => state.saveProject)
  const getStudio = useProjectStore((state) => state.getStudio)
  const getProduction = useProjectStore((state) => state.getProduction)
  const assets = useAssetsStore((state) => state.assets)
  const folders = useAssetsStore((state) => state.folders)
  const addAsset = useAssetsStore((state) => state.addAsset)
  const monitorJobs = useGenerationMonitorStore((state) => state.jobs)

  const [generateCardId, setGenerateCardId] = useState(null)
  const [motionCatalog, setMotionCatalog] = useState({ items: [] })
  const [mediaPicker, setMediaPicker] = useState(null)
  const [generateError, setGenerateError] = useState('')
  const [editingDescription, setEditingDescription] = useState(null)
  const [dragId, setDragId] = useState(null)
  const [imageUrls, setImageUrls] = useState({})
  const [editCardId, setEditCardId] = useState(null)
  const [blockingCardId, setBlockingCardId] = useState(null)
  const cardRefs = useRef({})
  const studio = useMemo(() => normalizeStudio(currentProject?.studio || getStudio?.()), [currentProject, getStudio])
  const production = useMemo(() => getProduction?.() || currentProject?.production || null, [currentProject, getProduction])

  const board = useMemo(
    () => (currentProject ? seedFromProject(currentProject) : emptyBoard()),
    [currentProject]
  )

  useEffect(() => {
    loadMotionCatalog().then(setMotionCatalog)
  }, [])

  useEffect(() => {
    const handler = (event) => {
      const cardId = event?.detail?.cardId
      if (!cardId) return
      window.setTimeout(() => {
        cardRefs.current[cardId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 40)
    }
    window.addEventListener('comfystudio-focus-storyboard-card', handler)
    return () => window.removeEventListener('comfystudio-focus-storyboard-card', handler)
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
        const asset = assets.find((item) => item.id === card.imageAssetId)
        const path = asset?.path || asset?.absolutePath
        if (!path) continue
        try {
          const url = asset.url && !String(asset.url).startsWith('blob:')
            ? asset.url
            : await getProjectFileUrl(currentProjectHandle, path)
          if (!cancelled && url) next[card.id] = url
        } catch (_) { /* ignore */ }
      }
      if (!cancelled) {
        setImageUrls((prev) => ({ ...prev, ...next }))
      }
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

  const addCard = useCallback(() => {
    persist({
      ...board,
      cards: [...board.cards, newCard(board.cards.length + 1)],
    })
    setEditingDescription(null)
  }, [board, persist])

  const removeCard = useCallback((cardId) => {
    persist({
      ...board,
      cards: board.cards.filter((card) => card.id !== cardId),
    })
  }, [board, persist])

  const moveCard = useCallback((fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return
    const cards = [...board.cards]
    const fromIndex = cards.findIndex((card) => card.id === fromId)
    const toIndex = cards.findIndex((card) => card.id === toId)
    if (fromIndex < 0 || toIndex < 0) return
    const [moved] = cards.splice(fromIndex, 1)
    cards.splice(toIndex, 0, moved)
    persist({ ...board, cards })
  }, [board, persist])

  const imageAssets = useMemo(
    () => (assets || []).filter((asset) => asset.type === 'image'),
    [assets]
  )

  const assetName = useCallback((assetId) => {
    if (!assetId) return ''
    return assets.find((item) => item.id === assetId)?.name || assetId
  }, [assets])

  const jobForCard = (cardId) => (
    [...monitorJobs]
      .filter((job) => job.storyboardCardId === cardId)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null
  )

  const buildVelornMeta = (card, placement) => {
    const refs = directorRefsForCard(currentProject, card)
    return {
      placement,
      cardId: card.id,
      cardTitle: card.title || '',
      cardOrder: card.order || null,
      motionSlug: card.motionSlug || '',
      characters: refs.characters,
      location: refs.location,
    }
  }

  const toggleMediaPicker = (cardId, slot) => {
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
    if (slot === 'frame') updateCard(cardId, { imageAssetId: asset.id })
    else if (slot === 'source') updateCard(cardId, { sourceAssetId: asset.id })
    else if (slot === 'ref1') updateCard(cardId, { refAssetId1: asset.id })
    else if (slot === 'ref2') updateCard(cardId, { refAssetId2: asset.id })
    else if (slot === 'character') updateCard(cardId, { characterRefs: addRef(card, 'characterRefs', asset) })
    else if (slot === 'location') updateCard(cardId, { locationRef: { assetId: asset.id, name: asset.name }, sceneRefs: [{ assetId: asset.id, name: asset.name }] })
    else if (slot === 'scene') updateCard(cardId, { locationRef: { assetId: asset.id, name: asset.name }, sceneRefs: [{ assetId: asset.id, name: asset.name }] })
    else if (slot === 'prop') updateCard(cardId, { propRefs: addRef(card, 'propRefs', asset) })
    setMediaPicker(null)
  }

  const removeImage = (cardId) => {
    updateCard(cardId, { imageAssetId: null })
    setImageUrls((prev) => {
      const next = { ...prev }
      delete next[cardId]
      return next
    })
    setMediaPicker((current) => (current?.cardId === cardId && current?.slot === 'frame' ? null : current))
  }

  const openGeneratePanel = (card) => {
    const workflow = findFrameWorkflow(card.workflowId)
    const patch = {}
    if (!card.workflowId) patch.workflowId = workflow.id
    if (workflow.needsImage && !card.sourceAssetId && card.imageAssetId) {
      patch.sourceAssetId = card.imageAssetId
    }
    if (Object.keys(patch).length) updateCard(card.id, patch)
    setGenerateError('')
    setGenerateCardId((current) => (current === card.id ? null : card.id))
    setMediaPicker(null)
  }

  const submitGenerate = async (card) => {
    const motion = findMotion(card.motionSlug, motionCatalog)
    const workflow = findFrameWorkflow(card.workflowId)
    const prompt = composeGenerationPrompt(card, {
      motionTitle: motion?.title || '',
      mode: modeFromWorkflow(workflow.id, 'still'),
      projectLook,
    })
    const sourceId = card.sourceAssetId || card.imageAssetId || null
    if (workflow.needsImage && !sourceId) {
      setGenerateError('This workflow needs a source or reference image.')
      return
    }
    const refs = primaryRefIds(card)
    updateCard(card.id, {
      status: 'generating',
      hasGeneration: true,
      lastGenerationError: '',
      workflowId: workflow.id,
      prompt: card.prompt || prompt,
      sourceAssetId: sourceId,
    })
    setGenerateCardId(null)
    setGenerateError('')
    try {
      await ensureGenerateWorkspace()
      window.dispatchEvent(new CustomEvent('comfystudio-mcp-prepare-generation', {
        detail: {
          workflowId: workflow.id,
          category: getComfyNativeTemplate(workflow.id)?.category || 'image',
          prompt,
          selectedAssetId: workflow.needsImage ? sourceId : (refs.first || null),
          referenceAssetId1: refs.first || card.refAssetId1 || null,
          referenceAssetId2: refs.second || card.refAssetId2 || null,
          selectedAssetFieldIds: {
            ...(workflow.needsImage && sourceId ? { image: sourceId } : {}),
            ...(refs.first ? { referenceImage1: refs.first } : {}),
            ...(refs.second ? { referenceImage2: refs.second } : {}),
          },
          storyboardCardId: card.id,
          resolution: generateResolution(currentProject, card),
          placement: 'storyboard-frame',
          velornMeta: buildVelornMeta(card, 'storyboard-frame'),
          autoQueue: true,
        },
      }))
    } catch (error) {
      setGenerateError(error?.message || 'Could not start the generation.')
      updateCard(card.id, { status: 'draft' })
    }
  }

  const submitPoseStill = async (card) => {
    const motion = findMotion(card.motionSlug, motionCatalog)
    if (!motion?.files?.pose) {
      setGenerateError('Pick a motion first. The starting frame is compiled from that pose still plus a character ref.')
      return
    }
    const characterId = card.characterRefs?.[0]?.assetId || card.sourceAssetId || card.imageAssetId || null
    if (!characterId) {
      setGenerateError('Add a character reference (or a source still) so identity comes from a photo, not the pose silhouette.')
      return
    }
    if (!currentProjectHandle) {
      setGenerateError('Open a project folder before importing the pose still.')
      return
    }
    setGenerateError('')
    try {
      const imported = await importAsset(currentProjectHandle, motion.files.pose, 'images')
      const poseAsset = addAsset({
        ...imported,
        name: `pose-${motion.slug}`,
        type: 'image',
      })
      const prompt = [
        composeGenerationPrompt(card, { motionTitle: motion.title, mode: 'still', projectLook }),
        motionPosePrompt(motion),
      ].filter(Boolean).join('\n')
      updateCard(card.id, {
        status: 'generating',
        hasGeneration: true,
        lastGenerationError: '',
        workflowId: POSE_STILL_WORKFLOW,
        prompt,
        sourceAssetId: characterId,
        refAssetId1: poseAsset?.id || card.refAssetId1,
        motionSlug: motion.slug,
      })
      setGenerateCardId(null)
      await ensureGenerateWorkspace()
      window.dispatchEvent(new CustomEvent('comfystudio-mcp-prepare-generation', {
        detail: {
          workflowId: POSE_STILL_WORKFLOW,
          category: 'image',
          prompt,
          selectedAssetId: characterId,
          referenceAssetId1: poseAsset?.id || null,
          selectedAssetFieldIds: {
            image: characterId,
            ...(poseAsset?.id ? { referenceImage1: poseAsset.id } : {}),
          },
          storyboardCardId: card.id,
          resolution: generateResolution(currentProject, card),
          placement: 'storyboard-frame',
          velornMeta: buildVelornMeta(card, 'storyboard-frame'),
          autoQueue: true,
        },
      }))
    } catch (error) {
      setGenerateError(error?.message || 'Could not import the pose still into this project.')
    }
  }

  const submitInpaint = async (card, payload) => {
    if (!card.imageAssetId) return
    setPendingMaskDataUrl(payload.maskDataUrl || null)
    updateCard(card.id, {
      status: 'generating',
      hasGeneration: true,
      lastGenerationError: '',
      workflowId: payload.workflowId,
      prompt: payload.prompt,
    })
    setEditCardId(null)
    try {
      await ensureGenerateWorkspace()
      window.dispatchEvent(new CustomEvent('comfystudio-mcp-prepare-generation', {
        detail: {
          workflowId: payload.workflowId,
          category: 'image',
          prompt: payload.prompt,
          selectedAssetId: card.imageAssetId,
          selectedAssetFieldIds: { image: card.imageAssetId },
          storyboardCardId: card.id,
          resolution: generateResolution(currentProject, card),
          placement: 'storyboard-frame',
          velornMeta: buildVelornMeta(card, 'storyboard-frame'),
          autoQueue: true,
        },
      }))
    } catch (error) {
      setGenerateError(error?.message || 'Could not start the inpaint.')
      updateCard(card.id, { status: 'draft' })
    }
  }

  if (!currentProject) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-sf-text-muted">
        Open a project to edit its storyboard.
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-sf-dark-950">
      <div className="flex items-center justify-between px-5 py-3 border-b border-sf-dark-800">
        <div>
          <h1 className="text-sm font-semibold text-sf-text-primary">Storyboard</h1>
          <p className="text-[11px] text-sf-text-muted">
            Drag cards to reorder. Shot numbers stay 1, 2, 3… Add or generate a still here. Sequence turns accepted frames into video.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => saveProject?.()}
            className="px-3 py-1.5 text-[11px] rounded-md border border-sf-dark-600 text-sf-text-secondary hover:bg-sf-dark-800"
          >
            Save
          </button>
          <button
            type="button"
            onClick={addCard}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md bg-sf-accent/90 hover:bg-sf-accent text-white"
          >
            <Plus className="w-3.5 h-3.5" />
            New card
          </button>
        </div>
      </div>
      <div className="px-5 py-2 border-b border-sf-dark-800 space-y-2">
        <OutputRatioBar
          settings={currentProject.settings || {}}
          onChange={(next) => {
            updateProjectSettings(next)
            const production = getProduction?.()
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
        <StageRail
          studio={studio}
          extras={{ videoCount: board.cards.filter((card) => card.videoAssetId).length }}
        />
        <details>
          <summary className="cursor-pointer text-[11px] text-sf-text-secondary">Cast (series → season → episode)</summary>
          <div className="mt-2">
            <CastPanel studio={studio} season={production?.current?.seasonId} episode={production?.current?.episodeId} />
          </div>
        </details>
      </div>

      <div className="flex-1 overflow-auto p-5">
        {generateError && (
          <p className="mb-3 text-sm text-red-400">{generateError}</p>
        )}
        {board.cards.length === 0 ? (
          <div className="max-w-md mx-auto mt-16 text-center">
            <p className="text-sf-text-primary font-medium mb-2">No storyboard cards yet</p>
            <p className="text-xs text-sf-text-muted mb-4">
              Add a card, write the shot above the empty frame, then add an image or generate one.
            </p>
            <button
              type="button"
              onClick={addCard}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md bg-sf-dark-800 border border-sf-dark-600 text-sf-text-primary"
            >
              <Plus className="w-4 h-4" />
              Add first shot
            </button>
          </div>
        ) : (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
          >
            {board.cards.map((card) => {
              const hasImage = Boolean(card.imageAssetId)
              const job = jobForCard(card.id)
              const generating = isGeneratingStatus(card)
                || (job && !['done', 'error'].includes(job.status))
              const reviewing = isReviewStatus(card) && !generating
              const generateOpen = generateCardId === card.id
              const workflow = findFrameWorkflow(card.workflowId || DEFAULT_FRAME_WORKFLOW)
              const slots = frameWorkflowSlots(workflow)
              const pickerFor = (slot) => mediaPicker?.cardId === card.id && mediaPicker?.slot === slot
              const slotView = cardSlotView(studio, card)
              return (
                <article
                  key={card.id}
                  ref={(node) => { cardRefs.current[card.id] = node }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    const fromId = event.dataTransfer.getData('text/plain') || dragId
                    moveCard(fromId, card.id)
                    setDragId(null)
                  }}
                  className={`rounded-xl border bg-sf-dark-900 overflow-hidden flex flex-col ${
                    dragId === card.id ? 'border-sf-accent opacity-70' : 'border-sf-dark-700'
                  }`}
                >
                  <div className="px-3 pt-3 pb-2 space-y-1.5">
                    {slotView && (
                      <div className="flex flex-wrap gap-1 text-[9px] uppercase tracking-wide">
                        <span className={`px-1.5 py-0.5 rounded border ${
                          slotView.state === 'filled' ? 'border-emerald-500/50 text-emerald-300'
                            : slotView.state === 'partial' ? 'border-amber-400/50 text-amber-200'
                              : 'border-dashed border-sf-dark-500 text-sf-text-muted'
                        }`}>{slotView.slot.slot_id} · {slotView.state}</span>
                        <span className={slotView.qa.video.result === 'pass' ? 'text-emerald-300' : slotView.qa.video.result === 'fail' ? 'text-red-400' : 'text-sf-text-muted'}>
                          V {slotView.qa.video.result}
                        </span>
                        <span className={slotView.qa.audio.result === 'pass' ? 'text-emerald-300' : slotView.qa.audio.result === 'fail' ? 'text-red-400' : 'text-sf-text-muted'}>
                          A {slotView.qa.audio.result}
                        </span>
                      </div>
                    )}
                    <div className="flex items-start gap-2">
                      <span
                        draggable
                        onDragStart={(event) => {
                          setDragId(card.id)
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData('text/plain', card.id)
                        }}
                        onDragEnd={() => setDragId(null)}
                        className="mt-1 text-sf-text-muted cursor-grab"
                        title="Drag to reorder"
                      >
                        <GripVertical className="w-3.5 h-3.5" />
                      </span>
                      <input
                        value={card.title}
                        onChange={(event) => updateCard(card.id, { title: event.target.value })}
                        placeholder={`Shot ${card.order}`}
                        className="flex-1 min-w-0 bg-transparent text-sm font-semibold text-sf-text-primary border-b border-transparent focus:border-sf-dark-500 outline-none"
                      />
                      <span
                        className="flex-shrink-0 min-w-[1.75rem] h-7 px-1.5 rounded-md bg-black/70 border border-white/15 text-[12px] font-semibold tabular-nums text-white flex items-center justify-center"
                        title={`Shot ${card.order}`}
                      >
                        {card.order}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeCard(card.id)}
                        className="p-1 rounded text-sf-text-muted hover:text-white"
                        title="Remove card"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {editingDescription === card.id ? (
                      <textarea
                        autoFocus
                        value={card.description}
                        onChange={(event) => updateCard(card.id, { description: event.target.value })}
                        onBlur={() => setEditingDescription(null)}
                        placeholder="Describe the intended shot before you generate a frame…"
                        rows={4}
                        className="w-full resize-y min-h-[4.5rem] bg-sf-dark-800 border border-sf-dark-600 rounded-md px-2 py-1.5 text-[12px] leading-snug text-sf-text-primary placeholder:text-sf-text-muted outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingDescription(card.id)}
                        className="w-full text-left min-h-[4.5rem] px-2 py-1.5 rounded-md border border-dashed border-sf-dark-600 hover:border-sf-dark-400 text-[12px] leading-snug text-sf-text-primary"
                      >
                        {card.description?.trim()
                          ? card.description
                          : 'Click to write the intended shot. This sits above the frame so you can plan before any image exists.'}
                      </button>
                    )}
                  </div>

                  <div className="aspect-[9/16] max-h-64 bg-sf-dark-800 relative mx-3 rounded-md overflow-hidden">
                    {imageUrls[card.id] ? (
                      <button
                        type="button"
                        onClick={() => setEditCardId(card.id)}
                        className="w-full h-full block"
                        title="Open fullscreen editor"
                      >
                        <img src={imageUrls[card.id]} alt="" className="w-full h-full object-cover" />
                      </button>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[11px] text-sf-text-muted px-4 text-center">
                        Empty frame — add an image or generate one
                      </div>
                    )}
                    {generating && (
                      <div className="absolute inset-0 bg-black/55 flex flex-col items-center justify-center gap-2 text-white">
                        <Loader2 className="w-6 h-6 animate-spin text-sf-accent" />
                        <span className="text-[11px] font-medium">
                          {job?.status === 'queued' ? 'Queued in ComfyUI' : 'Generating…'}
                        </span>
                        <div className="w-2/3 h-1.5 rounded bg-white/20 overflow-hidden">
                          <div className="h-full bg-sf-accent" style={{ width: `${Math.max(8, job?.progress || 8)}%` }} />
                        </div>
                        {job?.workflowLabel && (
                          <span className="text-[10px] text-white/80 px-3 text-center">{job.workflowLabel}</span>
                        )}
                      </div>
                    )}
                    <span className={`absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded border ${statusTone(generating ? 'generating' : card.status)}`}>
                      {generating ? 'generating' : card.status}
                    </span>
                    <span className="absolute top-2 right-2 min-w-[1.5rem] h-6 px-1 rounded bg-black/75 text-white text-[11px] font-semibold tabular-nums flex items-center justify-center">
                      {card.order}
                    </span>
                    {card.videoAssetId && (
                      <button
                        type="button"
                        onClick={() => window.dispatchEvent(new CustomEvent('comfystudio-open-sequence-tab', { detail: { cardId: card.id } }))}
                        className="absolute bottom-2 left-2 right-2 text-[10px] rounded bg-black/75 text-amber-200 py-1"
                      >
                        {card.status === 'accepted' ? 'Clip accepted — open Sequence' : 'Clip ready to review — open Sequence'}
                      </button>
                    )}
                  </div>

                  <div className="p-3 space-y-2 flex-1 flex flex-col">
                    {!reviewing && !generating && (
                      <>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => toggleMediaPicker(card.id, 'frame')}
                            className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-sf-dark-600 bg-sf-dark-800 text-[11px] text-sf-text-primary hover:border-sf-accent"
                          >
                            <ImagePlus className="w-3.5 h-3.5" />
                            {hasImage ? 'Replace' : 'Add image'}
                          </button>
                          {hasImage && (
                            <button
                              type="button"
                              onClick={() => removeImage(card.id)}
                              className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-sf-dark-700 text-[11px] text-sf-text-secondary hover:text-white"
                            >
                              <ImageOff className="w-3.5 h-3.5" />
                              Remove image
                            </button>
                          )}
                          {hasImage && (
                            <button
                              type="button"
                              onClick={() => setEditCardId(card.id)}
                              className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-sf-dark-600 text-[11px] text-sf-text-primary hover:border-sf-accent"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Edit / inpaint
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => window.dispatchEvent(new CustomEvent('comfystudio-open-sequence-tab', { detail: { cardId: card.id } }))}
                            className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-sf-dark-600 text-[11px] text-sf-text-secondary hover:text-sf-text-primary"
                          >
                            Sequence
                          </button>
                          <button
                            type="button"
                            onClick={() => setBlockingCardId((current) => (current === card.id ? null : card.id))}
                            className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-sf-dark-600 text-[11px] text-sf-text-secondary hover:text-sf-text-primary"
                          >
                            Blocking
                          </button>
                          <button
                            type="button"
                            onClick={() => openGeneratePanel(card)}
                            className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-sf-accent/80 hover:bg-sf-accent text-white text-[11px] ml-auto"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            Generate
                            <ChevronDown className={`w-3 h-3 transition-transform ${generateOpen ? 'rotate-180' : ''}`} />
                          </button>
                        </div>
                        {blockingCardId === card.id && (
                          <BlockingPanel
                            projectPath={typeof currentProjectHandle === 'string' ? currentProjectHandle : ''}
                            studio={studio}
                            card={card}
                            onApplyRig={(rig) => updateCard(card.id, { cameraRig: rig })}
                          />
                        )}
                        {pickerFor('frame') && (
                          <AssetPicker
                            assets={imageAssets}
                            value={card.imageAssetId}
                            preferredFolderNames={['Keyframes', 'Storyboard', 'Cast']}
                            empty="No images in this project yet."
                            onPick={(asset) => applyPickedAsset(card.id, 'frame', asset)}
                          />
                        )}
                      </>
                    )}

                    {reviewing && (
                      <div className="grid grid-cols-4 gap-1.5 mt-auto">
                        <button
                          type="button"
                          onClick={() => updateCard(card.id, { status: 'accepted' })}
                          className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md bg-emerald-600/80 hover:bg-emerald-600 text-white text-[11px]"
                        >
                          <Check className="w-3 h-3" />
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => updateCard(card.id, { status: 'rejected' })}
                          className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md bg-sf-dark-700 hover:bg-red-700 text-sf-text-primary text-[11px]"
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          onClick={() => openGeneratePanel(card)}
                          className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md bg-sf-accent/80 hover:bg-sf-accent text-white text-[11px]"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Regen
                        </button>
                        <button
                          type="button"
                          onClick={() => window.dispatchEvent(new CustomEvent('comfystudio-open-sequence-tab', { detail: { cardId: card.id } }))}
                          className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md border border-sf-dark-600 text-[11px] text-sf-text-primary"
                        >
                          Sequence
                        </button>
                      </div>
                    )}

                    {generateOpen && (
                      <div className="rounded-md border border-sf-dark-600 bg-sf-dark-950 p-2 space-y-2">
                        <label className="block space-y-1">
                          <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">Workflow</span>
                          <select
                            value={workflow.id}
                            onChange={(event) => updateCard(card.id, { workflowId: event.target.value })}
                            className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5 text-[11px] text-sf-text-primary"
                          >
                            {FRAME_WORKFLOWS.map((item) => (
                              <option key={item.id} value={item.id}>{item.label}</option>
                            ))}
                          </select>
                        </label>
                        <p className="text-[10px] text-sf-text-muted">{workflow.description}</p>
                        <label className="block space-y-1">
                          <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">Prompt</span>
                          <textarea
                            value={card.prompt}
                            onChange={(event) => updateCard(card.id, { prompt: event.target.value })}
                            placeholder={card.description || 'Describe the still to generate…'}
                            rows={3}
                            className="w-full resize-none bg-sf-dark-800 border border-sf-dark-700 rounded-md px-2 py-1.5 text-[11px] text-sf-text-primary placeholder:text-sf-text-muted outline-none"
                          />
                        </label>

                        {slots.map((slot) => (
                          <div key={slot.id} className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">
                                {slot.label}{slot.required ? ' *' : ''}
                              </span>
                              <button
                                type="button"
                                onClick={() => toggleMediaPicker(card.id, slot.id)}
                                className="text-[10px] text-sf-accent hover:underline"
                              >
                                {slot.id === 'source'
                                  ? (card.sourceAssetId || card.imageAssetId ? 'Change' : 'Select')
                                  : (card[slot.id === 'ref1' ? 'refAssetId1' : 'refAssetId2'] ? 'Change' : 'Select')}
                              </button>
                            </div>
                            <p className="text-[11px] text-sf-text-secondary">
                              {slot.id === 'source'
                                ? (assetName(card.sourceAssetId || card.imageAssetId) || 'Required for this workflow')
                                : (assetName(slot.id === 'ref1' ? card.refAssetId1 : card.refAssetId2) || 'Optional')}
                            </p>
                            {pickerFor(slot.id) && (
                              <AssetPicker
                                assets={imageAssets}
                                preferredFolderNames={slot.id === 'source' ? ['Keyframes', 'Storyboard'] : ['Cast']}
                                empty="No images in this project yet."
                                onPick={(asset) => applyPickedAsset(card.id, slot.id, asset)}
                              />
                            )}
                          </div>
                        ))}

                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">Location (one)</span>
                            <button type="button" onClick={() => toggleMediaPicker(card.id, 'location')} className="text-[10px] text-sf-accent hover:underline">
                              {card.locationRef ? 'Change' : 'Select'}
                            </button>
                          </div>
                          <p className="text-[10px] text-sf-text-muted">A shot has exactly one location. Empty plate preferred.</p>
                          {card.locationRef ? (
                            <RefChips
                              items={[card.locationRef]}
                              onRemove={() => updateCard(card.id, { locationRef: null, sceneRefs: [] })}
                            />
                          ) : (
                            <span className="text-[10px] text-amber-300">No location yet</span>
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
                            <button type="button" onClick={() => toggleMediaPicker(card.id, 'character')} className="text-[10px] text-sf-accent hover:underline">
                              Add
                            </button>
                          </div>
                          <p className="text-[10px] text-sf-text-muted">B-roll and inserts can have none. Dialogue coverage can have several.</p>
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
                            <button type="button" onClick={() => toggleMediaPicker(card.id, 'prop')} className="text-[10px] text-sf-accent hover:underline">
                              Add
                            </button>
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
                          mode="still"
                          projectLook={projectLook}
                          value={card.shotSettings}
                          onChange={(shotSettings) => updateCard(card.id, { shotSettings })}
                        />

                        <div className="space-y-1">
                          <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">Motion / pose</span>
                          <MotionPicker
                            value={card.motionSlug || ''}
                            onChange={(slug) => updateCard(card.id, { motionSlug: slug })}
                          />
                        </div>

                        {generateError && (
                          <p className="text-[10px] text-red-400">{generateError}</p>
                        )}
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => { setGenerateCardId(null); setGenerateError('') }}
                            className="flex-1 px-2 py-1.5 rounded-md border border-sf-dark-600 text-[11px] text-sf-text-secondary"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => { void submitPoseStill(card) }}
                            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md border border-sf-accent/50 text-[11px] text-sf-text-primary hover:bg-sf-accent/10"
                            title="Compile a starting still from the character ref + this pose"
                          >
                            Pose still
                          </button>
                          <button
                            type="button"
                            onClick={() => submitGenerate(card)}
                            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md bg-sf-accent text-white text-[11px]"
                          >
                            <Sparkles className="w-3 h-3" />
                            Open Generate
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
      <InpaintEditor
        open={Boolean(editCardId)}
        imageUrl={editCardId ? imageUrls[editCardId] : ''}
        title={board.cards.find((card) => card.id === editCardId)?.title}
        initialPrompt={board.cards.find((card) => card.id === editCardId)?.prompt || ''}
        onClose={() => setEditCardId(null)}
        onSubmit={(payload) => {
          const card = board.cards.find((item) => item.id === editCardId)
          if (card) submitInpaint(card, payload)
        }}
      />
    </div>
  )
}
