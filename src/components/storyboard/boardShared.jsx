import { WORKFLOWS } from '../../config/generateWorkspaceConfig'
import { listComfyNativeTemplates } from '../../config/comfyNativeTemplates'
import MediaPicker from './MediaPicker'
import {
  assembleLexiconLine,
  emptyShotSettings,
  normalizeShotSettings,
} from '../../services/shotSettings'

export const DEFAULT_FRAME_WORKFLOW = 'z-image-turbo'
export const DEFAULT_VIDEO_WORKFLOW = 'ltx25-i2v'
export const DEFAULT_FLF_WORKFLOW = 'ltx25-flf2v'

const nativeVideo = listComfyNativeTemplates('video').map((item) => ({
  id: item.id,
  label: item.label,
  needs: item.needs || [],
  description: item.description,
  group: item.group,
}))

const bundledVideo = (WORKFLOWS.video || [])
  .filter((item) => !['custom-generate-video', 'frame-interpolation'].includes(item.id))
  .map((item) => ({
    id: item.id,
    label: item.label,
    needs: item.id.includes('flf') ? ['first', 'last'] : (item.needsImage ? ['first'] : []),
    description: item.description,
    group: 'bundled',
  }))

export const VIDEO_WORKFLOWS = [
  ...nativeVideo,
  ...bundledVideo.filter((item) => !nativeVideo.some((native) => native.id === item.id)),
]

export const FRAME_WORKFLOWS = [
  ...listComfyNativeTemplates('image').map((item) => ({
    id: item.id,
    label: item.label,
    needsImage: item.needsImage,
    description: item.description,
  })),
  ...(WORKFLOWS.image || []).filter((workflow) => workflow.id !== 'custom-generate-image'),
]

export const AssetPicker = MediaPicker

export const emptyBoard = () => ({ version: 1, cards: [] })

export const numberCards = (cards = []) => cards.map((card, index) => ({
  ...card,
  order: index + 1,
}))

export const newCard = (order) => ({
  id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  order,
  title: `Shot ${order}`,
  description: '',
  prompt: '',
  dialogue: '',
  action: '',
  ingredients: [],
  characterRefs: [],
  sceneRefs: [],
  locationRef: null,
  propRefs: [],
  shotSettings: emptyShotSettings(),
  imageAssetId: null,
  workflowId: DEFAULT_FRAME_WORKFLOW,
  videoWorkflowId: DEFAULT_VIDEO_WORKFLOW,
  sourceAssetId: null,
  refAssetId1: null,
  refAssetId2: null,
  audioAssetId: null,
  lastFrameAssetId: null,
  motionSlug: '',
  duration: 5,
  status: 'draft',
  hasGeneration: false,
})

export const findFrameWorkflow = (workflowId) => (
  FRAME_WORKFLOWS.find((item) => item.id === workflowId) || FRAME_WORKFLOWS[0]
)

export const findVideoWorkflow = (workflowId) => (
  VIDEO_WORKFLOWS.find((item) => item.id === workflowId) || VIDEO_WORKFLOWS[0]
)

export const isFlfWorkflow = (workflowId) => (
  (findVideoWorkflow(workflowId)?.needs || []).includes('last')
)

export const frameWorkflowSlots = (workflow) => {
  const slots = []
  if (workflow?.needsImage) {
    slots.push({ id: 'source', label: 'Source / edit image', required: true })
  }
  if ([
    'image-edit',
    'longcat-image-edit',
    'gpt-image-2-edit',
    'seedream-5-lite-image-edit',
    'nano-banana-2',
    'multi-angles',
    'multi-angles-scene',
  ].includes(workflow?.id)) {
    slots.push({ id: 'ref1', label: 'Style / extra reference', required: false })
    slots.push({ id: 'ref2', label: 'Second extra reference', required: false })
  }
  return slots
}

export const isReviewStatus = (card) => (
  card.status === 'generating'
  || card.status === 'pending-review'
  || card.status === 'accepted'
  || card.status === 'rejected'
)

