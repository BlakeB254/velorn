import { getLocalComfyHttpBaseSync } from './localComfyConnection'
import { getComfyNativeTemplate } from '../config/comfyNativeTemplates'
import { modifyLocalApiWorkflow } from './comfyui'

let pendingMaskDataUrl = null

export function setPendingMaskDataUrl(url) {
  pendingMaskDataUrl = url || null
}

export function takePendingMaskDataUrl() {
  const value = pendingMaskDataUrl
  pendingMaskDataUrl = null
  return value
}

function isUiWorkflow(graph) {
  return Boolean(graph && Array.isArray(graph.nodes) && Array.isArray(graph.links))
}

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Could not load ComfyUI template (${response.status}): ${url}`)
  }
  return response.json()
}

export async function fetchOfficialComfyTemplate(spec) {
  const comfyBase = getLocalComfyHttpBaseSync()
  if (spec?.extensionPath) {
    return fetchJson(`${comfyBase}/${String(spec.extensionPath).replace(/^\//, '')}`)
  }
  const name = String(spec?.templateName || '').trim()
  if (!name) throw new Error('Template has no ComfyUI name.')
  return fetchJson(`${comfyBase}/templates/${name}.json`)
}

export async function convertUiWorkflowToApi(uiWorkflow) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null
  if (!api?.convertComfyWorkflowGraph) {
    throw new Error('Converting ComfyUI templates needs the Velorn desktop app with ComfyUI running.')
  }
  const conversion = await api.convertComfyWorkflowGraph({
    workflowGraph: uiWorkflow,
    comfyBaseUrl: getLocalComfyHttpBaseSync(),
  })
  if (!conversion?.success || !conversion.output) {
    throw new Error(conversion?.error || 'ComfyUI could not convert that official template to a runnable graph.')
  }
  return conversion.output
}

export async function loadComfyNativeTemplate(workflowId) {
  const spec = getComfyNativeTemplate(workflowId)
  if (!spec) throw new Error(`Unknown ComfyUI template workflow: ${workflowId}`)
  const graph = await fetchOfficialComfyTemplate(spec)
  if (isUiWorkflow(graph)) return convertUiWorkflowToApi(graph)
  return graph
}

function setLinkedImage(modified, link, filename) {
  if (!filename || !Array.isArray(link)) return
  const node = modified[String(link[0])]
  if (node?.inputs && 'image' in node.inputs) node.inputs.image = filename
}

export function applyComfyNativeInputs(workflow, options = {}) {
  const {
    prompt = '',
    negativePrompt = '',
    inputImage = '',
    lastImage = '',
    maskImage = '',
    inputVideo = '',
    width = 768,
    height = 1344,
    duration = 5,
    fps = 24,
    seed = Math.floor(Math.random() * 1000000000000),
    filenamePrefix = 'velorn/native',
    wireLastFrame = false,
  } = options

  let modified = modifyLocalApiWorkflow(workflow, {
    prompt,
    negativePrompt,
    inputImage,
    inputVideo,
    width,
    height,
    duration,
    fps,
    seed,
    filenamePrefix,
  })

  const loaders = Object.entries(modified)
    .filter(([, node]) => node?.class_type === 'LoadImage')
    .map(([id, node]) => ({ id, node, title: String(node?._meta?.title || '') }))

  const firstLoader = loaders.find((item) => /first/i.test(item.title)) || loaders[0]
  const lastLoader = loaders.find((item) => /last|end/i.test(item.title))
    || (loaders.length > 1 ? loaders[1] : null)
  const maskLoader = loaders.find((item) => /mask/i.test(item.title))

  if (inputImage && firstLoader) firstLoader.node.inputs.image = inputImage
  if (lastImage && lastLoader) lastLoader.node.inputs.image = lastImage
  if (maskImage && maskLoader) maskLoader.node.inputs.image = maskImage

  const length = Math.max(5, Math.round(Number(duration || 5) * Number(fps || 24)))

  for (const node of Object.values(modified)) {
    if (!node?.inputs) continue
    const cls = String(node.class_type || '')

    if (cls === 'MiniMaxH3ImageToVideo' || cls === 'MiniMaxH3ReferenceToVideo') {
      if ('prompt' in node.inputs && prompt) node.inputs.prompt = prompt
      if ('width' in node.inputs) node.inputs.width = Math.round(Number(width) || 768)
      if ('height' in node.inputs) node.inputs.height = Math.round(Number(height) || 1344)
      if ('length' in node.inputs) node.inputs.length = length
      setLinkedImage(modified, node.inputs.first_frame, inputImage)
      if (lastImage) {
        if (Array.isArray(node.inputs.last_frame)) {
          setLinkedImage(modified, node.inputs.last_frame, lastImage)
        } else if (wireLastFrame) {
          modified.velorn_last_frame = {
            inputs: { image: lastImage },
            class_type: 'LoadImage',
            _meta: { title: 'Load Last Frame' },
          }
          node.inputs.last_frame = ['velorn_last_frame', 0]
        }
      }
    }

    if (maskImage && /inpaint|mask/i.test(cls)) {
      if (typeof node.inputs.mask === 'string') node.inputs.mask = maskImage
      setLinkedImage(modified, node.inputs.mask, maskImage)
    }
  }

  return modified
}

export async function dataUrlToFile(dataUrl, name = 'mask.png') {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  return new File([blob], name, { type: blob.type || 'image/png' })
}
