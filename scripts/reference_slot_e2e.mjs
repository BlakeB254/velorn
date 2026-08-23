#!/usr/bin/env node
/**
 * Reference-slot generation loop e2e — the P5 live smoke test. REAL ComfyUI:
 * this drives the local server at 127.0.0.1:8188 (z-image-turbo, local model,
 * no partner credits) and waits for the job to finish.
 *
 *   seeds a throwaway project with one empty character card (Mara)
 *   → launches Velorn in Electron (playwright-core, own MCP port, own
 *     user-data dir — never touches the developer's live instance)
 *   → Storyboard → Character reference cards → Generate on Close-up face
 *   → slot goes 'generating'; the refslot-tagged job runs on live ComfyUI
 *   → watcher parks the finished image as a review candidate
 *   → click Accept → slot accepted with the generated asset
 *   → every transition asserted against the project file on disk
 *
 * Run: xvfb-run -a node scripts/reference_slot_e2e.mjs
 * (npm run test:reference-slot-e2e). Exits non-zero on any failed assertion.
 *
 * PREREQUISITES: (1) live ComfyUI on 127.0.0.1:8188 — checked up front;
 * (2) the vite dev server must already be serving on 127.0.0.1:5173
 * (`npm run dev`) — electron/main.js is dev-mode here and only LOADS
 * 127.0.0.1:5173..5176, it does not spawn vite. Without it the window stays
 * black and the project picker never appears.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { newCharacterCard } from '../src/services/referenceCards.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MCP_PORT = 19794
const OUT_DIR = path.join(ROOT, 'tests', 'out', 'reference-slot-e2e')
const GENERATION_TIMEOUT_MS = 10 * 60 * 1000 // live GPU job — model load + sample

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

// Live ComfyUI is the whole point of this harness — refuse early without it.
try {
  const res = await fetch('http://127.0.0.1:8188/system_stats', { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  console.log('ok — live ComfyUI at 127.0.0.1:8188')
} catch (error) {
  console.error(`FAIL: no live ComfyUI at 127.0.0.1:8188 (${error?.message || error})`)
  process.exit(1)
}

const failures = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok' : 'FAIL'} — ${name}${ok ? '' : ` ${detail}`}`)
  if (!ok) failures.push(name)
}

/* ── seed project ─────────────────────────────────────────────────────── */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-e2e-refslot-'))
const projectPath = path.join(tmp, 'Refslot E2E')
fs.mkdirSync(projectPath, { recursive: true })
fs.mkdirSync(path.join(tmp, 'userdata'), { recursive: true })
fs.mkdirSync(OUT_DIR, { recursive: true })

const mara = newCharacterCard({ id: 'character-mara', name: 'Mara' })
const projectFile = {
  version: '1.0',
  name: 'Refslot E2E',
  created: new Date().toISOString(),
  modified: new Date().toISOString(),
  storyboardBoard: { version: 1, cards: [] },
  timelines: [],
  assets: [],
  references: { characters: [mara], locations: [], props: [] },
}
const projectFilePath = path.join(projectPath, 'project.comfystudio')
fs.writeFileSync(projectFilePath, JSON.stringify(projectFile, null, 2))

