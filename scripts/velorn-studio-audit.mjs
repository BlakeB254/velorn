#!/usr/bin/env node
/**
 * velorn-studio-audit — "what do I do next?" for a Velorn project.
 *
 * Reads project.comfystudio (Velorn data). Does NOT call cdx-video-director :7060.
 *
 *   node scripts/velorn-studio-audit.mjs [project]
 *   node scripts/velorn-studio-audit.mjs --json "Chi-Town Triplets"
 *   node scripts/velorn-studio-audit.mjs --verdict READY_TO_GENERATE
 *   node scripts/velorn-studio-audit.mjs --record s1-ots --result pass --reason "on-model"
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOTS = [
  '/home/codex450/VelornProjects',
  resolve(process.cwd()),
]

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : ''
}

function hasFlag(flag) {
  return process.argv.includes(flag)
}

function findProject(arg) {
  if (arg && existsSync(join(arg, 'project.comfystudio'))) return resolve(arg)
  if (arg && existsSync(arg) && basename(arg) === 'project.comfystudio') return resolve(arg, '..')
  const name = arg || 'Chi-Town Triplets'
  for (const root of ROOTS) {
    const direct = join(root, name)
    if (existsSync(join(direct, 'project.comfystudio'))) return direct
    if (existsSync(root)) {
      const hit = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .find((entry) => entry.name.toLowerCase() === String(name).toLowerCase())
      if (hit && existsSync(join(root, hit.name, 'project.comfystudio'))) return join(root, hit.name)
    }
  }
  throw new Error(`No project.comfystudio for '${name}'`)
}

const base = resolve(fileURLToPath(new URL('..', import.meta.url)))
const { auditProject } = await import(pathToFileURL(join(base, 'src/services/studioAudit.js')).href)
const { recordVerdict, normalizeStudio } = await import(pathToFileURL(join(base, 'src/services/studioStore.js')).href)

const positional = process.argv.slice(2).filter((item) => !item.startsWith('--'))
const dir = findProject(positional[0])
const projectPath = join(dir, 'project.comfystudio')
const project = JSON.parse(readFileSync(projectPath, 'utf8'))

if (hasFlag('--record')) {
  const shot = argValue('--record')
  const video = argValue('--video') || argValue('--result') || undefined
  const audio = argValue('--audio') || argValue('--result') || undefined
  const reason = argValue('--reason')
  const by = argValue('--by') || process.env.HERMES_PROFILE || 'agent'
  if (!shot) {
    console.error('ERROR: --record needs a shot id')
    process.exit(2)
  }
  if (!video && !audio) {
    console.error('ERROR: give --result (both tracks) or --video / --audio')
    process.exit(2)
  }
  try {
    const studio = recordVerdict(project.studio, shot, {
      video: video || undefined,
      audio: audio || undefined,
      reason,
      by,
      production: project.production,
    })
    project.studio = studio
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`)
    const report = auditProject(project)
    const row = report.shots.find((item) => item.shot === shot)
    console.log(`recorded ${shot}: video=${video || '-'} audio=${audio || '-'} audit=${row?.verdict || '?'}`)
    console.log(`  -> ${projectPath}`)
    process.exit(0)
  } catch (error) {
    console.error(`ERROR: ${error.message}`)
    process.exit(2)
  }
}

const report = auditProject(project, {
  verdict: argValue('--verdict'),
  assets: project.assets || [],
})

if (hasFlag('--json')) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

const order = ['NEEDS_REGEN', 'READY_TO_GENERATE', 'DIALOGUE_BLOCKED', 'NEEDS_FLF', 'DONE']
console.log(`\n${report.project}  — ${report.shots_total} shots`)
console.log(`  ${order.map((key) => `${key}=${report.counts[key] || 0}`).join(' · ')}`)
console.log(`  QA: verified=${report.qa_coverage.verified} unverified=${report.qa_coverage.unverified}`)
console.log()
console.log(`  ${'SHOT'.padEnd(24)} ${'VERDICT'.padEnd(18)} ${'DLG'.padEnd(4)} ${'SPATIAL'.padEnd(8)} ACTION`)
console.log(`  ${'-'.repeat(100)}`)
for (const verdict of order) {
  for (const row of report.shots.filter((item) => item.verdict === verdict)) {
    console.log(
      `  ${String(row.shot).padEnd(24)} ${row.verdict.padEnd(18)} ${
        (row.dialogue ? 'yes' : '-').padEnd(4)
      } ${(row.spatial_ok ? 'ok' : 'thin').padEnd(8)} ${String(row.action).slice(0, 52)}`,
    )
  }
}
console.log('\n  AUDIT GAPS:')
for (const gap of report.audit_gaps) console.log(`   ! ${gap}`)
console.log()
