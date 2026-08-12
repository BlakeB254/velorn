/**
 * Official ComfyUI / LTX Creative Studio templates Velorn can call.
 * These are not copied into the app — they are fetched from the running
 * ComfyUI instance (/templates/… or /extensions/…) and queued as-is.
 */
export const COMFY_NATIVE_TEMPLATES = Object.freeze({
  'ltx25-i2v': {
    templateName: 'video_ltx2_5_i2v',
    label: 'Extend / I2V (LTX 2.5)',
    description: 'Local LTX 2.5 image-to-video from this still',
    category: 'video',
    group: 'extend',
    needs: ['first'],
    needsImage: true,
    route: 'local',
  },
  'ltx25-t2v': {
    templateName: 'video_ltx2_5_t2v',
    label: 'Text to video (LTX 2.5)',
    description: 'Local LTX 2.5 text-to-video',
    category: 'video',
    group: 'text',
    needs: [],
    route: 'local',
  },
  'ltx25-flf2v': {
    templateName: 'video_ltx2_5_flf2v',
    label: 'First / last frame (LTX 2.5)',
    description: 'Local LTX 2.5 fill between two stills',
    category: 'video',
    group: 'flf',
    needs: ['first', 'last'],
    needsImage: true,
    route: 'local',
  },
  'ltx25-ingredients': {
    extensionPath: 'extensions/ComfyUI-LTXVideo/example_workflows/2.5/LTX-2.5_ICLoRA_Ingredients_Single_Stage_Distilled.json',
    label: 'Ingredients / identity (LTX 2.5)',
    description: 'LTX Creative Studio ingredients LoRA — character/prop/location lock',
    category: 'video',
    group: 'control',
    needs: ['first', 'refs'],
    needsImage: true,
    route: 'local',
  },
  'ltx25-union-control': {
    extensionPath: 'extensions/ComfyUI-LTXVideo/example_workflows/2.5/LTX-2.5_ICLoRA_Union_Control_Distilled.json',
    label: 'Union control (LTX 2.5)',
    description: 'LTX Creative Studio depth/canny/pose control',
    category: 'video',
    group: 'control',
    needs: ['first'],
    needsImage: true,
    route: 'local',
  },
  'ltx25-inpaint': {
    extensionPath: 'extensions/ComfyUI-LTXVideo/example_workflows/2.5/LTX-2.5_ICLoRA_Inpaint_Two_Stage_Distilled.json',
    label: 'Video inpaint (LTX 2.5)',
    description: 'LTX Creative Studio two-stage inpaint',
    category: 'video',
    group: 'edit',
    needs: ['first', 'mask'],
    route: 'local',
  },
  'ltx25-outpaint': {
    extensionPath: 'extensions/ComfyUI-LTXVideo/example_workflows/2.5/LTX-2.5_ICLoRA_Outpaint_Two_Stage_Distilled.json',
    label: 'Video outpaint (LTX 2.5)',
    description: 'LTX Creative Studio two-stage outpaint',
    category: 'video',
    group: 'edit',
    needs: ['first'],
    needsImage: true,
    route: 'local',
  },
  'ltx25-motion-track': {
    extensionPath: 'extensions/ComfyUI-LTXVideo/example_workflows/2.5/LTX-2.5_ICLoRA_Motion_Track_Distilled.json',
    label: 'Motion track (LTX 2.5)',
    description: 'LTX Creative Studio motion-track control',
    category: 'video',
    group: 'control',
    needs: ['first'],
    needsImage: true,
    route: 'local',
  },
  'ltx25-v2v': {
    extensionPath: 'extensions/ComfyUI-LTXVideo/example_workflows/2.5/LTX-2.5_V2V_ICLoRA_Single_Stage_Distilled.json',
    label: 'Video to video (LTX 2.5)',
    description: 'LTX Creative Studio V2V restyle',
    category: 'video',
    group: 'edit',
    needs: [],
    route: 'local',
  },
  'minimax-h3-i2v': {
    templateName: 'video_minimax_h3_i2v',
    label: 'Extend / I2V (MiniMax H3)',
    description: 'Local H3 image-to-video with native audio',
    category: 'video',
    group: 'extend',
    needs: ['first'],
    needsImage: true,
    route: 'local',
  },
  'minimax-h3-flf2v': {
    templateName: 'video_minimax_h3_i2v',
    label: 'First / last frame (MiniMax H3)',
    description: 'Local H3 FL2VA — same official graph, last frame wired at queue time',
    category: 'video',
    group: 'flf',
    needs: ['first', 'last'],
    needsImage: true,
    route: 'local',
    wireLastFrame: true,
  },
  'minimax-h3-t2v': {
    templateName: 'video_minimax_h3_t2v',
    label: 'Text to video (MiniMax H3)',
    description: 'Local H3 text-to-video with native audio',
    category: 'video',
    group: 'text',
    needs: [],
    route: 'local',
  },
  'minimax-h3-r2v-local': {
    templateName: 'video_minimax_h3_r2v',
    label: 'Reference to video (MiniMax H3)',
    description: 'Local H3 Ref2VA — characters/scenes/props as refs',
    category: 'video',
    group: 'refs',
    needs: ['refs'],
    route: 'local',
  },
  'wan22-flf2v': {
    templateName: 'video_wan2_2_14B_flf2v',
    label: 'First / last frame (WAN 2.2)',
    description: 'Official local WAN 2.2 FLF graph',
    category: 'video',
    group: 'flf',
    needs: ['first', 'last'],
    needsImage: true,
    route: 'local',
  },
  'qwen-inpaint': {
    templateName: 'image_qwen_image_instantx_inpainting_controlnet',
    label: 'Inpaint (Qwen InstantX)',
    description: 'Official Qwen inpaint — paint a mask, type a prompt',
    category: 'image',
    group: 'edit',
    needs: ['first', 'mask'],
    needsImage: true,
    route: 'local',
  },
  'qwen-image-2512': {
    templateName: 'image_qwen_Image_2512',
    label: 'Text to image (Qwen 2512)',
    description: 'Official Qwen-Image 2512 stills',
    category: 'image',
    group: 'still',
    needs: [],
    route: 'local',
  },
  'qwen-edit-2511': {
    templateName: 'image_qwen_image_edit_2511',
    label: 'Image edit (Qwen 2511)',
    description: 'Official Qwen Image Edit 2511',
    category: 'image',
    group: 'edit',
    needs: ['first'],
    needsImage: true,
    route: 'local',
  },
  'flux2-klein-t2i': {
    templateName: 'image_flux2_klein_text_to_image',
    label: 'Text to image (FLUX.2 Klein)',
    description: 'Official local FLUX.2 Klein stills',
    category: 'image',
    group: 'still',
    needs: [],
    route: 'local',
  },
  'flux2-klein-edit': {
    templateName: 'image_flux2_klein_image_edit_9b_distilled',
    label: 'Image edit (FLUX.2 Klein 9B)',
    description: 'Official FLUX.2 Klein in-context edit',
    category: 'image',
    group: 'edit',
    needs: ['first'],
    needsImage: true,
    route: 'local',
  },
  'ideogram4-t2i': {
    templateName: 'image_ideogram4_t2i',
    label: 'Text to image (Ideogram 4)',
    description: 'Official Ideogram 4 — best on-image lettering',
    category: 'image',
    group: 'still',
    needs: [],
    route: 'local',
  },
  'flux3-i2v': {
    templateName: 'api_bfl_flux3_i2v',
    label: 'Image to video (FLUX 3 API)',
    description: 'Official BFL FLUX 3 cloud template — no local weights exist',
    category: 'video',
    group: 'cloud',
    needs: ['first'],
    needsImage: true,
    route: 'cloud',
  },
  'wan27-i2v': {
    templateName: 'api_wan2_7_i2v',
    label: 'Image to video (WAN 2.7 API)',
    description: 'Official WAN 2.7 cloud template — no WAN 3 weights on disk',
    category: 'video',
    group: 'cloud',
    needs: ['first'],
    needsImage: true,
    route: 'cloud',
  },
})

export function getComfyNativeTemplate(workflowId) {
  return COMFY_NATIVE_TEMPLATES[String(workflowId || '').trim()] || null
}

export function isComfyNativeTemplate(workflowId) {
  return Boolean(getComfyNativeTemplate(workflowId))
}

export function listComfyNativeTemplates(category) {
  return Object.entries(COMFY_NATIVE_TEMPLATES)
    .map(([id, spec]) => ({ id, ...spec }))
    .filter((item) => !category || item.category === category)
}

export function nativeNeeds(workflowId) {
  return getComfyNativeTemplate(workflowId)?.needs || []
}
