/**
 * CDX Studio-native style packs.
 *
 * Spec only from CDX Studio style_packs.py + styles/README.md:
 *   one pack per production; beat prompts describe WHAT happens;
 *   the pack carries HOW it looks. Fix the pack, not the shot.
 *
 * Pure / Electron-free so it runs under `node --test`.
 */

import { STYLE_PACK_CATALOG } from '../catalogs/stylePacks.catalog.js'

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const asString = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback
  return String(value)
}

export const STYLE_PACK_CONTRACT = Object.freeze({
  gpuSerial: true,
  outward: 'draft',
  previewOnlyDefault: true,
  rule: 'Beat prompts describe action. The pack carries look, LoRAs, palette, and negatives.',
})

export function cleanTail(text) {
  return asString(text).replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.,;]+$/, '')
}

export function packStem(nameOrPath) {
  const raw = asString(nameOrPath).trim().replace(/`/g, '')
  if (!raw) return ''
  const leaf = raw.split(/[\\/]/).pop() || raw
  return leaf.replace(/\.ya?ml$/i, '').trim().toLowerCase()
}

export function normalizeStylePack(raw, fallbackId = '') {
  const src = isPlainObject(raw) ? raw : {}
  const id = packStem(src.id || src.name || fallbackId)
  return {
    id,
    name: asString(src.name, id),
    summary: asString(src.summary),
    applies_to: Array.isArray(src.applies_to) ? src.applies_to.map(asString).filter(Boolean) : [],
    parody_of: src.parody_of ? asString(src.parody_of) : null,
    kind: asString(src.kind, 'house'),
    swatches: Array.isArray(src.swatches) ? src.swatches.map(asString).filter(Boolean) : [],
    prompt_tail: asString(src.prompt_tail),
    video_prompt_tail: asString(src.video_prompt_tail),
    negative_tail: asString(src.negative_tail),
    lora_stack: Array.isArray(src.lora_stack) ? src.lora_stack.filter(isPlainObject).map((item) => ({
      file: asString(item.file),
      strength: Number.isFinite(Number(item.strength)) ? Number(item.strength) : 1,
      when: asString(item.when, 'any'),
    })).filter((item) => item.file) : [],
    resolution: isPlainObject(src.resolution) ? {
      w: Number(src.resolution.w) || null,
      h: Number(src.resolution.h) || null,
    } : null,
    aspect: asString(src.aspect),
    camera_language: asString(src.camera_language),
    grade: asString(src.grade),
    pacing: asString(src.pacing),
    sound: asString(src.sound),
    notes: asString(src.notes),
    brand_id: src.brand_id == null || src.brand_id === '' ? null : Number(src.brand_id) || src.brand_id,
    pace_mode: src.pace_mode ? asString(src.pace_mode) : null,
  }
}

export function listStylePacks() {
  return STYLE_PACK_CATALOG.map((pack) => normalizeStylePack(pack, pack.id))
}

export function loadStylePack(nameOrPath) {
  const stem = packStem(nameOrPath)
  if (!stem) return null
  const hit = STYLE_PACK_CATALOG.find((pack) => {
    const id = packStem(pack.id || pack.name)
    const name = asString(pack.name).toLowerCase()
    return id === stem || name === stem || name.replace(/\s+/g, '-') === stem
  })
  return hit ? normalizeStylePack(hit, stem) : null
}

export function stylePackForApi(pack) {
  if (!pack) return null
  const norm = normalizeStylePack(pack, pack.id)
  return {
    id: norm.id,
    name: norm.name,
    summary: norm.summary,
    applies_to: norm.applies_to,
    parody_of: norm.parody_of,
    kind: norm.kind,
    aspect: norm.aspect,
    resolution: norm.resolution,
    prompt_tail: norm.prompt_tail,
    video_prompt_tail: norm.video_prompt_tail,
    negative_tail: norm.negative_tail,
    camera_language: norm.camera_language,
    grade: norm.grade,
    swatches: norm.swatches,
    lora_stack: norm.lora_stack,
    brand_id: norm.brand_id,
  }
}

function appendTail(prompt, tail) {
  const base = asString(prompt).trim()
  const cleaned = cleanTail(tail)
  if (!cleaned) return base
  if (base.toLowerCase().includes(cleaned.toLowerCase())) return base
  return base ? `${base.replace(/,+$/, '')}, ${cleaned}` : cleaned
}

export function applyStylePack(prompt, packOrName, kind = 'video') {
  const pack = isPlainObject(packOrName) ? normalizeStylePack(packOrName, packOrName.id) : loadStylePack(packOrName)
  if (!pack) return asString(prompt)
  const videoKinds = new Set(['video', 'i2v', 'flf', 'extend', 'clip'])
  const tail = videoKinds.has(asString(kind).toLowerCase()) ? (pack.video_prompt_tail || pack.prompt_tail) : pack.prompt_tail
  return appendTail(prompt, tail)
}

export function applyStyleNegative(negative, packOrName) {
  const pack = isPlainObject(packOrName) ? normalizeStylePack(packOrName, packOrName.id) : loadStylePack(packOrName)
  if (!pack) return asString(negative)
  return appendTail(negative, pack.negative_tail)
}

export function loraStackFor(packOrName, kind = 'video') {
  const pack = isPlainObject(packOrName) ? normalizeStylePack(packOrName, packOrName.id) : loadStylePack(packOrName)
  if (!pack) return []
  const wanted = asString(kind).toLowerCase() || 'any'
  return pack.lora_stack.filter((item) => {
    const when = asString(item.when, 'any').toLowerCase()
    if (!when || when === 'any') return true
    if (when === wanted) return true
    if (when === 'video' && ['i2v', 'flf', 'extend', 'clip'].includes(wanted)) return true
    if (when === 'still' && ['image', 'keyframe'].includes(wanted)) return true
    return false
  })
}

export function resolutionStr(packOrName) {
  const pack = isPlainObject(packOrName) ? normalizeStylePack(packOrName, packOrName.id) : loadStylePack(packOrName)
  if (pack?.resolution?.w && pack?.resolution?.h) return `${pack.resolution.w}x${pack.resolution.h}`
  return null
}

export function applyGenerationStyle(cardPrompt, {
  packName = '',
  kind = 'still',
  negative = '',
} = {}) {
  const pack = loadStylePack(packName)
  return {
    prompt: applyStylePack(cardPrompt, pack, kind),
    negative: applyStyleNegative(negative, pack),
    loras: loraStackFor(pack, kind),
    pack: pack ? stylePackForApi(pack) : null,
    applied: Boolean(pack),
  }
}
