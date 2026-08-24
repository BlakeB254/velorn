import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  UNAFFILIATED,
  filterProjects,
  groupProjectsByFranchise,
  isAdType,
  projectListMeta,
  shouldListProjectFolder,
  sortProjects,
  subjectFromProject,
  typeFacets,
  typeLabel,
} from '../src/services/projectListing.js'
import { resolveContextStack } from '../src/services/contextStack.js'

/* ── what the home list already filtered out ──────────────────────────── */

test('archived and dot/underscore folders stay off the home list', () => {
  assert.equal(shouldListProjectFolder('My Show', '/p/My Show'), true)
  assert.equal(shouldListProjectFolder('_archive', '/p/_archive'), false)
  assert.equal(shouldListProjectFolder('old', '/p/_archive/old'), false)
  assert.equal(shouldListProjectFolder('.hidden', '/p/.hidden'), false)
})

/* ── meta the list now carries ────────────────────────────────────────── */

test('list meta surfaces the franchise a project belongs to', () => {
  const meta = projectListMeta({ production: { type: 'show', franchiseSlug: 'chi-town-triplets' } })
  assert.equal(meta.productionType, 'show')
  assert.equal(meta.franchiseSlug, 'chi-town-triplets')
  assert.equal(meta.franchiseName, 'Chi-Town Triplets')
})

test('an off-catalog franchise still groups under its slug', () => {
  const meta = projectListMeta({ production: { franchiseSlug: 'not-in-catalog' } })
  assert.equal(meta.franchiseName, 'not-in-catalog', 'never silently collapses into Unaffiliated')
})

test('the ad subject captured at creation is finally readable', () => {
  const project = {
    production: { type: 'commercial' },
    creation: {
      ad: {
        subject: {
          mode: 'cdx',
          orgId: '90',
          orgName: 'Integrity Developers',
          offerings: [{ id: '5', name: 'Custom Homes' }, { id: '6', name: 'Renovations' }],
        },
      },
    },
  }
  const meta = projectListMeta(project)
  assert.equal(meta.subject.orgName, 'Integrity Developers')
  assert.equal(meta.subject.offerings.length, 2)
})

test('a project with no ad subject reports none rather than an empty shell', () => {
  assert.equal(subjectFromProject({}), null)
  assert.equal(subjectFromProject({ creation: { ad: { subject: { mode: 'none' } } } }), null)
})

/* ── type taxonomy ────────────────────────────────────────────────────── */

test('ad-style types are the ones that carry a brand', () => {
  assert.equal(isAdType('commercial'), true)
  assert.equal(isAdType('advertisement'), true, 'aliases normalize')
  assert.equal(isAdType('hype-video'), true)
  assert.equal(isAdType('movie'), false)
  assert.equal(isAdType('show'), false)
})

test('type labels come from the production catalog', () => {
  assert.equal(typeLabel('show'), 'Show')
  assert.equal(typeLabel('music-video'), 'Music video')
  assert.equal(typeLabel(''), 'Untyped')
})

/* ── organising the list ──────────────────────────────────────────────── */

const PROJECTS = [
  { name: 'CTT Ep 1', productionType: 'show', franchiseSlug: 'chi-town-triplets', franchiseName: 'Chi-Town Triplets', modified: '2026-08-03' },
  { name: 'CTT Ep 2', productionType: 'show', franchiseSlug: 'chi-town-triplets', franchiseName: 'Chi-Town Triplets', modified: '2026-08-10' },
  { name: 'GCC Spot', productionType: 'commercial', franchiseSlug: '', modified: '2026-08-20', subject: { orgName: 'GCC', offerings: [{ id: '1', name: 'Cleaning' }] } },
  { name: 'Alley Skit', productionType: 'skit', franchiseSlug: '', modified: '2026-08-01' },
]

test('type facets only offer filters that would return something', () => {
  const facets = typeFacets(PROJECTS)
  const ids = facets.map((f) => f.id)
  assert.deepEqual(ids.sort(), ['commercial', 'show', 'skit'])
  assert.equal(facets.find((f) => f.id === 'show').count, 2)
})

