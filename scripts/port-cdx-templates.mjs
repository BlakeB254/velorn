#!/usr/bin/env node
/**
 * Convert CDX Studio API-format templates into Velorn bundled workflows.
 * {{PLACEHOLDER}} values become defaults; the owning node is titled VELORN_*.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC = '/home/codex450/cdx-platform/services/cdx-video-director/templates'
const DEST = '/home/codex450/opensource/velorn/public/workflows'

const TITLE_FOR = {
  '{{PROMPT}}': 'VELORN_PROMPT',
  '{{SEED}}': 'VELORN_SEED',
  '{{WIDTH}}': 'VELORN_WIDTH',
  '{{HEIGHT}}': 'VELORN_HEIGHT',
  '{{FPS}}': 'VELORN_FPS',
  '{{LENGTH}}': 'VELORN_DURATION',
  '{{CHARACTER_REF}}': 'VELORN_REFERENCE_IMAGE_1',
  '{{PENDANT_REF}}': 'VELORN_REFERENCE_IMAGE_2',
  '{{PLATE_REF}}': 'VELORN_INPUT_IMAGE',
  '{{FIRST_FRAME}}': 'VELORN_INPUT_IMAGE',
  '{{LAST_FRAME}}': 'VELORN_REFERENCE_IMAGE_1',
  '{{IMAGE}}': 'VELORN_INPUT_IMAGE',
  '{{REF_IMAGE}}': 'VELORN_REFERENCE_IMAGE_1',
  '{{TARGET}}': 'VELORN_INPUT_IMAGE',
  '{{VIDEO}}': 'VELORN_INPUT_VIDEO',
  '{{CONTROL_VIDEO}}': 'VELORN_CONTROL_VIDEO',
  '{{MASK}}': 'VELORN_MASK',
  '{{FACE_MODEL}}': 'VELORN_FACE_MODEL',
}

const DEFAULTS = {
  '{{PROMPT}}': '',
  '{{NEGATIVE}}': '',
  '{{SEED}}': 0,
  '{{WIDTH}}': 1080,
  '{{HEIGHT}}': 1920,
  '{{FPS}}': 24,
  '{{LENGTH}}': 121,
  '{{PREFIX}}': 'velorn/cdx',
  '{{CONTROL_LORA}}': 'ltx-2.3-22b-distilled-lora-384.safetensors',
  '{{CONTROL_STRENGTH}}': 0.85,
  '{{LAST_STRENGTH}}': 0.85,
  '{{FACE_INDEX}}': 0,
  '{{FACE_MODEL}}': '',
  '{{RESOLUTION}}': 1024,
  '{{MODEL}}': '',
  '{{CHARACTER_REF}}': '',
  '{{PENDANT_REF}}': '',
  '{{PLATE_REF}}': '',
  '{{FIRST_FRAME}}': '',
  '{{LAST_FRAME}}': '',
  '{{IMAGE}}': '',
  '{{REF_IMAGE}}': '',
  '{{TARGET}}': '',
  '{{VIDEO}}': '',
  '{{CONTROL_VIDEO}}': '',
  '{{MASK}}': '',
}

const PORTS = [
  { src: 'qwen_keyframe_multiref.json', dest: 'cdx_keyframe_multiref.json' },
  { src: 'ltx_union_control_flf.json', dest: 'cdx_ltx_union_control_flf.json' },
  { src: 'reactor_facelock.json', dest: 'cdx_reactor_facelock.json' },
  { src: 'qwen_edit_inpaint_ref.json', dest: 'cdx_qwen_inpaint_ref.json' },
  { src: 'extract_depth_image.json', dest: 'cdx_extract_depth_image.json' },
  { src: 'extract_depth_video.json', dest: 'cdx_extract_depth_video.json' },
  { src: 'extract_pose_video.json', dest: 'cdx_extract_pose_video.json' },
  { src: 'scene_compose_zimage_turbo.json', dest: 'cdx_scene_compose.json' },
]

function convert(raw) {
  const out = {}
  for (const [id, node] of Object.entries(raw)) {
    if (!node || typeof node !== 'object' || !node.class_type) continue
    const next = JSON.parse(JSON.stringify(node))
    next._meta = { ...(next._meta || {}) }
    if (next.inputs && typeof next.inputs === 'object') {
      for (const [key, value] of Object.entries(next.inputs)) {
        if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
          if (TITLE_FOR[value] && !String(next._meta.title || '').startsWith('VELORN_')) {
            next._meta.title = TITLE_FOR[value]
          }
          next.inputs[key] = DEFAULTS[value] !== undefined ? DEFAULTS[value] : ''
        }
      }
    }
    const cls = String(next.class_type || '')
    if (cls === 'SaveImage') next._meta.title = 'VELORN_OUTPUT_IMAGE'
    if (cls === 'SaveVideo' || cls === 'VHS_VideoCombine') next._meta.title = 'VELORN_OUTPUT_VIDEO'
    out[id] = next
  }
  return out
}

mkdirSync(DEST, { recursive: true })
for (const item of PORTS) {
  const raw = JSON.parse(readFileSync(join(SRC, item.src), 'utf8'))
  const converted = convert(raw)
  writeFileSync(join(DEST, item.dest), `${JSON.stringify(converted, null, 2)}\n`)
  console.log('wrote', item.dest, Object.keys(converted).length, 'nodes')
}
