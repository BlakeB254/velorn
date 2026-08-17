import { slotState, verdictForShot } from './studioStore.js'
import { auditShot } from './studioAudit.js'

export function slotForCard(studio, card) {
  const slots = studio?.slots || []
  if (!card) return null
  const hay = `${card.id || ''} ${card.title || ''} ${card.action || ''}`.toLowerCase()
  return slots.find((slot) => (
    slot.board_shot === card.id
    || slot.slot_id === card.id
    || hay.includes(String(slot.slot_id || '').toLowerCase())
    || (slot.board_shot && hay.includes(String(slot.board_shot).toLowerCase()))
  )) || null
}

export function cardSlotView(studio, card, approvedAssetIds = null) {
  const slot = slotForCard(studio, card)
  if (!slot) return null
  const qa = verdictForShot(studio, slot.board_shot || slot.slot_id)
  const audit = auditShot({ card, slot, studio })
  return {
    slot,
    state: slotState(slot, approvedAssetIds),
    qa,
    audit,
  }
}
