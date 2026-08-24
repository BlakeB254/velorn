/**
 * After a ComfyUI job finishes, seed the result into the CDX Studio project
 * (storyboard frame, sequence versions, cover, character/location refs)
 * and push a tagged copy into Media DAM.
 */

import useAssetsStore from '../stores/assetsStore'
import useProjectStore from '../stores/projectStore'
import { ingestVelornAssetToDam, resolveVelornProjectSlug, slugifyDamToken } from './mediaDam'

const ROLE_FOLDERS = {
  'storyboard-frame': 'Storyboard',
  'sequence-clip': 'Video',
  'character-ref': 'Cast',
  'location-ref': 'Plates',
  cover: 'Cover',
}

const DAM_CATEGORY = {
  'storyboard-frame': { category: 'keyframes', role: 'keyframe' },
  'sequence-clip': { category: 'clips', role: 'clip' },
  'character-ref': { category: 'reference', role: 'reference' },
  'location-ref': { category: 'reference', role: 'reference' },
  cover: { category: 'production', role: 'production_asset' },
  audio: { category: 'audio', role: 'production_asset' },
}

function inferPlacement(job, asset) {
  if (job?.placement) return job.placement
  if (job?.velornMeta?.placement) return job.velornMeta.placement
  if (asset?.type === 'audio') return 'audio'
  if (asset?.type === 'video' || job?.category === 'video') return 'sequence-clip'
  if (job?.storyboardCardId) return 'storyboard-frame'
  return asset?.type === 'image' ? 'storyboard-frame' : 'sequence-clip'
}

function ensureFolder(name) {
  const { folders = [], addFolder } = useAssetsStore.getState()
  const existing = folders.find((folder) => (
    !folder?.parentId && String(folder?.name || '').toLowerCase() === String(name).toLowerCase()
  ))
  if (existing) return existing.id
  if (typeof addFolder !== 'function') return null
  return addFolder({ name, parentId: null })?.id || null
}

function appendUniqueVersion(list, entry) {
  const next = Array.isArray(list) ? [...list] : []
  if (next.some((item) => item.assetId === entry.assetId)) return next
  next.push(entry)
  return next.slice(-24)
}

function buildTags({ projectSlug, placement, card, meta, workflowId, asset }) {
  const tags = [
    'velorn',
    'generated',
    'comfyui',
    projectSlug || null,
    projectSlug ? `project:${projectSlug}` : null,
    placement ? `kind:${placement}` : null,
    workflowId ? `workflow:${slugifyDamToken(workflowId, 'workflow')}` : null,
    asset?.type ? `media:${asset.type}` : null,
  ]
  const characters = meta?.characters || card?.characterRefs || []
  for (const item of characters) {
    const slug = item.slug || slugifyDamToken(item.name, '')
    if (slug) tags.push(`character:${slug}`)
  }
  const location = meta?.location || card?.locationRef || (card?.sceneRefs || [])[0]
  if (location) {
    const slug = location.slug || slugifyDamToken(location.name, '')
    if (slug) tags.push(`location:${slug}`)
  }
  if (card?.id) tags.push(`storyboard:${slugifyDamToken(card.id, card.id)}`)
  if (card?.order) tags.push(`shot:${card.order}`)
  if (card?.motionSlug) tags.push(`motion:${slugifyDamToken(card.motionSlug, card.motionSlug)}`)
  return [...new Set(tags.filter(Boolean))]
}

function patchStoryboardCard(cardId, updater) {
  const projectState = useProjectStore.getState()
  const board = projectState.currentProject?.storyboardBoard
  if (!board?.cards || !cardId) return null
  const cards = board.cards.map((card) => (
    card.id === cardId ? updater(card) : card
  ))
  projectState.setStoryboardBoard({ ...board, cards })
  return cards.find((card) => card.id === cardId) || null
}

function patchDirector(mutator) {
  const projectState = useProjectStore.getState()
  const director = projectState.currentProject?.shortFilmDirector
  if (!director || typeof projectState.setShortFilmDirector !== 'function') return
  projectState.setShortFilmDirector(mutator({ ...director }))
}

function setCoverAsset(assetId) {
  const projectState = useProjectStore.getState()
  if (!projectState.currentProject || !assetId) return
  if (projectState.currentProject.coverAssetId) return
  useProjectStore.setState((state) => ({
    currentProject: state.currentProject ? {
      ...state.currentProject,
      coverAssetId: assetId,
      modified: new Date().toISOString(),
    } : null,
  }))
}

