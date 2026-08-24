import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendVersion,
  emptyIndex,
  makeVersionId,
  resolveRestoreFiles,
  shouldAutosaveAction,
  slugifyVersionLabel,
  snapshotCandidates,
} from '../src/services/projectVersions.js'

test('slugifyVersionLabel keeps a short kebab id', () => {
  assert.equal(slugifyVersionLabel('Before titles'), 'before-titles')
  assert.equal(slugifyVersionLabel(''), 'snap')
})

test('appendVersion chains parentId to the previous snapshot', () => {
  const first = appendVersion(emptyIndex(), { id: 'v1', label: 'baseline', files: ['project.comfystudio'] })
  const second = appendVersion(first, { id: 'v2', label: 'after titles' })
  assert.equal(second.versions.length, 2)
  assert.equal(second.versions[1].parentId, 'v1')
})

test('resolveRestoreFiles restores all files or a named subset', () => {
  const files = ['project.comfystudio', 'docs/edit-map.md']
  assert.deepEqual(resolveRestoreFiles(files, []), files)
  assert.deepEqual(resolveRestoreFiles(files, ['docs/edit-map.md']), ['docs/edit-map.md'])
  assert.throws(() => resolveRestoreFiles(files, ['missing.md']))
})

test('shouldAutosaveAction only after applied writes', () => {
  assert.equal(shouldAutosaveAction('add_text_clip', { previewOnly: false }), true)
  assert.equal(shouldAutosaveAction('add_text_clip', { previewOnly: true }), false)
  assert.equal(shouldAutosaveAction('save_project', { previewOnly: false }), false)
  assert.equal(shouldAutosaveAction('get_project', {}), false)
  assert.equal(shouldAutosaveAction('split_clip', { previewOnly: false, persist: false }), false)
})

test('snapshotCandidates always include the live project file', () => {
  assert.equal(snapshotCandidates()[0], 'project.comfystudio')
  assert.ok(snapshotCandidates().includes('NEXT.md'))
})

test('makeVersionId is unique-enough and filesystem-safe', () => {
  const id = makeVersionId('After punch', new Date('2026-08-23T17:00:00Z'))
  assert.match(id, /^v-20260823-170000Z-after-punch$/)
})
