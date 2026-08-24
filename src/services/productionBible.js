/**
 * CDX Studio-native production bible.
 *
 * Spec only from CDX Studio production_bible.py + shortFilmDirector import:
 *   assemble franchise + cast + locations + style + story + constraints
 *   into one deterministic snapshot. Seal it so generators stop inventing
 *   identity. Import a Studio `.studio/bible.json` when hydrating a show.
 *
 * GPU stays serial. Outward artifacts stay drafts. These helpers plan and
 * persist; they do not queue Comfy.
 */

import { hydrateProductionFromProject, normalizeProduction } from './productionStore.js'
import { normalizeStudio, resolveCast } from './studioStore.js'
import {
  applyStyleNegative,
  applyStylePack,
  loadStylePack,
  loraStackFor,
  stylePackForApi,
} from './stylePacks.js'
import { getAnimationStyle } from './animationStyles.js'
import {
  checkFranchiseConsistency,
  franchiseForApi,
  loadFranchise,
} from './franchises.js'

export const BIBLE_VERSION = 1

export const BIBLE_POLICY = Object.freeze({
  gpuSerial: true,
  outward: 'draft',
  previewOnlyDefault: true,
  neverIdentityDrift: true,
})

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const asString = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback
  return String(value)
}

const nowIso = () => new Date().toISOString()

export function emptyBibleSeal() {
  return {
    sealed: false,
    sealedAt: '',
    sealedBy: '',
    contentHash: '',
    snapshot: null,
    source: '',
  }
}

export function normalizeBibleSeal(raw) {
  if (!isPlainObject(raw)) return emptyBibleSeal()
  const snapshot = isPlainObject(raw.snapshot) ? raw.snapshot : (isPlainObject(raw.bible) ? raw.bible : null)
  return {
    sealed: Boolean(raw.sealed || snapshot?.sealed),
    sealedAt: asString(raw.sealedAt || raw.sealed_at || snapshot?.sealed_at),
    sealedBy: asString(raw.sealedBy || raw.sealed_by || snapshot?.sealed_by),
    contentHash: asString(raw.contentHash || raw.content_hash || snapshot?.content_hash),
    snapshot,
    source: asString(raw.source),
  }
}

export function stableBibleHash(obj) {
  const payload = JSON.stringify(obj, (_, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value).sort().reduce((acc, key) => {
        acc[key] = value[key]
        return acc
      }, {})
    }
    return value
  })
  let hash = 2166136261
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function castLayer(project, production) {
  const studio = normalizeStudio(project?.studio)
  const resolved = resolveCast(studio, {
    season: production.current?.seasonId,
    episode: production.current?.episodeId,
  })
  const directorChars = Array.isArray(project?.shortFilmDirector?.characters)
    ? project.shortFilmDirector.characters
    : []
  const imported = Array.isArray(project?.importedBible?.cast?.characters)
    ? project.importedBible.cast.characters
    : []
  const source = resolved.length
    ? resolved.map((member) => ({
      id: member.cast_id,
      name: member.display_name,
      prompt_fragment: asString(member.fields?.prompt_fragment || member.fields?.outfit),
      outfit: asString(member.fields?.outfit),
      never: asString(member.fields?.never),
      scope: member.scope,
    }))
    : (directorChars.length ? directorChars : imported).map((entry) => ({
      id: asString(entry.id || entry.slug || entry.cast_id),
      name: asString(entry.name || entry.display_name),
      prompt_fragment: asString(entry.prompt_fragment || entry.visualNotes || entry.outfit),
      outfit: asString(entry.outfit || entry.visualNotes),
      never: asString(entry.never),
      scope: asString(entry.scope, 'series'),
    }))
  return {
    characters: source.filter((item) => item.id || item.name),
    count: source.filter((item) => item.id || item.name).length,
  }
}

function locationLayer(project) {
  const director = Array.isArray(project?.shortFilmDirector?.locations) ? project.shortFilmDirector.locations : []
  const studioLocs = Object.values(project?.studio?.locations || {})
  const source = director.length ? director : studioLocs
  const scenes = source.filter(isPlainObject).map((entry) => ({
    id: asString(entry.id || entry.slug),
    slug: asString(entry.slug || entry.id),
    name: asString(entry.name),
    description: asString(entry.description),
    plate: asString(entry.heroAssetId || entry.plate || ''),
  }))
  return { scenes, count: scenes.length }
}

function styleLayer(production) {
  const packName = asString(production.stylePack)
  const animId = asString(production.animationStyle)
  const pack = packName ? loadStylePack(packName) : null
  const animation = animId ? getAnimationStyle(animId) : null
  return {
    style_pack: packName,
    animation_style: animId,
    style_pack_card: pack ? stylePackForApi(pack) : null,
    animation_style_card: animation,
    houseStyle: asString(production.show?.houseStyle),
  }
}

