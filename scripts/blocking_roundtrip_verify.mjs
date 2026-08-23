/**
 * blocking_roundtrip.sh helper: host-side assertions after the bridge run.
 *
 *   node scripts/blocking_roundtrip_verify.mjs <tmpdir>
 *
 * Asserts, against <tmpdir> (blocking.json written back by --export-samples,
 * control passes under <tmpdir>/control/<shot>/<CAM>/):
 *   1. G5 — green/pose/depth frame sets identical (via the gate service).
 *   2. export.samples — every character sampled, on_screen=true for the
 *      fixture framing, screen x/y within [0, 1].
 *   3. Full evaluateGates table is ready (no fail) with G6 checked against
 *      the tmp dir as the approved cast-ref root.
 * Exit 0 on PASS, 1 on FAIL.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { evalG5, evaluateGates } from '../src/services/blockingGates.js'

const tmp = process.argv[2]
if (!tmp) {
  console.error('usage: node blocking_roundtrip_verify.mjs <tmpdir>')
  process.exit(1)
}

const doc = JSON.parse(readFileSync(join(tmp, 'blocking.json'), 'utf8'))

// ── 1. G5 frame-lock over the rendered control contract ──────────────────
const shotDir = join(tmp, 'control', 'rt01')
const camDirs = readdirSync(shotDir, { withFileTypes: true }).filter((e) => e.isDirectory())
assert.equal(camDirs.length, 1, `expected exactly one CAM dir under ${shotDir}`)
const camName = camDirs[0].name
const controlFrames = {}
for (const pass of ['green', 'pose', 'depth']) {
  controlFrames[pass] = readdirSync(join(shotDir, camName, pass))
}
const g5 = evalG5(controlFrames)
console.log(`G5 ${g5.status}: ${g5.reasons[0] || ''}`)
assert.equal(g5.status, 'pass', g5.reasons.join('; '))
assert.ok(g5.details.frames >= 9, `expected ≥9 frame-locked frames, got ${g5.details.frames}`)

// ── 2. export.samples written back ────────────────────────────────────────
const samples = doc.export?.samples
assert.ok(Array.isArray(samples) && samples.length > 0, 'export.samples missing from written-back doc')
const castIds = [...new Set(samples.map((s) => s.cast_id))].sort()
assert.deepEqual(castIds, ['stud', 'walker'], `samples cover every character: ${castIds}`)
for (const s of samples) {
  assert.ok(s.on_screen === true, `${s.cast_id} f${s.frame} should be on screen for the fixture framing`)
  assert.ok(s.screen_x >= 0 && s.screen_x <= 1 && s.screen_y >= 0 && s.screen_y <= 1,
    `${s.cast_id} f${s.frame} screen (${s.screen_x}, ${s.screen_y}) outside [0, 1]`)
}
console.log(`samples: ${samples.length} rows, ${castIds.length} characters, all on screen in [0,1]`)

// ── 3. full gate table (G6 against the tmp approved root) ────────────────
const { gates, ready } = evaluateGates(doc, {
  controlFrames,
  approvedRoots: [tmp],
  baseDir: tmp,
  fileExists: existsSync,
})
for (const g of gates) console.log(`${g.gate} ${g.status}${g.reasons[0] ? ` — ${g.reasons[0]}` : ''}`)
assert.equal(ready, true, 'gate table has a failing gate')

console.log('HOST VERIFY PASS')
