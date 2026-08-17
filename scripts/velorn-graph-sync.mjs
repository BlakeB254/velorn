#!/usr/bin/env node
/**
 * Velorn production-graph mapper. Dry-run by default.
 *
 *   node scripts/velorn-graph-sync.mjs --app studio|beatlab|twin|all
 *   node scripts/velorn-graph-sync.mjs --project "/path/to/VelornProject"
 *   node scripts/velorn-graph-sync.mjs --map-json   # stdin payload → stdout graph
 *
 * Does not publish, schedule, or queue GPU work.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const base = resolve(here, '..')
const creativeOps = await import(pathToFileURL(join(base, 'src/services/creativeOps.js')).href)
const productionGraph = await import(pathToFileURL(join(base, 'src/services/productionGraph.js')).href)
const disk = await import(pathToFileURL(join(base, 'src/services/creativeOpsDisk.js')).href)

function flag(name) {
  return process.argv.includes(name)
}

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function collect(name) {
  const out = []
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === name && process.argv[i + 1]) out.push(process.argv[i + 1])
  }
  return out
}

function readStdin() {
  return readFileSync(0, 'utf8')
}

function loadProjectWorkspace(projectDir) {
  const file = join(projectDir, 'project.comfystudio')
  if (!existsSync(file)) return null
  const project = JSON.parse(readFileSync(file, 'utf8'))
  const concept = creativeOps.conceptFromProject({ ...project, projectDir })
  return creativeOps.normalizeWorkspace(project.creativeOps, concept)
}

if (flag('--map-json')) {
  const payload = JSON.parse(readStdin() || '{}')
  const graph = productionGraph.buildProductionGraph(payload)
  process.stdout.write(`${JSON.stringify(graph)}\n`)
  process.exit(0)
}

const app = arg('--app', 'all')
const projectDir = arg('--project')
const extraRoots = collect('--ledger-root')
const outPath = arg('--out')
const roots = [
  ...extraRoots,
  projectDir ? join(projectDir, 'out', '_creative_ops') : '',
  ...disk.DEFAULT_LEDGER_ROOTS,
].filter(Boolean)

const workspaces = disk.listDiskLedgers(roots)
if (projectDir) {
  const fromProject = loadProjectWorkspace(resolve(projectDir))
  if (fromProject && !workspaces.some((item) => item.slug === fromProject.slug && item.generations.length)) {
    workspaces.push(fromProject)
  }
}

const studio = (app === 'studio' || app === 'all')
  ? productionGraph.ledgerProductions(workspaces)
  : []

let twin = null
if (app === 'twin' || app === 'all') {
  const twinPath = arg('--twin-json')
  if (twinPath && existsSync(twinPath)) twin = JSON.parse(readFileSync(twinPath, 'utf8'))
}

let beatlab = []
if (app === 'beatlab' || app === 'all') {
  const beatPath = arg('--beatlab-json')
  if (beatPath && existsSync(beatPath)) beatlab = JSON.parse(readFileSync(beatPath, 'utf8'))
}

const graph = productionGraph.buildProductionGraph({
  studio,
  beatlab,
  twin,
  coreProjectId: arg('--core-project-id') ? Number(arg('--core-project-id')) : null,
})

const report = {
  app,
  policy: graph.policy,
  stats: graph.apps,
  productions: studio,
  nodes: graph.nodes,
  edges: graph.edges,
  apply: false,
  note: 'Dry-run. Pass this JSON to scripts/app_graph_sync.py --apply to write THE MAP. MCP sync_production_graph only snapshots locally.',
}

const text = `${JSON.stringify(report, null, 2)}\n`
if (outPath) {
  mkdirSync(dirname(resolve(outPath)), { recursive: true })
  writeFileSync(outPath, text)
  process.stdout.write(`${JSON.stringify({ wrote: outPath, edges: graph.edges.length, nodes: graph.nodes.length }, null, 2)}\n`)
} else {
  process.stdout.write(text)
}
