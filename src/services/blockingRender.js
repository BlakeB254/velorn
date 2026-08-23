/**
 * Blocking v7 §6 — renderer-side orchestration for "Generate from blocking":
 * save the doc, run the G0–G6 gates, invoke the Blender bridge via
 * `electronAPI.blockingRender`, then re-check G5 against the rendered
 * control-pass listing.
 *
 * Path helpers are pure (and node-test-safe); anything touching the fs goes
 * through an injected api (window.electronAPI in the app).
 */

import { evaluateGates } from './blockingGates.js'

export const DEFAULT_CAM_NAME = 'CAM_canonical'

const slugify = (shotSlug) => String(shotSlug || 'shot').replace(/[^a-z0-9_-]+/gi, '-')

/** docs/blocking/<slug> — project-relative, POSIX separators (docs only). */
export function blockingDirRel(shotSlug) {
  return `docs/blocking/${slugify(shotSlug)}`
}

/** Camera dir name render_apply uses: doc camera_id or the canonical default. */
export function camNameForDoc(doc) {
  const id = doc && typeof doc === 'object' ? doc.camera?.camera_id : null
  return (typeof id === 'string' && id.trim()) || DEFAULT_CAM_NAME
}

/** Every camera the bridge renders for this doc: primary + camera.cuts. */
export function camNamesForDoc(doc) {
  const names = [camNameForDoc(doc)]
  for (const cut of Array.isArray(doc?.camera?.cuts) ? doc.camera.cuts : []) {
    const id = typeof cut?.camera_id === 'string' ? cut.camera_id.trim() : ''
    if (id && !names.includes(id)) names.push(id)
  }
  return names
}

/** <blockingDir>/control/<shot>/<CAM> — where the three passes land. */
export function controlDirRel(shotSlug, camName = DEFAULT_CAM_NAME) {
  const slug = slugify(shotSlug)
  return `docs/blocking/${slug}/control/${slug}/${camName}`
}

/**
 * Frame range for a bridge render from the doc: doc.fps (fallback 25) and
 * duration_s (fallback 25 frames). start is always 1 for generated control.
 */
export function frameRangeForDoc(doc, { defaultFps = 25, defaultFrames = 25 } = {}) {
  const fps = Number(doc?.fps) > 0 ? Number(doc.fps) : defaultFps
  const duration = [doc?.duration_s, doc?.playback?.duration_s].map(Number).find((v) => Number.isFinite(v) && v > 0)
  const frames = Math.max(1, Math.round((duration ?? defaultFrames / fps) * fps))
  return { fps, start: 1, frames }
}

/**
 * List the rendered control passes for G5. Returns
 * { green: [...names], pose: [...names], depth: [...names] } or null when the
 * api/control dir is unavailable (dir missing = no render yet, not an error).
 */
export async function listControlFrames(api, projectPath, shotSlug, camName = DEFAULT_CAM_NAME) {
  if (!api?.listDirectory || !api?.pathJoin || !projectPath) return null
  const base = await api.pathJoin(projectPath, controlDirRel(shotSlug, camName))
  const listing = {}
  for (const pass of ['green', 'pose', 'depth']) {
    const result = await api.listDirectory(await api.pathJoin(base, pass))
    if (!result?.success) return null
    listing[pass] = (result.items || []).map((item) => item.name)
  }
  return listing
}

/**
 * Per-camera pass listings for G5 multi-cam: { camera_id: listing|null }.
 * Null per camera means its control dir is missing (or the api is absent).
 */
export async function listControlFramesByCam(api, projectPath, shotSlug, camNames) {
  const out = {}
  for (const cam of Array.isArray(camNames) ? camNames : []) {
    out[cam] = await listControlFrames(api, projectPath, shotSlug, cam)
  }
  return out
}

/**
 * Full generate-from-blocking flow. Returns
 * { ok, gates, doc?, controlDir?, frames?, error? } — `gates` is always the
 * freshest evaluation (G5 included after a successful render).
 *
 * deps: { saveBlockingDoc, loadBlockingDoc } injected for testability.
 */
export async function renderBlockingControl(
  { projectPath, shotSlug, doc, width, height, meshStandins = true },
  { saveBlockingDoc, loadBlockingDoc } = {},
) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null
  if (!api?.blockingRender) return { ok: false, error: 'Bridge render needs the desktop app.', gates: null }
  if (!projectPath || !shotSlug || !doc) return { ok: false, error: 'Nothing to render — no blocking doc.', gates: null }

  const gateOpts = { approvedRoots: [projectPath], baseDir: projectPath }
  const pre = evaluateGates(doc, gateOpts)
  if (!pre.ready) {
    const failing = pre.gates.filter((g) => g.status === 'fail')
      .map((g) => `${g.gate}: ${g.reasons[0] || 'failing'}`).join(' · ')
    return { ok: false, error: `Gates failing — ${failing}`, gates: pre }
  }

  if (typeof saveBlockingDoc === 'function') await saveBlockingDoc(projectPath, shotSlug, doc)

  const { fps, start, frames } = frameRangeForDoc(doc)
  const result = await api.blockingRender({
    projectPath, shotSlug, fps, start, frames, width, height, meshStandins,
  })
  if (!result?.success) {
    return { ok: false, error: result?.error || 'Bridge render failed.', log: result?.log, gates: pre }
  }

  // The bridge writes export.samples back into blocking.json — reload so the
  // panel's sample readout and scrub ceiling pick them up.
  const freshDoc = typeof loadBlockingDoc === 'function'
    ? (await loadBlockingDoc(projectPath, shotSlug)) || doc
    : doc
  const controlFramesByCam = await listControlFramesByCam(
    api, projectPath, shotSlug, camNamesForDoc(freshDoc))
  const gates = evaluateGates(freshDoc, { ...gateOpts, controlFramesByCam })
  const g5 = gates.gates.find((g) => g.gate === 'G5')
  if (g5?.status === 'fail') {
    return { ok: false, error: `G5: ${g5.reasons[0] || 'control passes not frame-locked'}`, gates, doc: freshDoc }
  }
  return { ok: true, gates, doc: freshDoc, controlDir: result.controlDir, frames: result.frames, log: result.log }
}
