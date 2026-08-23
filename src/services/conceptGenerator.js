/**
 * Ad concept/director-treatment generation for AdEasyMode.
 *
 * Turns the create-wizard brief (creation.ad: subject + concept prompt) into
 * a Director-style concept the user can edit before building a plan.
 *
 * Backend chain, first success wins, all fail-open:
 *   1. ComfyUI-routed Gemini text workflow (runTextWorkflow from
 *      flowAiRuntime) — needs ComfyUI running and a Partner API key.
 *   2. LM Studio on localhost:1234 — needs the server up and a model loaded.
 * If neither is available the result is { ok: false, error } and the UI keeps
 * the copy-paste-to-external-LLM bridge as the fallback.
 *
 * The prompt builder is pure and node-tested; the default backends are loaded
 * via dynamic import so tests (and non-browser contexts) never pull the
 * ComfyUI/store graph. Inject `backends` in tests.
 */

const DEFAULT_GEMINI_WORKFLOW_ID = 'google-gemini-flash-lite'

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function cleanBlock(value) {
  return String(value || '').trim()
}

function offeringNames(offerings) {
  return (Array.isArray(offerings) ? offerings : [])
    .map((offering) => cleanText(typeof offering === 'string' ? offering : offering?.name))
    .filter(Boolean)
}

/**
 * Build the { systemPrompt, userPrompt } pair for an ad concept/director
 * treatment. Pure — node-tested.
 *
 * subject:   { mode, orgId, orgName } (creation.ad.subject shape)
 * offerings: [{ id, name }] — falls back to subject.offerings
 * prompt:    the brief text (creation.ad.concept.prompt / pasted text)
 * style:     optional { format, tone, platform, lengthSeconds, shotCount }
 */
export function buildAdConceptPrompt({ subject, offerings, prompt, style } = {}) {
  const orgName = cleanText(subject?.orgName)
  const names = offeringNames(offerings?.length ? offerings : subject?.offerings)
  const brief = cleanBlock(prompt)

  const systemPrompt = [
    'You are a senior advertising director writing a concise concept and director treatment for a short video ad.',
    'Write for a video generation pipeline: every beat must be visually shootable as a still keyframe plus a short motion clip.',
    'Return only the treatment text. No markdown fences, no commentary, no questions.',
    'Never ask for text to be rendered into images — reserve space for editor-native overlays instead.',
    'Avoid overpromising claims, split screens, collages, and fake typography.',
  ].join(' ')

  const lines = [
    'Write the ad concept and director treatment for this brief.',
    '',
    `Brand / organization: ${orgName || 'not specified'}`,
    `Offerings: ${names.length ? names.join(', ') : 'not specified'}`,
  ]

  if (style && typeof style === 'object') {
    const hints = []
    if (cleanText(style.format)) hints.push(`Format: ${cleanText(style.format)}`)
    if (cleanText(style.tone)) hints.push(`Tone: ${cleanText(style.tone)}`)
    if (cleanText(style.platform)) hints.push(`Aspect/platform: ${cleanText(style.platform)}`)
    if (Number(style.lengthSeconds) > 0) hints.push(`Length: ${Number(style.lengthSeconds)} seconds`)
    if (Number(style.shotCount) > 0) hints.push(`Target shot count: ${Number(style.shotCount)}`)
    if (hints.length) lines.push('', 'Format hints:', ...hints)
  }

  lines.push(
    '',
    'Brief:',
    brief || '(empty)',
    '',
    'Structure the treatment as:',
    'Concept: one-sentence logline',
    'Audience: who this is for',
    'Promise: the single benefit the ad proves',
    'Visual rules: palette, lighting, wardrobe, and continuity notes',
    'Then one block per shot:',
    'Shot N: short title',
    'Ad beat: hook | product reveal | demo | proof | benefit | CTA | end card',
    'Keyframe prompt: one still image prompt, no rendered text',
    'Motion prompt: image-to-video motion from that exact keyframe',
    'Camera: simple camera movement',
    'Duration: 2 to 5 seconds',
  )

  return { systemPrompt, userPrompt: lines.join('\n') }
}

/* ── default backends (dynamic imports keep this module node-testable) ── */

async function geminiBackend({ systemPrompt, userPrompt }) {
  const { runTextWorkflow } = await import('./flowAiRuntime.js')
  const text = await runTextWorkflow({
    prompt: userPrompt,
    systemPrompt,
    workflowId: DEFAULT_GEMINI_WORKFLOW_ID,
  })
  return String(text || '').trim()
}

async function lmStudioBackend({ systemPrompt, userPrompt }) {
  const client = (await import('./lmstudio.js')).default
  const connected = await client.checkConnection()
  if (!connected) throw new Error('LM Studio is not reachable on localhost:1234')
  const models = await client.listModels()
  const loaded = (Array.isArray(models) ? models : []).find((model) => model?.state === 'loaded')
  const modelId = cleanText(loaded?.id) || cleanText(models?.[0]?.id)
  if (!modelId) throw new Error('LM Studio has no model available')
  const data = await client.chatCompletion(modelId, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], { temperature: 0.7 })
  const text = cleanBlock(data?.choices?.[0]?.message?.content)
  if (!text) throw new Error('LM Studio returned an empty response')
  return text
}

const DEFAULT_BACKENDS = Object.freeze([
  { id: 'comfyui-gemini', run: geminiBackend },
  { id: 'lm-studio', run: lmStudioBackend },
])

/**
 * Generate an ad concept/director treatment from the wizard brief.
 * Never throws: resolves { ok: true, text, backend } or { ok: false, error }.
 *
 * deps.backends: inject [{ id, run({ systemPrompt, userPrompt }) }] to test
 * the chain without touching ComfyUI or LM Studio.
 */
export async function generateAdConcept({ prompt, subject, offerings } = {}, deps = {}) {
  const brief = cleanBlock(prompt)
  if (!brief) return { ok: false, error: 'Add a concept brief first.' }

  const { systemPrompt, userPrompt } = buildAdConceptPrompt({
    subject,
    offerings,
    prompt: brief,
    style: deps.style,
  })

  const backends = Array.isArray(deps.backends) && deps.backends.length
    ? deps.backends
    : DEFAULT_BACKENDS

  const errors = []
  for (const backend of backends) {
    const id = cleanText(backend?.id) || 'backend'
    try {
      const text = cleanBlock(await backend.run({ systemPrompt, userPrompt }))
      if (text) return { ok: true, text, backend: id }
      errors.push(`${id}: empty response`)
    } catch (error) {
      errors.push(`${id}: ${cleanText(error?.message) || 'failed'}`)
    }
  }

  return {
    ok: false,
    error: `No text backend available (${errors.join('; ') || 'none configured'}). Use the copy-paste LLM prompt below instead.`,
  }
}
