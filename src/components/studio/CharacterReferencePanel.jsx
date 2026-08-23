import { useState } from 'react'
import {
  ChevronDown, ChevronRight, ImagePlus, Music, Plus, Trash2, X,
} from 'lucide-react'
import useProjectStore from '../../stores/projectStore'
import useAssetsStore from '../../stores/assetsStore'
import { importAsset } from '../../services/fileSystem'
import {
  acceptSlot,
  acceptWardrobeSlot,
  addWardrobeVariant,
  attachAudio,
  failSlot,
  getSlot,
  replaceSlot,
  requestRegenerate,
  setActiveWardrobe,
  setBody,
} from '../../services/referenceCards'
import { slotGenerationSpec } from '../../services/generationRefs'
import { ensureGenerateWorkspace } from '../../services/ensureGenerateWorkspace'
import { DEFAULT_FRAME_WORKFLOW } from '../storyboard/boardShared'
import {
  addCardByName,
  bodyFieldsEditable,
  cardProgress,
  mapCard,
  normalizeReferences,
  removeCard,
  upsertCard,
} from '../../services/referencePanels'
import {
  AUDIO_FILTERS,
  IMAGE_FILTERS,
  SlotGrid,
  importProjectImage,
  pickFile,
} from './referencePanelShared'

/**
 * Character reference cards (docs/ux-guided-mobile-plan.md P2): the slot
 * grid with the anchor cascade, body fields, wardrobe variants, and the
 * audio reference. P5 wires Generate/Regenerate to the ComfyUI queue via
 * slotGenerationSpec; finished jobs land back on the slot as review
 * candidates through the refslot watcher in StoryboardWorkspace.
 */
