import { fromBlockingDoc, normalizeCameraRig, toBlockingCamera, EYE_HEIGHT_M } from './cameraRig'

export function blockingRelPath(shotSlug) {
  const slug = String(shotSlug || 'shot').replace(/[^a-z0-9_-]+/gi, '-')
  return `docs/blocking/${slug}/blocking.json`
}

export async function loadBlockingDoc(projectPath, shotSlug) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null
  if (!api?.readFile || !projectPath) return null
  const path = await api.pathJoin(projectPath, blockingRelPath(shotSlug))
  try {
    const result = await api.readFile(path, { encoding: 'utf8' })
    if (!result?.success || !result.data) return null
    return JSON.parse(result.data)
  } catch {
    return null
  }
}

export async function saveBlockingDoc(projectPath, shotSlug, doc) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null
  if (!api?.writeFile || !projectPath) throw new Error('Blocking save needs the desktop app.')
  const path = await api.pathJoin(projectPath, blockingRelPath(shotSlug))
  const dir = path.replace(/\/blocking\.json$/, '')
  if (api.createDirectory) await api.createDirectory(dir)
  const result = await api.writeFile(path, `${JSON.stringify(doc, null, 2)}\n`)
  if (result && result.success === false) throw new Error(result.error || 'Could not write blocking.json')
  return path
}

export function ensureBlockingCamera(doc) {
  const next = doc && typeof doc === 'object' ? JSON.parse(JSON.stringify(doc)) : { schema_version: 2, camera: {}, characters: [] }
  const rig = normalizeCameraRig(fromBlockingDoc(next))
  if (!next.camera) next.camera = {}
  if (!Number(next.camera.position?.z_m)) {
    next.camera.position = { ...(next.camera.position || {}), z_m: EYE_HEIGHT_M }
  }
  next.camera = { ...next.camera, ...toBlockingCamera(rig) }
  return next
}

export function applyRigToBlocking(doc, rig) {
  const next = ensureBlockingCamera(doc)
  next.camera = { ...next.camera, ...toBlockingCamera(rig) }
  return next
}
