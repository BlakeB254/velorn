import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  applyCameraPatch,
  fromBlockingDoc,
  normalizeCameraRig,
} from '../../services/cameraRig'
import { applyRigToBlocking, ensureBlockingCamera, loadBlockingDoc, saveBlockingDoc } from '../../services/blockingStore'
import {
  enuFacingToThreeYaw,
  enuToThree,
  frustumRaysEnu,
  samplePath,
  threeToEnu,
} from '../../services/blockingScene'
import { evaluateGates } from '../../services/blockingGates'
import { renderBlockingControl } from '../../services/blockingRender'
import { slotForCard } from '../../services/studioUi'
import { applyCharacterCardRefSets } from '../../services/generationRefs'
import useProjectStore from '../../stores/projectStore'
import useAssetsStore from '../../stores/assetsStore'

const TOP_SIZE = 520
const SIDE_SIZE = { w: 520, h: 260 }
const FRUSTUM_LEN_M = 4.5
const FALLBACK_COLOR = '#fbbf24'
const CAM_COLOR = '#38bdf8'

const GATE_PILL_CLASS = {
  pass: 'border-emerald-500/50 text-emerald-400',
  fail: 'border-red-500/60 text-red-400',
  skip: 'border-sf-dark-600 text-sf-text-muted',
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** Camera doc at selector index: 0 = primary, i>0 = camera.cuts[i-1]. */
function camDocAt(doc, camIndex) {
  if (camIndex > 0) {
    const cut = Array.isArray(doc?.camera?.cuts) ? doc.camera.cuts[camIndex - 1] : null
    if (cut && typeof cut === 'object') return cut
  }
  return doc?.camera && typeof doc.camera === 'object' ? doc.camera : {}
}

function camNameAt(doc, camIndex) {
  return camDocAt(doc, camIndex).camera_id || 'CAM_canonical'
}

/** Doc + scrub time → the sampled scene pose (never mutates the doc). */
function poseAt(doc, t, camIndex = 0) {
  const cam = camDocAt(doc, camIndex)
  const camPos = cam.position && typeof cam.position === 'object' ? cam.position : {}
  const camera = samplePath(cam.path, t, {
    x_m: Number(camPos.x_m) || 0,
    y_m: Number(camPos.y_m) ?? -2,
    z_m: Number(camPos.z_m) || 1.55,
    facing_deg: Number(cam.facing_deg) || 0,
    pitch_deg: Number(cam.pitch_deg) || 0,
    roll_deg: Number(cam.roll_deg) || 0,
    fov_deg: Number(cam.fov_deg) || 40.95,
  })
  const characters = (Array.isArray(doc?.characters) ? doc.characters : []).map((ch) => {
    const pos = ch.position && typeof ch.position === 'object' ? ch.position : {}
    return {
      cast_id: ch.cast_id,
      label: ch.label || ch.cast_id,
      color: ch.color || FALLBACK_COLOR,
      height_m: Number(ch.height_m) || 1.7,
      ...samplePath(ch.path, t, {
        x_m: Number(pos.x_m) || 0,
        y_m: Number(pos.y_m) || 0,
        z_m: Number(pos.z_m) || 0,
        facing_deg: Number(ch.facing_deg) || 0,
      }),
    }
  })
  const footprint = Array.isArray(doc?.environment?.footprint) ? doc.environment.footprint : []
  return { camera, characters, footprint }
}

/** Latest scrub ceiling: longest path or the export.samples frame range. */
function timeCeiling(doc) {
  let max = 0
  const walk = (path) => {
    for (const key of Array.isArray(path) ? path : []) {
      const ts = Number(key && key.t_s)
      if (Number.isFinite(ts)) max = Math.max(max, ts)
    }
  }
  walk(doc?.camera?.path)
  for (const cut of Array.isArray(doc?.camera?.cuts) ? doc.camera.cuts : []) walk(cut?.path)
  for (const ch of Array.isArray(doc?.characters) ? doc.characters : []) walk(ch.path)
  const samples = Array.isArray(doc?.export?.samples) ? doc.export.samples : []
  const fps = Number(doc?.fps) || 25
  for (const s of samples) {
    const f = Number(s && s.frame)
    if (Number.isFinite(f)) max = Math.max(max, (f - 1) / fps)
  }
  return Math.max(4, Math.ceil(max * 4) / 4)
}

function buildFrustumLines(fovDeg, aspect) {
  const corners = frustumRaysEnu({ fovDeg, aspect, length: FRUSTUM_LEN_M })
    .map((r) => new THREE.Vector3(r.x, r.z, -r.y)) // ENU direction → three (x, z, −y)
  const apex = new THREE.Vector3(0, 0, 0)
  const pts = []
  for (const c of corners) pts.push(apex.clone(), c)
  for (let i = 0; i < 4; i++) pts.push(corners[i], corners[(i + 1) % 4])
  const geometry = new THREE.BufferGeometry().setFromPoints(pts)
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: CAM_COLOR, transparent: true, opacity: 0.8 }),
  )
}