test('filtering by type narrows the list', () => {
  assert.equal(filterProjects(PROJECTS, { types: ['show'] }).length, 2)
  assert.equal(filterProjects(PROJECTS, { types: ['commercial', 'skit'] }).length, 2)
  assert.equal(filterProjects(PROJECTS, { types: [] }).length, 4, 'no filter means everything')
})

test('search reaches franchise, type, org and offering names', () => {
  assert.equal(filterProjects(PROJECTS, { query: 'chi-town' }).length, 2)
  assert.equal(filterProjects(PROJECTS, { query: 'cleaning' })[0].name, 'GCC Spot', 'an offering name finds its project')
  assert.equal(filterProjects(PROJECTS, { query: 'gcc' })[0].name, 'GCC Spot')
  assert.equal(filterProjects(PROJECTS, { query: 'nothing here' }).length, 0)
})

test('sorting by recent, name and type', () => {
  assert.equal(sortProjects(PROJECTS, 'recent')[0].name, 'GCC Spot')
  assert.equal(sortProjects(PROJECTS, 'name')[0].name, 'Alley Skit')
  assert.equal(sortProjects(PROJECTS, 'type')[0].productionType, 'commercial')
  assert.equal(sortProjects(PROJECTS).length, 4, 'sorting never drops a project')
})

test('sorting does not mutate the input list', () => {
  const before = PROJECTS.map((p) => p.name)
  sortProjects(PROJECTS, 'name')
  assert.deepEqual(PROJECTS.map((p) => p.name), before)
})

test('franchises group together and unaffiliated always comes last', () => {
  const groups = groupProjectsByFranchise(PROJECTS)
  assert.equal(groups.length, 2)
  assert.equal(groups[0].slug, 'chi-town-triplets')
  assert.equal(groups[0].projects.length, 2)
  assert.equal(groups[groups.length - 1].slug, UNAFFILIATED)
  assert.equal(groups[groups.length - 1].name, 'Unaffiliated')
})

/* ── brand as a context layer ─────────────────────────────────────────── */

const AD_CREATION = {
  ad: {
    subject: {
      mode: 'cdx',
      orgId: '90',
      orgName: 'Integrity Developers',
      offerings: [{ id: '5', name: 'Custom Homes' }],
    },
  },
}

test('a commercial puts its brand and offering into the prompt', () => {
  const stack = resolveContextStack({
    references: { characters: [], locations: [], props: [], movements: [] },
    production: { type: 'commercial' },
    creation: AD_CREATION,
    shot: {},
  })
  const brand = stack.layers.find((l) => l.kind === 'brand')
  assert.equal(brand.status, 'ready')
  assert.ok(stack.promptLines.includes('Brand: Integrity Developers'))
  assert.ok(stack.promptLines.includes('Featured offering: Custom Homes'))
})

test('live directory data overrides the stored org name', () => {
  const stack = resolveContextStack({
    references: {},
    creation: AD_CREATION,
    brand: { name: 'Integrity Developers Inc', voice: 'plainspoken, local, no hype' },
    shot: {},
  })
  assert.ok(stack.promptLines.includes('Brand: Integrity Developers Inc'))
  assert.ok(stack.promptLines.includes('Brand voice: plainspoken, local, no hype'))
})

test('a non-ad project has no brand layer at all', () => {
  const stack = resolveContextStack({
    references: {},
    production: { type: 'show' },
    shot: {},
  })
  assert.equal(stack.layers.find((l) => l.kind === 'brand').status, 'inactive')
  assert.equal(stack.promptLines.length, 0)
})

test('brand sits directly after franchise, before the look', () => {
  const stack = resolveContextStack({
    references: {},
    production: { franchiseSlug: 'chi-town-triplets', type: 'commercial' },
    creation: AD_CREATION,
    shot: {},
  })
  const kinds = stack.active.map((l) => l.kind)
  assert.ok(kinds.indexOf('franchise') < kinds.indexOf('brand'))
  assert.ok(kinds.indexOf('brand') < kinds.indexOf('productionType'))
})
