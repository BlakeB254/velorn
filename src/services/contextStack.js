/**
 * The context stack — one resolver that answers "what context is feeding
 * this generation, and what is still missing?"
 *
 * Before this module each context layer reached generation by its own path:
 * franchise/style pack through the production block, character anchors and
 * wardrobe through generationRefs, landmarks through blocking v7, movement
 * through nothing at all. Nobody could see the whole set, so a shot could be
 * generated with half its context silently absent.
 *
 * `resolveContextStack` walks the layers from outermost identity to innermost
 * action — franchise → brand → style → production type → location →
 * character → wardrobe → prop → movement → blocking — and returns, per layer:
 *
 *   status        ready | partial | missing | inactive
 *   contributes   the prompt lines / reference asset ids / structured data
 *                 that layer actually puts into the generation
 *   gaps          why it is not ready, in the same shape the other gates use
 *
 * The flattened `promptLines` / `referenceAssetIds` are what generation
 * consumes; `layers` is what the UI renders so the context visibly comes
 * through the process; `signature` is recorded on a take so you can later ask
 * what fed a clip that already exists.
 *
 * Pure and node-test-safe. Blocking state is passed in rather than imported,
 * because the blocking store needs Electron.
 */

import { getProductionType } from './productionTypes.js'
import { loadFranchise } from './franchises.js'
import { loadStylePack } from './stylePacks.js'
import { normalizeReferences } from './referencePanels.js'
import { subjectFromProject } from './projectListing.js'
import { anchorsAccepted, getSlot } from './referenceCards.js'
import {
  characterBuildLine,
  findCharacterCard,
  findLocationCard,
  generationAnchorAssetIds,
  wardrobeLine,
} from './generationRefs.js'
import {
  listMovements,
  movementAccepted,
  movementLine,
  movementsForCharacter,
} from './movementRefs.js'

/** Outermost identity first, innermost action last. */
export const CONTEXT_LAYER_ORDER = Object.freeze([
  'franchise',
  'brand',
  'style',
  'productionType',
  'location',
  'character',
  'wardrobe',
  'prop',
  'movement',
  'blocking',
])

export const LAYER_LABELS = Object.freeze({
  franchise: 'Franchise',
  brand: 'Brand',
  style: 'Style',
  productionType: 'Type',
  location: 'Location',
  character: 'Character',
  wardrobe: 'Wardrobe',
  prop: 'Prop',
  movement: 'Movement',
  blocking: 'Blocking',
})

const asString = (value) => (value === null || value === undefined ? '' : String(value))

const nameOf = (entry) => {
  if (!entry) return ''
  if (typeof entry === 'string') return entry.trim()
  return asString(entry.name || entry.id || entry.assetId).trim()
}

const asList = (value) => {
  if (Array.isArray(value)) return value
  if (value === null || value === undefined || value === '') return []
  return [value]
}

/**
 * FNV-1a over the canonical layer contributions. Deterministic, dependency
 * free, and stable across machines — good enough to answer "is this the same
 * context as last time?" without pulling in a crypto dependency.
 */
export function contextSignature(parts) {
  const canonical = JSON.stringify(parts)
  let hash = 0x811c9dc5
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `ctx_${hash.toString(16).padStart(8, '0')}`
}

function layer(kind, { id, label, status, detail = '', promptLines = [], referenceAssetIds = [], data = null, gaps = [] }) {
  return {
    kind,
    id: id || kind,
    label: label || LAYER_LABELS[kind] || kind,
    status,
    detail,
    contributes: {
      promptLines: promptLines.filter(Boolean),
      referenceAssetIds: referenceAssetIds.filter(Boolean),
      data,
    },
    gaps,
  }
}

/* ── individual layers ────────────────────────────────────────────────── */