function buildCharacterMesh(ch) {
  const h = Math.max(0.3, Number(ch.height_m) || 1.7)
  const color = new THREE.Color(ch.color || FALLBACK_COLOR)
  const group = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.16, h, 12),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
  )
  body.position.y = h / 2 // position is the character's BASE (feet)
  group.add(body)
  // Top-view marker: the body cylinder is a sub-pixel dot from directly
  // above, so characters get a flat ground disc + a facing wedge (unlit —
  // readable at any zoom, and a usable drag target). Wedge points −Z like
  // the nose cone.
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.3, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }),
  )
  disc.rotation.x = -Math.PI / 2
  disc.position.y = 0.015
  group.add(disc)
  const wedge = new THREE.Mesh(
    new THREE.CircleGeometry(0.46, 24, Math.PI / 2 - 0.55, 1.1),
    new THREE.MeshBasicMaterial({ color }),
  )
  wedge.rotation.x = -Math.PI / 2
  wedge.position.y = 0.02
  group.add(wedge)
  // Facing arrow: cone nose along the group's −Z (three facing direction).
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.1, 0.38, 10),
    new THREE.MeshStandardMaterial({ color: 0xe9eaf0, roughness: 0.5 }),
  )
  nose.rotation.x = -Math.PI / 2
  nose.position.set(0, h * 0.72, -0.34)
  group.add(nose)
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.4, 0.03, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  )
  ring.rotation.x = Math.PI / 2
  ring.position.y = 0.03
  ring.visible = false
  group.add(ring)
  group.userData = { cast_id: ch.cast_id, body, ring }
  return group
}