export function seedFromProject(project) {
  if (Array.isArray(project?.storyboardBoard?.cards) && project.storyboardBoard.cards.length > 0) {
    return {
      version: 1,
      cards: numberCards(project.storyboardBoard.cards.map((card, index) => ({
        ...newCard(index + 1),
        ...card,
        ingredients: Array.isArray(card.ingredients) ? card.ingredients : [],
        characterRefs: Array.isArray(card.characterRefs) ? card.characterRefs : [],
        sceneRefs: Array.isArray(card.sceneRefs) ? card.sceneRefs : [],
        locationRef: card.locationRef || card.sceneRefs?.[0] || null,
        propRefs: Array.isArray(card.propRefs) ? card.propRefs : [],
        shotSettings: normalizeShotSettings(card.shotSettings),
        motionSlug: card.motionSlug || '',
        hasGeneration: Boolean(card.hasGeneration),
      }))),
    }
  }
  const story = (project?.timelines || []).find((timeline) => (
    timeline.id === 'timeline-storyboard' || String(timeline.name || '').toLowerCase() === 'storyboard'
  ))
  const clips = (story?.clips || []).filter((clip) => clip.type === 'image' || clip.assetId)
  return {
    version: 1,
    cards: numberCards(clips.map((clip, index) => ({
      ...newCard(index + 1),
      id: `card-${clip.id || index}`,
      title: clip.name || `Shot ${index + 1}`,
      description: clip.metadata?.cdxSlot || clip.name || '',
      imageAssetId: clip.assetId || null,
      status: 'draft',
      hasGeneration: false,
    }))),
  }
}

export function refNames(items = []) {
  return items.map((item) => item.name || item.assetId).filter(Boolean).join(', ')
}

export function composeGenerationPrompt(card, extra = {}) {
  const parts = []
  const description = String(card.description || '').trim()
  const prompt = String(card.prompt || extra.prompt || '').trim()
  const action = String(card.action || '').trim()
  const dialogue = String(card.dialogue || '').trim()
  if (description) parts.push(description)
  if (prompt && prompt !== description) parts.push(prompt)
  if (action) parts.push(`Action: ${action}`)
  if (dialogue) parts.push(`Dialogue: "${dialogue}"`)
  const characters = refNames(card.characterRefs)
  const location = card.locationRef?.name || refNames(card.locationRef ? [card.locationRef] : (card.sceneRefs || []).slice(0, 1))
  const props = refNames(card.propRefs)
  if (characters) parts.push(`Characters in frame: ${characters}`)
  else parts.push('No principal characters in frame.')
  if (location) parts.push(`Location: ${location}`)
  if (props) parts.push(`Props: ${props}`)
  const lexicon = extra.lexiconLine
    || assembleLexiconLine(card.shotSettings, extra.mode || 'still', extra.projectLook || {})
  if (lexicon) parts.push(lexicon)
  if (extra.motionTitle) {
    parts.push(`Match this pose / action exactly: ${extra.motionTitle}. Keep identity and wardrobe from the character reference.`)
  }
  if (extra.bridge) parts.push(String(extra.bridge).trim())
  return parts.filter(Boolean).join('\n')
}

export function primaryRefIds(card) {
  const pool = [
    ...(card.characterRefs || []),
    ...(card.locationRef ? [card.locationRef] : (card.sceneRefs || [])),
    ...(card.propRefs || []),
    ...(card.ingredients || []),
  ]
  return {
    first: pool[0]?.assetId || card.refAssetId1 || null,
    second: pool[1]?.assetId || card.refAssetId2 || null,
  }
}

export function guessAssetRole(asset, folders = []) {
  const folder = folders.find((item) => item.id === asset?.folderId)
  const hay = `${folder?.name || ''} ${asset?.name || ''} ${asset?.path || ''}`.toLowerCase()
  if (/\b(cast|character|talent|actor|actress|face|person)\b/.test(hay)) return 'character'
  if (/\b(scene|location|plate|environment|set|bg|background)\b/.test(hay)) return 'scene'
  if (/\b(prop|product|object|item|wardrobe|costume)\b/.test(hay)) return 'prop'
  return null
}

export function sortAssetsForRole(assets, folders, role) {
  if (!role) return assets
  return [...assets].sort((a, b) => {
    const aMatch = guessAssetRole(a, folders) === role ? 0 : 1
    const bMatch = guessAssetRole(b, folders) === role ? 0 : 1
    return aMatch - bMatch
  })
}



export function RefChips({ items = [], onRemove }) {
  if (!items.length) {
    return <span className="text-[10px] text-sf-text-muted">None</span>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <button
          key={item.assetId}
          type="button"
          onClick={() => onRemove(item.assetId)}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sf-dark-800 border border-sf-dark-600 text-[10px] text-sf-text-secondary"
        >
          {item.name}
          <span className="text-sf-text-muted">×</span>
        </button>
      ))}
    </div>
  )
}
