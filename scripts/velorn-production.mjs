#!/usr/bin/env node
/**
 * Disk CLI for the Velorn production packet. Works when the desktop app is down.
 *
 *   velorn-production context [projectDir]
 *   velorn-production catalog
 *   velorn-production episodes [projectDir]
 *   velorn-production seed-show [projectDir]
 *   velorn-production create-episode --title "Navy Pier 2" [projectDir]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOTS = [
  '/home/codex450/VelornProjects',
  resolve(process.cwd()),
]

async function loadStores() {
  const base = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const productionStore = await import(pathToFileURL(join(base, 'src/services/productionStore.js')).href)
  const productionPacket = await import(pathToFileURL(join(base, 'src/services/productionPacket.js')).href)
  return { productionStore, productionPacket }
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

function readProject(dir) {
  return JSON.parse(readFileSync(join(dir, 'project.comfystudio'), 'utf8'))
}

function writeProject(dir, data) {
  writeFileSync(join(dir, 'project.comfystudio'), `${JSON.stringify(data, null, 2)}\n`)
}

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : ''
}

const cmd = process.argv[2] || 'context'
const positional = process.argv.slice(3).filter((item) => !item.startsWith('--'))

const { productionStore, productionPacket } = await loadStores()

if (cmd === 'catalog') {
  console.log(JSON.stringify(productionPacket.listProductionCatalog(), null, 2))
  process.exit(0)
}

const dir = findProject(positional[0])
const project = readProject(dir)

if (cmd === 'context') {
  console.log(JSON.stringify(productionPacket.buildProductionPacket(project, { assets: project.assets || [] }), null, 2))
} else if (cmd === 'episodes') {
  const production = productionStore.hydrateProductionFromProject(project)
  console.log(JSON.stringify({ current: production.current, seasons: productionStore.listEpisodes(production) }, null, 2))
} else if (cmd === 'seed-show') {
  const production = productionStore.setProductionMeta(productionStore.hydrateProductionFromProject(project), {
    type: 'show',
    title: project.cdxMigration?.title || project.name,
    slug: project.cdxMigration?.slug,
  })
  project.production = production
  writeProject(dir, project)
  console.log(JSON.stringify(productionStore.productionSummary(production), null, 2))
} else if (cmd === 'create-episode') {
  const created = productionStore.createEpisode(productionStore.hydrateProductionFromProject(project), {
    title: argValue('--title') || 'Untitled episode',
    logline: argValue('--logline'),
    seasonId: argValue('--season') || undefined,
  })
  project.production = created.production
  writeProject(dir, project)
  console.log(JSON.stringify({ episode: created.episode, current: created.production.current }, null, 2))
} else if (cmd === 'shot') {
  const cardId = positional[0]
  const packet = productionPacket.buildShotPacket(project, cardId, { assets: project.assets || [] })
  if (!packet) throw new Error(`Shot ${cardId} not found`)
  console.log(JSON.stringify(packet, null, 2))
} else {
  console.error(`Unknown command ${cmd}`)
  process.exit(2)
}
