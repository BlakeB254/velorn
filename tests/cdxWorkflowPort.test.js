import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { slotForCard } from '../src/services/studioUi.js'

test('ported CDX keyframe graph carries Velorn titles', () => {
  const graph = JSON.parse(readFileSync(join(import.meta.dirname, '../public/workflows/cdx_keyframe_multiref.json'), 'utf8'))
  const titles = Object.values(graph).map((node) => node._meta?.title).filter(Boolean)
  assert.ok(titles.includes('VELORN_PROMPT'))
  assert.ok(titles.includes('VELORN_REFERENCE_IMAGE_1'))
  assert.ok(titles.includes('VELORN_OUTPUT_IMAGE'))
})

test('ported union-control FLF has first/last + output video titles', () => {
  const graph = JSON.parse(readFileSync(join(import.meta.dirname, '../public/workflows/cdx_ltx_union_control_flf.json'), 'utf8'))
  const titles = Object.values(graph).map((node) => node._meta?.title).filter(Boolean)
  assert.ok(titles.includes('VELORN_INPUT_IMAGE'))
  assert.ok(titles.includes('VELORN_OUTPUT_VIDEO'))
})

test('slotForCard matches board titles to studio slot ids', () => {
  const studio = {
    slots: [{ slot_id: 'fx4-punch', board_shot: null, assigned: { first: null, last: null } }],
    qa: {},
    cast: { series: {}, seasons: {}, episodes: {} },
  }
  const hit = slotForCard(studio, { id: 'card-clip-6', title: '14. fx4-punch' })
  assert.equal(hit.slot_id, 'fx4-punch')
})
