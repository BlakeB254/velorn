import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildAdConceptPrompt, generateAdConcept } from '../src/services/conceptGenerator.js'

test('buildAdConceptPrompt includes org, offerings, brief, and style hints', () => {
  const { systemPrompt, userPrompt } = buildAdConceptPrompt({
    subject: { mode: 'cdx', orgId: '9', orgName: 'Acme Org' },
    offerings: [{ id: 'o1', name: 'Pro Plan' }, { id: 'o2', name: 'Starter' }],
    prompt: 'Launch spot for the spring push.',
    style: { format: 'Product Demo', tone: 'premium calm', platform: '9:16', lengthSeconds: 30, shotCount: 8 },
  })
  assert.ok(systemPrompt.includes('advertising director'))
  assert.ok(userPrompt.includes('Acme Org'))
  assert.ok(userPrompt.includes('Pro Plan, Starter'))
  assert.ok(userPrompt.includes('Launch spot for the spring push.'))
  assert.ok(userPrompt.includes('Format: Product Demo'))
  assert.ok(userPrompt.includes('Tone: premium calm'))
  assert.ok(userPrompt.includes('Length: 30 seconds'))
  assert.ok(userPrompt.includes('Target shot count: 8'))
  assert.ok(userPrompt.includes('Keyframe prompt:'))
})

test('buildAdConceptPrompt falls back to subject.offerings and tolerates empties', () => {
  const { userPrompt } = buildAdConceptPrompt({
    subject: { orgName: '', offerings: [{ name: 'Solo Offer' }] },
    prompt: '  ',
  })
  assert.ok(userPrompt.includes('Offerings: Solo Offer'))
  assert.ok(userPrompt.includes('Brand / organization: not specified'))
  assert.ok(userPrompt.includes('(empty)'))
  assert.ok(!userPrompt.includes('Format hints:'))
})

test('generateAdConcept rejects an empty brief without calling backends', async () => {
  let called = 0
  const result = await generateAdConcept({ prompt: '   ' }, {
    backends: [{ id: 'fake', run: async () => { called += 1; return 'x' } }],
  })
  assert.equal(result.ok, false)
  assert.equal(called, 0)
  assert.match(result.error, /brief/i)
})

test('generateAdConcept returns the first successful backend result', async () => {
  const calls = []
  const result = await generateAdConcept({ prompt: 'brief', subject: { orgName: 'Acme' } }, {
    backends: [
      { id: 'first', run: async ({ systemPrompt, userPrompt }) => { calls.push('first'); assert.ok(systemPrompt); assert.ok(userPrompt.includes('Acme')); return ' concept text ' } },
      { id: 'second', run: async () => { calls.push('second'); return 'other' } },
    ],
  })
  assert.deepEqual(result, { ok: true, text: 'concept text', backend: 'first' })
  assert.deepEqual(calls, ['first'])
})

test('generateAdConcept falls through failures and empty responses in order', async () => {
  const calls = []
  const result = await generateAdConcept({ prompt: 'brief' }, {
    backends: [
      { id: 'gemini', run: async () => { calls.push('gemini'); throw new Error('no Partner API key') } },
      { id: 'empty', run: async () => { calls.push('empty'); return '   ' } },
      { id: 'lmstudio', run: async () => { calls.push('lmstudio'); return 'local concept' } },
    ],
  })
  assert.equal(result.ok, true)
  assert.equal(result.text, 'local concept')
  assert.equal(result.backend, 'lmstudio')
  assert.deepEqual(calls, ['gemini', 'empty', 'lmstudio'])
})

test('generateAdConcept resolves ok:false with a combined error when all backends fail', async () => {
  const result = await generateAdConcept({ prompt: 'brief' }, {
    backends: [
      { id: 'gemini', run: async () => { throw new Error('ComfyUI offline') } },
      { id: 'lm-studio', run: async () => { throw new Error('connection refused') } },
    ],
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /gemini: ComfyUI offline/)
  assert.match(result.error, /lm-studio: connection refused/)
})