function franchiseLayer(production) {
  const slug = asString(production.franchiseSlug)
  if (!slug) return { slug: null, found: false }
  const franchise = loadFranchise(slug)
  if (!franchise) return { slug, found: false }
  return {
    slug,
    found: true,
    ...franchiseForApi(franchise),
  }
}

export function importStudioBible(raw, { source = 'shortFilmDirector' } = {}) {
  if (!isPlainObject(raw)) return null
  const identity = isPlainObject(raw.identity) ? raw.identity : {}
  const story = isPlainObject(raw.story) ? raw.story : {}
  const concept = isPlainObject(raw.concept) ? raw.concept : {}
  const style = isPlainObject(raw.style) ? raw.style : {}
  const franchise = isPlainObject(identity.franchise) ? identity.franchise : (isPlainObject(raw.franchise) ? raw.franchise : {})
  return {
    version: Number(raw.version) || BIBLE_VERSION,
    slug: asString(raw.slug || identity.slug),
    title: asString(identity.title || story.title || raw.title),
    premise: asString(story.premise || concept.premise || concept.logline || raw.premise),
    type: asString(story.type || identity.type || raw.type),
    franchiseSlug: asString(franchise.slug || raw.franchise_slug),
    stylePack: packNameFrom(style.style_pack || raw.style_pack),
    animationStyle: asString(style.animation_style || raw.animation_style),
    cast: isPlainObject(raw.cast) ? raw.cast : { characters: [], count: 0 },
    locations: isPlainObject(raw.locations) ? raw.locations : { scenes: [], count: 0 },
    sealed: Boolean(raw.sealed),
    contentHash: asString(raw.content_hash || raw.contentHash),
    source,
    raw,
  }
}

