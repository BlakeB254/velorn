#!/usr/bin/env node
/**
 * Create a baseline on-disk version for every Velorn project folder
 * that has project.comfystudio and no versions/index.json yet.
 *
 * Usage: node scripts/seed-project-versions.mjs [rootDir]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  INDEX_FILE,
  PROJECT_FILE,
  VERSION_DIR,
  appendVersion,
  emptyIndex,
  makeVersionId,
  snapshotCandidates,
} from '../src/services/projectVersions.js'

async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function seedOne(root, label = 'baseline') {
  const projectFile = path.join(root, PROJECT_FILE)
  if (!(await exists(projectFile))) return { skipped: true, reason: 'no-project-file' }
  const indexPath = path.join(root, VERSION_DIR, INDEX_FILE)
  if (await exists(indexPath)) return { skipped: true, reason: 'already-versioned' }
  const id = makeVersionId(label)
  const destRoot = path.join(root, VERSION_DIR, id)
  const copied = []
  for (const rel of snapshotCandidates()) {
    const src = path.join(root, ...rel.split('/'))
    if (!(await exists(src))) continue
    const dest = path.join(destRoot, ...rel.split('/'))
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.copyFile(src, dest)
    copied.push(rel)
  }
  const index = appendVersion(emptyIndex(), {
    id,
    label,
    createdAt: new Date().toISOString(),
    files: copied,
    ops: [{ action: 'seed-project-versions' }],
  })
  await fs.mkdir(path.dirname(indexPath), { recursive: true })
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2))
  return { skipped: false, id, files: copied }
}

async function main() {
  const root = process.argv[2] || path.join(process.env.HOME || '', 'VelornProjects')
  const entries = await fs.readdir(root, { withFileTypes: true })
  const summary = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue
    const projectRoot = path.join(root, entry.name)
    const result = await seedOne(projectRoot)
    summary.push({ project: entry.name, ...result })
  }
  const made = summary.filter((row) => !row.skipped)
  const skipped = summary.filter((row) => row.skipped)
  console.log(JSON.stringify({ root, seeded: made.length, skipped: skipped.length, made, skipped }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