function franchiseLayer(production) {
  const slug = asString(production?.franchiseSlug).trim()
  if (!slug) return layer('franchise', { status: 'inactive', detail: 'no franchise linked' })
  const franchise = loadFranchise(slug)
  if (!franchise) {
    return layer('franchise', {
      id: slug,
      status: 'missing',
      detail: `unknown franchise '${slug}'`,
      gaps: [{ kind: 'franchise', id: slug, reason: `franchise '${slug}' is not in the catalog` }],
    })
  }
  return layer('franchise', {
    id: franchise.slug,
    label: franchise.name,
    status: 'ready',
    detail: franchise.summary,
    // Invariants are the durable "never break this" rules for the universe,
    // so they belong in every prompt built under the franchise.
    promptLines: franchise.invariants || [],
    data: {
      slug: franchise.slug,
      name: franchise.name,
      brand: franchise.brand || '',
      entityId: franchise.entity_id || '',
      defaultAspect: franchise.default_aspect,
      stylePack: franchise.style_pack || '',
      animationStyle: franchise.animation_style || '',
    },
  })
}

/**
 * What an ad-style project is actually selling. The creation wizard captures
 * the CDX org and its offerings (creation.ad.subject) and nothing put them
 * into generation — so a commercial never named its own product. `live` is
 * the optionally-refreshed record from the CDX directory (core-api :7017);
 * without it the stored names still carry the layer, so the stack works
 * offline.
 */
function brandLayer(subject, live) {
  if (!subject || typeof subject !== 'object') {
    return layer('brand', { status: 'inactive', detail: 'no brand subject' })
  }
  const orgName = asString(live?.name || subject.orgName).trim()
  const offerings = (Array.isArray(subject.offerings) ? subject.offerings : [])
    .map((item) => asString(item?.name).trim())
    .filter(Boolean)
  if (!orgName && !offerings.length) {
    return layer('brand', {
      id: asString(subject.orgId) || 'brand',
      status: 'partial',
      detail: 'subject linked but unnamed',
      gaps: [{ kind: 'brand', id: asString(subject.orgId), reason: 'the linked org has no name on file' }],
    })
  }
  const promptLines = []
  if (orgName) promptLines.push(`Brand: ${orgName}`)
  if (offerings.length) promptLines.push(`Featured offering${offerings.length === 1 ? '' : 's'}: ${offerings.join(', ')}`)
  const voice = asString(live?.voice).trim()
  if (voice) promptLines.push(`Brand voice: ${voice}`)
  return layer('brand', {
    id: asString(subject.orgId) || orgName,
    label: orgName || 'Brand',
    status: 'ready',
    detail: offerings.length
      ? `${offerings.length} offering${offerings.length === 1 ? '' : 's'}`
      : 'no offerings selected',
    promptLines,
    data: {
      mode: subject.mode,
      orgId: asString(subject.orgId),
      orgName,
      offerings,
      live: live || null,
    },
  })
}

function styleLayer(production, franchiseData) {
  // An explicit pack on the production wins; otherwise inherit the
  // franchise's house look.
  const wanted = asString(production?.stylePack).trim() || asString(franchiseData?.stylePack).trim()
  if (!wanted) return layer('style', { status: 'inactive', detail: 'no style pack' })
  const pack = loadStylePack(wanted)
  if (!pack) {
    return layer('style', {
      id: wanted,
      status: 'missing',
      detail: `unknown style pack '${wanted}'`,
      gaps: [{ kind: 'style', id: wanted, reason: `style pack '${wanted}' is not in the catalog` }],
    })
  }
  return layer('style', {
    id: pack.id || wanted,
    label: pack.name || wanted,
    status: 'ready',
    detail: pack.summary || '',
    data: { id: pack.id || wanted, name: pack.name || wanted },
  })
}

