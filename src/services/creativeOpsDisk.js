/**
 * Disk adapter for the CreativeOps folder contract.
 * Node-only. Do not import from renderer MCP handlers.
 *
 *   <root>/<slug>/
 *     manifest.json
 *     approval_profile.json
 *     generations.jsonl
 *     ready_pool.jsonl
 *     versions/ variants/ review_queue/ regeneration_queue/
 *     ready_pool/ publishing_packages/ feedback/ social_metadata/
 *     comfy_runs/ source_links/
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  WORKSPACE_DIRS,
  emptyWorkspace,
  fullState,
  normalizeWorkspace,
  slugify,
} from './creativeOps.js'

export const DEFAULT_LEDGER_ROOTS = Object.freeze([
  '/home/codex450/cdx-platform/out/_creative_ops',
  '/home/codex450/cdx-platform/services/cdx-video-director/out/_creative_ops',
  '/home/codex450/creative/out/_creative_ops',
])

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

function readJsonl(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)]
      } catch {
        return []
      }
    })
}

function appendJsonl(path, record) {
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8')
}

export function projectDir(root, slug) {
  return join(root, slugify(slug))
}

export function ensureDiskWorkspace(root, workspace) {
  const next = normalizeWorkspace(workspace)
  const dir = projectDir(root, next.slug)
  for (const rel of WORKSPACE_DIRS) {
    const folder = join(dir, rel)
    mkdirSync(folder, { recursive: true })
    const keep = join(folder, '.gitkeep')
    if (!existsSync(keep)) writeFileSync(keep, '', 'utf8')
  }
  const state = fullState(next)
  writeJson(join(dir, 'manifest.json'), state.manifest)
  writeJson(join(dir, 'approval_profile.json'), state.approval_profile)
  return { dir, manifest: state.manifest }
}

export function writeGeneration(root, record) {
  const dir = projectDir(root, record.slug)
  mkdirSync(dir, { recursive: true })
  appendJsonl(join(dir, 'generations.jsonl'), record)
  const queue = record.ai_evaluation?.decision === 'preflag_for_regeneration' ? 'regeneration_queue' : 'review_queue'
  writeJson(join(dir, queue, `${record.generation_id}.json`), record)
  return join(dir, 'generations.jsonl')
}

export function writeFeedback(root, event) {
  const dir = projectDir(root, event.slug)
  appendJsonl(join(dir, 'feedback', 'human_feedback.jsonl'), event)
}

export function writeReadyPool(root, record) {
  const dir = projectDir(root, record.slug)
  writeJson(join(dir, 'ready_pool', `${record.generation_id}.json`), record)
  appendJsonl(join(dir, 'ready_pool.jsonl'), record)
}

export function writeSourceLink(root, record) {
  const dir = projectDir(root, record.slug || 'project')
  writeJson(join(dir, 'source_links', `${Date.now()}-${slugify(record.kind || 'link')}.json`), record)
}

export function readDiskWorkspace(dir) {
  const manifest = readJson(join(dir, 'manifest.json'), {})
  const slug = manifest.slug || slugify(dir.split('/').filter(Boolean).at(-1), 'project')
  const queueFiles = (rel) => {
    const folder = join(dir, rel)
    if (!existsSync(folder)) return []
    return readdirSync(folder)
      .filter((name) => name.endsWith('.json'))
      .map((name) => readJson(join(folder, name), null))
      .filter(Boolean)
  }
  return normalizeWorkspace({
    ...emptyWorkspace({
      slug,
      title: manifest.title || manifest.display_title,
      projectType: manifest.project_type,
      brand: manifest.brand,
      entityId: manifest.entity_id,
      siteUrl: manifest.site_url || manifest.canonical_site_url,
      projectDir: manifest.project_dir,
      diskRoot: dir,
      createdAt: manifest.created_at,
    }),
    approvalProfile: readJson(join(dir, 'approval_profile.json'), {}),
    generations: readJsonl(join(dir, 'generations.jsonl')),
    feedback: readJsonl(join(dir, 'feedback', 'human_feedback.jsonl')),
    readyPool: queueFiles('ready_pool'),
    reviewQueue: queueFiles('review_queue'),
    regenerationQueue: queueFiles('regeneration_queue'),
    sourceLinks: queueFiles('source_links'),
  })
}

export function listDiskLedgers(roots = DEFAULT_LEDGER_ROOTS) {
  const found = []
  const seen = new Set()
  for (const root of roots) {
    if (!root || !existsSync(root)) continue
    for (const name of readdirSync(root, { withFileTypes: true })) {
      if (!name.isDirectory()) continue
      if (name.name.startsWith('_')) continue
      const dir = join(root, name.name)
      if (seen.has(dir)) continue
      if (!existsSync(join(dir, 'manifest.json')) && !existsSync(join(dir, 'generations.jsonl'))) continue
      seen.add(dir)
      found.push(readDiskWorkspace(dir))
    }
  }
  return found
}

export function persistWorkspace(root, workspace) {
  const next = normalizeWorkspace(workspace)
  const { dir } = ensureDiskWorkspace(root, next)
  const existing = existsSync(join(dir, 'generations.jsonl'))
    ? readJsonl(join(dir, 'generations.jsonl')).map((item) => item.generation_id)
    : []
  for (const record of next.generations) {
    if (!existing.includes(record.generation_id)) writeGeneration(root, record)
  }
  return dir
}
