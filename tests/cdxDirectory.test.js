import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FACE_GROUPS,
  SUBJECT_GROUPS,
  getCdxCoreUrl,
  isFaceOption,
  isSubjectOption,
  listOfferings,
  mapEntityOption,
  mapKnowledgeHit,
  mapOffering,
  pickImageUrl,
  searchEntityOptions,
  searchKnowledge,
} from '../src/services/cdxDirectory.js'

test('getCdxCoreUrl falls back to the local core API default', () => {
  assert.equal(getCdxCoreUrl(), 'http://127.0.0.1:7017')
})

test('mapEntityOption maps value/label/group and rejects blanks', () => {
  assert.deepEqual(mapEntityOption({ value: 42, label: 'Acme Org', group: 'organization' }), {
    id: '42', name: 'Acme Org', group: 'organization',
  })
  assert.deepEqual(mapEntityOption({ id: 'p1', name: 'Jane', type: 'person' }), {
    id: 'p1', name: 'Jane', group: 'person',
  })
  assert.equal(mapEntityOption({ value: '', label: 'No id' }), null)
  assert.equal(mapEntityOption({ value: 'x', label: '' }), null)
  assert.equal(mapEntityOption(null), null)
})

test('mapOffering prefers shortDescription and keeps type/category', () => {
  assert.deepEqual(mapOffering({
    id: 7, name: 'Pro Plan', type: 'subscription', category: 'saas',
    shortDescription: 'Short', description: 'Long',
  }), {
    id: '7', name: 'Pro Plan', type: 'subscription', category: 'saas', description: 'Short',
  })
  assert.equal(mapOffering({ id: 1, name: '' }), null)
})

test('mapKnowledgeHit keeps collection/type and rejects nameless rows', () => {
  assert.deepEqual(mapKnowledgeHit({
    id: 'c1', collection: 'campaigns', name: 'Spring Push', type: 'campaign', description: 'd',
  }), {
    id: 'c1', collection: 'campaigns', name: 'Spring Push', type: 'campaign', description: 'd',
  })
  assert.equal(mapKnowledgeHit({ id: 'x' }), null)
})

test('subject vs face group classifiers', () => {
  assert.ok(SUBJECT_GROUPS.includes('organization'))
  assert.ok(FACE_GROUPS.includes('person'))
  assert.ok(isSubjectOption({ group: 'Business' }))
  assert.ok(!isSubjectOption({ group: 'person' }))
  assert.ok(isFaceOption({ group: 'person' }))
  assert.ok(!isFaceOption({ group: 'organization' }))
})

test('pickImageUrl takes the first http(s) image-looking field', () => {
  assert.equal(pickImageUrl({ imageUrl: 'https://cdn.example.com/a.png' }), 'https://cdn.example.com/a.png')
  assert.equal(pickImageUrl({ avatarUrl: 'https://cdn.example.com/a.jpg?w=128' }), 'https://cdn.example.com/a.jpg?w=128')
  assert.equal(pickImageUrl({ photoUrl: 'https://cdn.example.com/a.webp' }), 'https://cdn.example.com/a.webp')
  assert.equal(pickImageUrl({ image: 'https://cdn.example.com/a.jpeg#x' }), 'https://cdn.example.com/a.jpeg#x')
  assert.equal(pickImageUrl({ url: 'http://cdn.example.com/a.gif' }), 'http://cdn.example.com/a.gif')
  // Non-image / non-http values are skipped in favor of a later image field.
  assert.equal(pickImageUrl({
    imageUrl: 'https://example.com/profile-page',
    avatarUrl: 'not-a-url.png',
    photoUrl: 'https://cdn.example.com/face.avif',
  }), 'https://cdn.example.com/face.avif')
  assert.equal(pickImageUrl({ imageUrl: 'https://example.com/no-extension' }), '')
  assert.equal(pickImageUrl({}), '')
  assert.equal(pickImageUrl(null), '')
})

