import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, Loader2, Sparkles } from 'lucide-react'
import useProjectStore from '../stores/projectStore'
import useAssetsStore from '../stores/assetsStore'
import useGenerationMonitorStore from '../stores/generationMonitorStore'
import { getProjectFileUrl } from '../services/fileSystem'
import { getComfyNativeTemplate } from '../config/comfyNativeTemplates'
import MotionPicker from './storyboard/MotionPicker'
import ShotParamsPanel from './storyboard/ShotParamsPanel'
import ProjectLookBar from './storyboard/ProjectLookBar'
import { findMotion, loadMotionCatalog } from '../services/motionLibrary'
import { assembleLexiconLabels, modeFromWorkflow, normalizeProjectLook } from '../services/shotSettings'
import {
  AssetPicker,
  DEFAULT_FLF_WORKFLOW,
  DEFAULT_VIDEO_WORKFLOW,
  RefChips,
  VIDEO_WORKFLOWS,
  composeGenerationPrompt,
  emptyBoard,
  findVideoWorkflow,
  isFlfWorkflow,
  numberCards,
  primaryRefIds,
  seedFromProject,
  sortAssetsForRole,
} from './storyboard/boardShared'

async function ensureGenerateWorkspace() {
  window.dispatchEvent(new CustomEvent('comfystudio-ensure-generate-workspace'))
  const started = Date.now()
  while (Date.now() - started < 8000) {
    const ready = await new Promise((resolve) => {
      let answered = false
      window.dispatchEvent(new CustomEvent('comfystudio-generate-workspace-ping', {
        detail: {
          respond: () => {
            answered = true
            resolve(true)
          },
        },
      }))
      setTimeout(() => resolve(answered), 60)
    })
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  throw new Error('The Generate engine did not start. Open the Generate tab once, then try again.')
}

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
  const assets = useAssetsStore((state) => state.assets)
  const folders = useAssetsStore((state) => state.folders)
  const monitorJobs = useGenerationMonitorStore((state) => state.jobs)
  const comfyConnected = useGenerationMonitorStore((state) => state.isConnected)

  const [openId, setOpenId] = useState(null)
  const [mediaPicker, setMediaPicker] = useState(null)
  const [error, setError] = useState('')
  const [urls, setUrls] = useState({})
  const [submittingId, setSubmittingId] = useState(null)
  const [motionCatalog, setMotionCatalog] = useState({ items: [] })

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
        for (const assetId of [card.imageAssetId, card.lastFrameAssetId]) {
          const asset = assets.find((item) => item.id === assetId)
          const path = asset?.path || asset?.absolutePath
          if (!path) continue
          try {
            const url = await getProjectFileUrl(currentProjectHandle, path)
            if (!cancelled && url) next[asset.id] = url
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
    else if (slot === 'last') updateCard(cardId, { lastFrameAssetId: asset.id })
    else if (slot === 'character') updateCard(cardId, { characterRefs: addRef(card, 'characterRefs', asset) })
    else if (slot === 'location' || slot === 'scene') updateCard(cardId, { locationRef: { assetId: asset.id, name: asset.name }, sceneRefs: [{ assetId: asset.id, name: asset.name }] })
    else if (slot === 'prop') updateCard(cardId, { propRefs: addRef(card, 'propRefs', asset) })
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
    const refs = primaryRefIds(card)
    const motion = findMotion(card.motionSlug, motionCatalog)
    const prompt = composeGenerationPrompt(card, {
      motionTitle: motion?.title || '',
      mode: modeFromWorkflow(workflow.id, 'video'),
      projectLook,
      bridge: needs.includes('last') && nextCard
        ? `Last frame is shot ${nextCard.order}: ${nextCard.title}. ${nextCard.description || ''}`
        : '',
    })
    setError('')
    setSubmittingId(card.id)
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
          autoQueue: true,
        },
      }))
    } catch (err) {
      setError(err?.message || 'Could not start the generation.')
    } finally {
      setSubmittingId(null)
    }
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
            One still per shot. Review what will be sent, then generate here — this page stays put and shows progress.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] ${comfyConnected ? 'text-emerald-400' : 'text-amber-300'}`}>
            {comfyConnected ? 'ComfyUI connected' : 'ComfyUI not connected yet'}
          </span>
          <button
            type="button"
            onClick={() => saveProject?.()}
            className="px-3 py-1.5 text-[11px] rounded-md border border-sf-dark-600 text-sf-text-secondary hover:bg-sf-dark-800"
          >
            Save
          </button>
        </div>
      </div>
      <div className="px-5 py-2 border-b border-sf-dark-800">
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
            <div key={card.id} className="rounded-xl border border-sf-dark-700 bg-sf-dark-900 p-3 flex gap-3">
              <div className={`${flf ? 'w-24' : 'w-32'} aspect-[9/16] rounded bg-sf-dark-800 overflow-hidden flex-shrink-0 relative`}>
                {frameUrl(card.imageAssetId) ? (
                  <img src={frameUrl(card.imageAssetId)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] text-sf-text-muted px-1 text-center">No frame</div>
                )}
                <span className="absolute top-1 right-1 min-w-[1.25rem] h-5 px-1 rounded bg-black/75 text-white text-[10px] font-semibold flex items-center justify-center">
                  {card.order || index + 1}
                </span>
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <div className="text-sm font-medium text-sf-text-primary truncate">
                  {card.order || index + 1}. {card.title}
                </div>
                <p className="text-[11px] text-sf-text-secondary whitespace-pre-wrap">
                  {card.description || 'No shot description yet — edit it on the Storyboard tab.'}
                </p>

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
                  </div>
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
                    <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">Action / extend context</span>
                    <textarea
                      value={card.action || ''}
                      onChange={(event) => updateCard(card.id, { action: event.target.value })}
                      placeholder="What happens as this frame continues…"
                      rows={2}
                      className="w-full resize-none bg-sf-dark-800 border border-sf-dark-700 rounded-md px-2 py-1.5 text-[11px] text-sf-text-primary placeholder:text-sf-text-muted outline-none"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      updateCard(card.id, { videoWorkflowId: DEFAULT_VIDEO_WORKFLOW })
                      setOpenId(card.id)
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
                        setError('')
                      }}
                      className="px-2.5 py-1.5 rounded-md bg-sf-accent/80 hover:bg-sf-accent text-white text-[11px]"
                    >
                      First/last → shot {next.order}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpenId(panelOpen ? null : card.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-sf-dark-600 text-[11px] text-sf-text-secondary hover:text-sf-text-primary"
                  >
                    More flows
                    <ChevronDown className={`w-3 h-3 transition-transform ${panelOpen ? 'rotate-180' : ''}`} />
                  </button>
                </div>

                {panelOpen && (
                  <div className="rounded-md border border-sf-dark-600 bg-sf-dark-950 p-2 space-y-2">
                    <label className="block space-y-1">
                      <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">Video workflow</span>
                      <select
                        value={workflow.id}
                        onChange={(event) => updateCard(card.id, { videoWorkflowId: event.target.value })}
                        className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5 text-[11px] text-sf-text-primary"
                      >
                        {VIDEO_WORKFLOWS.map((item) => (
                          <option key={item.id} value={item.id}>{item.label}</option>
                        ))}
                      </select>
                    </label>
                    <p className="text-[10px] text-sf-text-muted">{workflow.description}</p>
                    <label className="block space-y-1">
                      <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">Duration (seconds)</span>
                      <input
                        type="number"
                        min="2"
                        max="15"
                        value={card.duration || 5}
                        onChange={(event) => updateCard(card.id, { duration: Number(event.target.value) || 5 })}
                        className="w-24 bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-[11px] text-sf-text-primary"
                      />
                    </label>
                    {needs.includes('first') && (
                      <p className="text-[11px] text-sf-text-secondary">
                        This frame: {assetName(card.imageAssetId) || 'add a still on Storyboard first'}
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

                    <button
                      type="button"
                      disabled={submittingId === card.id}
                      onClick={() => submitVideo(card, next)}
                      className="inline-flex items-center justify-center gap-1.5 w-full px-2 py-1.5 rounded-md bg-sf-accent text-white text-[11px] disabled:opacity-50"
                    >
                      {submittingId === card.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      {submittingId === card.id ? 'Starting…' : `Generate ${flf ? 'first/last' : 'extend'} here`}
                    </button>
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
    </div>
  )
}
