#!/usr/bin/env node
/**
 * Blocking panel e2e — real click-through of the v7 blocking lane in the
 * packaged Electron app (docs/blocking-v7-plan.md §6, last open item).
 *
 *   seeds a throwaway project (card e2e-card-1 + docs/blocking/e2e-card-1)
 *   → launches Velorn in Electron (playwright-core, own MCP port, own
 *     user-data dir — never touches the developer's live instance)
 *   → opens the project via the app's own MCP server (open_project)
 *   → Storyboard tab → card → Blocking panel
 *   → screenshots the three.js dual-pane
 *   → edits the camera x_m input → Save → asserts blocking.json on disk
 *   → Generate from blocking → asserts the Blender bridge rendered
 *     green/pose/depth frames under docs/blocking/e2e-card-1/control/
 *
 * Run: xvfb-run -a node scripts/blocking_panel_e2e.mjs
 * (npm run test:blocking-panel-e2e). Exits non-zero on any failed assertion.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { acceptSlot, newCharacterCard } from '../src/services/referenceCards.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MCP_PORT = 19791
const OUT_DIR = path.join(ROOT, 'tests', 'out', 'blocking-panel-e2e')

// playwright-core is reused from an existing on-box install (kept out of
// package.json on purpose — this harness is a manual/CI check, not a dep).
const PW_CANDIDATES = [
  '/home/codex450/.hermes/hermes-agent/node_modules/playwright-core',
  '/home/codex450/3d/game-dev/node_modules/playwright-core',
]
let _electron = null
for (const candidate of PW_CANDIDATES) {
  try {
    const req = createRequire(path.join(candidate, 'index.js'))
    ;({ _electron } = req('playwright-core'))
    if (_electron) break
  } catch { /* try next */ }
}
if (!_electron) {
  console.error('FAIL: playwright-core not found in any candidate path:', PW_CANDIDATES.join(', '))
  process.exit(1)
}

const failures = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok' : 'FAIL'} — ${name}${ok ? '' : ` ${detail}`}`)
  if (!ok) failures.push(name)
}

/* ── seed project ─────────────────────────────────────────────────────── */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-e2e-blocking-'))
const projectPath = path.join(tmp, 'Blocking E2E')
const CARD_ID = 'e2e-card-1'
const blockingDir = path.join(projectPath, 'docs', 'blocking', CARD_ID)
fs.mkdirSync(blockingDir, { recursive: true })
fs.mkdirSync(path.join(tmp, 'userdata'), { recursive: true })
fs.mkdirSync(OUT_DIR, { recursive: true })

const blockingDoc = {
  schema_version: 7,
  coordinate_frame: 'blender_enu_meters',
  fps: 25,
  duration_s: 0.2, // 5 frames — keeps the bridge render fast
  camera: {
    camera_id: 'CAM_canonical',
    position: { x_m: 0.0, y_m: -2.0, z_m: 1.55 },
    facing_deg: 0.0,
    pitch_deg: -4.0,
    roll_deg: 0.0,
    fov_deg: 40.0,
    cuts: [
      {
        camera_id: 'CAM_close',
        position: { x_m: 0.5, y_m: 1.5, z_m: 1.6 },
        facing_deg: 8.0,
        pitch_deg: -2.0,
        roll_deg: 0.0,
        fov_deg: 28.0,
      },
    ],
  },
  characters: [
    {
      cast_id: 'stud',
      label: 'The Stud',
      position: { x_m: 0.4, y_m: 3.5, z_m: 0.0 },
      facing_deg: 180.0,
      height_m: 1.85,
    },
  ],
  props: [],
  environment: {},
}
fs.writeFileSync(path.join(blockingDir, 'blocking.json'), `${JSON.stringify(blockingDoc, null, 2)}\n`)

// P5: an accepted character card for cast_id 'stud' (card name slug-matches)
// whose close_up_face asset lives inside the project — G6's approved root.
let studCard = newCharacterCard({ id: 'character-stud', name: 'Stud' })
studCard = acceptSlot(studCard, 'close_up_face', 'asset-stud-face')
studCard = acceptSlot(studCard, 'full_body', 'asset-stud-body')
const faceRelPath = 'assets/images/stud-face.png'
fs.mkdirSync(path.join(projectPath, 'assets', 'images'), { recursive: true })
// 1x1 transparent PNG
fs.writeFileSync(path.join(projectPath, faceRelPath), Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
))

