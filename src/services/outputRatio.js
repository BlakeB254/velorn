/**
 * Output ratio targets — mobile phone vs computer vs feed.
 *
 * `edit` is the NLE / project canvas.
 * `generate` is 32-aligned for LTX / most local video graphs (frames still
 * follow the model's own length rules).
 */

const align32 = (value) => Math.max(32, Math.round(Number(value) / 32) * 32)

export const OUTPUT_TARGETS = Object.freeze([
  {
    id: 'mobile',
    label: 'Mobile',
    device: 'phone',
    aspect: '9:16',
    edit: { width: 1080, height: 1920 },
    generate: { width: 768, height: 1344 },
    hint: 'Stories, Reels, TikTok, vertical phone',
  },
  {
    id: 'computer',
    label: 'Computer',
    device: 'desktop',
    aspect: '16:9',
    edit: { width: 1920, height: 1080 },
    generate: { width: 1344, height: 768 },
    hint: 'YouTube, web, desktop monitors',
  },
  {
    id: 'square',
    label: 'Square',
    device: 'feed',
    aspect: '1:1',
    edit: { width: 1080, height: 1080 },
    generate: { width: 1024, height: 1024 },
    hint: 'Feed posts, 1:1',
  },
  {
    id: 'portrait-feed',
    label: 'Portrait feed',
    device: 'phone-feed',
    aspect: '4:5',
    edit: { width: 1080, height: 1350 },
    generate: { width: 896, height: 1120 },
    hint: 'Instagram / Facebook feed 4:5',
  },
])

export const DEFAULT_OUTPUT_TARGET = 'mobile'

export function getOutputTarget(id) {
  return OUTPUT_TARGETS.find((item) => item.id === id) || OUTPUT_TARGETS[0]
}

export function inferOutputTarget({ width, height, outputTarget, aspect } = {}) {
  if (outputTarget && OUTPUT_TARGETS.some((item) => item.id === outputTarget)) {
    return getOutputTarget(outputTarget)
  }
  const raw = String(aspect || '').replace('x', ':')
  if (raw === '9:16' || raw === 'vertical_9x16') return getOutputTarget('mobile')
  if (raw === '16:9' || raw === 'landscape_16x9') return getOutputTarget('computer')
  if (raw === '1:1') return getOutputTarget('square')
  if (raw === '4:5') return getOutputTarget('portrait-feed')
  const w = Number(width) || 0
  const h = Number(height) || 0
  if (w > 0 && h > 0) {
    const ratio = w / h
    if (Math.abs(ratio - 1) < 0.05) return getOutputTarget('square')
    if (Math.abs(ratio - 4 / 5) < 0.06) return getOutputTarget('portrait-feed')
    if (ratio < 1) return getOutputTarget('mobile')
    return getOutputTarget('computer')
  }
  return getOutputTarget(DEFAULT_OUTPUT_TARGET)
}

export function resolveOutput(project, card = null) {
  const settings = project?.settings || {}
  const production = project?.production || {}
  const target = inferOutputTarget({
    outputTarget: card?.outputTarget || settings.outputTarget || production.format?.outputTarget,
    width: settings.width,
    height: settings.height,
    aspect: production.format?.aspect || settings.aspectRatio,
  })
  return {
    ...target,
    inherited: !card?.outputTarget,
    source: card?.outputTarget ? 'shot' : (settings.outputTarget || production.format?.outputTarget ? 'project' : 'inferred'),
  }
}

export function applyOutputTargetToSettings(settings = {}, targetId) {
  const target = getOutputTarget(targetId)
  return {
    ...settings,
    outputTarget: target.id,
    width: target.edit.width,
    height: target.edit.height,
    aspectRatio: target.aspect,
  }
}

export function generateResolution(project, card = null) {
  const target = resolveOutput(project, card)
  return {
    width: align32(target.generate.width),
    height: align32(target.generate.height),
    aspect: target.aspect,
    outputTarget: target.id,
  }
}

export function listOutputTargets() {
  return OUTPUT_TARGETS.map((item) => ({
    id: item.id,
    label: item.label,
    device: item.device,
    aspect: item.aspect,
    edit: item.edit,
    generate: item.generate,
    hint: item.hint,
  }))
}
