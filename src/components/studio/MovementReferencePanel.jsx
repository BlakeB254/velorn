import { useEffect, useState } from 'react'
import { Activity, ChevronDown, ChevronRight, Plus, RefreshCw, Trash2, Check } from 'lucide-react'
import useProjectStore from '../../stores/projectStore'
import { generateMotion, kimodoHealth } from '../../services/kimodoMotion'
import {
  acceptMovement,
  assignMovementToCharacter,
  failMovement,
  markMovementGenerating,
  motionMetaFromResponse,
  movementRequest,
  normalizeMovementParams,
  requestRegenerateMovement,
  reviewMovement,
} from '../../services/movementRefs'
import {
  addCardByName,
  mapCard,
  normalizeReferences,
  removeCard,
  upsertCard,
} from '../../services/referencePanels'

/**
 * Movement reference cards — the action layer.
 *
 * Each card binds one named action to one character and is realised by
 * kimodo.cpp (SMPL-X22 on the GB10). Unlike the image kinds there is no slot
 * grid: a movement is generated whole, reviewed, then accepted, and the
 * accepted clip survives a regenerate so a character is never left bare.
 */

const STATUS_TONE = {
  empty: 'text-sf-text-muted border-sf-dark-600',
  generating: 'text-amber-300 border-amber-500/40',
  review: 'text-sky-300 border-sky-500/40',
  accepted: 'text-emerald-300 border-emerald-500/50',
}

const inputClass =
  'bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-[11px] text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent'

