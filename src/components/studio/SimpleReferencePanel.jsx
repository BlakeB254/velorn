import { useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import useProjectStore from '../../stores/projectStore'
import useAssetsStore from '../../stores/assetsStore'
import {
  acceptSlot,
  failSlot,
  getSlot,
  replaceSlot,
  requestRegenerate,
} from '../../services/referenceCards'
import { slotGenerationSpec } from '../../services/generationRefs'
import { ensureGenerateWorkspace } from '../../services/ensureGenerateWorkspace'
import { DEFAULT_FRAME_WORKFLOW } from '../storyboard/boardShared'
import {
  addCardByName,
  cardProgress,
  mapCard,
  normalizeReferences,
  removeCard,
  upsertCard,
} from '../../services/referencePanels'
import { IMAGE_FILTERS, SlotGrid, importProjectImage, pickFile } from './referencePanelShared'

/**
 * Location/prop reference cards (docs/ux-guided-mobile-plan.md P3): the
 * same slot accept/regenerate/replace semantics as character cards, without
 * the anchor cascade. `renderExtra(card, mutate)` slots in kind-specific
 * extras (landmarks for locations).
 */
export default function SimpleReferencePanel({ kind, addPlaceholder, emptyHint, renderExtra, testId }) {
  const currentProject = useProjectStore((s) => s.currentProject)
  const currentProjectHandle = useProjectStore((s) => s.currentProjectHandle)
  const saveProject = useProjectStore((s) => s.saveProject)
  const assets = useAssetsStore((s) => s.assets)
  const addAsset = useAssetsStore((s) => s.addAsset)

  const [newName, setNewName] = useState('')
  const [expanded, setExpanded] = useState({})
  const [busy, setBusy] = useState(false)

  const references = normalizeReferences(currentProject?.references)
  const listKey = kind === 'location' ? 'locations' : 'props'
  const cards = references[listKey]

  const persist = (nextReferences) => saveProject({ references: nextReferences })
  const mutate = (cardId, fn) => persist(mapCard(references, kind, cardId, fn))
  const assetFor = (assetId) => (assetId ? (assets || []).find((a) => a.id === assetId) : null)

  /**
   * Queue a ComfyUI generation for one slot (P5). The refslot tag on the job
   * lets the StoryboardWorkspace watcher park the finished image as a review
   * candidate on this slot.
   */
  const generateSlot = async (card, row) => {
    if (busy) return
    const spec = slotGenerationSpec(card, row.id)
    if (!spec) return
    setBusy(true)
    const now = new Date().toISOString()
    try {
      mutate(card.id, (c) => requestRegenerate(c, row.id, { now }))
      await ensureGenerateWorkspace()
      window.dispatchEvent(new CustomEvent('comfystudio-mcp-prepare-generation', {
        detail: {
          workflowId: DEFAULT_FRAME_WORKFLOW,
          category: 'image',
          prompt: spec.prompt,
          selectedAssetId: spec.refs.referenceImage1 || null,
          referenceAssetId1: spec.refs.referenceImage1 || null,
          referenceAssetId2: spec.refs.referenceImage2 || null,
          selectedAssetFieldIds: spec.refs,
          storyboardCardId: spec.tag,
          resolution: { width: 1024, height: 1024 },
          placement: 'location-ref',
          velornMeta: {
            placement: 'location-ref',
            source: 'reference-card',
            cardId: card.id,
            cardTitle: card.name,
            slotId: row.id,
          },
          autoQueue: true,
        },
      }))
    } catch (error) {
      console.warn(`[SimpleReferencePanel:${kind}] queue generation failed:`, error)
      mutate(card.id, (c) => failSlot(c, row.id, { now: new Date().toISOString() }))
    } finally {
      setBusy(false)
    }
  }

  const uploadToSlot = async (card, row) => {
    if (!currentProjectHandle || busy) return
    const file = await pickFile({
      title: `${card.name} — ${row.id}`,
      filters: IMAGE_FILTERS,
      accept: 'image/*,.png,.jpg,.jpeg,.webp',
    })
    if (!file) return
    setBusy(true)
    try {
      const asset = await importProjectImage(currentProjectHandle, addAsset, file)
      const now = new Date().toISOString()
      const existing = getSlot(card, row.id)
      if (existing?.assetId) {
        const propagate = window.confirm(
          `Replace ${row.id} on ${card.name}.\n\nAlso update the other filled slots to match (re-queue them for regeneration)?`,
        )
        const { card: replaced, regenerate } = replaceSlot(card, row.id, asset.id, { propagate, now })
        let next = replaced
        for (const rid of regenerate) next = requestRegenerate(next, rid, { now })
        persist(upsertCard(references, next))
      } else {
        persist(upsertCard(references, acceptSlot(card, row.id, asset.id, { now })))
      }
    } catch (error) {
      console.warn(`[SimpleReferencePanel:${kind}] upload failed:`, error)
    } finally {
      setBusy(false)
    }
  }

  const addCard = () => {
    const { references: next, card } = addCardByName(references, kind, newName)
    if (!card) return
    persist(next)
    setExpanded((prev) => ({ ...prev, [card.id]: true }))
    setNewName('')
  }

  if (!currentProject) return null

  return (
    <div className="space-y-2" data-testid={testId || `${kind}-reference-panel`}>
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCard() } }}
          placeholder={addPlaceholder}
          className="flex-1 max-w-xs bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-3 py-1.5 text-xs text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent"
        />
        <button
          type="button"
          onClick={addCard}
          className="flex items-center gap-1 px-3 py-1.5 bg-sf-dark-800 border border-sf-dark-600 hover:border-sf-dark-500 rounded-lg text-[11px] text-sf-text-secondary transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add
        </button>
      </div>

      {cards.length === 0 && (
        <p className="text-[11px] text-sf-text-muted">{emptyHint}</p>
      )}

      {cards.map((card) => {
        const progress = cardProgress(card)
        const isOpen = Boolean(expanded[card.id])
        return (
          <div key={card.id} className="rounded-lg border border-sf-dark-700 bg-sf-dark-900">
            <button
              type="button"
              onClick={() => setExpanded((prev) => ({ ...prev, [card.id]: !isOpen }))}
              className="w-full flex items-center gap-2 px-3 py-2 text-left"
            >
              {isOpen
                ? <ChevronDown className="w-3.5 h-3.5 text-sf-text-muted" />
                : <ChevronRight className="w-3.5 h-3.5 text-sf-text-muted" />}
              <span className="text-[11px] font-medium text-sf-text-primary">{card.name}</span>
              <span className="text-[10px] text-sf-text-muted">
                {progress.accepted}/{progress.total} accepted
                {progress.busy > 0 ? ` · ${progress.busy} in flight` : ''}
              </span>
              <span className="flex-1" />
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  persist(removeCard(references, kind, card.id))
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.stopPropagation() }}
                className="p-1 text-sf-text-muted hover:text-sf-error transition-colors"
                title="Remove card"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </span>
            </button>

            {isOpen && (
              <div className="px-3 pb-3 space-y-3 border-t border-sf-dark-800 pt-3">
                <SlotGrid
                  card={card}
                  assetFor={assetFor}
                  busy={busy}
                  columns={kind === 'location' ? 4 : 5}
                  onUpload={(row) => uploadToSlot(card, row)}
                  onAccept={(row) => mutate(card.id, (c) => acceptSlot(c, row.id, row.candidateId || row.assetId, { now: new Date().toISOString() }))}
                  onReject={(row) => mutate(card.id, (c) => failSlot(c, row.id, { now: new Date().toISOString() }))}
                  onGenerate={(row) => generateSlot(card, row)}
                />
                {renderExtra?.(card, mutate)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