export default function CharacterReferencePanel() {
  const currentProject = useProjectStore((s) => s.currentProject)
  const currentProjectHandle = useProjectStore((s) => s.currentProjectHandle)
  const saveProject = useProjectStore((s) => s.saveProject)
  const assets = useAssetsStore((s) => s.assets)
  const addAsset = useAssetsStore((s) => s.addAsset)

  const [newName, setNewName] = useState('')
  const [expanded, setExpanded] = useState({})
  const [busy, setBusy] = useState(false)

  const references = normalizeReferences(currentProject?.references)
  const cards = references.characters

  const persist = (nextReferences) => saveProject({ references: nextReferences })
  const mutate = (cardId, fn) => persist(mapCard(references, 'character', cardId, fn))

  const assetFor = (assetId) => (assetId ? (assets || []).find((a) => a.id === assetId) : null)

  /**
   * Queue a ComfyUI generation for one slot. The slot goes to 'generating';
   * when the job's image lands (tagged refslot:<cardId>:<slotId>) the
   * StoryboardWorkspace watcher parks it as a review candidate.
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
          placement: 'character-ref',
          velornMeta: {
            placement: 'character-ref',
            source: 'reference-card',
            cardId: card.id,
            cardTitle: card.name,
            slotId: row.id,
          },
          autoQueue: true,
        },
      }))
    } catch (error) {
      console.warn('[CharacterReferencePanel] queue generation failed:', error)
      mutate(card.id, (c) => failSlot(c, row.id, { now: new Date().toISOString() }))
    } finally {
      setBusy(false)
    }
  }

  /** Import an image file into the project and return the new asset. */
  const importImage = (file) => importProjectImage(currentProjectHandle, addAsset, file)

  const uploadToSlot = async (card, slotId) => {
    if (!currentProjectHandle || busy) return
    const file = await pickFile({
      title: `${card.name} — ${slotId}`,
      filters: IMAGE_FILTERS,
      accept: 'image/*,.png,.jpg,.jpeg,.webp',
    })
    if (!file) return
    setBusy(true)
    try {
      const asset = await importImage(file)
      const now = new Date().toISOString()
      const existing = getSlot(card, slotId)
      if (existing?.assetId) {
        // Replace flow — optionally re-queue the rest so the set stays consistent.
        const propagate = window.confirm(
          `Replace ${slotId} on ${card.name}.\n\nAlso update the other filled slots to match (re-queue them for regeneration)?`,
        )
        const { card: replaced, regenerate } = replaceSlot(card, slotId, asset.id, { propagate, now })
        let next = replaced
        for (const rid of regenerate) next = requestRegenerate(next, rid, { now })
        persist(upsertCard(references, next))
      } else {
        persist(upsertCard(references, acceptSlot(card, slotId, asset.id, { now })))
      }
    } catch (error) {
      console.warn('[CharacterReferencePanel] upload failed:', error)
    } finally {
      setBusy(false)
    }
  }

  const uploadToWardrobe = async (card, variantId, slotId) => {
    if (!currentProjectHandle || busy) return
    const file = await pickFile({
      title: `${card.name} wardrobe — ${slotId}`,
      filters: IMAGE_FILTERS,
      accept: 'image/*,.png,.jpg,.jpeg,.webp',
    })
    if (!file) return
    setBusy(true)
    try {
      const asset = await importImage(file)
      mutate(card.id, (c) => acceptWardrobeSlot(c, variantId, slotId, asset.id, { now: new Date().toISOString() }))
    } catch (error) {
      console.warn('[CharacterReferencePanel] wardrobe upload failed:', error)
    } finally {
      setBusy(false)
    }
  }

  const attachVoice = async (card) => {
    if (!currentProjectHandle || busy) return
    const file = await pickFile({
      title: `${card.name} — voice sample`,
      filters: AUDIO_FILTERS,
      accept: 'audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus',
    })
    if (!file) return
    setBusy(true)
    try {
      const info = await importAsset(currentProjectHandle, file, 'audio')
      const asset = addAsset({
        ...info,
        type: 'audio',
        url: info.url || '',
        settings: { ...(info.settings || {}), duration: info.duration },
      })
      mutate(card.id, (c) => attachAudio(c, asset.id, { now: new Date().toISOString() }))
    } catch (error) {
      console.warn('[CharacterReferencePanel] audio attach failed:', error)
    } finally {
      setBusy(false)
    }
  }

  const addCharacter = () => {
    const { references: next, card } = addCardByName(references, 'character', newName)
    if (!card) return
    persist(next)
    setExpanded((prev) => ({ ...prev, [card.id]: true }))
    setNewName('')
  }

  const [newWardrobe, setNewWardrobe] = useState({})
  const addVariant = (card) => {
    const label = String(newWardrobe[card.id] || '').trim()
    if (!label) return
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    mutate(card.id, (c) => addWardrobeVariant(c, { id, label }))
    setNewWardrobe((prev) => ({ ...prev, [card.id]: '' }))
  }

  if (!currentProject) return null

  return (
    <div className="space-y-2" data-testid="character-reference-panel">
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCharacter() } }}
          placeholder="New character name…"
          className="flex-1 max-w-xs bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-3 py-1.5 text-xs text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent"
        />
        <button
          type="button"
          onClick={addCharacter}
          className="flex items-center gap-1 px-3 py-1.5 bg-sf-dark-800 border border-sf-dark-600 hover:border-sf-dark-500 rounded-lg text-[11px] text-sf-text-secondary transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add character
        </button>
      </div>

      {cards.length === 0 && (
        <p className="text-[11px] text-sf-text-muted">
          No character reference cards yet. The creation wizard scaffolds them from your cast list, or add one above.
        </p>
      )}

      {cards.map((card) => {
        const progress = cardProgress(card)
        const isOpen = Boolean(expanded[card.id])
        const editableBody = bodyFieldsEditable(card)
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
                  persist(removeCard(references, 'character', card.id))
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
                  onUpload={(row) => uploadToSlot(card, row.id)}
                  onAccept={(row) => mutate(card.id, (c) => acceptSlot(c, row.id, row.candidateId || row.assetId, { now: new Date().toISOString() }))}
                  onReject={(row) => mutate(card.id, (c) => failSlot(c, row.id, { now: new Date().toISOString() }))}
                  onGenerate={(row) => generateSlot(card, row)}
                />

                {/* Body fields */}
                <div>
                  <p className="text-[10px] text-sf-text-muted mb-1.5">
                    Body — {editableBody ? 'injected into generation prompts' : 'unlocks after both anchors are accepted'}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="block">
                      <span className="text-[9px] text-sf-text-muted">Height (cm)</span>
                      <input
                        type="number"
                        defaultValue={card.body?.height_cm ?? ''}
                        disabled={!editableBody}
                        onBlur={(e) => mutate(card.id, (c) => setBody(c, { height_cm: e.target.value === '' ? null : Number(e.target.value) }))}
                        className="mt-0.5 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-[11px] text-sf-text-primary disabled:opacity-40 focus:outline-none focus:border-sf-accent"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[9px] text-sf-text-muted">Weight (kg)</span>
                      <input
                        type="number"
                        defaultValue={card.body?.weight_kg ?? ''}
                        disabled={!editableBody}
                        onBlur={(e) => mutate(card.id, (c) => setBody(c, { weight_kg: e.target.value === '' ? null : Number(e.target.value) }))}
                        className="mt-0.5 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-[11px] text-sf-text-primary disabled:opacity-40 focus:outline-none focus:border-sf-accent"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[9px] text-sf-text-muted">Body type</span>
                      <input
                        type="text"
                        defaultValue={card.body?.body_type || ''}
                        disabled={!editableBody}
                        placeholder="athletic, slim, …"
                        onBlur={(e) => mutate(card.id, (c) => setBody(c, { body_type: e.target.value }))}
                        className="mt-0.5 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-[11px] text-sf-text-primary disabled:opacity-40 focus:outline-none focus:border-sf-accent"
                      />
                    </label>
                  </div>
                </div>

                {/* Wardrobe */}
                <div>
                  <p className="text-[10px] text-sf-text-muted mb-1.5">
                    Wardrobe variants — the active variant's filled slots override the base anchors in generation
                  </p>
                  <div className="space-y-1.5">
                    {card.wardrobe.map((variant) => {
                      const isActive = card.activeWardrobeId === variant.id
                      return (
                      <div key={variant.id} className={`flex items-center gap-2 px-2 py-1.5 bg-sf-dark-850 border rounded-md ${isActive ? 'border-sf-accent/60' : 'border-sf-dark-700'}`}>
                        <button
                          type="button"
                          onClick={() => mutate(card.id, (c) => setActiveWardrobe(c, isActive ? null : variant.id, { now: new Date().toISOString() }))}
                          title={isActive ? 'Active in generation — click to clear' : 'Dress this character in this variant for generation'}
                          className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                            isActive
                              ? 'bg-sf-accent/20 text-sf-accent'
                              : 'bg-sf-dark-700 text-sf-text-muted hover:bg-sf-dark-600'
                          }`}
                        >
                          {isActive ? 'Active' : 'Use'}
                        </button>
                        <span className="text-[11px] text-sf-text-primary">{variant.label}</span>
                        <span className="flex-1" />
                        {['close_up_face', 'full_body'].map((slotId) => {
                          const slot = variant.slots?.[slotId]
                          const asset = assetFor(slot?.assetId)
                          return (
                            <button
                              key={slotId}
                              type="button"
                              onClick={() => uploadToWardrobe(card, variant.id, slotId)}
                              disabled={busy}
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-sf-dark-700 text-[9px] text-sf-text-secondary hover:bg-sf-dark-600 transition-colors disabled:opacity-50"
                              title={slotId === 'close_up_face' ? 'Close-up face' : 'Full body'}
                            >
                              {asset?.url ? (
                                <img src={asset.url} alt={slotId} className="w-4 h-4 rounded object-cover" />
                              ) : (
                                <ImagePlus className="w-3 h-3" />
                              )}
                              {slotId === 'close_up_face' ? 'Face' : 'Body'}
                            </button>
                          )
                        })}
                        <button
                          type="button"
                          onClick={() => mutate(card.id, (c) => ({
                            ...c,
                            wardrobe: c.wardrobe.filter((w) => w.id !== variant.id),
                            activeWardrobeId: c.activeWardrobeId === variant.id ? null : c.activeWardrobeId,
                          }))}
                          className="p-0.5 text-sf-text-muted hover:text-sf-error transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      )
                    })}
                  </div>
                  <div className="flex gap-2 mt-1.5">
                    <input
                      type="text"
                      value={newWardrobe[card.id] || ''}
                      onChange={(e) => setNewWardrobe((prev) => ({ ...prev, [card.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addVariant(card) } }}
                      placeholder="Variant label (suit, casual, …)"
                      className="flex-1 max-w-[220px] bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-[11px] text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent"
                    />
                    <button
                      type="button"
                      onClick={() => addVariant(card)}
                      className="flex items-center gap-1 px-2 py-1 bg-sf-dark-800 border border-sf-dark-600 hover:border-sf-dark-500 rounded text-[10px] text-sf-text-secondary transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      Add variant
                    </button>
                  </div>
                </div>

                {/* Audio reference */}
                <div className="flex items-center gap-2">
                  <Music className="w-3.5 h-3.5 text-sf-text-muted" />
                  {card.audio?.assetId ? (
                    <>
                      <span className="text-[11px] text-sf-text-primary">
                        Voice sample: {assetFor(card.audio.assetId)?.name || card.audio.assetId}
                      </span>
                      <button
                        type="button"
                        onClick={() => mutate(card.id, (c) => ({ ...c, audio: null }))}
                        className="p-0.5 text-sf-text-muted hover:text-sf-error transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => attachVoice(card)}
                      disabled={busy}
                      className="flex items-center gap-1 px-2 py-1 bg-sf-dark-800 border border-sf-dark-600 hover:border-sf-dark-500 rounded text-[10px] text-sf-text-secondary transition-colors disabled:opacity-50"
                    >
                      <Plus className="w-3 h-3" />
                      Attach voice sample
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
