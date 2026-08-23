/**
 * On-disk project versions — every production type, not just show cuts.
 *
 * Live file is always `<root>/project.comfystudio` (what Blake opens).
 * Named snapshots live in `<root>/versions/<id>/` so a set of edits can
 * be reverted together, or individual snapshot files can be restored.
 *
 * In-memory MCP checkpoints remain a session safety net; these persist.
 */

export const VERSION_DIR = 'versions'
export const INDEX_FILE = 'index.json'
export const PROJECT_FILE = 'project.comfystudio'

/** Extra docs copied when present. Never copy assets/ (too large). */
export const OPTIONAL_SNAPSHOT_FILES = [
  'CONTEST.md',
  'SUBMIT.md',
  'INSPECT.md',
  'docs/edit-map.md',
  'docs/grok-cut/edit-map.md',
  'docs/PRODUCTION-BIBLE.md',
  'docs/QA-LOG.md',
  'docs/SHOT-CRAFT.md',
  'docs/CDX-MIGRATION.md',
  'docs/DANCE-PASS.md',
  'docs/SESSION-HANDOFF-2026-08-20.md',
]

export function snapshotCandidates() {
  return [PROJECT_FILE, ...OPTIONAL_SNAPSHOT_FILES]
}

export function slugifyVersionLabel(value, fallback = 'snap') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || fallback
}

export function emptyIndex() {
  return { version: 1, versions: [] }
}

export function normalizeIndex(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyIndex()
  const versions = Array.isArray(raw.versions)
    ? raw.versions.filter((row) => row && typeof row === 'object' && row.id)
    : []
  return { version: 1, versions }
}

export function makeVersionId(label, at = new Date()) {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-')
  return `v-${stamp}-${slugifyVersionLabel(label)}`
}

export function appendVersion(index, entry) {
  const next = normalizeIndex(index)
  const id = String(entry.id || '').trim()
  if (!id) throw new Error('version entry needs id')
  const row = {
    id,
    parentId: entry.parentId ? String(entry.parentId) : (next.versions[next.versions.length - 1]?.id || ''),
    label: String(entry.label || id),
    createdAt: String(entry.createdAt || new Date().toISOString()),
    files: Array.isArray(entry.files) ? entry.files.map((f) => String(f)) : [],
    ops: Array.isArray(entry.ops) ? entry.ops : [],
  }
  return { version: 1, versions: [...next.versions.filter((v) => v.id !== id), row] }
}

export function resolveRestoreFiles(manifestFiles, requested) {
  const available = (Array.isArray(manifestFiles) ? manifestFiles : []).map(String)
  const want = Array.isArray(requested)
    ? requested.map(String).filter(Boolean)
    : []
  if (!want.length) return available
  const missing = want.filter((name) => !available.includes(name))
  if (missing.length) {
    throw new Error(`not in this version: ${missing.join(', ')}`)
  }
  return want
}

export const SKIP_AUTOSAVE_ACTIONS = new Set([
  'save_project',
  'save_project_version',
  'restore_project_version',
  'list_project_versions',
  'create_project_checkpoint',
  'restore_project_checkpoint',
  'open_project',
  'list_recent_projects',
  'create_project',
  'duplicate_project',
  'undo',
  'redo',
  'undo_redo',
  'set_playhead',
  'select_clips',
  'select_assets',
  'export_timeline',
  'export_fcpxml',
])

export function shouldAutosaveAction(action, payload = {}) {
  const name = String(action || '')
  if (!name) return false
  if (payload.previewOnly === true) return false
  if (payload.persist === false) return false
  if (SKIP_AUTOSAVE_ACTIONS.has(name)) return false
  if (/^(get_|list_|inspect_|analyze_|check_|diagnose_|discover_)/.test(name)) return false
  return payload.previewOnly === false
}