function productionTypeLayer(production) {
  const typeId = asString(production?.type).trim()
  if (!typeId) return layer('productionType', { status: 'inactive', detail: 'untyped project' })
  const def = getProductionType(typeId)
  if (!def) {
    return layer('productionType', {
      id: typeId,
      status: 'missing',
      detail: `unknown production type '${typeId}'`,
      gaps: [{ kind: 'productionType', id: typeId, reason: `'${typeId}' is not a known production type` }],
    })
  }
  return layer('productionType', {
    id: def.id,
    label: def.label,
    status: 'ready',
    detail: `${def.runtime} · hook by ${def.hookByS}s · max hold ${def.maxHoldS}s`,
    data: {
      id: def.id,
      label: def.label,
      aspect: def.aspect,
      outputTarget: def.outputTarget,
      paceMode: def.paceMode,
      hookByS: def.hookByS,
      maxHoldS: def.maxHoldS,
      flow: def.flow,
    },
  })
}

function locationLayers(references, wanted) {
  const names = asList(wanted).map(nameOf).filter(Boolean)
  if (!names.length) return [layer('location', { status: 'inactive', detail: 'no location on this shot' })]
  return names.map((name) => {
    const card = findLocationCard(references, name)
    if (!card) {
      return layer('location', {
        id: name,
        label: name,
        status: 'missing',
        detail: 'no location card',
        gaps: [{ kind: 'location', id: name, reason: `no location reference card for '${name}'` }],
      })
    }
    const wide = getSlot(card, 'wide')
    const accepted = wide?.status === 'accepted' ? wide.assetId : null
    const landmarks = Array.isArray(card.landmarks) ? card.landmarks : []
    return layer('location', {
      id: card.id,
      label: card.name,
      status: accepted ? 'ready' : 'partial',
      detail: accepted
        ? `plate accepted${landmarks.length ? ` · ${landmarks.length} landmark${landmarks.length === 1 ? '' : 's'}` : ''}`
        : 'no accepted wide plate yet',
      referenceAssetIds: accepted ? [accepted] : [],
      data: { id: card.id, name: card.name, landmarks },
      gaps: accepted ? [] : [{ kind: 'location', id: card.id, reason: `'${card.name}' has no accepted wide plate` }],
    })
  })
}

function characterLayers(references, characterRefs) {
  const names = asList(characterRefs).map(nameOf).filter(Boolean)
  if (!names.length) return { layers: [layer('character', { status: 'inactive', detail: 'no characters on this shot' })], cards: [] }
  const cards = []
  const layers = []
  for (const name of names) {
    const card = findCharacterCard(references, name)
    if (!card) {
      layers.push(layer('character', {
        id: name,
        label: name,
        status: 'missing',
        detail: 'no character card',
        gaps: [{ kind: 'character', id: name, reason: `no character reference card for '${name}'` }],
      }))
      continue
    }
    cards.push(card)
    const ready = anchorsAccepted(card)
    const anchors = ready ? generationAnchorAssetIds(card) : null
    const buildLine = characterBuildLine(references, card.name)
    layers.push(layer('character', {
      id: card.id,
      label: card.name,
      status: ready ? 'ready' : 'partial',
      detail: ready ? 'anchors accepted' : 'anchors incomplete',
      promptLines: buildLine ? [buildLine] : [],
      referenceAssetIds: anchors ? [anchors.closeUp, anchors.fullBody] : [],
      data: { id: card.id, name: card.name, anchors },
      gaps: ready ? [] : [{ kind: 'character', id: card.id, reason: `'${card.name}' has no accepted anchor pair` }],
    }))

    // Wardrobe rides on the character but is its own visible layer, because
    // swapping it changes the generation without touching the identity lock.
    const dressLine = wardrobeLine(references, card.name)
    if (dressLine) {
      layers.push(layer('wardrobe', {
        id: `${card.id}-wardrobe`,
        label: `${card.name} wardrobe`,
        status: 'ready',
        detail: dressLine,
        promptLines: [dressLine],
      }))
    }
  }
  return { layers, cards }
}

