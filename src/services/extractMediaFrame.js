/**
 * Grab a still from a video URL (first, last, or a timestamp).
 * Used to chain Sequence clips: last frame → next first/last.
 */
export async function extractMediaFrame(videoUrl, {
  position = 'end',
  time = null,
  filename = 'frame.png',
} = {}) {
  if (!videoUrl) throw new Error('No video URL to pull a frame from.')
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = videoUrl

    const fail = (message) => reject(new Error(message))
    const timeout = window.setTimeout(() => fail('Timed out reading a frame from the clip.'), 12000)

    const finish = (fn) => {
      window.clearTimeout(timeout)
      fn()
    }

    video.onloadedmetadata = () => {
      const duration = Number(video.duration)
      if (!Number.isFinite(duration) || duration <= 0) {
        finish(() => fail('Video has no duration yet.'))
        return
      }
      let target = 0
      if (Number.isFinite(Number(time))) target = Number(time)
      else if (position === 'end') target = Math.max(0, duration - 0.05)
      else if (position === 'mid') target = duration / 2
      video.currentTime = Math.min(Math.max(0, target), Math.max(0, duration - 0.01))
    }

    video.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 1080
      canvas.height = video.videoHeight || 1920
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        finish(() => fail('Could not draw the video frame.'))
        return
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        if (!blob) {
          finish(() => fail('Failed to export the frame.'))
          return
        }
        finish(() => resolve(new File([blob], filename, { type: 'image/png' })))
      }, 'image/png')
    }

    video.onerror = () => finish(() => fail('Failed to load the clip for frame grab.'))
    try { video.load() } catch (_) { /* ignore */ }
  })
}

export function shotClipStatus(card) {
  if (card?.status === 'generating') return 'generating'
  if (card?.videoAssetId && card.status === 'accepted') return 'accepted'
  if (card?.videoAssetId) return 'review'
  if (card?.imageAssetId) return 'still'
  return 'empty'
}
