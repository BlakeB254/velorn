import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LEDGER_POLICY,
  WORKSPACE_DIRS,
  emptyWorkspace,
  qualityDecision,
  recordGeneration,
  recordFeedback,
  promoteToReadyPool,
  linkSource,
  summarize,
  fullState,
  productionFromWorkspace,
} from '../src/services/creativeOps.js'
import { ensureDiskWorkspace, persistWorkspace, readDiskWorkspace } from '../src/services/creativeOpsDisk.js'

function demoWorkspace() {
  return emptyWorkspace({
    slug: 'demo-site-tour',
    title: 'Demo Site Tour',
    projectType: 'website-tour',
    brand: 'Demo',
    entityId: 109,
    entityName: 'Rich Demenor Clothing',
    siteUrl: 'https://demo.example',
  })
}

test('workspace scaffold is append-only and lists every contract folder', () => {
  const workspace = demoWorkspace()
  assert.equal(workspace.rules.appendOnly, true)
  assert.equal(workspace.rules.humanApprovalRequiredBeforePublish, true)
  assert.equal(workspace.rules.gpuSerial, true)
  assert.equal(workspace.rules.outward, 'draft')
  assert.deepEqual([...WORKSPACE_DIRS].sort(), [
    'comfy_runs',
    'feedback',
    'publishing_packages',
    'ready_pool',
    'regeneration_queue',
    'review_queue',
    'social_metadata',
    'source_links',
    'variants',
    'versions',
  ])
  assert.equal(LEDGER_POLICY.neverOverwriteMedia, true)
})

test('low-quality generation is preflagged into regeneration_queue', () => {
  const { workspace, record } = recordGeneration(demoWorkspace(), {
    generation_id: 'clip-001-v1',
    attempt: 1,
    asset_type: 'video',
    workflow_family: 'website-tour',
    content_pillar: 'site-tour',
    model: 'ltx-2.3-22b',
    quality_scores: {
      visual_clarity: 0.9,
      brand_fit: 0.9,
      motion_stability: 0.40,
      story_clarity: 0.9,
      audio_quality: 0.9,
      lip_sync: 0.9,
      cta_strength: 0.9,
      platform_fit: 0.9,
    },
  })
  assert.equal(record.ai_evaluation.decision, 'preflag_for_regeneration')
  assert.ok(record.ai_evaluation.failed_gates.includes('motion_stability'))
  assert.equal(workspace.regenerationQueue.length, 1)
  assert.equal(workspace.reviewQueue.length, 0)
  assert.equal(workspace.generations.length, 1)
})

test('recording the same generation_id is idempotent', () => {
  const first = recordGeneration(demoWorkspace(), { generation_id: 'clip-001-v1', attempt: 1 })
  const second = recordGeneration(first.workspace, { generation_id: 'clip-001-v1', attempt: 2, prompt: 'other' })
  assert.equal(second.created, false)
  assert.equal(second.workspace.generations.length, 1)
  assert.equal(second.workspace.generations[0].attempt, 1)
})

test('missing scores go to human review, not regen', () => {
  const decision = qualityDecision(null, { attempt: 1, assetType: 'image' })
  assert.equal(decision.decision, 'needs_human_review')
  assert.equal(decision.score, null)
})

test('human denial updates approval_profile terms/pillars', () => {
  const generated = recordGeneration(demoWorkspace(), { generation_id: 'clip-001-v1', attempt: 1 })
  const { workspace, event } = recordFeedback(generated.workspace, {
    generation_id: 'clip-001-v1',
    approved: false,
    note: 'motion is jittery and CTA needs stronger offer',
    content_pillar: 'site-tour',
  })
  assert.equal(event.approved, false)
  assert.equal(summarize(workspace).denial_count, 1)
  const profile = fullState(workspace).approval_profile
  assert.equal(profile.denied_reason_terms.motion, 1)
  assert.equal(profile.denied_pillars['site-tour'], 1)
})

test('ready-pool promotion preserves caption metadata and does not overwrite', () => {
  const generated = recordGeneration(demoWorkspace(), { generation_id: 'clip-001-v2', attempt: 2 })
  const first = promoteToReadyPool(generated.workspace, 'clip-001-v2', {
    youtube_title: 'Demo Site Tour in 30 Seconds',
    x_caption: 'Quick walkthrough of the new feature set.',
    content_pillar: 'site-tour',
    optimal_window: 'weekday morning',
  })
  assert.equal(first.record.status, 'ready')
  assert.equal(first.record.caption_pack.content_pillar, 'site-tour')
  assert.equal(summarize(first.workspace).ready_count, 1)
  const second = promoteToReadyPool(first.workspace, 'clip-001-v2', { youtube_title: 'CHANGED' })
  assert.equal(second.created, false)
  assert.equal(second.record.caption_pack.youtube_title, 'Demo Site Tour in 30 Seconds')
})

test('source links are append-only and Hyperframes-safe', () => {
  const { workspace, record } = linkSource(demoWorkspace(), {
    kind: 'hyperframes',
    path: '/home/codex450/creative/hyperframes/demo-tour',
    note: 'import metadata only; do not move media',
  })
  assert.equal(record.kind, 'hyperframes')
  const again = linkSource(workspace, {
    kind: 'hyperframes',
    path: '/home/codex450/creative/hyperframes/demo-tour',
  })
  assert.equal(again.created, false)
  assert.equal(again.workspace.sourceLinks.length, 1)
})

test('production row carries entity + models for the graph mapper', () => {
  const generated = recordGeneration(demoWorkspace(), {
    generation_id: 'clip-001-v1',
    model: 'ltx-2.3-22b',
    quality_scores: { visual_clarity: 0.9, brand_fit: 0.9, motion_stability: 0.9, story_clarity: 0.9, audio_quality: 0.9, lip_sync: 0.9, cta_strength: 0.9, platform_fit: 0.9 },
  })
  const row = productionFromWorkspace(generated.workspace, { coreProjectId: 396 })
  assert.equal(row.entity_id, 109)
  assert.deepEqual(row.models, ['ltx-2.3-22b'])
  assert.equal(row.core_project_id, 396)
  assert.equal(row.clip_count, 1)
})

test('disk adapter writes append-only scaffold and generations.jsonl', () => {
  const root = mkdtempSync(join(tmpdir(), 'velorn-creativeops-'))
  const generated = recordGeneration(demoWorkspace(), {
    generation_id: 'clip-001-v1',
    attempt: 1,
    model: 'ltx-2.3-22b',
    quality_scores: {
      visual_clarity: 0.4,
      brand_fit: 0.4,
      motion_stability: 0.4,
      story_clarity: 0.4,
      audio_quality: 0.4,
      lip_sync: 0.4,
      cta_strength: 0.4,
      platform_fit: 0.4,
    },
  })
  const dir = persistWorkspace(root, generated.workspace)
  assert.ok(existsSync(join(dir, 'manifest.json')))
  assert.ok(existsSync(join(dir, 'generations.jsonl')))
  assert.ok(existsSync(join(dir, 'regeneration_queue', 'clip-001-v1.json')))
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  assert.equal(manifest.rules.appendOnly ?? manifest.rules.append_only, true)
  const reloaded = readDiskWorkspace(dir)
  assert.equal(reloaded.generations[0].generation_id, 'clip-001-v1')
  ensureDiskWorkspace(root, generated.workspace)
  const lines = readFileSync(join(dir, 'generations.jsonl'), 'utf8').trim().split('\n')
  assert.equal(lines.length, 1)
})
