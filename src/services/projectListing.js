/**
 * Which folders appear on the CDX Studio home project list, and how that list
 * is organised once it is there.
 *
 * Versions of a show live *inside* that show (productionCuts), never as
 * sibling project folders. Archived mistakes go under `_archive/`.
 *
 * The home screen groups by franchise (the durable IP universe) and filters
 * by production type (show / movie / skit / commercial / …). Both already
 * exist as project data — `production.franchiseSlug` and `production.type` —
 * so this module just surfaces them in a shape the list can render. Ad-type
 * projects additionally carry the CDX org and offerings the wizard captured
 * at creation (`creation.ad.subject`), which nothing displayed before.
 *
 * Pure and node-test-safe.
 */

import { loadFranchise } from './franchises.js'
import { getProductionType, normalizeProductionType } from './productionTypes.js'

export const UNAFFILIATED = '__unaffiliated__'

export function shouldListProjectFolder(name = '', path = '') {
  const rawPath = String(path || name || '')
  const leaf = String(name || rawPath).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ''
  if (!leaf || leaf.startsWith('.') || leaf.startsWith('_')) return false
  if (/(^|[\\/])_archive([\\/]|$)/i.test(rawPath)) return false
  return true
}

export function versionCountFromProject(project = {}) {
  const index = project.productionCuts
  if (!index || typeof index !== 'object') return 0
  return Object.values(index).reduce((sum, bucket) => {
    const cuts = Array.isArray(bucket?.cuts) ? bucket.cuts.length : 0
    return sum + cuts
  }, 0)
}

const asString = (value) => (value === null || value === undefined ? '' : String(value))

/**
 * The org + offerings an ad-style project is selling. The creation wizard
 * captures this (createWizard.js → creation.ad.subject) and, until now,
 * nothing ever read it back outside the ad easy-mode concept seed.
 */
export function subjectFromProject(project = {}) {
  const subject = project?.creation?.ad?.subject
  if (!subject || typeof subject !== 'object') return null
  const mode = subject.mode === 'cdx' || subject.mode === 'manual' ? subject.mode : 'none'
  if (mode === 'none') return null
  const offerings = (Array.isArray(subject.offerings) ? subject.offerings : [])
    .map((item) => ({ id: asString(item?.id), name: asString(item?.name) }))
    .filter((item) => item.id || item.name)
  const orgName = asString(subject.orgName)
  const orgId = asString(subject.orgId)
  if (!orgName && !orgId && !offerings.length) return null
  return { mode, orgId, orgName, offerings }
}

export function projectListMeta(project = {}) {
  const production = project.production || {}
  const franchiseSlug = asString(production.franchiseSlug)
  const franchise = franchiseSlug ? loadFranchise(franchiseSlug) : null
  return {
    productionType: production.type || '',
    episodeId: production.current?.episodeId || '',
    versionCount: versionCountFromProject(project),
    franchiseSlug,
    // Fall back to the slug so an off-catalog franchise still groups, rather
    // than silently collapsing into Unaffiliated.
    franchiseName: franchise?.name || franchiseSlug,
    subject: subjectFromProject(project),
  }
}

/* ── organisation ─────────────────────────────────────────────────────── */

/** Does this project type sell something? Drives the brand/offering display. */
export function isAdType(typeId) {
  return ['commercial', 'psa', 'hype-video', 'site-update', 'website-tour']
    .includes(normalizeProductionType(typeId, ''))
}

export function typeLabel(typeId) {
  const def = getProductionType(typeId)
  if (def) return def.label
  return asString(typeId) || 'Untyped'
}

/**
 * Type filter chips: only the types actually present, each with its count,
 * so the home screen never offers a filter that would empty the list.
 */
export function typeFacets(projects = []) {
  const counts = new Map()
  for (const project of projects) {
    const id = asString(project?.productionType)
    const key = id || 'untyped'
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: id === 'untyped' ? 'Untyped' : typeLabel(id), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export function filterProjects(projects = [], { types = [], query = '' } = {}) {
  const wanted = new Set((Array.isArray(types) ? types : [types]).filter(Boolean))
  const needle = asString(query).trim().toLowerCase()
  return projects.filter((project) => {
    if (wanted.size) {
      const id = asString(project?.productionType) || 'untyped'
      if (!wanted.has(id)) return false
    }
    if (!needle) return true
    const haystack = [
      project?.name,
      project?.franchiseName,
      project?.productionType,
      project?.subject?.orgName,
      ...(project?.subject?.offerings || []).map((o) => o.name),
    ].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(needle)
  })
}

export const PROJECT_SORTS = Object.freeze([
  { id: 'recent', label: 'Recently modified' },
  { id: 'name', label: 'Name' },
  { id: 'type', label: 'Type' },
])

const timeOf = (value) => {
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : 0
}

export function sortProjects(projects = [], mode = 'recent') {
  const list = [...projects]
  if (mode === 'name') {
    return list.sort((a, b) => asString(a?.name).localeCompare(asString(b?.name)))
  }
  if (mode === 'type') {
    return list.sort((a, b) => (
      typeLabel(a?.productionType).localeCompare(typeLabel(b?.productionType))
      || asString(a?.name).localeCompare(asString(b?.name))
    ))
  }
  return list.sort((a, b) => timeOf(b?.modified) - timeOf(a?.modified))
}

/**
 * Group into franchises for the home screen. Unaffiliated projects always
 * come last under a single bucket so a one-off never hides at the top.
 */
export function groupProjectsByFranchise(projects = []) {
  const groups = new Map()
  for (const project of projects) {
    const slug = asString(project?.franchiseSlug) || UNAFFILIATED
    if (!groups.has(slug)) {
      groups.set(slug, {
        slug,
        name: slug === UNAFFILIATED ? 'Unaffiliated' : (project?.franchiseName || slug),
        projects: [],
      })
    }
    groups.get(slug).projects.push(project)
  }
  const list = [...groups.values()]
  const loose = list.filter((group) => group.slug === UNAFFILIATED)
  return [
    ...list.filter((group) => group.slug !== UNAFFILIATED).sort((a, b) => a.name.localeCompare(b.name)),
    ...loose,
  ]
}
