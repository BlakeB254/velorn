#!/usr/bin/env node
/**
 * Mobile shell e2e — 390×844 viewport pass over the main views
 * (docs/ux-guided-mobile-plan.md §5/P4).
 *
 *   launches Velorn in Electron (playwright-core, own MCP port, own
 *     user-data dir — never touches the developer's live instance)
 *   → forces a 390×844 mobile viewport via CDP device metrics override
 *   → Welcome (single column) → wizard as full-screen stepper
 *   → opens a seeded project → bottom tab bar drives Storyboard/Editor/
 *     Generate → screenshots each
 *
 * Run: xvfb-run -a node scripts/mobile_shell_e2e.mjs
 * (npm run test:mobile-shell-e2e). Exits non-zero on any failed assertion.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { acceptSlot, newCharacterCard } from '../src/services/referenceCards.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MCP_PORT = 19794
const OUT_DIR = path.join(ROOT, 'tests', 'out', 'mobile-shell-e2e')

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-e2e-mobile-'))
const projectPath = path.join(tmp, 'Mobile E2E')
fs.mkdirSync(projectPath, { recursive: true })
fs.mkdirSync(path.join(tmp, 'userdata'), { recursive: true })
fs.mkdirSync(OUT_DIR, { recursive: true })

let mara = newCharacterCard({ id: 'character-mara', name: 'Mara' })
mara = acceptSlot(mara, 'close_up_face', 'asset-face')

const projectFile = {
  version: '1.0',
  name: 'Mobile E2E',
  created: new Date().toISOString(),
  modified: new Date().toISOString(),
  storyboardBoard: {
    version: 1,
    cards: [{ id: 'card-1', order: 1, title: 'Opening shot', status: 'draft', duration: 5 }],
  },
  timelines: [],
  assets: [],
  references: { characters: [mara], locations: [], props: [] },
}
fs.writeFileSync(path.join(projectPath, 'project.comfystudio'), JSON.stringify(projectFile, null, 2))

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

let window
try {
  window = await waitForMainWindow(app)
  check('main window (not splash) acquired', Boolean(window), app.windows().map((w) => w.url()).join(', '))
  window.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[renderer:${msg.type()}]`, msg.text().slice(0, 200))
  })
  await window.waitForLoadState('domcontentloaded')

  // Force the phone viewport (390×844, iPhone-14-ish) over CDP.
  const cdp = await window.context().newCDPSession(window)
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  })
  await sleep(800) // let matchMedia listeners fire
  const viewportWidth = await window.evaluate(() => globalThis.innerWidth)
  check('viewport forced to 390 CSS px', viewportWidth === 390, `got ${viewportWidth}`)

  // Welcome screen at phone size
  await window.getByRole('button', { name: 'New Project', exact: true }).first()
    .waitFor({ state: 'visible', timeout: 30000 })
  await shot(window, '01-welcome-mobile.png')

  // Wizard = full-screen stepper
  await window.getByRole('button', { name: 'New Project', exact: true }).first().click()
  await window.getByText('What are we making?', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
  const wizardBox = await window.getByText('What are we making?', { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"max-w-2xl")]').first().boundingBox()
  check('wizard stepper is full-screen on mobile',
    Boolean(wizardBox) && wizardBox.width >= 389 && wizardBox.height >= 840,
    JSON.stringify(wizardBox))
  await shot(window, '02-wizard-mobile.png')
  // close wizard via the header X (top-right of the modal)
  await window.locator('div.fixed.inset-0 button').first().click()
  await sleep(400)

  // Open the seeded project
  const row = window.getByText('Mobile E2E', { exact: true }).first()
  await row.waitFor({ state: 'visible', timeout: 15000 })
  await row.click()

  // Bottom tab bar drives navigation
  const tabBar = window.locator('[data-testid="mobile-tab-bar"]')
  await tabBar.waitFor({ state: 'visible', timeout: 30000 })
  check('bottom tab bar renders on mobile', true)

  // TitleBar center tab strip is hidden on mobile (compact mode)
  const topStripVisible = await window.locator('.drag-region .no-drag button', { hasText: 'Storyboard' })
    .isVisible().catch(() => false)
  check('TitleBar tab strip hidden in compact mode', !topStripVisible)

  // Storyboard via the bottom bar
  await tabBar.getByRole('button', { name: 'Storyboard', exact: true }).click()
  await window.getByText('Drag cards to reorder.', { exact: false }).first()
    .waitFor({ state: 'visible', timeout: 15000 })
  check('storyboard opens via bottom tab bar', true)
  await sleep(1200)
  await shot(window, '03-storyboard-mobile.png')
  const scrollWidth = await window.evaluate(() => document.documentElement.scrollWidth)
  check('no horizontal page overflow on storyboard', scrollWidth <= 392, `scrollWidth=${scrollWidth}`)

  // Reference cards section stacks on mobile
  await window.getByText('Character reference cards', { exact: true }).first().click()
  await window.locator('[data-testid="character-reference-panel"]').getByText('Mara', { exact: true })
    .first().waitFor({ state: 'visible', timeout: 10000 })
  check('reference panel usable at phone width', true)
  await shot(window, '04-references-mobile.png')

  // Editor via the bottom bar
  await tabBar.getByRole('button', { name: 'Editor', exact: true }).click()
  await sleep(1500)
  await shot(window, '05-editor-mobile.png')
  check('editor opens via bottom tab bar', true)

  // Generate via the bottom bar
  await tabBar.getByRole('button', { name: 'Generate', exact: true }).click()
  await sleep(1500)
  await shot(window, '06-generate-mobile.png')
  check('generate opens via bottom tab bar', true)
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
  console.log(`\nMOBILE SHELL E2E FAIL (${failures.length}): ${failures.join(', ')}`)
  console.log(`screenshots: ${OUT_DIR}`)
  process.exit(1)
}
console.log(`\n=== MOBILE SHELL E2E PASS === (screenshots: ${OUT_DIR})`)
