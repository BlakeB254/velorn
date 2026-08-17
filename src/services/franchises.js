/**
 * Velorn-native franchises (shared IP universes).
 *
 * Spec only from CDX Studio franchises.py:
 *   a franchise is the durable identity layer; episodes/projects link to it
 *   and inherit locked style, animation card, aspect, and invariants.
 *
 * Pure / Electron-free so it runs under `node --test`.
 */

import { FRANCHISE_CATALOG } from '../catalogs/franchises.catalog.js'
import { loadStylePack, stylePackForApi } from './stylePacks.js'
import { getAnimationStyle } from './animationStyles.js'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const asString = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback
  return String(value)
}

export function slugifyFranchise(value, fallback = '') {
  const slug = asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return SLUG_RE.test(slug) ? slug : fallback
}

export function normalizeFranchise(raw, fallbackSlug = '') {
  const src = isPlainObject(raw) ? raw : {}
  const slug = slugifyFranchise(src.slug || fallbackSlug, slugifyFranchise(src.name, fallbackSlug))
  return {
    slug,
    name: asString(src.name, slug),
    summary: asString(src.summary),
    status: asString(src.status, 'active'),
    cast_canon_path: asString(src.cast_canon_path || src.cast_canon),
    locations_path: asString(src.locations_path),
    style_pack: packStemSafe(src.style_pack),
    animation_style: asString(src.animation_style).trim(),
    default_aspect: asString(src.default_aspect, '9:16'),
    project_kinds: listOf(src.project_kinds || src.kinds),
    project_slugs: listOf(src.project_slugs || src.projects),
    brand: asString(src.brand),
    entity_id: asString(src.entity_id),
    invariants: listOf(src.invariants),
    tags: listOf(src.tags),
    source: asString(src.source, 'velorn-catalog'),
  }
}

function packStemSafe(value) {
  return asString(value).trim().replace(/`/g, '').split(/[\\/]/).pop().replace(/\.ya?ml$/i, '')
}

function listOf(value) {
  if (Array.isArray(value)) return value.map((item) => asString(item).trim()).filter(Boolean)
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return []
}

export function listFranchises() {
  return FRANCHISE_CATALOG.map((item) => normalizeFranchise(item, item.slug))
}

export function loadFranchise(slug) {
  const wanted = slugifyFranchise(slug)
  if (!wanted) return null
  const hit = FRANCHISE_CATALOG.find((item) => slugifyFranchise(item.slug || item.name) === wanted)
  return hit ? normalizeFranchise(hit, wanted) : null
}

export function franchiseForApi(franchise) {
  if (!franchise) return null
  const norm = normalizeFranchise(franchise, franchise.slug)
  const pack = norm.style_pack ? loadStylePack(norm.style_pack) : null
  const animation = norm.animation_style ? getAnimationStyle(norm.animation_style) : null
  return {
    ...norm,
    project_count: norm.project_slugs.length,
    style_pack_card: pack ? stylePackForApi(pack) : null,
    animation_style_card: animation,
  }
}

export function bindFranchise(production = {}, slug, { inheritEmpty = true } = {}) {
  const franchise = loadFranchise(slug)
  if (!franchise) {
    return {
      ok: false,
      reason: slug ? `franchise '${slug}' not found` : 'franchise slug required',
      production,
    }
  }
  const next = isPlainObject(production) ? { ...production } : {}
  next.franchiseSlug = franchise.slug
  if (inheritEmpty) {
    if (!asString(next.stylePack) && franchise.style_pack) next.stylePack = franchise.style_pack
    if (!asString(next.animationStyle) && franchise.animation_style) next.animationStyle = franchise.animation_style
    if (isPlainObject(next.format) && !asString(next.format.aspect) && franchise.default_aspect) {
      next.format = { ...next.format, aspect: franchise.default_aspect }
    }
    if (isPlainObject(next.show) && !asString(next.show.houseStyle) && franchise.style_pack) {
      next.show = { ...next.show, houseStyle: franchise.style_pack }
    }
  }
  return { ok: true, franchise: franchiseForApi(franchise), production: next }
}

export function checkFranchiseConsistency(production = {}, {
  franchise: franchiseHint = null,
  castIds = [],
} = {}) {
  const slug = asString(production.franchiseSlug || franchiseHint?.slug || production.franchise)
  const franchise = franchiseHint || loadFranchise(slug)
  const issues = []
  if (!franchise) {
    return {
      ok: !slug,
      slug: slug || null,
      found: false,
      issues: slug ? [`franchise '${slug}' is not in the Velorn catalog`] : [],
      invariants: [],
    }
  }
  if (franchise.style_pack && production.stylePack && packStemSafe(production.stylePack) !== packStemSafe(franchise.style_pack)) {
    issues.push(`style pack '${production.stylePack}' differs from franchise house pack '${franchise.style_pack}'`)
  }
  if (franchise.animation_style && production.animationStyle && asString(production.animationStyle) !== franchise.animation_style) {
    issues.push(`animation style '${production.animationStyle}' differs from franchise '${franchise.animation_style}'`)
  }
  const aspect = asString(production.format?.aspect || production.aspect)
  if (franchise.default_aspect && aspect && !aspect.includes(franchise.default_aspect.replace(/^'|'$/g, ''))) {
    issues.push(`aspect '${aspect}' differs from franchise default '${franchise.default_aspect}'`)
  }
  if (franchise.project_kinds.length && production.type && !franchise.project_kinds.includes(production.type)) {
    issues.push(`production type '${production.type}' is outside franchise kinds (${franchise.project_kinds.join(', ')})`)
  }
  return {
    ok: issues.length === 0,
    slug: franchise.slug,
    found: true,
    name: franchise.name,
    issues,
    invariants: franchise.invariants,
    castIds: Array.isArray(castIds) ? castIds : [],
    style_pack: franchise.style_pack,
    animation_style: franchise.animation_style,
  }
}
