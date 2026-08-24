/**
 * Mount GenerateWorkspace (hidden) so Storyboard / Sequence can queue
 * ComfyUI jobs without yanking the user off the card they are watching.
 */
export async function ensureGenerateWorkspace(timeoutMs = 8000) {
  if (typeof window === 'undefined') {
    throw new Error('Generate engine is only available in the CDX Studio app window.')
  }
  window.dispatchEvent(new CustomEvent('comfystudio-ensure-generate-workspace'))
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const ready = await new Promise((resolve) => {
      let answered = false
      window.dispatchEvent(new CustomEvent('comfystudio-generate-workspace-ping', {
        detail: {
          respond: () => {
            answered = true
            resolve(true)
          },
        },
      }))
      window.setTimeout(() => resolve(answered), 60)
    })
    if (ready) return
    await new Promise((resolve) => window.setTimeout(resolve, 80))
  }
  throw new Error('The Generate engine did not start. Open the Generate tab once, then try again.')
}
