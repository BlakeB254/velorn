/**
 * Velorn-native animation / film style cards.
 *
 * Spec only from CDX Studio animation_styles.py + studio_animation_styles MCP.
 * Catalog is vendored; user overlays are optional extras passed at call time.
 */

import { ANIMATION_STYLE_CATALOG } from '../catalogs/animationStyles.catalog.js'

export const STYLE_FAMILIES = Object.freeze([
  {
    id: 'film',
    label: 'Film & live-action',
    description: 'Photoreal grades and cinema looks for commercials, movies, docs, ads',
    categories: ['film', 'cinematic'],
  },
  {
    id: 'animation',
    label: 'Animation',
    description: '2D, anime, 3D, painterly, graphic, and stop-motion looks',
    categories: ['2d', 'anime', '3d', 'painterly', 'graphic', 'stop-motion'],
  },
  {
    id: 'other',
    label: 'Other',
    description: 'Custom and uncategorized styles',
    categories: ['other'],
  },
])

export const CATEGORY_ORDER = Object.freeze([
  'film',
  'cinematic',
  '2d',
  'anime',
  '3d',
  'painterly',
  'graphic',
  'stop-motion',
  'other',
])

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const asString = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback
  return String(value)
}

export function familyForCategory(category) {
  const cat = asString(category, 'other').trim().toLowerCase() || 'other'
  for (const family of STYLE_FAMILIES) {
    if (family.categories.includes(cat)) return family.id
  }
  return 'other'
}

export function normalizeAnimationStyle(raw) {
  const src = isPlainObject(raw) ? raw : {}
  const id = asString(src.id).trim().toLowerCase()
  const category = asString(src.category, 'other').trim().toLowerCase() || 'other'
  return {
    id,
    name: asString(src.name, id),
    tagline: asString(src.tagline),
    category,
    family: asString(src.family) || familyForCategory(category),
    swatches: Array.isArray(src.swatches) ? src.swatches.map(asString).filter(Boolean) : [],
    prompt_tail: asString(src.prompt_tail).trim(),
    negative_tail: asString(src.negative_tail).trim(),
    best_for: Array.isArray(src.best_for) ? src.best_for.map(asString).filter(Boolean) : [],
    style_pack: src.style_pack || null,
    aspect_default: asString(src.aspect_default, '9:16'),
  }
}

export function listAnimationStyles({ category = '', family = '', extra = [] } = {}) {
  const extras = Array.isArray(extra) ? extra.filter(isPlainObject) : []
  const byId = new Map()
  for (const item of [...ANIMATION_STYLE_CATALOG, ...extras]) {
    const norm = normalizeAnimationStyle(item)
    if (norm.id) byId.set(norm.id, norm)
  }
  let styles = [...byId.values()]
  if (family) {
    const wanted = asString(family).trim().toLowerCase()
    styles = styles.filter((item) => item.family === wanted)
  }
  if (category) {
    const wanted = asString(category).trim().toLowerCase()
    styles = styles.filter((item) => item.category === wanted)
  }
  return styles
}

export function getAnimationStyle(styleId, extra = []) {
  const sid = asString(styleId).trim().toLowerCase()
  if (!sid) return null
  return listAnimationStyles({ extra }).find((item) => item.id === sid) || null
}

export function animationStylesForApi({ category = '', family = '', extra = [] } = {}) {
  const all = listAnimationStyles({ extra })
  const styles = listAnimationStyles({ category, family, extra })
  const cats = new Set(all.map((item) => item.category))
  const categories = [
    ...CATEGORY_ORDER.filter((id) => cats.has(id)),
    ...[...cats].filter((id) => !CATEGORY_ORDER.includes(id)).sort(),
  ]
  const families = STYLE_FAMILIES.map((fam) => {
    const famStyles = all.filter((item) => item.family === fam.id)
    return {
      id: fam.id,
      label: fam.label,
      description: fam.description,
      count: famStyles.length,
      categories: fam.categories
        .filter((id) => cats.has(id))
        .map((id) => ({ id, count: all.filter((item) => item.category === id).length })),
    }
  })
  return {
    styles,
    categories,
    count: styles.length,
    category_order: CATEGORY_ORDER,
    families,
  }
}
