import { useEffect, useRef, useState } from 'react'
import { Eraser, Pencil, Sparkles, X } from 'lucide-react'

const EDIT_FLOWS = [
  { id: 'qwen-inpaint', label: 'Qwen InstantX inpaint' },
  { id: 'image-edit', label: 'Qwen Image Edit 2509' },
  { id: 'qwen-edit-2511', label: 'Qwen Image Edit 2511' },
  { id: 'flux2-klein-edit', label: 'FLUX.2 Klein edit' },
  { id: 'longcat-image-edit', label: 'LongCat image edit' },
]

export default function InpaintEditor({
  open,
  imageUrl,
  title,
  initialPrompt = '',
  onClose,
  onSubmit,
}) {
  const imageRef = useRef(null)
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const [prompt, setPrompt] = useState(initialPrompt)
  const [workflowId, setWorkflowId] = useState('qwen-inpaint')
  const [brush, setBrush] = useState(28)
  const [mode, setMode] = useState('paint')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!open) return
    setPrompt(initialPrompt)
    setReady(false)
  }, [open, initialPrompt, imageUrl])

  useEffect(() => {
    if (!open || !imageUrl || !canvasRef.current || !imageRef.current) return
    const img = imageRef.current
    const canvas = canvasRef.current
    const sync = () => {
      canvas.width = img.naturalWidth || img.width
      canvas.height = img.naturalHeight || img.height
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      setReady(true)
    }
    if (img.complete) sync()
    else img.onload = sync
  }, [open, imageUrl])

  const paintAt = (event) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height
    const ctx = canvas.getContext('2d')
    ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over'
    ctx.fillStyle = 'rgba(255, 80, 80, 0.55)'
    ctx.beginPath()
    ctx.arc(x, y, (brush / rect.width) * canvas.width, 0, Math.PI * 2)
    ctx.fill()
  }

  const submit = () => {
    const canvas = canvasRef.current
    const mask = canvas ? canvas.toDataURL('image/png') : ''
    onSubmit({
      prompt: prompt.trim(),
      workflowId,
      maskDataUrl: mask,
    })
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] bg-black/90 flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
        <div className="text-sm text-white truncate">{title || 'Edit shot'}</div>
        <button type="button" onClick={onClose} className="p-1 text-white/70 hover:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center p-4">
        <div className="relative max-w-full max-h-full">
          {imageUrl ? (
            <>
              <img
                ref={imageRef}
                src={imageUrl}
                alt=""
                className="max-h-[72vh] max-w-[90vw] object-contain select-none"
                draggable={false}
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full cursor-crosshair"
                onMouseDown={(event) => { drawing.current = true; paintAt(event) }}
                onMouseMove={(event) => { if (drawing.current) paintAt(event) }}
                onMouseUp={() => { drawing.current = false }}
                onMouseLeave={() => { drawing.current = false }}
              />
            </>
          ) : (
            <p className="text-white/60 text-sm">This shot has no still to edit.</p>
          )}
        </div>
      </div>
      <div className="border-t border-white/10 p-3 space-y-2 bg-sf-dark-950">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={workflowId}
            onChange={(event) => setWorkflowId(event.target.value)}
            className="bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5 text-[11px] text-sf-text-primary"
          >
            {EDIT_FLOWS.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setMode('paint')}
            className={`inline-flex items-center gap-1 px-2 py-1.5 rounded text-[11px] ${mode === 'paint' ? 'bg-sf-accent text-white' : 'bg-sf-dark-800 text-sf-text-secondary'}`}
          >
            <Pencil className="w-3 h-3" />
            Paint mask
          </button>
          <button
            type="button"
            onClick={() => setMode('erase')}
            className={`inline-flex items-center gap-1 px-2 py-1.5 rounded text-[11px] ${mode === 'erase' ? 'bg-sf-accent text-white' : 'bg-sf-dark-800 text-sf-text-secondary'}`}
          >
            <Eraser className="w-3 h-3" />
            Erase
          </button>
          <label className="inline-flex items-center gap-2 text-[11px] text-sf-text-secondary">
            Size
            <input type="range" min="8" max="80" value={brush} onChange={(event) => setBrush(Number(event.target.value))} />
          </label>
        </div>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Describe the edit for the painted region…"
          rows={2}
          className="w-full resize-none bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5 text-[12px] text-sf-text-primary outline-none"
        />
        <button
          type="button"
          disabled={!imageUrl || !ready || !prompt.trim()}
          onClick={submit}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-sf-accent text-white text-[12px] disabled:opacity-40"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Submit edit
        </button>
      </div>
    </div>
  )
}
