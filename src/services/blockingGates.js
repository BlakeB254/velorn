/**
 * Blocking v7 — G0–G6 spatial gates (docs/blocking-v7-plan.md §4.6).
 *
 * Ported from the gate table in the legacy director docs and mapped onto the
 * v7 world:
 *   G0 Env flat          footprint points finite (z-flat by construction);
 *                        explicit env tilt ≤ 1.5°. No env data → skip.
 *   G1 Blocking exists   doc present and validateBlockingDoc() has no errors
 *                        (warnings allowed).
 *   G2 Map underlay      environment.footprint present, ≥3 finite points
 *                        (what the panel's underlay renders). Missing → skip.
 *   G3 Character plant   every character |z_m| ≤ plantToleranceM (default
 *                        0.05 — furniture seating is a later, explicit opt-in)
 *                        and facing_deg finite in [0, 360).
 *   G4 t_s scrub         max path t_s ≤ shot duration_s × (1 + tolerance)
 *                        (±15% for drafts; overrun fails, shorter paths clamp
 *                        and are fine). No timing data → skip.
 *   G5 Control (finals)  green/pose/depth control passes frame-locked 1:1:
 *                        equal counts of f%04d.png with identical frame-number
 *                        sets. Pure over an injected listing so the service
 *                        stays node-test-safe; no listing → skip.
 *   G6 Identity          every character ref_set.front lives under an approved
 *                        cast-ref root (never invented faces). Characters with
 *                        no ref_set skip per character; no refs at all → skip.
 *
 * Verdict: { gate, status: 'pass'|'fail'|'skip', reasons: [...], details: {...} }.
 * evaluateGates(doc, opts) returns all seven plus `ready` = no `fail`.
 *
 * Everything here is pure so it runs under `node --test` and in the renderer.
 */

import { validateBlockingDoc } from './blockingV7.js'
import { normalizeFootprint } from './blockingScene.js'

export const G0_TILT_TOLERANCE_DEG = 1.5
export const G3_PLANT_TOLERANCE_M = 0.05
export const G4_DRAFT_TOLERANCE = 0.15

const verdict = (gate, status, reasons = [], details = {}) => ({ gate, status, reasons, details })

const finite = (value) => Number.isFinite(Number(value))

