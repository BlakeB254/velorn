/**
 * CDX Studio → CDX Media DAM client.
 *
 * Uploads a generated file to Media DAM (:7130) with project + production
 * metadata so assets land in the project folder (keyframes / clips /
 * reference / audio) instead of as untagged Comfy leftovers.
 *
 * Fail-open: DAM being down must never fail a CDX Studio generation.
 */

const DEFAULT_DAM_URL = 'http://127.0.0.1:7130'

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
}

export function getDamBaseUrl() {
  try {
    const stored = localStorage.getItem('comfystudio-dam-url')
    if (stored && /^https?:\/\//i.test(stored)) return stored.replace(/\/+$/, '')
  } catch (_) { /* ignore */ }
  return DEFAULT_DAM_URL
}

export function slugifyDamToken(value, fallback = 'untitled') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || fallback
}

export function resolveVelornProjectSlug(project, projectHandle) {
  return (
    project?.cdxMigration?.slug
    || project?.shortFilmDirector?.source?.slug
    || project?.shortFilmDirector?.slug
    || project?.slug
    || slugifyDamToken(project?.name, '')
    || slugifyDamToken(
      typeof projectHandle === 'string' ? projectHandle.split(/[\\/]/).pop() : '',
      'velorn-project',
    )
  )
}

function extOf(name = '') {
  const match = String(name).toLowerCase().match(/\.[a-z0-9]+$/)
  return match ? match[0] : ''
}

function mimeFor(name, assetType) {
  return MIME_BY_EXT[extOf(name)]
    || (assetType === 'video' ? 'video/mp4' : assetType === 'audio' ? 'audio/mpeg' : 'image/png')
}

async function resolveAbsolutePath(asset, projectHandle) {
  if (asset?.absolutePath) return asset.absolutePath
  if (!asset?.path || !projectHandle || typeof projectHandle !== 'string') return null
  if (!window.electronAPI?.pathJoin) return null
  try {
    return await window.electronAPI.pathJoin(projectHandle, asset.path)
  } catch (_) {
    return null
  }
}

async function readAssetFile(asset, projectHandle) {
  const absolutePath = await resolveAbsolutePath(asset, projectHandle)
  if (absolutePath && window.electronAPI?.readFileAsBuffer) {
    const result = await window.electronAPI.readFileAsBuffer(absolutePath)
    if (!result?.success || !result.data) {
      throw new Error(result?.error || `Could not read ${absolutePath}`)
    }
    const filename = asset.name || asset.path?.split(/[\\/]/).pop() || 'asset.bin'
    return {
      file: new File([result.data], filename, { type: mimeFor(filename, asset.type) }),
      filename,
      sourcePath: absolutePath,
    }
  }
  if (asset?.url) {
    const response = await fetch(asset.url)
    if (!response.ok) throw new Error(`Could not fetch asset ${asset.id}`)
    const blob = await response.blob()
    const filename = asset.name || 'asset.bin'
    return {
      file: new File([blob], filename, { type: blob.type || mimeFor(filename, asset.type) }),
      filename,
      sourcePath: asset.url,
    }
  }
  throw new Error(`No readable file for asset ${asset?.id || '?'}`)
}

export async function ingestVelornAssetToDam({
  asset,
  projectHandle,
  project,
  category,
  role = 'production_asset',
  tags = [],
  metadata = {},
  title,
} = {}) {
  if (!asset) return null
  const projectSlug = resolveVelornProjectSlug(project, projectHandle)
  const assetType = asset.type === 'video' ? 'video' : asset.type === 'audio' ? 'audio' : 'image'
  const { file, filename, sourcePath } = await readAssetFile(asset, projectHandle)
  const form = new FormData()
  form.append('file', file, filename)
  form.append('source', 'cdx-gen-velorn')
  form.append('workflowType', String(metadata.workflowId || 'velorn'))
  form.append('projectSlug', projectSlug)
  form.append('category', category)
  form.append('role', role)
  form.append('title', title || asset.name || filename)
  form.append('tags', JSON.stringify(tags.filter(Boolean)))

  const response = await fetch(`${getDamBaseUrl()}/api/cdx-platform/upload`, {
    method: 'POST',
    body: form,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`DAM upload ${response.status}: ${text.slice(0, 240)}`)
  }
  const body = await response.json()
  const doc = body?.doc || body
  const damId = doc?.id || doc?._id || body?.assetId || null
  if (!damId) throw new Error('DAM upload succeeded but returned no asset id')

  const sourceMetadata = {
    generationSource: 'cdx-gen-velorn',
    sourcePath,
    velornAssetId: asset.id,
    projectName: project?.name || '',
    projectSlug,
    ...metadata,
  }
  try {
    await fetch(`${getDamBaseUrl()}/api/media-assets/${damId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title || asset.name || filename,
        description: metadata.prompt || '',
        sourceType: 'generated',
        sourceMetadata,
      }),
    })
  } catch (_) { /* metadata patch is best-effort */ }

  return {
    damId: String(damId),
    url: `${getDamBaseUrl()}/api/media-assets/file/${damId}`,
    projectSlug,
    category,
  }
}