const projectFile = {
  version: '1.0',
  name: 'Blocking E2E',
  created: new Date().toISOString(),
  modified: new Date().toISOString(),
  storyboardBoard: {
    cards: [
      {
        id: CARD_ID,
        order: 1,
        title: 'E2E Shot',
        description: 'blocking panel click-through',
        action: 'stud holds frame',
        status: 'draft',
        duration: 5,
      },
    ],
  },
  timelines: [],
  assets: [
    { id: 'asset-stud-face', name: 'stud-face.png', type: 'image', path: faceRelPath },
    { id: 'asset-stud-body', name: 'stud-body.png', type: 'image', path: faceRelPath },
  ],
  references: { characters: [studCard], locations: [], props: [] },
}
fs.writeFileSync(path.join(projectPath, 'project.comfystudio'), JSON.stringify(projectFile, null, 2))

// Skip the first-run "Set Up Your Workspace" gate: the app reads
// <userData>/settings.json (electron/main.js settingsPath) for
// defaultProjectsLocation on boot.
fs.writeFileSync(path.join(tmp, 'userdata', 'settings.json'), JSON.stringify({
  defaultProjectsLocation: tmp,
}, null, 2))

/* ── helpers ──────────────────────────────────────────────────────────── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function mcpCall(name, args = {}) {
  const res = await fetch(`http://127.0.0.1:${MCP_PORT}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  return res.json()
}

async function waitForMcp(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const out = await mcpCall('get_project')
      if (out && (out.result || out.error)) return true
    } catch { /* not up yet */ }
    await sleep(500)
  }
  return false
}

/* ── launch ───────────────────────────────────────────────────────────── */
const executablePath = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron')
const app = await _electron.launch({
  executablePath,
  args: [
    ROOT,
    `--user-data-dir=${path.join(tmp, 'userdata')}`,
    '--no-sandbox', // dev checkout: chrome-sandbox helper isn't root-owned 4755
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  cwd: ROOT,
  env: { ...process.env, VELORN_MCP_PORT: String(MCP_PORT) },
  timeout: 60000,
})

/** The app boots a splash.html window first; the real UI lives in the
 * 5173/dev or dist window. MCP actions execute in the main window's
 * renderer, so we must wait for it before calling open_project. */
async function waitForMainWindow(app, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      if (!w.isClosed() && !w.url().endsWith('splash.html')) return w
    }
    await sleep(500)
  }
  return null
}