/** Lexical path normalize (renderer-safe, no node:path): / and .. resolved. */
export function normalizeGatePath(path) {
  const raw = String(path || '').replace(/\\/g, '/')
  const absolute = raw.startsWith('/')
  const parts = []
  for (const seg of raw.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return (absolute ? '/' : '') + parts.join('/')
}

function isUnderRoot(path, root) {
  const p = normalizeGatePath(path)
  const r = normalizeGatePath(root).replace(/\/+$/, '')
  if (!r) return false
  return p === r || p.startsWith(`${r}/`)
}

/** G0 — environment normalization: z-flat footprint, tilt ≤ 1.5°. */
export function evalG0(doc) {
  const env = doc && typeof doc === 'object' && doc.environment && typeof doc.environment === 'object'
    ? doc.environment : {}
  const footprint = Array.isArray(env.footprint) ? env.footprint : []
  const tiltDeg = finite(env.tilt_deg) ? Math.abs(Number(env.tilt_deg)) : null
  const rotation = Array.isArray(env.rotation_deg) && env.rotation_deg.length >= 2
    ? Math.max(Math.abs(Number(env.rotation_deg[0]) || 0), Math.abs(Number(env.rotation_deg[1]) || 0))
    : null
  const tilt = tiltDeg !== null ? Math.max(tiltDeg, rotation ?? 0) : rotation
  if (!footprint.length && tilt === null) {
    return verdict('G0', 'skip', ['no environment data'])
  }
  const failures = []
  const reasons = []
  if (footprint.length) {
    const usable = normalizeFootprint(footprint)
    if (usable.length !== footprint.length) {
      failures.push(`environment.footprint has ${footprint.length - usable.length} non-finite point(s)`)
    } else {
      reasons.push(`footprint (${usable.length} pts) is 2D — z-flat by construction`)
    }
  }
  if (tilt !== null) {
    if (tilt > G0_TILT_TOLERANCE_DEG) {
      failures.push(`environment tilt ${tilt.toFixed(2)}° exceeds ${G0_TILT_TOLERANCE_DEG}°`)
    } else {
      reasons.push(`env tilt ${tilt.toFixed(2)}° within ${G0_TILT_TOLERANCE_DEG}°`)
    }
  }
  return verdict('G0', failures.length ? 'fail' : 'pass', failures.length ? failures : reasons,
    { tilt_deg: tilt, footprint_points: footprint.length })
}

/** G1 — blocking.json exists for the shot and validates (warnings allowed). */
export function evalG1(doc) {
  if (!doc || typeof doc !== 'object') {
    return verdict('G1', 'fail', ['no blocking.json for this shot'])
  }
  const problems = validateBlockingDoc(doc)
  if (problems.length) return verdict('G1', 'fail', problems, { problems })
  return verdict('G1', 'pass', ['blocking doc validates (schema v7)'])
}

/** G2 — top-down underlay from the same meters bounds: footprint ≥3 points. */
export function evalG2(doc) {
  const env = doc && typeof doc === 'object' && doc.environment && typeof doc.environment === 'object'
    ? doc.environment : {}
  if (!Array.isArray(env.footprint) || !env.footprint.length) {
    return verdict('G2', 'skip', ['no environment.footprint'])
  }
  const usable = normalizeFootprint(env.footprint)
  if (usable.length !== env.footprint.length) {
    return verdict('G2', 'fail', ['environment.footprint has non-finite points'])
  }
  if (usable.length < 3) {
    return verdict('G2', 'fail', [`environment.footprint needs at least 3 points, got ${usable.length}`])
  }
  return verdict('G2', 'pass', [`footprint underlay: ${usable.length} points`], { points: usable.length })
}

/** G3 — cast planted on the ground plane, facing valid. */
export function evalG3(doc, plantToleranceM = G3_PLANT_TOLERANCE_M) {
  const characters = Array.isArray(doc?.characters) ? doc.characters : []
  if (!characters.length) return verdict('G3', 'skip', ['no characters'])
  const failures = []
  for (const ch of characters) {
    const id = String(ch?.cast_id || '?')
    const z = Number(ch?.position?.z_m)
    if (!Number.isFinite(z)) {
      failures.push(`${id}: z_m missing`)
    } else if (Math.abs(z) > plantToleranceM) {
      failures.push(`${id}: z_m ${z} off ground plane (|z| > ${plantToleranceM})`)
    }
    const facing = Number(ch?.facing_deg)
    if (!Number.isFinite(facing) || facing < 0 || facing >= 360) {
      failures.push(`${id}: facing_deg ${ch?.facing_deg} not in [0, 360)`)
    }
  }
  if (failures.length) return verdict('G3', 'fail', failures, { tolerance_m: plantToleranceM })
  return verdict('G3', 'pass', [`${characters.length} character(s) planted within ±${plantToleranceM} m`],
    { tolerance_m: plantToleranceM })
}

/** G4 — scrub timing: max path t_s must not overrun the shot duration. */
export function evalG4(doc, draftTolerance = G4_DRAFT_TOLERANCE) {
  const duration = [doc?.duration_s, doc?.playback?.duration_s].map(Number).find(Number.isFinite)
  let maxTs = 0
  let hasPath = false
  const walk = (path) => {
    for (const key of Array.isArray(path) ? path : []) {
      const t = Number(key && key.t_s)
      if (Number.isFinite(t)) {
        hasPath = true
        maxTs = Math.max(maxTs, t)
      }
    }
  }
  walk(doc?.camera?.path)
  for (const ch of Array.isArray(doc?.characters) ? doc.characters : []) walk(ch?.path)
  if (!hasPath && duration === undefined) return verdict('G4', 'skip', ['no timing data'])
  if (duration === undefined) return verdict('G4', 'skip', ['no shot duration_s to compare paths against'])
  if (!hasPath) return verdict('G4', 'skip', ['no path t_s keys'])
  const limit = duration * (1 + draftTolerance)
  const details = { duration_s: duration, max_path_t_s: maxTs, tolerance: draftTolerance }
  if (maxTs > limit + 1e-9) {
    return verdict('G4', 'fail',
      [`max path t_s ${maxTs}s overruns duration_s ${duration}s by more than ${Math.round(draftTolerance * 100)}%`],
      details)
  }
  return verdict('G4', 'pass', [`max path t_s ${maxTs}s within duration_s ${duration}s +${Math.round(draftTolerance * 100)}%`], details)
}

/** f%04d.png frame-number set from a listing of file names. */
export function frameNumberSet(names) {
  const set = new Set()
  for (const name of Array.isArray(names) ? names : []) {
    const m = /^f(\d{4})\.png$/.exec(String(name))
    if (m) set.add(m[1])
  }
  return set
}

/**
 * G5 — control passes frame-locked 1:1. `controlFrames` is an injected
 * listing { green: [...names], pose: [...names], depth: [...names] }
 * (readdir output — the service never touches the fs itself).
 */
export function evalG5(controlFrames) {
  if (!controlFrames || typeof controlFrames !== 'object') {
    return verdict('G5', 'skip', ['no control dir listing — evaluated at generation time'])
  }
  const sets = {}
  const failures = []
  for (const pass of ['green', 'pose', 'depth']) {
    if (!Array.isArray(controlFrames[pass])) {
      failures.push(`missing ${pass} pass dir`)
      continue
    }
    sets[pass] = frameNumberSet(controlFrames[pass])
    if (!sets[pass].size) failures.push(`${pass} pass has no f%04d.png frames`)
  }
  if (failures.length) return verdict('G5', 'fail', failures)
  const diff = (a, b) => [...a].filter((f) => !b.has(f)).sort()
  for (const pass of ['pose', 'depth']) {
    const missing = diff(sets.green, sets[pass])
    const extra = diff(sets[pass], sets.green)
    if (missing.length) failures.push(`${pass} missing frame(s) ${missing.join(', ')} present in green`)
    if (extra.length) failures.push(`${pass} has extra frame(s) ${extra.join(', ')} not in green`)
  }
  const count = sets.green.size
  if (failures.length) return verdict('G5', 'fail', failures, { frames: count })
  return verdict('G5', 'pass', [`green/pose/depth frame-locked 1:1 (${count} frames)`], { frames: count })
}

/**
 * G5 for multi-camera cuts (docs/blocking-v7-plan.md §6). `framesByCam` is
 * { camera_id: listing|null } — one entry per camera the doc renders
 * (primary + camera.cuts). All null → skip (nothing rendered yet). A camera
 * with no dir after a render is a FAIL, not a skip — the bridge was supposed
 * to produce it.
 */
export function evalG5Multi(framesByCam) {
  if (!framesByCam || typeof framesByCam !== 'object') {
    return verdict('G5', 'skip', ['no control dir listing — evaluated at generation time'])
  }
  const cams = Object.keys(framesByCam)
  if (!cams.length || cams.every((cam) => !framesByCam[cam])) {
    return verdict('G5', 'skip', ['no control dir listing — evaluated at generation time'])
  }
  const failures = []
  const details = { cams: {} }
  for (const cam of cams) {
    const listing = framesByCam[cam]
    if (!listing) {
      failures.push(`${cam}: no control dir (bridge did not render this camera)`)
      continue
    }
    const v = evalG5(listing)
    details.cams[cam] = v.status
    if (v.status !== 'pass') failures.push(`${cam}: ${v.reasons[0] || 'frame-lock failed'}`)
    else details.frames = v.details.frames
  }
  if (failures.length) return verdict('G5', 'fail', failures, details)
  return verdict('G5', 'pass',
    [`green/pose/depth frame-locked 1:1 for ${cams.length} camera(s) (${details.frames} frames)`],
    details)
}

/**
 * G6 — identity refs are vetted cast refs only. opts:
 *   approvedRoots: string[] — ref paths must live under one of these
 *   baseDir:       string   — relative refs resolve against this first
 *   fileExists:    (path) => boolean — optional existence probe (injected fs)
 */
export function evalG6(doc, { approvedRoots = [], baseDir = '', fileExists = null } = {}) {
  const characters = Array.isArray(doc?.characters) ? doc.characters : []
  const skipped = []
  const checked = []
  for (const ch of characters) {
    const ref = ch?.ref_set && typeof ch.ref_set === 'object' ? ch.ref_set.front : null
    if (typeof ref === 'string' && ref.trim()) checked.push({ id: String(ch?.cast_id || '?'), ref })
    else skipped.push(String(ch?.cast_id || '?'))
  }
  if (!checked.length) {
    return verdict('G6', 'skip', ['no ref_set.front refs to check'], { skipped })
  }
  const failures = []
  const roots = (Array.isArray(approvedRoots) ? approvedRoots : []).filter(Boolean)
  for (const { id, ref } of checked) {
    const resolved = baseDir && !ref.startsWith('/') ? `${String(baseDir).replace(/\/+$/, '')}/${ref}` : ref
    if (!roots.length || !roots.some((root) => isUnderRoot(resolved, root))) {
      failures.push(`${id}: ref_set.front '${ref}' is outside the approved cast-ref roots (unvetted face)`)
      continue
    }
    if (typeof fileExists === 'function' && !fileExists(resolved)) {
      failures.push(`${id}: ref_set.front '${ref}' not found on disk`)
    }
  }
  const details = { checked: checked.length, skipped, roots }
  if (failures.length) return verdict('G6', 'fail', failures, details)
  return verdict('G6', 'pass', [`${checked.length} ref(s) under approved cast-ref roots`], details)
}

/**
 * Evaluate all seven gates. opts:
 *   plantToleranceM, draftTolerance, approvedRoots, baseDir, fileExists,
 *   controlFrames (injected { green, pose, depth } listings for G5).
 * `ready` = no gate failed (skips do not block readiness).
 */
export function evaluateGates(doc, opts = {}) {
  const gates = [
    evalG0(doc),
    evalG1(doc),
    evalG2(doc),
    evalG3(doc, opts.plantToleranceM ?? G3_PLANT_TOLERANCE_M),
    evalG4(doc, opts.draftTolerance ?? G4_DRAFT_TOLERANCE),
    opts.controlFramesByCam ? evalG5Multi(opts.controlFramesByCam) : evalG5(opts.controlFrames),
    evalG6(doc, opts),
  ]
  return { gates, ready: gates.every((g) => g.status !== 'fail') }
}