export default function MovementReferencePanel() {
  const currentProject = useProjectStore((s) => s.currentProject)
  const saveProject = useProjectStore((s) => s.saveProject)

  const [newName, setNewName] = useState('')
  const [expanded, setExpanded] = useState({})
  const [busyId, setBusyId] = useState('')
  const [service, setService] = useState({ state: 'checking', detail: '' })

  const references = normalizeReferences(currentProject?.references)
  const cards = references.movements || []
  const characters = references.characters || []

  // Movement is the one reference kind that needs a live service, so say so
  // up front rather than failing at generate time.
  useEffect(() => {
    let cancelled = false
    kimodoHealth()
      .then(() => { if (!cancelled) setService({ state: 'up', detail: '' }) })
      .catch((error) => {
        if (!cancelled) setService({ state: 'down', detail: error?.message || 'unreachable' })
      })
    return () => { cancelled = true }
  }, [])

  const persist = (next) => saveProject({ references: next })
  const mutate = (cardId, fn) => persist(mapCard(references, 'movement', cardId, fn))

  const add = () => {
    const clean = newName.trim()
    if (!clean) return
    const { references: next } = addCardByName(references, 'movement', clean)
    persist(next)
    setNewName('')
  }

  const generate = async (card) => {
    if (busyId) return
    let request
    try {
      request = movementRequest(card)
    } catch (error) {
      window.alert?.(error?.message || 'This movement needs an action prompt first.')
      return
    }
    setBusyId(card.id)
    const startedAt = new Date().toISOString()
    // Regenerate keeps the accepted clip; a first run just moves to generating.
    persist(upsertCard(references, card.motion
      ? requestRegenerateMovement(card, { now: startedAt })
      : markMovementGenerating(card, { now: startedAt })))
    try {
      const response = await generateMotion(request.prompt, {
        frames: request.frames,
        steps: request.steps,
        seed: request.seed,
      })
      const now = new Date().toISOString()
      const meta = motionMetaFromResponse(response, { params: card.params, now })
      // Re-read the project: the generation is long enough that other edits
      // may have landed while it ran.
      const fresh = normalizeReferences(useProjectStore.getState().currentProject?.references)
      const latest = (fresh.movements || []).find((item) => item.id === card.id) || card
      persist(upsertCard(fresh, reviewMovement(latest, meta, { now })))
    } catch (error) {
      const now = new Date().toISOString()
      const fresh = normalizeReferences(useProjectStore.getState().currentProject?.references)
      const latest = (fresh.movements || []).find((item) => item.id === card.id) || card
      persist(upsertCard(fresh, failMovement(latest, error, { now })))
    } finally {
      setBusyId('')
    }
  }

  const accept = (card) => mutate(card.id, (c) => acceptMovement(c, { now: new Date().toISOString() }))

  return (
    <div className="space-y-2" data-testid="movement-reference-panel">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="New movement name…"
          className={`flex-1 min-w-0 ${inputClass}`}
        />
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1 px-2 py-1 bg-sf-dark-800 border border-sf-dark-600 hover:border-sf-dark-500 rounded text-[10px] text-sf-text-secondary transition-colors"
        >
          <Plus className="w-3 h-3" />
          Add
        </button>
      </div>

      <p className="text-[10px] text-sf-text-muted">
        kimodo.cpp · SMPL-X22
        {service.state === 'up' && <span className="text-emerald-300"> · service up</span>}
        {service.state === 'down' && (
          <span className="text-red-300"> · service unreachable ({service.detail})</span>
        )}
        {service.state === 'checking' && <span> · checking…</span>}
      </p>

      {cards.length === 0 && (
        <p className="text-[11px] text-sf-text-muted">
          No movement cards yet. Add an action ("throws a right hook then backpedals"), assign it to a
          character, and generate the motion.
        </p>
      )}

      <div className="space-y-1.5">
        {cards.map((card) => {
          const params = normalizeMovementParams(card.params)
          const open = Boolean(expanded[card.id])
          const tone = STATUS_TONE[card.status] || STATUS_TONE.empty
          const character = characters.find((item) => item.id === card.characterId)
          const busy = busyId === card.id || card.status === 'generating'
          return (
            <div key={card.id} className="rounded border border-sf-dark-700 bg-sf-dark-900">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => ({ ...prev, [card.id]: !prev[card.id] }))}
                  className="text-sf-text-muted hover:text-sf-text-primary"
                >
                  {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </button>
                <Activity className="w-3 h-3 text-sf-accent shrink-0" />
                <span className="text-[11px] text-sf-text-primary font-medium">{card.name}</span>
                <span className={`text-[9px] uppercase tracking-wide px-1 rounded border ${tone}`}>
                  {card.status}
                </span>
                {character
                  ? <span className="text-[10px] text-sf-text-secondary">→ {character.name}</span>
                  : <span className="text-[10px] text-amber-300">unassigned</span>}
                <span className="flex-1" />
                {card.motion && (
                  <span className="text-[9px] text-sf-text-muted">
                    {card.motion.frames}f · {card.motion.joints}j
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => persist(removeCard(references, 'movement', card.id))}
                  className="p-0.5 text-sf-text-muted hover:text-sf-error transition-colors"
                  title="Remove movement"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>

              {open && (
                <div className="px-2 pb-2 space-y-1.5 border-t border-sf-dark-800 pt-1.5">
                  <select
                    value={card.characterId || ''}
                    onChange={(e) => mutate(card.id, (c) => assignMovementToCharacter(c, e.target.value))}
                    className={`w-full ${inputClass}`}
                  >
                    <option value="">— assign to a character —</option>
                    {characters.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>

                  <textarea
                    value={card.prompt}
                    onChange={(e) => mutate(card.id, (c) => ({ ...c, prompt: e.target.value }))}
                    placeholder="Action — e.g. throws a right hook then backpedals"
                    rows={2}
                    className={`w-full resize-none ${inputClass}`}
                  />

                  <div className="flex gap-1.5">
                    {['frames', 'steps', 'seed'].map((field) => (
                      <label key={field} className="flex-1 min-w-0">
                        <span className="block text-[9px] uppercase tracking-wide text-sf-text-muted mb-0.5">
                          {field}
                        </span>
                        <input
                          type="number"
                          value={params[field]}
                          onChange={(e) => mutate(card.id, (c) => ({
                            ...c,
                            params: normalizeMovementParams({ ...params, [field]: e.target.value }),
                          }))}
                          className={`w-full ${inputClass}`}
                        />
                      </label>
                    ))}
                  </div>

                  {card.error && <p className="text-[10px] text-red-300">{card.error}</p>}

                  {card.candidate && (
                    <div className="flex items-center gap-2 px-2 py-1 rounded border border-sky-500/40 bg-sky-500/5">
                      <span className="text-[10px] text-sky-300">
                        Candidate ready — {card.candidate.frames} frames
                      </span>
                      <span className="flex-1" />
                      <button
                        type="button"
                        onClick={() => accept(card)}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-emerald-500/50 text-[10px] text-emerald-300 hover:bg-emerald-500/10"
                      >
                        <Check className="w-3 h-3" />
                        Accept
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={busy || service.state === 'down'}
                    onClick={() => generate(card)}
                    className="flex items-center gap-1 px-2 py-1 bg-sf-dark-800 border border-sf-dark-600 hover:border-sf-accent rounded text-[10px] text-sf-text-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <RefreshCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} />
                    {busy ? 'Generating…' : card.motion ? 'Regenerate motion' : 'Generate motion'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