test('mapEntityOption passes imageUrl through only when present', () => {
  assert.deepEqual(mapEntityOption({
    value: 'p1', label: 'Jane', group: 'person', imageUrl: 'https://cdn.example.com/jane.png',
  }), {
    id: 'p1', name: 'Jane', group: 'person', imageUrl: 'https://cdn.example.com/jane.png',
  })
  // Absent field → no key at all (keeps the { id, name, group } shape stable).
  assert.deepEqual(mapEntityOption({ value: 'p2', label: 'No Image', group: 'person' }), {
    id: 'p2', name: 'No Image', group: 'person',
  })
})

test('mapKnowledgeHit passes imageUrl through only when present', () => {
  assert.deepEqual(mapKnowledgeHit({
    id: 'e1', collection: 'entities', name: 'Jane Face', type: 'person',
    avatarUrl: 'https://cdn.example.com/jane.jpg',
  }), {
    id: 'e1', collection: 'entities', name: 'Jane Face', type: 'person',
    description: '', imageUrl: 'https://cdn.example.com/jane.jpg',
  })
  assert.deepEqual(mapKnowledgeHit({ id: 'e2', collection: 'entities', name: 'Plain', type: 'person' }), {
    id: 'e2', collection: 'entities', name: 'Plain', type: 'person', description: '',
  })
})

function fakeFetch(routes) {
  const calls = []
  const impl = async (url) => {
    calls.push(url)
    for (const [match, body] of routes) {
      if (url.includes(match)) return { ok: true, status: 200, json: async () => body }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  return { impl, calls }
}

test('searchEntityOptions hits the options endpoint and maps rows', async () => {
  const { impl, calls } = fakeFetch([
    ['/api/v1/entities/options', [{ value: 9, label: 'Acme', group: 'organization' }, { value: '', label: 'bad' }]],
  ])
  const result = await searchEntityOptions('acme', { fetchImpl: impl })
  assert.equal(result.ok, true)
  assert.deepEqual(result.items, [{ id: '9', name: 'Acme', group: 'organization' }])
  assert.ok(calls[0].includes('search=acme'))
})

test('listOfferings requires an entity id and maps docs', async () => {
  assert.deepEqual(await listOfferings('', { fetchImpl: async () => ({}) }), { ok: false, items: [] })
  const { impl, calls } = fakeFetch([
    ['/api/v1/offerings', { docs: [{ id: 3, name: 'Starter', type: 'plan' }] }],
  ])
  const result = await listOfferings(9, { fetchImpl: impl })
  assert.equal(result.ok, true)
  assert.deepEqual(result.items, [{
    id: '3', name: 'Starter', type: 'plan', category: '', description: '',
  }])
  assert.ok(calls[0].includes('entity_id=9'))
})

test('searchKnowledge maps results and passes collections', async () => {
  const { impl, calls } = fakeFetch([
    ['/api/v1/search', { results: [{ id: 'e1', collection: 'entities', name: 'Jane Face', type: 'person' }] }],
  ])
  const result = await searchKnowledge('jane', { fetchImpl: impl, collections: ['entities'] })
  assert.equal(result.ok, true)
  assert.equal(result.items[0].name, 'Jane Face')
  assert.ok(calls[0].includes('collections=entities'))
  assert.deepEqual(await searchKnowledge('', { fetchImpl: impl }), { ok: false, items: [] })
})

test('fetchers are fail-open on network and HTTP errors', async () => {
  const throwing = async () => { throw new Error('connection refused') }
  assert.deepEqual(await searchEntityOptions('x', { fetchImpl: throwing }), { ok: false, items: [] })
  assert.deepEqual(await listOfferings('1', { fetchImpl: throwing }), { ok: false, items: [] })
  assert.deepEqual(await searchKnowledge('x', { fetchImpl: throwing }), { ok: false, items: [] })
  const notFound = async () => ({ ok: false, status: 404, json: async () => ({}) })
  assert.deepEqual(await searchEntityOptions('x', { fetchImpl: notFound }), { ok: false, items: [] })
})
