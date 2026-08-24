/**
 * CDX Studio → CDX platform directory client (:7017 core API).
 *
 * Powers the CreateProjectWizard's ad/subject step: org search, offering
 * lookup, and unified knowledge-base search (which also surfaces people —
 * the "relevant faces" an ad can optionally cast).
 *
 * Same house pattern as mediaDam.js: configurable base URL in localStorage,
 * fail-open — the CDX platform being down must never break project creation.
 * Manual entry is always available in the wizard, so every function returns
 * { ok, items } and never throws on network/HTTP failure.
 *
 * The mapping helpers are pure and node-tested; the fetchers accept an
 * injected fetchImpl so tests never touch the network.
 */

const DEFAULT_CDX_CORE_URL = 'http://127.0.0.1:7017'

export function getCdxCoreUrl() {
  try {
    const stored = localStorage.getItem('comfystudio-cdx-core-url')
    if (stored && /^https?:\/\//i.test(stored)) return stored.replace(/\/+$/, '')
  } catch (_) { /* non-browser contexts */ }
  return DEFAULT_CDX_CORE_URL
}

/* ── pure mappers (node-tested) ───────────────────────────────────────── */

/**
 * First raw field that looks like an http(s) image URL, else ''.
 * Additive: the CDX API returns no image field today, but the mappers pass
 * one through the moment any of these keys shows up.
 */
export function pickImageUrl(raw) {
  if (!raw || typeof raw !== 'object') return ''
  const candidates = [raw.imageUrl, raw.avatarUrl, raw.photoUrl, raw.image, raw.url]
  for (const candidate of candidates) {
    const value = String(candidate || '').trim()
    if (/^https?:\/\//i.test(value) && /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(value)) return value
  }
  return ''
}

/** /api/v1/entities/options row → wizard option. */
export function mapEntityOption(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = String(raw.value ?? raw.id ?? '').trim()
  const name = String(raw.label ?? raw.name ?? '').trim()
  if (!id || !name) return null
  const option = { id, name, group: String(raw.group || raw.type || '').trim() }
  const imageUrl = pickImageUrl(raw)
  if (imageUrl) option.imageUrl = imageUrl
  return option
}

/** /api/v1/offerings doc → wizard offering. */
export function mapOffering(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = String(raw.id ?? '').trim()
  const name = String(raw.name ?? '').trim()
  if (!id || !name) return null
  return {
    id,
    name,
    type: String(raw.type || '').trim(),
    category: String(raw.category || '').trim(),
    description: String(raw.shortDescription || raw.description || '').trim(),
  }
}

/** /api/v1/search result row → wizard knowledge hit. */
export function mapKnowledgeHit(raw) {
  if (!raw || typeof raw !== 'object') return null
  const name = String(raw.name ?? '').trim()
  if (!name) return null
  const hit = {
    id: String(raw.id ?? '').trim(),
    collection: String(raw.collection || '').trim(),
    name,
    type: String(raw.type || '').trim(),
    description: String(raw.description || '').trim(),
  }
  const imageUrl = pickImageUrl(raw)
  if (imageUrl) hit.imageUrl = imageUrl
  return hit
}

/** Entity-option groups that count as an org/subject a commercial can advertise. */
export const SUBJECT_GROUPS = Object.freeze(['organization', 'business', 'product'])
/** Groups that count as a castable face. */
export const FACE_GROUPS = Object.freeze(['person'])

export function isSubjectOption(option) {
  return SUBJECT_GROUPS.includes(String(option?.group || '').toLowerCase())
}

export function isFaceOption(option) {
  return FACE_GROUPS.includes(String(option?.group || '').toLowerCase())
}

/* ── fetchers (fail-open, injectable) ─────────────────────────────────── */

async function getJson(path, { fetchImpl, signal } = {}) {
  const impl = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null)
  if (!impl) return { ok: false, status: 0, body: null }
  try {
    const response = await impl(`${getCdxCoreUrl()}${path}`, { signal })
    if (!response?.ok) return { ok: false, status: response?.status || 0, body: null }
    return { ok: true, status: response.status, body: await response.json() }
  } catch (_) {
    return { ok: false, status: 0, body: null }
  }
}

/**
 * Org/person/face search for wizard dropdowns.
 * Returns { ok, items: [{ id, name, group }] }.
 */
export async function searchEntityOptions(query, { fetchImpl, signal } = {}) {
  const q = String(query || '').trim()
  const { ok, body } = await getJson(
    `/api/v1/entities/options?search=${encodeURIComponent(q)}`,
    { fetchImpl, signal },
  )
  const rows = Array.isArray(body) ? body : Array.isArray(body?.docs) ? body.docs : []
  return { ok, items: rows.map(mapEntityOption).filter(Boolean) }
}

/**
 * Offerings for one entity (the ad's "what are we selling" multi-select).
 * Returns { ok, items: [{ id, name, type, category, description }] }.
 */
export async function listOfferings(entityId, { fetchImpl, signal, limit = 50 } = {}) {
  const id = String(entityId || '').trim()
  if (!id) return { ok: false, items: [] }
  const { ok, body } = await getJson(
    `/api/v1/offerings?entity_id=${encodeURIComponent(id)}&limit=${Math.max(1, Math.min(200, limit))}`,
    { fetchImpl, signal },
  )
  const rows = Array.isArray(body?.docs) ? body.docs : []
  return { ok, items: rows.map(mapOffering).filter(Boolean) }
}

/**
 * Unified knowledge-base search (brands, campaigns, content, entities,
 * offerings, projects — reranked server-side). Used to enrich an ad concept
 * brief and to find org-linked people for optional face refs.
 * Returns { ok, items: [{ id, collection, name, type, description }] }.
 */
export async function searchKnowledge(query, { fetchImpl, signal, collections, limit = 10 } = {}) {
  const q = String(query || '').trim()
  if (!q) return { ok: false, items: [] }
  const cols = Array.isArray(collections) && collections.length
    ? `&collections=${encodeURIComponent(collections.join(','))}`
    : ''
  const { ok, body } = await getJson(
    `/api/v1/search?q=${encodeURIComponent(q)}${cols}&limit=${Math.max(1, Math.min(50, limit))}`,
    { fetchImpl, signal },
  )
  const rows = Array.isArray(body?.results) ? body.results : []
  return { ok, items: rows.map(mapKnowledgeHit).filter(Boolean) }
}
