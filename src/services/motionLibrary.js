import bundledCatalog from '../config/motionCatalog.json' with { type: 'json' }
import { getAbsoluteFileUrl } from './fileSystem'

export const MOTION_LIBRARY_PATH = '/home/codex450/creative/_library/motions/catalog.json'
export const POSE_STILL_WORKFLOW = 'image-edit'

let cached = null

function normalizeCatalog(raw) {
  const items = Array.isArray(raw?.items) ? raw.items : []
  return {
    version: raw?.version || 1,
    root: raw?.root || '/home/codex450/creative/_library/motions',
    items: items.map((item) => ({
      slug: String(item.slug || ''),
      title: String(item.title || item.slug || 'Motion'),
      chars: Number(item.chars) || 1,
      fps: Number(item.fps) || 24,
      license: item.license || '',
      source: item.source || '',
      approval: item.approval || 'vendor',
      tags: Array.isArray(item.tags) ? item.tags : [],
      animation: item.animation || '',
      files: item.files || {},
    })).filter((item) => item.slug),
  }
}

export async function loadMotionCatalog() {
  if (cached) return cached
  const api = typeof window !== 'undefined' ? window.electronAPI : null
  if (api?.readFile) {
    try {
      const result = await api.readFile(MOTION_LIBRARY_PATH, { encoding: 'utf8' })
      if (result?.success && result.data) {
        cached = normalizeCatalog(JSON.parse(result.data))
        return cached
      }
    } catch (_) { /* fall through to bundled snapshot */ }
  }
  cached = normalizeCatalog(bundledCatalog)
  return cached
}

export function findMotion(slug, catalog) {
  if (!slug) return null
  return (catalog?.items || []).find((item) => item.slug === slug) || null
}

export async function motionPreviewUrl(motion) {
  const path = motion?.files?.pose || motion?.files?.preview || ''
  if (!path) return ''
  try {
    return await getAbsoluteFileUrl(path)
  } catch (_) {
    return ''
  }
}

export function motionPosePrompt(motion) {
  if (!motion) return ''
  return `Match this pose / action exactly: ${motion.title}. Photoreal. Keep identity and wardrobe from the character reference. Do not invent a different body position.`
}
