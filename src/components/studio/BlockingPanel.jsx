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
  pass: 'border-sf-success/50 text-sf-success bg-sf-success/10',
  fail: 'border-sf-error/60 text-sf-error bg-sf-error/10',
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

  const firstFailingGate = gates?.gates?.find((g) => g.status !== 'pass')

  return (
    <div className="rounded border border-sf-dark-700 bg-sf-dark-950 p-3 space-y-5 text-xs">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-widest text-sf-text-muted font-medium">
          BLOCKING • {shotSlug}
        </span>
      </div>

      {!doc ? (
        /* Honest empty state — no guaranteed-fail button, accurate copy */
        <div className="py-6 border border-dashed border-sf-dark-600 rounded flex flex-col items-center text-center">
          <div className="text-sf-text-primary text-sm font-medium mb-2">No blocking data</div>
          <div className="text-sf-text-muted text-[11px] max-w-[260px] leading-tight mb-4">
            No blocking.json for this slot yet. GENERATE FROM BLOCKING can still use first/last frames from the shot.
          </div>
        </div>
      ) : (
        <>
          {/* STATUS — headline ready/blocked state */}
          {gates && (
            <div className="space-y-2">
              <div
                className={`flex items-center gap-3 px-4 py-3 rounded border ${
                  gates.ready
                    ? 'border-sf-success/40 bg-sf-success/5'
                    : 'border-sf-error/40 bg-sf-error/5'
                }`}
              >
                <div
                  className={`inline-flex items-center px-3 py-1 text-xs font-mono uppercase tracking-[1px] rounded font-medium ${
                    gates.ready
                      ? 'bg-sf-success text-white'
                      : 'bg-sf-error text-white'
                  }`}
                >
                  {gates.ready ? 'READY' : 'BLOCKED'}
                </div>
                <div className="flex-1 text-sm text-sf-text-primary">
                  {gates.ready ? (
                    'All gates passing — ready to generate'
                  ) : firstFailingGate ? (
                    <>
                      {firstFailingGate.gate} — {firstFailingGate.reasons?.[0] || 'gate failure'}
                    </>
                  ) : (
                    'Gates failing'
                  )}
                </div>
                <div className="text-[10px] text-sf-text-muted tabular-nums text-right">
                  G5 evaluated<br />at generation
                </div>
              </div>

              {/* Gate pills — keep operator codes but now secondary */}
              <div className="flex flex-wrap items-center gap-1.5 pl-1" aria-label="blocking gates">
                {gates.gates.map((g) => (
                  <span
                    key={g.gate}
                    title={`${g.gate} ${g.status}${g.reasons?.[0] ? ` — ${g.reasons[0]}` : ''}`}
                    className={`px-2.5 py-1 text-xs font-mono rounded border tabular-nums transition-colors ${GATE_PILL_CLASS[g.status] || GATE_PILL_CLASS.skip}`}
                  >
                    {g.gate}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* VIEWPORTS section */}
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <div className="text-[11px] uppercase tracking-widest font-medium text-sf-text-muted">VIEWPORTS</div>
              <div className="text-[11px] text-sf-text-muted">drag camera/characters in top view · wheel zooms</div>
            </div>

            {/* Top viewport */}
            <div
              ref={topHostRef}
              onPointerDown={onTopPointerDown}
              onPointerMove={onTopPointerMove}
              onPointerUp={onTopPointerUp}
              aria-label="Top-down orthographic view: drag to reposition camera or characters"
              className="rounded border border-sf-dark-700 bg-sf-dark-900 overflow-hidden cursor-crosshair"
            />

            {/* Side viewport */}
            <div className="space-y-1">
              <div className="px-1 text-[11px] uppercase tracking-widest text-sf-text-muted">SIDE — DEPTH (Y) × HEIGHT (Z)</div>
              <div
                ref={sideHostRef}
                aria-label="Side orthographic elevation view"
                className="rounded border border-sf-dark-700 bg-sf-dark-900 overflow-hidden"
              />
            </div>

            {/* Time scrubber — improved container */}
            <div className="flex items-center gap-3 bg-sf-dark-900 border border-sf-dark-700 rounded px-4 py-3">
              <span className="font-mono text-xs text-sf-text-muted w-5">t</span>
              <input
                type="range"
                min={0}
                max={tMax}
                step={0.04}
                value={Math.min(t, tMax)}
                onChange={(event) => setT(Number(event.target.value))}
                className="flex-1 accent-sf-accent cursor-pointer"
                aria-label="Scrub timeline"
              />
              <span className="font-mono text-xs tabular-nums text-sf-text-secondary w-14 text-right">
                {t.toFixed(2)}s
              </span>
            </div>
          </div>

          {/* Sample readout */}
          {sampleReadout && (
            <div className="rounded border border-sf-dark-700 bg-sf-dark-900 p-3">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-widest text-sf-text-muted mb-3">
                <span>BRIDGE SAMPLES — FRAME {sampleReadout.frame}</span>
              </div>
              <ul className="space-y-2 text-xs">
                {sampleReadout.rows.map((row) => (
                  <li key={row.cast_id} className="flex items-center gap-3 tabular-nums">
                    <span
                      className="w-3 h-3 rounded-full shrink-0 ring-1 ring-offset-2 ring-offset-sf-dark-900 ring-sf-dark-700"
                      style={{ background: row.color }}
                    />
                    <span className="flex-1 font-medium text-sf-text-secondary truncate">{row.cast_id}</span>
                    <span className="text-sf-text-muted">x {row.x.toFixed(2)}</span>
                    <span className="text-sf-text-muted">y {row.y.toFixed(2)}</span>
                    <span
                      className={`px-3 py-px text-[10px] font-medium rounded-full ${
                        row.on_screen
                          ? 'bg-sf-success/10 text-sf-success'
                          : 'bg-sf-error/10 text-sf-error'
                      }`}
                    >
                      {row.on_screen ? 'ON SCREEN' : 'OFF'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* CAMERA RIG — grouped numerics */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="text-[11px] uppercase tracking-widest font-medium text-sf-text-muted">CAMERA RIG</div>
              {doc && cutCount > 0 && (
                <div className="flex flex-wrap gap-1" aria-label="camera cuts">
                  {Array.from({ length: cutCount + 1 }, (_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setCamIndex(i)}
                      className={`px-2 py-0.5 text-[10px] font-mono rounded border tabular-nums transition-all ${
                        i === camIndex
                          ? 'border-sf-accent/70 bg-sf-accent/10 text-sf-accent'
                          : 'border-sf-dark-600 text-sf-text-muted hover:text-sf-text-secondary hover:border-sf-text-muted'
                      }`}
                    >
                      {camNameAt(doc, i)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-sf-dark-900 border border-sf-dark-700 rounded p-4 space-y-5">
              {/* Position */}
              <div>
                <div className="text-[10px] uppercase tracking-[0.5px] text-sf-text-muted mb-3">POSITION (m)</div>
                <div className="grid grid-cols-3 gap-4">
                  {['x_m', 'y_m', 'z_m'].map((key) => (
                    <label key={key} className="space-y-1">
                      <div className="text-[10px] text-sf-text-muted font-medium uppercase tracking-wider">
                        {key.replace('_m', '')}
                      </div>
                      <input
                        type="number"
                        step="0.05"
                        value={rig.camera[key] ?? 0}
                        onChange={(event) => patchCamera({ [key]: Number(event.target.value) })}
                        className="w-full bg-sf-dark-800 border border-sf-dark-600 hover:border-sf-dark-500 focus:border-sf-accent rounded px-3 py-2 text-sm text-sf-text-primary tabular-nums text-right focus:outline-none transition-colors"
                      />
                    </label>
                  ))}
                </div>
              </div>

              {/* Rotation */}
              <div>
                <div className="text-[10px] uppercase tracking-[0.5px] text-sf-text-muted mb-3">ROTATION (°)</div>
                <div className="grid grid-cols-3 gap-4">
                  {['yaw_deg', 'pitch_deg', 'roll_deg'].map((key) => {
                    const label = key.replace('_deg', '').toUpperCase()
                    return (
                      <label key={key} className="space-y-1">
                        <div className="text-[10px] text-sf-text-muted font-medium uppercase tracking-wider">
                          {label}
                        </div>
                        <input
                          type="number"
                          step="0.1"
                          value={rig.camera[key] ?? 0}
                          onChange={(event) => patchCamera({ [key]: Number(event.target.value) })}
                          className="w-full bg-sf-dark-800 border border-sf-dark-600 hover:border-sf-dark-500 focus:border-sf-accent rounded px-3 py-2 text-sm text-sf-text-primary tabular-nums text-right focus:outline-none transition-colors"
                        />
                      </label>
                    )
                  })}
                </div>
              </div>

              {/* Lens */}
              <div>
                <div className="text-[10px] uppercase tracking-[0.5px] text-sf-text-muted mb-3">LENS</div>
                <div className="max-w-[140px]">
                  <label className="space-y-1">
                    <div className="text-[10px] text-sf-text-muted font-medium uppercase tracking-wider">FOV (°)</div>
                    <input
                      type="number"
                      step="0.5"
                      value={rig.camera.fov_deg ?? 40.95}
                      onChange={(event) => patchCamera({ fov_deg: Number(event.target.value) })}
                      className="w-full bg-sf-dark-800 border border-sf-dark-600 hover:border-sf-dark-500 focus:border-sf-accent rounded px-3 py-2 text-sm text-sf-text-primary tabular-nums text-right focus:outline-none transition-colors"
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* ACTIONS — clear hierarchy */}
          <div className="pt-2 border-t border-sf-dark-700 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={save}
                className="col-span-1 px-4 py-2.5 text-xs border border-sf-dark-600 hover:border-sf-text-secondary text-sf-text-secondary hover:text-sf-text-primary rounded-xl transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent focus-visible:outline-offset-2"
              >
                Save blocking.json
              </button>
              <button
                type="button"
                onClick={() => onApplyRig?.(rig)}
                className="col-span-1 px-4 py-2.5 text-xs border border-sf-blue/40 hover:bg-sf-blue/5 text-sf-blue rounded-xl transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent focus-visible:outline-offset-2"
              >
                Apply to shot
              </button>
            </div>

            <button
              type="button"
              disabled={rendering}
              onClick={generateFromBlocking}
              className="w-full py-3.5 text-sm font-semibold bg-sf-accent hover:bg-sf-accent-hover disabled:bg-sf-dark-700 disabled:text-sf-text-muted text-white rounded-2xl shadow-inner transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sf-accent"
            >
              {rendering ? 'Rendering control passes…' : 'GENERATE FROM BLOCKING'}
            </button>

            {error && (
              <div className="px-3 py-2 text-xs text-sf-error bg-sf-error/5 border border-sf-error/20 rounded flex items-start gap-2">
                <span>⚠</span>
                <span>{error}</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
