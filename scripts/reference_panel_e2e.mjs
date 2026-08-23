#!/usr/bin/env node
/**
 * CharacterReferencePanel e2e — real click-through of the P2 reference-card
 * panel in the packaged Electron app (docs/ux-guided-mobile-plan.md P2).
 *
 *   seeds a throwaway project with two character cards (Mara: no anchors;
 *   Dex: both anchors accepted)
 *   → launches Velorn in Electron (playwright-core, own MCP port, own
 *     user-data dir — never touches the developer's live instance)
 *   → Storyboard tab → Character reference cards section
 *   → asserts the cascade lock states (Mara's body fields locked, Dex's open)
 *   → adds a character through the UI → asserts the project file on disk
 *
 * Run: xvfb-run -a node scripts/reference_panel_e2e.mjs
 * (npm run test:reference-panel-e2e). Exits non-zero on any failed assertion.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  acceptSlot,
  addLandmark,
  newCharacterCard,
  newLocationCard,
  newPropCard,
} from '../src/services/referenceCards.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MCP_PORT = 19793
const OUT_DIR = path.join(ROOT, 'tests', 'out', 'reference-panel-e2e')

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-e2e-refpanel-'))
const projectPath = path.join(tmp, 'Reference E2E')
fs.mkdirSync(projectPath, { recursive: true })
fs.mkdirSync(path.join(tmp, 'userdata'), { recursive: true })
fs.mkdirSync(OUT_DIR, { recursive: true })

const mara = newCharacterCard({ id: 'character-mara', name: 'Mara' })
let dex = newCharacterCard({ id: 'character-dex', name: 'Dex' })
dex = acceptSlot(dex, 'close_up_face', 'asset-face')
dex = acceptSlot(dex, 'full_body', 'asset-body')
let docks = newLocationCard({ id: 'location-the-docks', name: 'The Docks' })
docks = addLandmark(docks, { name: 'Crane', x_m: 12, y_m: 4 })
const briefcase = newPropCard({ id: 'prop-briefcase', name: 'Briefcase' })

const projectFile = {
  version: '1.0',
  name: 'Reference E2E',
  created: new Date().toISOString(),
  modified: new Date().toISOString(),
  storyboardBoard: { version: 1, cards: [] },
  timelines: [],
  assets: [],
  references: { characters: [mara, dex], locations: [docks], props: [briefcase] },
}
fs.writeFileSync(path.join(projectPath, 'project.comfystudio'), JSON.stringify(projectFile, null, 2))

// Skip the first-run "Set Up Your Workspace" gate.
fs.writeFileSync(path.join(tmp, 'userdata', 'settings.json'), JSON.stringify({
  defaultProjectsLocation: tmp,
}, null, 2))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

async function waitForMainWindow(appInstance, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const w of appInstance.windows()) {
      if (!w.isClosed() && !w.url().endsWith('splash.html')) return w
    }
    await sleep(500)
  }
  return null
}

const shot = (window, name) => window.screenshot({ path: path.join(OUT_DIR, name), fullPage: false })

// The card container for one character (header button carries the name).
const cardBox = (window, name) => window.locator(
  `xpath=//div[@data-testid="character-reference-panel"]//div[contains(@class,"rounded-lg")][.//span[normalize-space()="${name}"]]`,
).first()
const heightInput = (window, name) => cardBox(window, name).locator(
  'xpath=.//label[.//span[normalize-space()="Height (cm)"]]/input',
).first()

let window
try {
  window = await waitForMainWindow(app)
  check('main window (not splash) acquired', Boolean(window), app.windows().map((w) => w.url()).join(', '))
  window.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[renderer:${msg.type()}]`, msg.text().slice(0, 300))
  })
  await window.waitForLoadState('domcontentloaded')

  // Open the seeded project from the picker
  const row = window.getByText('Reference E2E', { exact: true }).first()
  await row.waitFor({ state: 'visible', timeout: 30000 })
  await row.click()

  // Storyboard tab → reference cards section
  const storyboardTab = window.getByRole('button', { name: 'Storyboard', exact: true }).first()
  await storyboardTab.waitFor({ state: 'visible', timeout: 30000 })
  await storyboardTab.click()
  const section = window.getByText('Character reference cards', { exact: true }).first()
  await section.waitFor({ state: 'visible', timeout: 15000 })
  await section.click()
  await cardBox(window, 'Mara').waitFor({ state: 'visible', timeout: 10000 })
  check('panel lists both seeded character cards', await cardBox(window, 'Dex').isVisible())
  await shot(window, '01-panel-collapsed.png')

  // Mara (no anchors): body fields locked, full_body slot locked
  await cardBox(window, 'Mara').locator('button').first().click()
  await window.getByText('Close-up face', { exact: true }).first().waitFor({ state: 'visible', timeout: 10000 })
  check('Mara slot grid renders 10 slots', await cardBox(window, 'Mara').locator('xpath=.//div[contains(@class,"aspect-square")]').count() === 10)
  check('Mara body fields locked (no anchors)', await heightInput(window, 'Mara').isDisabled())
  check('Mara unlock hint shown', await cardBox(window, 'Mara')
    .getByText('unlocks after both anchors are accepted', { exact: false }).isVisible())
  await shot(window, '02-mara-locked.png')

  // Dex (both anchors accepted): body fields editable
  await cardBox(window, 'Dex').locator('button').first().click()
  await sleep(300)
  check('Dex body fields editable (anchors accepted)', await heightInput(window, 'Dex').isEnabled())
  await shot(window, '03-dex-unlocked.png')

  // Add a character through the UI and verify the save roundtrip
  await window.getByPlaceholder('New character name…').fill('Zoe')
  await window.getByRole('button', { name: 'Add character', exact: true }).click()
  await cardBox(window, 'Zoe').waitFor({ state: 'visible', timeout: 10000 })
  check('Zoe added through the UI', true)
  await sleep(1500) // saveProject roundtrip
  await shot(window, '04-zoe-added.png')

  const saved = JSON.parse(fs.readFileSync(path.join(projectPath, 'project.comfystudio'), 'utf8'))
  const names = (saved?.references?.characters || []).map((card) => card.name)
  check('project file carries all three cards', ['Mara', 'Dex', 'Zoe'].every((n) => names.includes(n)),
    JSON.stringify(names))
  const savedDex = (saved?.references?.characters || []).find((card) => card.id === 'character-dex')
  check('Dex anchors survive the roundtrip', savedDex?.slots?.close_up_face?.status === 'accepted'
    && savedDex?.slots?.full_body?.status === 'accepted')
  const savedZoe = (saved?.references?.characters || []).find((card) => card.name === 'Zoe')
  check('Zoe scaffolded with empty slots', savedZoe
    && Object.values(savedZoe.slots).every((slot) => slot.status === 'empty'))

  /* ── P6: wardrobe active toggle ─────────────────────────────────────── */
  // Dex: add a variant through the UI, mark it active, verify the save.
  const dexBox = cardBox(window, 'Dex')
  await dexBox.getByPlaceholder('Variant label (suit, casual, …)').fill('Suit')
  await dexBox.getByRole('button', { name: 'Add variant', exact: true }).click()
  await dexBox.getByText('Suit', { exact: true }).first().waitFor({ state: 'visible', timeout: 10000 })
  check('wardrobe variant added through the UI', true)
  await dexBox.getByRole('button', { name: 'Use', exact: true }).first().click()
  await dexBox.getByRole('button', { name: 'Active', exact: true }).first()
    .waitFor({ state: 'visible', timeout: 10000 })
  check('variant toggled active through the UI', true)
  await sleep(1500) // saveProject roundtrip
  const savedWardrobe = JSON.parse(fs.readFileSync(path.join(projectPath, 'project.comfystudio'), 'utf8'))
  const savedDexWardrobe = (savedWardrobe?.references?.characters || [])
    .find((card) => card.id === 'character-dex')
  check('active wardrobe persists to the project file',
    savedDexWardrobe?.activeWardrobeId === 'suit'
    && savedDexWardrobe?.wardrobe?.[0]?.label === 'Suit',
    JSON.stringify({ active: savedDexWardrobe?.activeWardrobeId, wardrobe: savedDexWardrobe?.wardrobe }))
  // Toggle back off so later flows see the base state
  await dexBox.getByRole('button', { name: 'Active', exact: true }).first().click()
  await sleep(1200)
  const savedCleared = JSON.parse(fs.readFileSync(path.join(projectPath, 'project.comfystudio'), 'utf8'))
  check('wardrobe toggle clears cleanly', (savedCleared?.references?.characters || [])
    .find((card) => card.id === 'character-dex')?.activeWardrobeId === null)
  await shot(window, '04b-wardrobe-active.png')

  /* ── P3: locations + landmarks + props ─────────────────────────────── */
  const locSection = window.getByText('Location reference cards', { exact: true }).first()
  await locSection.click()
  const docksBox = window.locator(
    'xpath=//div[@data-testid="location-reference-panel"]//div[contains(@class,"rounded-lg")][.//span[normalize-space()="The Docks"]]',
  ).first()
  await docksBox.waitFor({ state: 'visible', timeout: 10000 })
  await docksBox.locator('button').first().click()
  // Seeded landmark renders; add a second one through the UI
  await docksBox.getByText('Crane', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
  check('seeded landmark renders on the location card', true)
  await docksBox.getByPlaceholder('Landmark name…').fill('Gate B')
  await docksBox.getByPlaceholder('x m').fill('3')
  await docksBox.getByPlaceholder('y m').fill('9')
  await docksBox.getByRole('button', { name: 'Add', exact: true }).last().click()
  await docksBox.getByText('Gate B', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
  check('landmark added through the UI', true)
  await shot(window, '05-location-landmarks.png')

  const propSection = window.getByText('Prop reference cards', { exact: true }).first()
  await propSection.click()
  const propPanel = window.locator('xpath=//div[@data-testid="prop-reference-panel"]')
  await propPanel.getByText('Briefcase', { exact: true }).first()
    .waitFor({ state: 'visible', timeout: 10000 })
  check('seeded prop card renders', true)
  await propPanel.getByPlaceholder('New prop name…').fill('Manifest')
  await propPanel.getByRole('button', { name: 'Add', exact: true }).first().click()
  await propPanel.getByText('Manifest', { exact: true }).first()
    .waitFor({ state: 'visible', timeout: 10000 })
  check('prop added through the UI', true)
  await sleep(1500) // saveProject roundtrip
  await shot(window, '06-props.png')

  const savedP3 = JSON.parse(fs.readFileSync(path.join(projectPath, 'project.comfystudio'), 'utf8'))
  const savedDocks = (savedP3?.references?.locations || []).find((card) => card.name === 'The Docks')
  check('landmarks persist to the project file', savedDocks
    && savedDocks.landmarks.some((l) => l.name === 'Crane' && l.x_m === 12 && l.y_m === 4)
    && savedDocks.landmarks.some((l) => l.name === 'Gate B' && l.x_m === 3 && l.y_m === 9),
    JSON.stringify(savedDocks?.landmarks))
  const propNames = (savedP3?.references?.props || []).map((card) => card.name)
  check('props persist to the project file', ['Briefcase', 'Manifest'].every((n) => propNames.includes(n)),
    JSON.stringify(propNames))
} catch (error) {
  check('harness completed without exception', false, error?.message || String(error))
  try {
    if (window) await shot(window, '99-error.png')
  } catch { /* window may be gone */ }
} finally {
  await app.close().catch(() => {})
  fs.rmSync(tmp, { recursive: true, force: true })
}

if (failures.length) {
  console.log(`\nREFERENCE PANEL E2E FAIL (${failures.length}): ${failures.join(', ')}`)
  console.log(`screenshots: ${OUT_DIR}`)
  process.exit(1)
}
console.log(`\n=== REFERENCE PANEL E2E PASS === (screenshots: ${OUT_DIR})`)
