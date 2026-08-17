import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = join(import.meta.dirname, '..')
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'release',
  'coverage',
  '.cache',
  '__pycache__',
])

const PATH_RE = /(?:^|[\s"'`=(])(?:\/[\w./-]*cdx-video-director(?:\/[\w./-]*)?|cdx-platform\/services\/cdx-video-director(?:\/[\w./-]*)?)/g

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) walk(full, files)
    else files.push(full)
  }
  return files
}

function isText(path) {
  return /\.(js|jsx|mjs|cjs|ts|tsx|json|md|ya?ml|py|sh|html|css|txt)$/i.test(path)
}

test('no Velorn source file points at a CDX Studio service path', () => {
  const hits = []
  for (const file of walk(ROOT).filter(isText)) {
    const rel = relative(ROOT, file)
    if (rel === 'tests/cdxStudioIsolation.test.js') continue
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(PATH_RE)) {
      hits.push(`${rel}: ${match[0].trim()}`)
    }
  }
  assert.deepEqual(hits, [])
})

test('lexicon catalog previews resolve to bundled public files', () => {
  const catalog = JSON.parse(readFileSync(join(ROOT, 'src/config/cinematographyCatalog.json'), 'utf8'))
  assert.equal(catalog.source, 'src/config/cinematography_vocab.yaml')
  assert.ok(existsSync(join(ROOT, catalog.source)))

  const previews = []
  const walkObj = (obj) => {
    if (Array.isArray(obj)) {
      obj.forEach(walkObj)
      return
    }
    if (!obj || typeof obj !== 'object') return
    if (typeof obj.preview === 'string') previews.push(obj.preview)
    Object.values(obj).forEach(walkObj)
  }
  walkObj(catalog)
  assert.ok(previews.length >= 90, `expected lexicon previews, got ${previews.length}`)
  const missing = []
  for (const preview of previews) {
    assert.match(preview, /^\/previews\/lexicon\/[a-z0-9-]+\.png$/)
    const disk = join(ROOT, 'public', preview.replace(/^\//, ''))
    if (!existsSync(disk)) missing.push(preview)
  }
  assert.deepEqual(missing, [])
})

test('getLexiconPreviewUrl prefixes Vite/Electron base', async () => {
  const shotSettingsUrl = pathToFileURL(join(ROOT, 'src/services/shotSettings.js')).href
  const mod = await import(shotSettingsUrl)
  const url = mod.getLexiconPreviewUrl('/previews/lexicon/extreme-close-up.png')
  assert.match(url, /previews\/lexicon\/extreme-close-up\.png$/)
  assert.equal(mod.getLexiconPreviewUrl(''), '')
  assert.equal(mod.getLexiconPreviewUrl('https://example.test/x.png'), 'https://example.test/x.png')
})
