import { useState } from 'react'
import { MapPin, Plus, X } from 'lucide-react'
import { addLandmark, removeLandmark } from '../../services/referenceCards'
import SimpleReferencePanel from './SimpleReferencePanel'

/**
 * Location reference cards + labelled landmarks (plan §4.2). Landmarks are
 * stored in meters ({ name, x_m, y_m }) and feed the blocking v7
 * environment footprint directly.
 */
function LandmarkEditor({ card, mutate }) {
  const [draft, setDraft] = useState({ name: '', x_m: '', y_m: '' })
  const add = () => {
    const name = draft.name.trim()
    if (!name) return
    mutate(card.id, (c) => addLandmark(c, { name, x_m: Number(draft.x_m) || 0, y_m: Number(draft.y_m) || 0 }))
    setDraft({ name: '', x_m: '', y_m: '' })
  }
  return (
    <div>
      <p className="text-[10px] text-sf-text-muted mb-1.5">
        Landmarks — labelled positions (meters) for the birds-eye; feeds the blocking environment.
      </p>
      {(card.landmarks || []).length > 0 && (
        <div className="space-y-1 mb-1.5">
          {card.landmarks.map((landmark, index) => (
            <div
              key={`${landmark.name}-${index}`}
              className="flex items-center gap-2 px-2 py-1 bg-sf-dark-850 border border-sf-dark-700 rounded-md"
            >
              <MapPin className="w-3 h-3 text-sf-accent shrink-0" />
              <span className="text-[11px] text-sf-text-primary">{landmark.name}</span>
              <span className="text-[10px] text-sf-text-muted">
                x {landmark.x_m} m · y {landmark.y_m} m
              </span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => mutate(card.id, (c) => removeLandmark(c, index))}
                className="p-0.5 text-sf-text-muted hover:text-sf-error transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={draft.name}
          onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="Landmark name…"
          className="flex-1 min-w-0 bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-[11px] text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent"
        />
        <input
          type="number"
          value={draft.x_m}
          onChange={(e) => setDraft((prev) => ({ ...prev, x_m: e.target.value }))}
          placeholder="x m"
          className="w-16 bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-[11px] text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent"
        />
        <input
          type="number"
          value={draft.y_m}
          onChange={(e) => setDraft((prev) => ({ ...prev, y_m: e.target.value }))}
          placeholder="y m"
          className="w-16 bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-[11px] text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent"
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
    </div>
  )
}

export default function LocationReferencePanel() {
  return (
    <SimpleReferencePanel
      kind="location"
      addPlaceholder="New location name…"
      emptyHint="No location reference cards yet. The creation wizard scaffolds them from your locations list, or add one above."
      testId="location-reference-panel"
      renderExtra={(card, mutate) => <LandmarkEditor card={card} mutate={mutate} />}
    />
  )
}
