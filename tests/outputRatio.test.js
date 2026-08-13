import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyOutputTargetToSettings,
  generateResolution,
  inferOutputTarget,
  resolveOutput,
} from '../src/services/outputRatio.js'

test('infers mobile vs computer from canvas size', () => {
  assert.equal(inferOutputTarget({ width: 1080, height: 1920 }).id, 'mobile')
  assert.equal(inferOutputTarget({ width: 1920, height: 1080 }).id, 'computer')
  assert.equal(inferOutputTarget({ width: 1080, height: 1080 }).id, 'square')
  assert.equal(inferOutputTarget({ aspect: '9:16' }).id, 'mobile')
})

test('generate sizes are 32-aligned', () => {
  const mobile = generateResolution({ settings: { outputTarget: 'mobile' } })
  const computer = generateResolution({ settings: { outputTarget: 'computer' } })
  assert.equal(mobile.width % 32, 0)
  assert.equal(mobile.height % 32, 0)
  assert.equal(computer.width % 32, 0)
  assert.equal(computer.height % 32, 0)
  assert.ok(mobile.height > mobile.width)
  assert.ok(computer.width > computer.height)
})

test('shot override wins over project', () => {
  const project = { settings: { outputTarget: 'mobile', width: 1080, height: 1920 } }
  const shot = resolveOutput(project, { outputTarget: 'computer' })
  assert.equal(shot.id, 'computer')
  assert.equal(shot.inherited, false)
})

test('applyOutputTargetToSettings writes edit canvas', () => {
  const next = applyOutputTargetToSettings({}, 'computer')
  assert.equal(next.width, 1920)
  assert.equal(next.height, 1080)
  assert.equal(next.aspectRatio, '16:9')
  assert.equal(next.outputTarget, 'computer')
})