function packNameFrom(value) {
  return asString(value).trim().replace(/`/g, '').split(/[\\/]/).pop().replace(/\.ya?ml$/i, '')
}

export function hydrateIdentityFromProject(project) {
  const production = hydrateProductionFromProject(project)
  const imported = importStudioBible(
    project?.importedBible
    || project?.shortFilmDirector?.bible
    || project?.shortFilmDirector?.source?.bible
    || null,
    { source: 'import' },
  )
  const migration = isPlainObject(project?.cdxMigration) ? project.cdxMigration : {}
  const next = { ...production }
  if (!next.franchiseSlug) {
    next.franchiseSlug = asString(
      production.franchiseSlug
      || migration.franchise
      || imported?.franchiseSlug
      || guessFranchiseSlug(next.slug || migration.slug || project?.name),
    )
  }
  if (!next.stylePack) {
    next.stylePack = asString(
      production.stylePack
      || migration.style_pack
      || imported?.stylePack
      || (next.franchiseSlug && loadFranchise(next.franchiseSlug)?.style_pack)
      || '',
    )
  }
  if (!next.animationStyle) {
    next.animationStyle = asString(
      production.animationStyle
      || migration.animation_style
      || imported?.animationStyle
      || (next.franchiseSlug && loadFranchise(next.franchiseSlug)?.animation_style)
      || '',
    )
  }
  next.bible = normalizeBibleSeal(production.bible)
  if (!next.bible.snapshot && imported?.raw) {
    next.bible = {
      ...next.bible,
      source: imported.source,
      snapshot: imported.raw,
      contentHash: imported.contentHash,
      sealed: Boolean(imported.sealed),
    }
  }
  return next
}

function guessFranchiseSlug(value) {
  const slug = asString(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return loadFranchise(slug) ? slug : ''
}

export function buildBible(project, { production: productionHint = null } = {}) {
  const production = normalizeProduction(productionHint || hydrateIdentityFromProject(project))
  const cast = castLayer(project, production)
  const locations = locationLayer(project)
  const style = styleLayer(production)
  const franchise = franchiseLayer(production)
  const consistency = checkFranchiseConsistency(production, {
    castIds: cast.characters.map((item) => item.id),
  })
  const story = {
    premise: asString(production.premise || production.show?.concept),
    title: asString(production.title),
    type: asString(production.type),
    logline: asString(production.logline || production.show?.logline),
    target_runtime: asString(production.format?.durationHint),
    platform: asString(production.format?.outputTarget),
    storyboard_shots: Array.isArray(project?.storyboardBoard?.cards) ? project.storyboardBoard.cards.length : 0,
  }
  const nevers = cast.characters.map((item) => item.never).filter(Boolean)
  const constraints = {
    never_identity_drift: true,
    gpu_serial: true,
    outward: 'draft',
    character_nevers: nevers,
    brand_fragment: asString(production.show?.houseStyle),
  }
  const identity = {
    title: production.title,
    type: production.type,
    slug: production.slug,
    franchise,
    status: production.current?.episodeId ? 'active' : 'bible',
  }
  const hashSource = {
    identity,
    cast,
    locations,
    style,
    story,
    constraints,
  }
  const bible = {
    version: BIBLE_VERSION,
    slug: production.slug,
    built_at: nowIso(),
    sealed: Boolean(production.bible?.sealed),
    identity,
    cast,
    locations,
    style,
    story,
    constraints,
    franchise_consistency: consistency,
    content_hash: stableBibleHash(hashSource),
  }
  return bible
}

export function sealBible(project, { sealedBy = 'operator', production: productionHint = null } = {}) {
  const production = hydrateIdentityFromProject(productionHint ? { ...project, production: productionHint } : project)
  const bible = buildBible(project, { production })
  bible.sealed = true
  bible.sealed_at = nowIso()
  bible.sealed_by = asString(sealedBy, 'operator')
  const next = {
    ...production,
    bible: {
      sealed: true,
      sealedAt: bible.sealed_at,
      sealedBy: bible.sealed_by,
      contentHash: bible.content_hash,
      snapshot: bible,
      source: 'velorn',
    },
  }
  return { production: next, bible, meta: {
    slug: bible.slug,
    sealed_at: bible.sealed_at,
    sealed_by: bible.sealed_by,
    content_hash: bible.content_hash,
  } }
}

export function unsealBible(production) {
  const norm = normalizeProduction(production)
  return {
    ...norm,
    bible: emptyBibleSeal(),
  }
}

export function applyBibleToPrompt(prompt, bible, { kind = 'video', negative = '' } = {}) {
  const packName = bible?.style?.style_pack || ''
  const animTail = bible?.style?.animation_style_card?.prompt_tail || ''
  let out = applyStylePack(prompt, packName, kind)
  if (animTail) {
    const cleaned = animTail.replace(/\s+/g, ' ').trim()
    if (cleaned && !out.toLowerCase().includes(cleaned.toLowerCase())) {
      out = out ? `${out.replace(/,+$/, '')}, ${cleaned}` : cleaned
    }
  }
  return {
    prompt: out,
    negative: applyStyleNegative(negative, packName),
    loras: loraStackFor(packName, kind),
  }
}

export function shotBrief(bible, {
  shotSlug = '',
  description = '',
  action = '',
  castIds = null,
} = {}) {
  const style = bible?.style || {}
  const story = bible?.story || {}
  const chars = []
  for (const entry of bible?.cast?.characters || []) {
    if (Array.isArray(castIds) && !castIds.includes(entry.id)) continue
    chars.push(`${entry.id}: ${entry.prompt_fragment || entry.name || ''}`)
  }
  const lines = [
    `SHOT: ${shotSlug || '(untitled)'}`,
    `PROJECT: ${bible?.slug || ''} — ${story.title || ''}`,
    `TYPE: ${story.type || ''}`,
    `PLATFORM: ${story.platform || 'general'}`,
    `DESCRIPTION: ${description || action || '(none)'}`,
    `ACTION: ${action || description || ''}`,
    `CHARACTERS: ${chars.length ? chars.join('; ') : 'none'}`,
    `STYLE_PACK: ${style.style_pack || 'default'}`,
    `ANIMATION_STYLE: ${style.animation_style || 'n/a'}`,
    `FRANCHISE: ${bible?.identity?.franchise?.slug || 'n/a'}`,
    'CONSTRAINTS: lock identity to reference images; no face morph; match outfit canon',
    'CAMERA: keep framing consistent with scene plate and blocking map',
    'LIGHTING: match location lock / style pack',
    'CONTINUITY: restyle only if previous-shot last frame provided',
    'POLICY: GPU serial; outward artifacts are drafts',
  ]
  return {
    shot: shotSlug,
    lines,
    text: lines.join('\n'),
    styled: applyBibleToPrompt(description || action, bible, { kind: 'video' }),
  }
}

export function bibleForPacket(project, production) {
  const seal = normalizeBibleSeal(production?.bible)
  const live = buildBible(project, { production })
  return {
    sealed: seal.sealed,
    sealedAt: seal.sealedAt,
    sealedBy: seal.sealedBy,
    contentHash: seal.contentHash || live.content_hash,
    live,
    snapshot: seal.snapshot,
    drift: Boolean(seal.sealed && seal.contentHash && seal.contentHash !== live.content_hash),
  }
}
