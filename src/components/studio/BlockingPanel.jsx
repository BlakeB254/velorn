import { useEffect, useMemo, useRef, useState } from 'react'
import {
  applyCameraPatch,
  fromBlockingDoc,
  normalizeCameraRig,
} from '../../services/cameraRig'
import { applyRigToBlocking, ensureBlockingCamera, loadBlockingDoc, saveBlockingDoc } from '../../services/blockingStore'
import { slotForCard } from '../../services/studioUi'

const WORLD = 8

function toCanvas(x, y, size) {
  return {
    cx: ((Number(x) + WORLD) / (WORLD * 2)) * size,
    cy: ((WORLD - Number(y)) / (WORLD * 2)) * size,
  }
}

function fromCanvas(cx, cy, size) {
  return {
    x_m: Number((((cx / size) * WORLD * 2) - WORLD).toFixed(2)),
    y_m: Number((WORLD - ((cy / size) * WORLD * 2)).toFixed(2)),
  }
}

export default function BlockingPanel({ projectPath, studio, card, onApplyRig }) {
  const slot = slotForCard(studio, card)
  const shotSlug = slot?.slot_id || slot?.board_shot || card?.id
  const [doc, setDoc] = useState(null)
  const [error, setError] = useState('')
  const [drag, setDrag] = useState(null)
  const canvasRef = useRef(null)
  const size = 260

  const rig = useMemo(() => normalizeCameraRig(fromBlockingDoc(doc || {})), [doc])

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

  const draw = () => {
    const canvas = canvasRef.current
    if (!canvas || !doc) return
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#0f1218'
    ctx.fillRect(0, 0, size, size)
    ctx.strokeStyle = '#2a3140'
    ctx.beginPath()
    ctx.moveTo(size / 2, 0)
    ctx.lineTo(size / 2, size)
    ctx.moveTo(0, size / 2)
    ctx.lineTo(size, size / 2)
    ctx.stroke()
    const cam = toCanvas(rig.camera.x_m, rig.camera.y_m, size)
    ctx.fillStyle = '#38bdf8'
    ctx.beginPath()
    ctx.arc(cam.cx, cam.cy, 7, 0, Math.PI * 2)
    ctx.fill()
    const yaw = (Number(rig.camera.yaw_deg) * Math.PI) / 180
    ctx.strokeStyle = '#38bdf8'
    ctx.beginPath()
    ctx.moveTo(cam.cx, cam.cy)
    ctx.lineTo(cam.cx + Math.sin(yaw) * 22, cam.cy - Math.cos(yaw) * 22)
    ctx.stroke()
    for (const stand of rig.characters) {
      const pos = toCanvas(stand.x_m, stand.y_m, size)
      ctx.fillStyle = '#fbbf24'
      ctx.beginPath()
      ctx.arc(pos.cx, pos.cy, 6, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  useEffect(draw, [doc, rig, size])

  const onPointer = (event, down) => {
    if (!doc) return
    const rect = canvasRef.current.getBoundingClientRect()
    const cx = event.clientX - rect.left
    const cy = event.clientY - rect.top
    if (down) {
      const cam = toCanvas(rig.camera.x_m, rig.camera.y_m, size)
      const dist = Math.hypot(cam.cx - cx, cam.cy - cy)
      setDrag(dist < 14 ? 'camera' : null)
      return
    }
    if (drag !== 'camera') return
    const next = fromCanvas(cx, cy, size)
    const nextRig = applyCameraPatch(rig, { x_m: next.x_m, y_m: next.y_m, z_m: rig.camera.z_m })
    setDoc(applyRigToBlocking(doc, nextRig))
  }

  const patchCamera = (fields) => {
    if (!doc) return
    setDoc(applyRigToBlocking(doc, applyCameraPatch(rig, fields)))
  }

  const save = async () => {
    setError('')
    try {
      await saveBlockingDoc(projectPath, shotSlug, doc)
    } catch (err) {
      setError(err.message || String(err))
    }
  }

  if (!shotSlug) return null

  return (
    <div className="rounded border border-sf-dark-700 bg-sf-dark-950 p-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-sf-text-muted">Blocking · {shotSlug}</span>
        <span className="text-[10px] text-sf-text-muted">drag the cyan camera · z stays off the ground</span>
      </div>
      {!doc ? (
        <p className="text-[11px] text-sf-text-muted">No blocking.json for this slot yet. Generate-from-blocking can still use first/last frames.</p>
      ) : (
        <>
          <canvas
            ref={canvasRef}
            width={size}
            height={size}
            className="rounded border border-sf-dark-700 cursor-crosshair"
            onPointerDown={(event) => onPointer(event, true)}
            onPointerMove={(event) => onPointer(event, false)}
            onPointerUp={() => setDrag(null)}
          />
          <div className="grid grid-cols-4 gap-1 text-[10px]">
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
              onClick={() => {
                window.dispatchEvent(new CustomEvent('comfystudio-mcp-prepare-generation', {
                  detail: {
                    workflowId: 'cdx-ltx-union-control-flf',
                    storyboardCardId: card.id,
                    prompt: card.action || card.title,
                    autoQueue: false,
                  },
                }))
              }}
              className="px-2 py-1 text-[10px] rounded bg-sf-accent/90 text-white"
            >
              Generate from blocking
            </button>
          </div>
        </>
      )}
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  )
}