export function applyVelornPlacement({ job, importedAssets = [] } = {}) {
  const projectState = useProjectStore.getState()
  const project = projectState.currentProject
  if (!project) return { placed: [], card: null }

  const cardId = job?.storyboardCardId || job?.velornMeta?.cardId || null
  const card = (project.storyboardBoard?.cards || []).find((item) => item.id === cardId) || null
  const placed = []

  if (job?.status === 'error' && cardId) {
    patchStoryboardCard(cardId, (current) => ({
      ...current,
      status: current.status === 'generating' ? 'draft' : current.status,
      lastGenerationError: job.error || 'Generation failed',
    }))
    return { placed, card }
  }

  importedAssets.forEach((asset, index) => {
    if (!asset?.id) return
    const placement = inferPlacement(job, asset)
    const folderName = ROLE_FOLDERS[placement]
    const folderId = folderName ? ensureFolder(folderName) : null
    const version = {
      assetId: asset.id,
      createdAt: asset.createdAt || new Date().toISOString(),
      workflowId: job?.workflowId || '',
      kind: placement,
      prompt: job?.prompt || '',
    }

    if (folderId && asset.folderId !== folderId) {
      useAssetsStore.getState().updateAsset(asset.id, {
        folderId,
        velornPlacement: placement,
        storyboardCardId: cardId || asset.storyboardCardId || null,
      })
    } else {
      useAssetsStore.getState().updateAsset(asset.id, {
        velornPlacement: placement,
        storyboardCardId: cardId || asset.storyboardCardId || null,
      })
    }

    if (cardId && (placement === 'storyboard-frame' || asset.type === 'image')) {
      patchStoryboardCard(cardId, (current) => {
        const versions = appendUniqueVersion(current.versions, version)
        const isPrimary = index === 0 && asset.type === 'image'
        return {
          ...current,
          imageAssetId: isPrimary ? asset.id : (current.imageAssetId || asset.id),
          versions,
          status: 'pending-review',
          hasGeneration: true,
          lastGenerationError: '',
        }
      })
      patchDirector((director) => ({
        ...director,
        shotPlan: Array.isArray(director.shotPlan)
          ? director.shotPlan.map((shot) => (
            shot.id === cardId ? { ...shot, keyframeAssetId: asset.id } : shot
          ))
          : director.shotPlan,
      }))
      if (!project.coverAssetId && !project.thumbnail) setCoverAsset(asset.id)
    }

    if (cardId && (placement === 'sequence-clip' || asset.type === 'video')) {
      patchStoryboardCard(cardId, (current) => ({
        ...current,
        videoAssetId: asset.id,
        videoVersions: appendUniqueVersion(current.videoVersions, version),
        status: 'pending-review',
        hasGeneration: true,
        lastGenerationError: '',
      }))
      patchDirector((director) => ({
        ...director,
        shotPlan: Array.isArray(director.shotPlan)
          ? director.shotPlan.map((shot) => (
            shot.id === cardId ? { ...shot, videoAssetId: asset.id } : shot
          ))
          : director.shotPlan,
      }))
    }

    if (placement === 'character-ref') {
      const target = (job?.velornMeta?.characters || card?.characterRefs || [])[0]
      if (target) {
        patchDirector((director) => ({
          ...director,
          characters: (director.characters || []).map((entry) => {
            const match = entry.id === target.id
              || entry.slug === target.slug
              || entry.name === target.name
            if (!match) return entry
            return {
              ...entry,
              referenceAssetId: entry.referenceAssetId || asset.id,
              referenceVersions: appendUniqueVersion(entry.referenceVersions, version),
            }
          }),
        }))
      }
    }

    if (placement === 'location-ref') {
      const target = job?.velornMeta?.location || card?.locationRef
      if (target) {
        patchDirector((director) => ({
          ...director,
          locations: (director.locations || []).map((entry) => {
            const match = entry.id === target.id
              || entry.slug === target.slug
              || entry.name === target.name
            if (!match) return entry
            return {
              ...entry,
              heroAssetId: entry.heroAssetId || asset.id,
              plateVersions: appendUniqueVersion(entry.plateVersions, version),
            }
          }),
        }))
      }
    }

    if (placement === 'cover') setCoverAsset(asset.id)
    placed.push({ assetId: asset.id, placement })
  })

  return {
    placed,
    card: cardId
      ? (useProjectStore.getState().currentProject?.storyboardBoard?.cards || [])
        .find((item) => item.id === cardId) || card
      : card,
  }
}

export async function ingestPlacedAssetsToDam({ job, importedAssets = [], card = null } = {}) {
  const projectState = useProjectStore.getState()
  const project = projectState.currentProject
  const projectHandle = projectState.currentProjectHandle
  if (!project || !importedAssets.length) return []

  const results = []
  for (const asset of importedAssets) {
    const placement = inferPlacement(job, asset)
    const damTarget = DAM_CATEGORY[placement] || DAM_CATEGORY['storyboard-frame']
    const tags = buildTags({
      projectSlug: resolveVelornProjectSlug(project, projectHandle),
      placement,
      card,
      meta: job?.velornMeta,
      workflowId: job?.workflowId,
      asset,
    })
    try {
      const dam = await ingestVelornAssetToDam({
        asset,
        projectHandle,
        project,
        category: damTarget.category,
        role: damTarget.role,
        tags,
        title: asset.name,
        metadata: {
          workflowId: job?.workflowId || '',
          prompt: job?.prompt || '',
          storyboardCardId: job?.storyboardCardId || null,
          cardTitle: card?.title || job?.velornMeta?.cardTitle || '',
          cardOrder: card?.order || job?.velornMeta?.cardOrder || null,
          characters: job?.velornMeta?.characters || card?.characterRefs || [],
          location: job?.velornMeta?.location || card?.locationRef || null,
          motionSlug: card?.motionSlug || job?.velornMeta?.motionSlug || '',
          placement,
          promptId: job?.promptId || null,
        },
      })
      if (dam?.damId) {
        useAssetsStore.getState().updateAsset(asset.id, {
          damId: dam.damId,
          damUrl: dam.url,
          damTags: tags,
        })
        results.push({ assetId: asset.id, ...dam })
      }
    } catch (error) {
      console.warn('[generationPlacement] DAM ingest failed:', error)
    }
  }
  return results
}

export async function finalizeVelornGeneration({ job, importedAssets = [] } = {}) {
  const placement = applyVelornPlacement({ job, importedAssets })
  const dam = job?.status === 'error'
    ? []
    : await ingestPlacedAssetsToDam({
      job,
      importedAssets,
      card: placement.card,
    })
  try {
    await useProjectStore.getState().saveProject?.()
  } catch (error) {
    console.warn('[generationPlacement] project save after generation failed:', error)
  }
  return { ...placement, dam }
}