export default function BlockingPanel({ projectPath, studio, card, onApplyRig }) {
  const slot = slotForCard(studio, card)
  const shotSlug = slot?.slot_id || slot?.board_shot || card?.id
  const [doc, setDoc] = useState(null)
  const [error, setError] = useState('')
  const [t, setT] = useState(0)
  const [rendering, setRendering] = useState(false)
  const [selected, setSelected] = useState(null) // 'camera' | cast_id | null
  const [camIndex, setCamIndex] = useState(0) // 0 = primary camera, i>0 = camera.cuts[i-1]
  const topHostRef = useRef(null)
  const sideHostRef = useRef(null)
  const threeRef = useRef(null)
  const dragRef = useRef(null) // { kind: 'camera' } | { kind: 'char', castId }

  useEffect(() => { setCamIndex(0) }, [shotSlug])

  const cutCount = Array.isArray(doc?.camera?.cuts) ? doc.camera.cuts.length : 0
  const rig = useMemo(
    () => normalizeCameraRig(fromBlockingDoc(doc ? { ...doc, camera: camDocAt(doc, camIndex) } : {})),
    [doc, camIndex])
  const pose = useMemo(() => (doc ? poseAt(doc, t, camIndex) : null), [doc, t, camIndex])
  const tMax = useMemo(() => (doc ? timeCeiling(doc) : 4), [doc])
  // P5 (plan §4.5): accepted character cards are the approved source of
  // ref_set.front. Enrichment is a pure derivation — the on-disk doc gets it
  // at save/generate time, gates evaluate the enriched view.
  const currentProject = useProjectStore((s) => s.currentProject)
  const assets = useAssetsStore((s) => s.assets)
  const references = currentProject?.references
  const docWithRefs = useMemo(
    () => applyCharacterCardRefSets(
      doc,
      references,
      (assetId) => (assets || []).find((a) => a.id === assetId)?.path || null,
    ),
    [doc, references, assets],
  )
  // G0–G6 gate strip (docs/blocking-v7-plan.md §4.6). G6 refs are approved
  // project-relative only (existence is checked at generation time, not here);
  // G5's control-dir listing only exists after a bridge render, so it reports
  // skip ("evaluated at generation time") — no new IPC channel needed.
  const gates = useMemo(() => (docWithRefs
    ? evaluateGates(docWithRefs, projectPath ? { approvedRoots: [projectPath], baseDir: projectPath } : {})
    : null), [docWithRefs, projectPath])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!projectPath || !shotSlug) return
      const loaded = await loadBlockingDoc(projectPath, shotSlug)
      if (cancelled) return
      setDoc(loaded ? ensureBlockingCamera(loaded) : null)
    }
    run()
    return () => { cancelled = true }
  }, [projectPath, shotSlug])

  /* ── three.js setup (once per mounted panel with a doc) ─────────────── */
  const hasDoc = Boolean(doc)
  useEffect(() => {
    if (!hasDoc || !topHostRef.current || !sideHostRef.current || threeRef.current) return undefined
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0f1218)
    scene.add(new THREE.HemisphereLight(0xdde4ff, 0x1a1d26, 1.15))
    const sun = new THREE.DirectionalLight(0xffffff, 1.2)
    sun.position.set(6, 10, 4)
    scene.add(sun)
    const grid = new THREE.GridHelper(40, 40, 0x2a3140, 0x1d2230) // 1 m cells
    grid.position.y = 0.001
    scene.add(grid)

    // Top-down view camera (VIEW only — never the doc camera).
    const topCam = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 200)
    topCam.position.set(0, 40, 0)
    topCam.up.set(0, 0, -1) // north (+Y enu = −Z three) points up-screen
    topCam.lookAt(0, 0, 0)
    // Side elevation (depth Y × height Z): looks along −X, north runs right.
    const sideCam = new THREE.OrthographicCamera(-10, 10, 5, -5, 0.1, 200)
    sideCam.position.set(40, 4, 0)
    sideCam.up.set(0, 1, 0)
    sideCam.lookAt(0, 2, 0)

    const topRenderer = new THREE.WebGLRenderer({ antialias: true })
    topRenderer.setSize(TOP_SIZE, TOP_SIZE)
    topRenderer.domElement.className = 'w-full h-auto rounded border border-sf-dark-700 cursor-crosshair'
    topHostRef.current.appendChild(topRenderer.domElement)
    const sideRenderer = new THREE.WebGLRenderer({ antialias: true })
    sideRenderer.setSize(SIDE_SIZE.w, SIDE_SIZE.h)
    sideRenderer.domElement.className = 'w-full h-auto rounded border border-sf-dark-700'
    sideHostRef.current.appendChild(sideRenderer.domElement)

    // Shot camera rig: body cone + fov/pitch frustum lines.
    const camGroup = new THREE.Group()
    camGroup.rotation.order = 'YXZ'
    const camBody = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.55, 4),
      new THREE.MeshStandardMaterial({ color: CAM_COLOR, roughness: 0.6 }),
    )
    camBody.rotation.x = -Math.PI / 2 // nose along −Z facing
    camGroup.add(camBody)
    const camRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.03, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    )
    camRing.rotation.x = Math.PI / 2
    camRing.visible = false
    camGroup.add(camRing)
    scene.add(camGroup)
    const frustum = buildFrustumLines(40.95, 16 / 9)
    camGroup.add(frustum)

    threeRef.current = {
      scene,
      topCam,
      sideCam,
      topRenderer,
      sideRenderer,
      camGroup,
      camRing,
      frustum,
      charGroups: new Map(),
      envLine: null,
      topView: 12,
      sideView: 5,
      ground: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      raycaster: new THREE.Raycaster(),
    }
    // Wheel = zoom/dolly of the VIEW only (never the doc camera). Native
    // listeners: React's delegated wheel handlers are passive, so
    // preventDefault would no-op and the page would scroll under the cursor.
    const zoomView = (which) => (event) => {
      event.preventDefault()
      const ctx = threeRef.current
      if (!ctx) return
      const factor = Math.pow(1.0015, event.deltaY)
      if (which === 'top') {
        ctx.topView = clamp(ctx.topView * factor, 2, 30)
        ctx.topCam.left = -ctx.topView
        ctx.topCam.right = ctx.topView
        ctx.topCam.top = ctx.topView
        ctx.topCam.bottom = -ctx.topView
        ctx.topCam.updateProjectionMatrix()
      } else {
        ctx.sideView = clamp(ctx.sideView * factor, 1, 20)
        const aspect = SIDE_SIZE.w / SIDE_SIZE.h
        ctx.sideCam.left = -ctx.sideView * aspect
        ctx.sideCam.right = ctx.sideView * aspect
        ctx.sideCam.top = ctx.sideView
        ctx.sideCam.bottom = -ctx.sideView
        ctx.sideCam.updateProjectionMatrix()
      }
      ctx.topRenderer.render(scene, ctx.topCam)
      ctx.sideRenderer.render(scene, ctx.sideCam)
    }
    const onTopWheel = zoomView('top')
    const onSideWheel = zoomView('side')
    topRenderer.domElement.addEventListener('wheel', onTopWheel, { passive: false })
    sideRenderer.domElement.addEventListener('wheel', onSideWheel, { passive: false })
    return () => {
      topRenderer.domElement.removeEventListener('wheel', onTopWheel)
      sideRenderer.domElement.removeEventListener('wheel', onSideWheel)
      for (const renderer of [topRenderer, sideRenderer]) {
        renderer.domElement.remove()
        renderer.dispose()
      }
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose()
        if (obj.material) {
          for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) m.dispose()
        }
      })
      threeRef.current = null
    }
  }, [hasDoc])

  /* ── push doc pose → scene, then render both panes ──────────────────── */
  useEffect(() => {
    const ctx = threeRef.current
    if (!ctx || !pose) return
    const { scene, camGroup, camRing, charGroups } = ctx

    // Camera.
    const camThree = enuToThree({ x_m: pose.camera.x_m, y_m: pose.camera.y_m, z_m: pose.camera.z_m })
    camGroup.position.set(camThree.x, camThree.y, camThree.z)
    camGroup.rotation.set(
      ((pose.camera.pitch_deg || 0) * Math.PI) / 180,
      enuFacingToThreeYaw(pose.camera.facing_deg),
      ((pose.camera.roll_deg || 0) * Math.PI) / 180,
    )
    camRing.visible = selected === 'camera'
    const fov = Number(pose.camera.fov_deg) || 40.95
    if (Math.abs((ctx.lastFov || 0) - fov) > 0.01) {
      camGroup.remove(ctx.frustum)
      ctx.frustum.geometry.dispose()
      ctx.frustum.material.dispose()
      ctx.frustum = buildFrustumLines(fov, 16 / 9)
      camGroup.add(ctx.frustum)
      ctx.lastFov = fov
    }

    // Characters (add/remove as the cast set changes).
    const seen = new Set()
    for (const ch of pose.characters) {
      if (!ch.cast_id) continue
      seen.add(ch.cast_id)
      let group = charGroups.get(ch.cast_id)
      if (!group || Math.abs((group.userData.height_m || 0) - ch.height_m) > 0.01
        || group.userData.color !== ch.color) {
        if (group) scene.remove(group)
        group = buildCharacterMesh(ch)
        group.userData.height_m = ch.height_m
        group.userData.color = ch.color
        charGroups.set(ch.cast_id, group)
        scene.add(group)
      }
      const p = enuToThree(ch)
      group.position.set(p.x, p.y, p.z)
      group.rotation.y = enuFacingToThreeYaw(ch.facing_deg)
      group.userData.ring.visible = selected === ch.cast_id
    }
    for (const [castId, group] of charGroups) {
      if (!seen.has(castId)) {
        scene.remove(group)
        charGroups.delete(castId)
      }
    }

    // Environment footprint underlay (ground plan polygon, ENU x/y).
    if (ctx.envLine) {
      scene.remove(ctx.envLine)
      ctx.envLine.geometry.dispose()
      ctx.envLine.material.dispose()
      ctx.envLine = null
    }
    if (pose.footprint.length >= 3) {
      const pts = pose.footprint.map((pt) => {
        const p = enuToThree({ x_m: pt.x_m, y_m: pt.y_m, z_m: 0 })
        return new THREE.Vector3(p.x, 0.02, p.z)
      })
      ctx.envLine = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xa999ff }),
      )
      scene.add(ctx.envLine)
    }

    ctx.topRenderer.render(scene, ctx.topCam)
    ctx.sideRenderer.render(scene, ctx.sideCam)
  }, [pose, selected])

  /* ── interactions (top pane): drag camera/characters, wheel = view zoom ─ */
  const groundEnuFromEvent = (event) => {
    const ctx = threeRef.current
    if (!ctx) return null
    const rect = ctx.topRenderer.domElement.getBoundingClientRect()
    const ndc = {
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    }
    ctx.raycaster.setFromCamera(ndc, ctx.topCam)
    const hit = new THREE.Vector3()
    if (!ctx.raycaster.ray.intersectPlane(ctx.ground, hit)) return null
    const enu = threeToEnu(hit)
    return { x_m: Number(enu.x_m.toFixed(2)), y_m: Number(enu.y_m.toFixed(2)) }
  }

  const onTopPointerDown = (event) => {
    if (!doc || !pose) return
    const point = groundEnuFromEvent(event)
    if (!point) return
    const camDist = Math.hypot(pose.camera.x_m - point.x_m, pose.camera.y_m - point.y_m)
    if (camDist < 0.6) {
      dragRef.current = { kind: 'camera' }
      setSelected('camera')
      event.target.setPointerCapture?.(event.pointerId)
      return
    }
    let best = null
    for (const ch of pose.characters) {
      const d = Math.hypot(ch.x_m - point.x_m, ch.y_m - point.y_m)
      if (d < 0.5 && (!best || d < best.d)) best = { d, castId: ch.cast_id }
    }
    if (best) {
      dragRef.current = { kind: 'char', castId: best.castId }
      setSelected(best.castId)
      event.target.setPointerCapture?.(event.pointerId)
    } else {
      setSelected(null)
    }
  }

  /** applyRigToBlocking, but camIndex-aware: edits land on the selected cut. */
  const applyRigToCam = (current, nextRig) => {
    if (camIndex <= 0) return applyRigToBlocking(current, nextRig)
    const patched = applyRigToBlocking(
      { ...current, camera: camDocAt(current, camIndex) }, nextRig).camera
    const cuts = [...(current.camera.cuts || [])]
    cuts[camIndex - 1] = patched
    return { ...current, camera: { ...current.camera, cuts } }
  }

  const onTopPointerMove = (event) => {
    const drag = dragRef.current
    if (!drag || !doc) return
    const point = groundEnuFromEvent(event)
    if (!point) return
    if (drag.kind === 'camera') {
      const nextRig = applyCameraPatch(rig, { x_m: point.x_m, y_m: point.y_m, z_m: rig.camera.z_m })
      setDoc(applyRigToCam(doc, nextRig))
      return
    }
    setDoc({
      ...doc,
      characters: doc.characters.map((ch) => (ch.cast_id === drag.castId
        ? { ...ch, position: { ...ch.position, x_m: point.x_m, y_m: point.y_m } }
        : ch)),
    })
  }

  const onTopPointerUp = () => { dragRef.current = null }

  const patchCamera = (fields) => {
    if (!doc) return
    setDoc(applyRigToCam(doc, applyCameraPatch(rig, fields)))
  }

  const save = async () => {
    setError('')
    try {
      // Persist with card-backed ref_set.front so the on-disk doc the Blender
      // bridge reads is self-contained (plan §4.5).
      await saveBlockingDoc(projectPath, shotSlug, docWithRefs || doc)
      if (docWithRefs && docWithRefs !== doc) setDoc(docWithRefs)
    } catch (err) {
      setError(err.message || String(err))
    }
  }

  // Save → gates → Blender bridge (green/pose/depth + export.samples) → G5
  // re-check → hand off to the ComfyUI control workflow. See blocking-v7 §6.
  const generateFromBlocking = async () => {
    setError('')
    setRendering(true)
    try {
      const outcome = await renderBlockingControl(
        { projectPath, shotSlug, doc: docWithRefs || doc, width: 768, height: 1344 },
        { saveBlockingDoc, loadBlockingDoc },
      )
      if (outcome.doc) setDoc(ensureBlockingCamera(outcome.doc))
      if (!outcome.ok) {
        setError(outcome.error || 'Bridge render failed')
        return
      }
      window.dispatchEvent(new CustomEvent('comfystudio-mcp-prepare-generation', {
        detail: {
          workflowId: 'cdx-ltx-union-control-flf',
          storyboardCardId: card.id,
          prompt: card.action || card.title,
          resolution: { width: 768, height: 1344 },
          autoQueue: false,
        },
      }))
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setRendering(false)
    }
  }

  // Bridge-written screen-space samples for the scrubbed frame, filtered to
  // the selected camera (rows are tagged camera_id since multi-cut renders;
  // untagged rows from single-cam docs count as the primary).
  const sampleReadout = useMemo(() => {
    const camName = camNameAt(doc, camIndex)
    const samples = (Array.isArray(doc?.export?.samples) ? doc.export.samples : [])
      .filter((s) => (s.camera_id || 'CAM_canonical') === camName)
    if (!samples.length) return null
    const fps = Number(doc?.fps) || 25
    const frame = Math.max(1, Math.round(t * fps) + 1)
    const frames = [...new Set(samples.map((s) => Number(s.frame)).filter(Number.isFinite))].sort((a, b) => a - b)
    const nearest = frames.reduce((a, b) => (Math.abs(b - frame) < Math.abs(a - frame) ? b : a), frames[0])
    const rows = samples
      .filter((s) => Number(s.frame) === nearest)
      .map((s) => ({
        cast_id: s.cast_id,
        x: Number(s.screen_x),
        y: Number(s.screen_y),
        on_screen: Boolean(s.on_screen),
        color: (doc.characters || []).find((c) => c.cast_id === s.cast_id)?.color || FALLBACK_COLOR,
      }))
    return { frame: nearest, rows }
  }, [doc, t, camIndex])

  if (!shotSlug) return null

  return (
    <div className="rounded border border-sf-dark-700 bg-sf-dark-950 p-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">Blocking · {shotSlug}</span>
        <span className="text-[10px] text-sf-text-muted">drag camera/arrows in top view · wheel zooms the view</span>
      </div>
      {doc && cutCount > 0 && (
        <div className="flex flex-wrap items-center gap-1" aria-label="camera cuts">
          <span className="text-[9px] uppercase tracking-wide text-sf-text-muted">cam</span>
          {Array.from({ length: cutCount + 1 }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setCamIndex(i)}
              className={`px-1.5 py-0.5 text-[9px] rounded border tabular-nums ${i === camIndex
                ? 'border-sf-accent/60 text-sf-accent'
                : 'border-sf-dark-600 text-sf-text-muted hover:text-sf-text-secondary'}`}
            >
              {camNameAt(doc, i)}
            </button>
          ))}
        </div>
      )}
      {!doc ? (
        <p className="text-[11px] text-sf-text-muted">No blocking.json for this slot yet. Generate-from-blocking can still use first/last frames.</p>
      ) : (
        <>
          {gates && (
            <div className="flex flex-wrap items-center gap-1" aria-label="blocking gates">
              {gates.gates.map((g) => (
                <span
                  key={g.gate}
                  title={`${g.gate} ${g.status}${g.reasons[0] ? ` — ${g.reasons[0]}` : ''}`}
                  className={`px-1.5 py-0.5 text-[9px] rounded border tabular-nums ${GATE_PILL_CLASS[g.status] || GATE_PILL_CLASS.skip}`}
                >
                  {g.gate}
                </span>
              ))}
              <span className="text-[9px] text-sf-text-muted ml-1">
                {gates.ready ? 'ready' : 'gates failing'} · G5 evaluated at generation time
              </span>
            </div>
          )}
          <div ref={topHostRef} onPointerDown={onTopPointerDown} onPointerMove={onTopPointerMove} onPointerUp={onTopPointerUp} />
          <div>
            <div className="px-0.5 py-0.5 text-[10px] uppercase tracking-wide text-sf-text-muted">side · depth (Y) × height (Z)</div>
            <div ref={sideHostRef} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-sf-text-muted">t</span>
            <input
              type="range"
              min={0}
              max={tMax}
              step={0.04}
              value={Math.min(t, tMax)}
              onChange={(event) => setT(Number(event.target.value))}
              className="flex-1 h-1 accent-sf-accent"
            />
            <span className="text-[10px] text-sf-text-muted tabular-nums w-12 text-right">{t.toFixed(2)}s</span>
          </div>
          {sampleReadout && (
            <div className="rounded border border-sf-dark-700 bg-sf-dark-900 px-2 py-1">
              <div className="text-[10px] uppercase tracking-wide text-sf-text-muted">
                frame {sampleReadout.frame} · bridge screen samples
              </div>
              <ul className="text-[10px] text-sf-text-secondary space-y-0.5 mt-0.5">
                {sampleReadout.rows.map((row) => (
                  <li key={row.cast_id} className="flex items-center gap-1.5 tabular-nums">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: row.color }} />
                    <span className="flex-1 truncate">{row.cast_id}</span>
                    <span>x {row.x.toFixed(2)}</span>
                    <span>y {row.y.toFixed(2)}</span>
                    <span className={row.on_screen ? 'text-emerald-400' : 'text-red-400'}>
                      {row.on_screen ? 'on screen' : 'off screen'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-[10px]">
            {['x_m', 'y_m', 'z_m', 'yaw_deg', 'pitch_deg', 'roll_deg', 'fov_deg'].map((key) => (
              <label key={key} className="space-y-0.5">
                <span className="text-sf-text-muted">{key.replace('_', ' ')}</span>
                <input
                  type="number"
                  step="0.05"
                  value={rig.camera[key]}
                  onChange={(event) => patchCamera({ [key]: Number(event.target.value) })}
                  className="w-full bg-sf-dark-800 border border-sf-dark-700 rounded px-1 py-0.5 text-sf-text-primary"
                />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            <button type="button" onClick={save} className="px-2 py-1 text-[10px] rounded border border-sf-dark-600 text-sf-text-secondary">
              Save blocking.json
            </button>
            <button
              type="button"
              onClick={() => onApplyRig?.(rig)}
              className="px-2 py-1 text-[10px] rounded border border-sf-accent/50 text-sf-accent"
            >
              Apply handle to shot
            </button>
            <button
              type="button"
              disabled={rendering}
              onClick={generateFromBlocking}
              className="px-2 py-1 text-[10px] rounded bg-sf-accent/90 text-white disabled:opacity-50"
            >
              {rendering ? 'Rendering control passes…' : 'Generate from blocking'}
            </button>
          </div>
        </>
      )}
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  )
}