function propLayers(references, wanted) {
  const names = asList(wanted).map(nameOf).filter(Boolean)
  if (!names.length) return [layer('prop', { status: 'inactive', detail: 'no props on this shot' })]
  const refs = normalizeReferences(references)
  return names.map((name) => {
    const lower = name.toLowerCase()
    const card = refs.props.find((item) => item.id === name || asString(item.name).toLowerCase() === lower)
    if (!card) {
      return layer('prop', {
        id: name,
        label: name,
        status: 'missing',
        detail: 'no prop card',
        gaps: [{ kind: 'prop', id: name, reason: `no prop reference card for '${name}'` }],
      })
    }
    const hero = getSlot(card, 'hero')
    const accepted = hero?.status === 'accepted' ? hero.assetId : null
    return layer('prop', {
      id: card.id,
      label: card.name,
      status: accepted ? 'ready' : 'partial',
      detail: accepted ? 'hero shot accepted' : 'no accepted hero shot yet',
      referenceAssetIds: accepted ? [accepted] : [],
      data: { id: card.id, name: card.name },
      gaps: accepted ? [] : [{ kind: 'prop', id: card.id, reason: `'${card.name}' has no accepted hero shot` }],
    })
  })
}

/**
 * Movement resolves two ways: explicit ids on the shot, or — when the shot
 * names no movement — every movement bound to the characters in the shot, so
 * an assigned action is not silently dropped just because the shot predates
 * the movement layer.
 */
function movementLayers(references, movementIds, characterCards) {
  const explicit = asList(movementIds).map(nameOf).filter(Boolean)
  const all = listMovements(references)
  let cards = []
  if (explicit.length) {
    cards = explicit.map((id) => all.find((card) => card.id === id || asString(card.name) === id) || { id, missing: true })
  } else {
    cards = characterCards.flatMap((character) => movementsForCharacter(references, character.id))
  }
  if (!cards.length) return [layer('movement', { status: 'inactive', detail: 'no movement assigned' })]
  return cards.map((card) => {
    if (card.missing) {
      return layer('movement', {
        id: card.id,
        label: card.id,
        status: 'missing',
        detail: 'no movement card',
        gaps: [{ kind: 'movement', id: card.id, reason: `no movement card '${card.id}'` }],
      })
    }
    const ready = movementAccepted(card)
    const action = movementLine(references, card)
    return layer('movement', {
      id: card.id,
      label: card.name,
      status: ready ? 'ready' : 'partial',
      detail: ready
        ? `${card.motion?.frames || card.params.frames} frames · ${card.motion?.format || 'SMPL-X22'}`
        : `status ${card.status}`,
      // The action reads into the prompt whether or not the motion clip has
      // been accepted — the words describe the beat, the clip drives the rig.
      promptLines: action ? [action] : [],
      data: {
        id: card.id,
        characterId: card.characterId,
        motion: ready ? card.motion : null,
        params: card.params,
      },
      gaps: ready ? [] : [{ kind: 'movement', id: card.id, reason: `'${card.name}' has no accepted motion yet` }],
    })
  })
}

function blockingLayer(blocking) {
  if (!blocking || typeof blocking !== 'object') {
    return layer('blocking', { status: 'inactive', detail: 'no blocking scene' })
  }
  const characters = Array.isArray(blocking.characters) ? blocking.characters : []
  const hasCamera = Boolean(blocking.camera)
  if (!characters.length && !hasCamera) {
    return layer('blocking', { status: 'inactive', detail: 'blocking scene is empty' })
  }
  return layer('blocking', {
    id: asString(blocking.id) || 'blocking',
    status: 'ready',
    detail: `${characters.length} character${characters.length === 1 ? '' : 's'}${hasCamera ? ' · camera set' : ''}`,
    data: { characters: characters.length, camera: hasCamera },
  })
}

/* ── the resolver ─────────────────────────────────────────────────────── */

