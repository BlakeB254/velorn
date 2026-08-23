#!/usr/bin/env node
/**
 * CreateProjectWizard e2e — real click-through of the P1 guided creation
 * flow in the packaged Electron app (docs/ux-guided-mobile-plan.md P1).
 *
 *   launches Velorn in Electron (playwright-core, own MCP port, own
 *     user-data dir — never touches the developer's live instance)
 *   → Welcome → New Project → wizard type rail
 *   → walks the SHOW steps (bible → seasons) for screenshots
 *   → back to type, switches to COMMERCIAL: details → manual subject →
 *     prompt concept → faces → review → Create
 *   → asserts the scaffolded project file on disk (production block,
 *     creation record, reference cards)
 *
 * Run: xvfb-run -a node scripts/create_wizard_e2e.mjs
 * (npm run test:create-wizard-e2e). Exits non-zero on any failed assertion.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MCP_PORT = 19792
const OUT_DIR = path.join(ROOT, 'tests', 'out', 'create-wizard-e2e')

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

/* ── seed ─────────────────────────────────────────────────────────────── */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-e2e-wizard-'))
fs.mkdirSync(path.join(tmp, 'userdata'), { recursive: true })
fs.mkdirSync(OUT_DIR, { recursive: true })

// Skip the first-run "Set Up Your Workspace" gate: the app reads
// <userData>/settings.json (electron/main.js settingsPath) for
// defaultProjectsLocation on boot.
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
    if (msg.type() === 'error') console.log(`[renderer:${msg.type()}]`, msg.text().slice(0, 300))
  })
  await window.waitForLoadState('domcontentloaded')

  // Welcome → New Project
  const newProjectBtn = window.getByRole('button', { name: 'New Project', exact: true }).first()
  await newProjectBtn.waitFor({ state: 'visible', timeout: 30000 })
  await newProjectBtn.click()

  // Type step rail renders the guided flow
  await window.getByText('What are we making?', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
  check('wizard opens on the type step', true)
  await shot(window, '01-type-step.png')

  // Walk the SHOW flow far enough to prove seasons/bible steps exist
  await window.getByRole('button', { name: /^Show\b/ }).first().click()
  await window.getByText('Project name', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
  await window.getByPlaceholder('Enter project name...').fill('E2E Wizard Show')
  await window.getByRole('button', { name: 'Next', exact: true }).click() // → bible
  await window.getByText('Series bible', { exact: true }).first()
    .waitFor({ state: 'visible', timeout: 10000 })
  check('show flow reaches the bible step', true)
  await window.getByPlaceholder('What is the show?').fill('A test series about testing.')
  await window.getByRole('button', { name: 'Next', exact: true }).click() // → seasons
  await window.getByText('Seasons & episodes', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
  await window.getByPlaceholder('Episode 1 title').fill('Pilot')
  check('show flow seasons editor renders with a default episode', true)
  await shot(window, '02-show-seasons.png')

  // Back to the type step via the rail, switch to COMMERCIAL
  await window.getByRole('button', { name: 'Type', exact: true }).first().click()
  await window.getByRole('button', { name: /^Commercial\b/ }).first().click()
  await window.getByText('Project name', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
  await window.getByPlaceholder('Enter project name...').fill('E2E Ad Spot')
  await window.getByRole('button', { name: 'Next', exact: true }).click() // → subject

  // Subject step: manual company (CDX search box is present but CI has no platform)
  await window.getByText('Who is this ad for?', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
  check('commercial flow reaches the subject step', true)
  await shot(window, '03-ad-subject.png')
  await window.getByRole('button', { name: /Manual \/ made-up/ }).click()
  await window.getByPlaceholder('Any name — real, client, or made up...').fill('Totally Made Up Co')
  await window.getByRole('button', { name: 'Next', exact: true }).click() // → concept

  // Concept step: prompt mode
  await window.getByText('Concept', { exact: true }).first().waitFor({ state: 'visible', timeout: 10000 })
  await window.getByRole('button', { name: /Prompt it/ }).click()
  await window.getByPlaceholder(/punchy 15s vertical spot/).fill('A cheerful 15s spot for an imaginary soda.')
  await shot(window, '04-ad-concept.png')
  await window.getByRole('button', { name: 'Next', exact: true }).click() // → faces

  // Faces step: manual add
  await window.getByText('Faces (optional)', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
  await window.getByPlaceholder('Or type a name and press Enter…').fill('Jane Face')
  await window.getByPlaceholder('Or type a name and press Enter…').press('Enter')
  check('face added to the list', await window.getByText('Jane Face', { exact: true }).first().isVisible())
  await window.getByRole('button', { name: 'Next', exact: true }).click() // → review

  // Review + create
  await window.getByText('Review', { exact: true }).first().waitFor({ state: 'visible', timeout: 10000 })
  await shot(window, '05-review.png')
  await window.getByRole('button', { name: 'Create Project', exact: true }).click()

  // Lands on the project view (welcome screen replaced)
  await window.getByRole('button', { name: 'New Project', exact: true })
    .waitFor({ state: 'hidden', timeout: 60000 })
    .catch(() => {})
  await sleep(2500)
  await shot(window, '06-project-view.png')

  // On-disk scaffold assertions
  const projectFilePath = path.join(tmp, 'E2E Ad Spot', 'project.comfystudio')
  check('project file written', fs.existsSync(projectFilePath), projectFilePath)
  if (fs.existsSync(projectFilePath)) {
    const saved = JSON.parse(fs.readFileSync(projectFilePath, 'utf8'))
    check('production type is commercial', saved?.production?.type === 'commercial',
      `got ${saved?.production?.type}`)
    check('current episode set', Boolean(saved?.production?.current?.episodeId))
    check('creation record marked wizard', saved?.creation?.wizard === true)
    check('manual subject recorded', saved?.creation?.ad?.subject?.mode === 'manual'
      && saved?.creation?.ad?.subject?.orgName === 'Totally Made Up Co',
      JSON.stringify(saved?.creation?.ad?.subject))
    check('prompt concept recorded', saved?.creation?.ad?.concept?.mode === 'prompt'
      && String(saved?.creation?.ad?.concept?.prompt || '').includes('imaginary soda'),
      JSON.stringify(saved?.creation?.ad?.concept))
    const faces = saved?.references?.characters || []
    check('face reference card scaffolded', faces.some((card) => card.name === 'Jane Face'),
      JSON.stringify(faces.map((card) => card.name)))
    check('face card slots all empty', faces.every((card) => (
      Object.values(card.slots || {}).every((slot) => slot.status === 'empty')
    )))
    check('creation.next points at ad easy mode', saved?.creation?.next?.flow === 'ad-easy-mode')
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
  console.log(`\nCREATE WIZARD E2E FAIL (${failures.length}): ${failures.join(', ')}`)
  console.log(`screenshots: ${OUT_DIR}`)
  process.exit(1)
}
console.log(`\n=== CREATE WIZARD E2E PASS === (screenshots: ${OUT_DIR})`)