let window
try {
  window = await waitForMainWindow(app)
  check('main window (not splash) acquired', Boolean(window), app.windows().map((w) => w.url()).join(', '))
  window.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[renderer:${msg.type()}]`, msg.text().slice(0, 300))
  })
  await window.waitForLoadState('domcontentloaded')

  check('MCP server up on own port', await waitForMcp())

  // The project picker lists the seeded project; open it with a real click.
  const row = window.getByText('Blocking E2E', { exact: true }).first()
  await row.waitFor({ state: 'visible', timeout: 30000 })
  await row.click()

  // Storyboard tab → card → Blocking
  const storyboardTab = window.getByRole('button', { name: 'Storyboard', exact: true }).first()
  await storyboardTab.waitFor({ state: 'visible', timeout: 30000 })
  await storyboardTab.click()
  // (the card title is an editable <input>, which Playwright's text engine
  // doesn't match — wait on the card's Blocking button instead)
  const blockingBtn = window.getByRole('button', { name: 'Blocking', exact: true }).first()
  await blockingBtn.waitFor({ state: 'visible', timeout: 30000 })
  check('storyboard card rendered', true)
  await blockingBtn.click()

  // Panel: gate pills + both three.js canvases
  await window.getByText('G1', { exact: true }).first().waitFor({ state: 'visible', timeout: 15000 })
  await window.getByText('side · depth (Y) × height (Z)').waitFor({ state: 'visible', timeout: 15000 })
  const canvases = window.locator('canvas')
  await canvases.first().waitFor({ state: 'visible', timeout: 15000 })
  await sleep(1500) // let three.js render a few frames
  check('panel renders gate strip + dual canvases', (await canvases.count()) >= 2, `count=${await canvases.count()}`)
  await window.screenshot({ path: path.join(OUT_DIR, '01-panel.png'), fullPage: false })
  await canvases.nth(0).screenshot({ path: path.join(OUT_DIR, '01-top-canvas.png') })
  await canvases.nth(1).screenshot({ path: path.join(OUT_DIR, '01-side-canvas.png') })

  // Edit the camera x_m input through the store, save, verify on disk
  const xInput = window.locator('xpath=//label[.//span[normalize-space()="x m"]]/input').first()
  await xInput.waitFor({ state: 'visible', timeout: 10000 })
  await xInput.fill('1.25')
  await sleep(300)
  await window.getByRole('button', { name: 'Save blocking.json', exact: true }).click()
  await sleep(1000)
  const saved = JSON.parse(fs.readFileSync(path.join(blockingDir, 'blocking.json'), 'utf8'))
  check('x_m edit saved to blocking.json', Math.abs(Number(saved?.camera?.position?.x_m) - 1.25) < 1e-6,
    `got ${saved?.camera?.position?.x_m}`)
  // P5: saving enriches characters[].ref_set.front from the accepted card
  check('ref_set.front sourced from accepted character card (P5)',
    saved?.characters?.[0]?.ref_set?.front === 'assets/images/stud-face.png',
    `got ${saved?.characters?.[0]?.ref_set?.front}`)
  await window.screenshot({ path: path.join(OUT_DIR, '02-edited.png'), fullPage: false })

  // Camera cuts selector: switching to CAM_close swaps the rig inputs
  const cutPill = window.getByRole('button', { name: 'CAM_close', exact: true }).first()
  await cutPill.waitFor({ state: 'visible', timeout: 10000 })
  await cutPill.click()
  await sleep(400)
  const xInputCut = window.locator('xpath=//label[.//span[normalize-space()="x m"]]/input').first()
  check('cut selector swaps rig inputs to the cut camera',
    Math.abs(Number(await xInputCut.inputValue()) - 0.5) < 1e-6,
    `x_m=${await xInputCut.inputValue()}`)
  const canonicalPill = window.getByRole('button', { name: 'CAM_canonical', exact: true }).first()
  await canonicalPill.click()
  await sleep(400)

  // Generate from blocking — full bridge round trip through the real IPC
  await window.getByRole('button', { name: 'Generate from blocking', exact: true }).click()
  const genBtn = window.getByRole('button', { name: 'Rendering control passes…', exact: true })
  check('bridge render starts (busy state)', await genBtn.isVisible().catch(() => false))
  // wait for the busy state to clear (bridge run finished, success or error)
  await window.getByRole('button', { name: 'Generate from blocking', exact: true })
    .waitFor({ state: 'visible', timeout: 240000 })
  const errorText = await window.locator('p.text-red-400').allTextContents()
  check('no panel error after bridge render', errorText.every((t) => !t.trim()), errorText.join(' | '))

  const controlBase = path.join(blockingDir, 'control', CARD_ID)
  let frameCounts = {}
  for (const cam of ['CAM_canonical', 'CAM_close']) {
    for (const pass of ['green', 'pose', 'depth']) {
      const dir = path.join(controlBase, cam, pass)
      frameCounts[`${cam}/${pass}`] = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^f\d{4}\.png$/.test(f)).length : 0
    }
  }
  const locked = Object.values(frameCounts).every((n) => n === 5)
  check('green/pose/depth frame-locked (5 each, both cameras)', locked, JSON.stringify(frameCounts))
  const samples = JSON.parse(fs.readFileSync(path.join(blockingDir, 'blocking.json'), 'utf8'))?.export?.samples
  const sampleCams = new Set((Array.isArray(samples) ? samples : []).map((s) => s.camera_id))
  check('export.samples written back for both cameras',
    Array.isArray(samples) && samples.length > 0 && sampleCams.has('CAM_canonical') && sampleCams.has('CAM_close'),
    `samples=${Array.isArray(samples) ? samples.length : 'none'} cams=${[...sampleCams].join(',')}`)
  await sleep(500)
  await window.screenshot({ path: path.join(OUT_DIR, '03-generated.png'), fullPage: false })
} catch (error) {
  check('harness completed without exception', false, error?.message || String(error))
  try {
    if (window) await window.screenshot({ path: path.join(OUT_DIR, '99-error.png'), fullPage: false })
  } catch { /* window may be gone */ }
} finally {
  await app.close().catch(() => {})
  fs.rmSync(tmp, { recursive: true, force: true })
}

if (failures.length) {
  console.log(`\nBLOCKING PANEL E2E FAIL (${failures.length}): ${failures.join(', ')}`)
  console.log(`screenshots: ${OUT_DIR}`)
  process.exit(1)
}
console.log(`\n=== BLOCKING PANEL E2E PASS === (screenshots: ${OUT_DIR})`)
