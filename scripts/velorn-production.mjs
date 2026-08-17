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
  const productionCuts = await import(pathToFileURL(join(base, 'src/services/productionCuts.js')).href)
  return { productionStore, productionPacket, productionCuts }
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

const { productionStore, productionPacket, productionCuts } = await loadStores()

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
} else if (cmd === 'cuts') {
  const episodeId = argValue('--episode') || project.production?.current?.episodeId
  console.log(JSON.stringify(productionCuts.listCuts(project.productionCuts, episodeId), null, 2))
} else if (cmd === 'save-cut') {
  const episodeId = argValue('--episode') || project.production?.current?.episodeId
  if (!episodeId) throw new Error('save-cut needs a current episode or --episode')
  const saved = productionCuts.saveCut(project.productionCuts, episodeId, {
    name: argValue('--name') || 'Draft',
    author: argValue('--author'),
    notes: argValue('--notes'),
    id: argValue('--id') || undefined,
    storyboardBoard: project.storyboardBoard,
    timelineId: argValue('--timeline') || undefined,
    makeCurrent: argValue('--make-current') !== 'false',
  })
  const review = productionCuts.buildReviewTimeline({
    episodeId,
    cut: saved.cut,
    settings: project.settings || {},
    assets: project.assets || [],
    pinTimelineId: argValue('--timeline') || saved.cut.timelineId,
  })
  saved.cut.timelineId = review.id
  const withTimeline = productionCuts.saveCut(saved.index, episodeId, {
    ...saved.cut,
    timelineId: review.id,
    storyboardBoard: saved.cut.storyboardBoard,
    makeCurrent: argValue('--make-current') !== 'false',
  })
  project.productionCuts = withTimeline.index
  project.production = productionCuts.applyCutsToProduction(
    productionStore.hydrateProductionFromProject(project),
    episodeId,
    withTimeline.bucket,
  )
  project.timelines = productionCuts.upsertReviewTimeline(project.timelines, review)
  writeProject(dir, project)
  console.log(JSON.stringify({ cut: productionCuts.summarizeCut(withTimeline.cut, withTimeline.bucket), cuts: productionCuts.listCuts(withTimeline.index, episodeId) }, null, 2))
} else if (cmd === 'checkout-cut') {
  const episodeId = argValue('--episode') || project.production?.current?.episodeId
  const cutRef = argValue('--cut') || positional[0]
  const snapped = productionCuts.snapshotLiveIntoCurrent(project.productionCuts, episodeId, project.storyboardBoard)
  const next = productionCuts.checkoutCut(snapped.skipped ? project.productionCuts : snapped.index, episodeId, cutRef)
  project.productionCuts = next.index
  project.storyboardBoard = next.cut.storyboardBoard
  project.production = productionCuts.applyCutsToProduction(
    productionStore.hydrateProductionFromProject(project),
    episodeId,
    next.bucket,
  )
  writeProject(dir, project)
  console.log(JSON.stringify({ cut: productionCuts.summarizeCut(next.cut, next.bucket), cardCount: next.cut.storyboardBoard?.cards?.length || 0 }, null, 2))
} else if (cmd === 'promote-cut') {
  const episodeId = argValue('--episode') || project.production?.current?.episodeId
  const next = productionCuts.promoteCut(project.productionCuts, episodeId, argValue('--cut') || positional[0])
  project.productionCuts = next.index
  project.production = productionCuts.applyCutsToProduction(
    productionStore.hydrateProductionFromProject(project),
    episodeId,
    next.bucket,
  )
  writeProject(dir, project)
  console.log(JSON.stringify({ cut: productionCuts.summarizeCut(next.cut, next.bucket), cuts: productionCuts.listCuts(next.index, episodeId) }, null, 2))
} else if (cmd === 'shot') {
  const cardId = positional[0]
  const packet = productionPacket.buildShotPacket(project, cardId, { assets: project.assets || [] })
  if (!packet) throw new Error(`Shot ${cardId} not found`)
  console.log(JSON.stringify(packet, null, 2))
} else if (cmd === 'readiness') {
  const packet = productionPacket.buildProductionPacket(project, { assets: project.assets || [] })
  console.log(JSON.stringify(packet.audio, null, 2))
} else {
  console.error(`Unknown command ${cmd}. Use: context | catalog | episodes | seed-show | create-episode | cuts | save-cut | checkout-cut | promote-cut | shot | readiness`)
  process.exit(2)
}