// Skip the first-run "Set Up Your Workspace" gate.
fs.writeFileSync(path.join(tmp, 'userdata', 'settings.json'), JSON.stringify({
  defaultProjectsLocation: tmp,
}, null, 2))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const readSlot = () => {
  try {
    const saved = JSON.parse(fs.readFileSync(projectFilePath, 'utf8'))
    return (saved?.references?.characters || [])
      .find((card) => card.id === 'character-mara')?.slots?.close_up_face || null
  } catch { return null }
}
const pollSlot = async (predicate, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = readSlot()
    if (last && predicate(last)) return last
    await sleep(5000)
  }
  console.log(`  … poll exhausted (${label}); last slot state: ${JSON.stringify(last)}`)
  return null
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
    if (msg.type() === 'error') console.log(`[renderer:${msg.type()}]`, msg.text().slice(0, 300))
  })
  await window.waitForLoadState('domcontentloaded')

  // Open the seeded project from the picker
  const row = window.getByText('Refslot E2E', { exact: true }).first()
  await row.waitFor({ state: 'visible', timeout: 30000 })
  await row.click()

  // Storyboard tab → reference cards section → expand Mara
  const storyboardTab = window.getByRole('button', { name: 'Storyboard', exact: true }).first()
  await storyboardTab.waitFor({ state: 'visible', timeout: 30000 })
  await storyboardTab.click()
  const section = window.getByText('Character reference cards', { exact: true }).first()
  await section.waitFor({ state: 'visible', timeout: 15000 })
  await section.click()
  const maraBox = window.locator(
    'xpath=//div[@data-testid="character-reference-panel"]//div[contains(@class,"rounded-lg")][.//span[normalize-space()="Mara"]]',
  ).first()
  await maraBox.waitFor({ state: 'visible', timeout: 10000 })
  await maraBox.locator('button').first().click()
  const faceCell = maraBox.locator(
    'xpath=.//div[contains(@class,"rounded-md")][.//span[normalize-space()="Close-up face"]]',
  ).first()
  await faceCell.waitFor({ state: 'visible', timeout: 10000 })

  // Generate on the empty anchor slot → queues z-image-turbo on live ComfyUI
  await faceCell.getByRole('button', { name: 'Generate', exact: true }).click()
  const generating = await pollSlot((slot) => slot.status === 'generating', 20000, 'generating')
  check('slot went to generating after Generate click', Boolean(generating))
  await shot(window, '01-generating.png')

  // The job runs on live ComfyUI; the watcher parks the result as a candidate.
  console.log('… waiting for the live ComfyUI job (z-image-turbo) to finish')
  const review = await pollSlot(
    (slot) => slot.status === 'review' && Boolean(slot.candidateId),
    GENERATION_TIMEOUT_MS,
    'review candidate',
  )
  check('generated image parked as review candidate (refslot watcher)', Boolean(review))
  check('candidate parked WITHOUT touching accepted asset (none existed)', Boolean(review) && review.assetId === null,
    JSON.stringify(review))

  if (review) {
    // Back to the panel: candidate thumbnail + Accept/Reject visible. Tab and
    // section/card expand state may or may not have survived the Generate-tab
    // detour — click conditionally instead of blindly toggling.
    await storyboardTab.click()
    await sleep(600)
    if (!(await maraBox.isVisible().catch(() => false))) {
      await section.click()
      await sleep(400)
    }
    await maraBox.waitFor({ state: 'visible', timeout: 15000 })
    if (!(await faceCell.isVisible().catch(() => false))) {
      await maraBox.locator('button').first().click()
    }
    await faceCell.getByRole('button', { name: 'Accept', exact: true })
      .waitFor({ state: 'visible', timeout: 15000 })
    check('review UI shows Accept/Reject with the candidate', await faceCell
      .getByRole('button', { name: 'Reject', exact: true }).isVisible())
    await sleep(500)
    await shot(window, '02-review-candidate.png')

    await faceCell.getByRole('button', { name: 'Accept', exact: true }).click()
    const accepted = await pollSlot(
      (slot) => slot.status === 'accepted' && slot.assetId === review.candidateId && !slot.candidateId,
      20000,
      'accepted',
    )
    check('Accept promotes the candidate into the slot', Boolean(accepted),
      JSON.stringify(readSlot()))
    await sleep(800)
    await shot(window, '03-accepted.png')
  }
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
  console.log(`\nREFERENCE SLOT E2E FAIL (${failures.length}): ${failures.join(', ')}`)
  console.log(`screenshots: ${OUT_DIR}`)
  process.exit(1)
}
console.log(`\n=== REFERENCE SLOT E2E PASS === (screenshots: ${OUT_DIR})`)
