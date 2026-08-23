/**
 * Music-video pipeline wiring for reference cards (project.references).
 *
 * Composes the generic card lookups from generationRefs.js into the shapes
 * the music-video planner and queues consume:
 *  - cast member → accepted card anchors (close-up + full body) for keyframe
 *    reference slots;
 *  - resolved artist labels → "Name build: …" prompt lines and per-shot card
 *    vocal samples;
 *  - script shot labels → accepted location wide/medium slot assets.
 *
 * Pure and node-test-safe. GenerateWorkspace only wires store data in.
 */

import {
  characterBuildLine,
  characterVoiceAssetId,
  findCharacterCard,
  findLocationCard,
  generationAnchorAssetIds,
} from './generationRefs.js'
import { getSlot } from './referenceCards.js'

/**
 * Accepted anchor pair ({ closeUp, fullBody }) for a resolved cast member
 * whose label/name/slug matches a character card — wardrobe-aware via
 * generationAnchorAssetIds. Null when the member matches no card or the
 * card's anchor cascade is incomplete.
 */
export function musicMemberAnchorSlots(references, member) {
  if (!member) return null
  const card = findCharacterCard(references, member.label || member.name || member.slug || member.id)
  return card ? generationAnchorAssetIds(card) : null
}

/**
 * Ordered reference-image candidates for the default music performer
 * reference: each cast member contributes its accepted card anchors (close-up
 * first, then full body) when it has a card, otherwise its raw assetId; the
 * legacy single-artist asset trails as the final fallback.
 */
export function musicCastReferenceCandidates(references, cast = [], fallbackAssetId = null) {
  const ids = []
  for (const member of Array.isArray(cast) ? cast : []) {
    const anchors = musicMemberAnchorSlots(references, member)
    if (anchors?.closeUp) {
      ids.push(anchors.closeUp)
      if (anchors.fullBody) ids.push(anchors.fullBody)
    } else if (member?.assetId) {
      ids.push(member.assetId)
    }
  }
  if (fallbackAssetId) ids.push(fallbackAssetId)
  return ids
}

/**
 * "Mara build: 180 cm, slim" lines for resolved artist labels — only for
 * labels whose card has accepted anchors and body data (characterBuildLine
 * gates both).
 */
export function musicArtistBuildLines(references, labels = []) {
  return (Array.isArray(labels) ? labels : [])
    .map((label) => characterBuildLine(references, label))
    .filter(Boolean)
}

/**
 * Card vocal sample (audio.assetId) for the first resolved artist label that
 * has one attached, else null — the per-shot vocal reference that wins over
 * the global song audio when the target video workflow accepts audio.
 */
export function musicShotVocalAssetId(references, labels = []) {
  for (const label of Array.isArray(labels) ? labels : []) {
    const assetId = characterVoiceAssetId(references, label)
    if (assetId) return assetId
  }
  return null
}

/**
 * Accepted wide (fallback medium) location slot asset for a script shot,
 * matching the shot label first and the coverage label second. Null when no
 * location card matches or neither slot is accepted yet.
 */
export function musicLocationReferenceAssetId(references, label = '', coverageLabel = '') {
  const card = findLocationCard(references, label) || findLocationCard(references, coverageLabel)
  if (!card) return null
  for (const slotId of ['wide', 'medium']) {
    const slot = getSlot(card, slotId)
    if (slot?.status === 'accepted' && slot?.assetId) return slot.assetId
  }
  return null
}