/**
 * @param {object}  input
 * @param {object}  input.references  project.references (any age)
 * @param {object}  [input.production] project.production — franchise, type, style pack
 * @param {object}  [input.shot]      the shot being generated; omit to resolve
 *                                    the whole project's context
 * @param {object}  [input.blocking]  blocking v7 scene, passed in (Electron)
 */
export function resolveContextStack({
  references,
  production = {},
  shot = null,
  blocking = null,
  creation = null,
  brand = null,
} = {}) {
  const refs = normalizeReferences(references)

  const franchise = franchiseLayer(production)
  const brandResolved = brandLayer(subjectFromProject({ creation }), brand)
  const style = styleLayer(production, franchise.contributes.data)
  const type = productionTypeLayer(production)

  // With no shot, resolve everything the project has so the panel can show
  // the whole context set rather than nothing.
  // Storyboard cards say `locationRef` / `propRefs`; other callers say
  // `location` / `props`. Accept both rather than making callers adapt.
  const wantLocations = shot
    ? (shot.location ?? shot.locationRef ?? shot.locationName ?? shot.locations)
    : refs.locations.map((c) => c.id)
  const wantCharacters = shot ? (shot.characterRefs ?? shot.characters) : refs.characters.map((c) => c.id)
  const wantProps = shot ? (shot.props ?? shot.propRefs) : refs.props.map((c) => c.id)
  const wantMovements = shot ? (shot.movementIds ?? shot.movements) : refs.movements.map((c) => c.id)

  const locations = locationLayers(refs, wantLocations)
  const { layers: characters, cards: characterCards } = characterLayers(refs, wantCharacters)
  const props = propLayers(refs, wantProps)
  const movements = movementLayers(refs, wantMovements, characterCards)
  const blockingResolved = blockingLayer(blocking)

  const layers = [
    franchise,
    brandResolved,
    style,
    type,
    ...locations,
    ...characters,
    ...props,
    ...movements,
    blockingResolved,
  ]

  const active = layers.filter((item) => item.status !== 'inactive')
  const promptLines = []
  const referenceAssetIds = []
  const gaps = []
  for (const item of active) {
    promptLines.push(...item.contributes.promptLines)
    referenceAssetIds.push(...item.contributes.referenceAssetIds)
    gaps.push(...item.gaps)
  }

  const signature = contextSignature(active.map((item) => [item.kind, item.id, item.status]))

  return {
    layers,
    active,
    promptLines,
    // Order matters downstream (referenceImage1/2) and duplicates would waste
    // a slot, so dedupe while preserving first-seen order.
    referenceAssetIds: [...new Set(referenceAssetIds)],
    gaps,
    ready: gaps.length === 0,
    counts: {
      total: layers.length,
      active: active.length,
      ready: active.filter((item) => item.status === 'ready').length,
      partial: active.filter((item) => item.status === 'partial').length,
      missing: active.filter((item) => item.status === 'missing').length,
    },
    signature,
  }
}

/**
 * The provenance record to store on a take, so a clip that already exists can
 * still answer which context produced it. Deliberately small — ids and
 * statuses, not the full payload.
 */
export function contextProvenance(stack, { now } = {}) {
  if (!stack || typeof stack !== 'object') return null
  return {
    signature: stack.signature,
    recordedAt: now || null,
    ready: Boolean(stack.ready),
    layers: (stack.active || []).map((item) => ({
      kind: item.kind,
      id: item.id,
      label: item.label,
      status: item.status,
    })),
    gapCount: (stack.gaps || []).length,
  }
}

/** One-line summary for chips and logs: "5 ready · 2 partial · 1 missing". */
export function describeContextStack(stack) {
  if (!stack?.counts) return ''
  const { ready, partial, missing } = stack.counts
  const parts = [`${ready} ready`]
  if (partial) parts.push(`${partial} partial`)
  if (missing) parts.push(`${missing} missing`)
  return parts.join(' · ')
}
