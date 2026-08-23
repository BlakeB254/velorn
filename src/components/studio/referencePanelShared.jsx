import { ImagePlus, Loader2, RefreshCw, Upload } from 'lucide-react'
import { isElectron, importAsset, getProjectFileUrl } from '../../services/fileSystem'
import { slotRows } from '../../services/referencePanels'

export const IMAGE_FILTERS = [
  { name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff'] },
  { name: 'All Files', extensions: ['*'] },
]
export const AUDIO_FILTERS = [
  { name: 'Audio Files', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'] },
  { name: 'All Files', extensions: ['*'] },
]

/** Pick a file in Electron (path string) or web (File). Returns null on cancel. */
export async function pickFile({ title, filters, accept }) {
  if (isElectron() && window.electronAPI?.selectFile) {
    return window.electronAPI.selectFile({ title, filters })
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] || null)
    input.click()
  })
}

/** Import an image into the open project and register it as an asset. */
export async function importProjectImage(currentProjectHandle, addAsset, file) {
  const info = await importAsset(currentProjectHandle, file, 'images')
  let url = info.url || ''
  if (!url && info.path) {
    try { url = await getProjectFileUrl(currentProjectHandle, info.path) } catch (_) { /* best-effort */ }
  }
  if (!url && typeof file !== 'string') {
    try { url = URL.createObjectURL(file) } catch (_) { /* best-effort */ }
  }
  return addAsset({ ...info, type: 'image', url, isImported: true })
}

const STATUS_STYLES = {
  empty: 'bg-sf-dark-700 text-sf-text-muted',
  generating: 'bg-sf-accent/20 text-sf-accent',
  review: 'bg-amber-500/20 text-amber-300',
  accepted: 'bg-emerald-500/20 text-emerald-300',
}

export function StatusPill({ status }) {
  return (
    <span className={`px-1 py-px rounded text-[9px] leading-tight ${STATUS_STYLES[status] || STATUS_STYLES.empty}`}>
      {status}
    </span>
  )
}

/**
 * The slot grid shared by all reference-card panels. Rows come pre-chewed
 * from referencePanels.slotRows (character cascade locks included).
 * onUpload(row) handles both first upload and replace-over-filled.
 * onGenerate(row) queues a ComfyUI regeneration (P5); review rows show the
 * queue candidate and offer Accept (promotes candidateId) / Reject.
 */
export function SlotGrid({ card, assetFor, busy, onUpload, onAccept, onReject, onGenerate, columns = 5 }) {
  return (
    <div className={`grid gap-1.5 ${columns === 5 ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-5' : 'grid-cols-2 md:grid-cols-4'}`}>
      {slotRows(card).map((row) => {
        const shownAssetId = row.status === 'review' && row.candidateId ? row.candidateId : row.assetId
        const asset = assetFor(shownAssetId)
        return (
          <div
            key={row.id}
            className={`rounded-md border p-1.5 flex flex-col gap-1 ${
              row.locked
                ? 'border-sf-dark-800 bg-sf-dark-950 opacity-50'
                : 'border-sf-dark-700 bg-sf-dark-850'
            }`}
            title={row.locked ? 'Locked by the cascade — accept the anchor slots first' : row.label}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-[9px] text-sf-text-secondary truncate">{row.label}</span>
              <StatusPill status={row.status} />
            </div>
            <div className="aspect-square rounded bg-sf-dark-800 flex items-center justify-center overflow-hidden">
              {asset?.url ? (
                <img src={asset.url} alt={row.label} className="w-full h-full object-cover" />
              ) : (
                <ImagePlus className="w-4 h-4 text-sf-text-muted" />
              )}
            </div>
            {!row.locked && (
              <div className="flex flex-col gap-1">
                {row.status === 'review' && (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => onAccept(row)}
                      className="flex-1 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[9px] hover:bg-emerald-500/30 transition-colors"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => onReject(row)}
                      title="Reject the candidate — keep the current accepted image"
                      className="flex-1 px-1.5 py-0.5 rounded bg-sf-dark-700 text-sf-text-muted text-[9px] hover:bg-sf-dark-600 transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => onUpload(row)}
                  disabled={busy}
                  className="flex items-center justify-center gap-1 px-1.5 py-0.5 rounded bg-sf-dark-700 text-sf-text-secondary text-[9px] hover:bg-sf-dark-600 transition-colors disabled:opacity-50"
                >
                  <Upload className="w-2.5 h-2.5" />
                  {row.assetId ? 'Replace' : 'Upload'}
                </button>
                <button
                  type="button"
                  onClick={() => onGenerate(row)}
                  disabled={busy}
                  title={row.assetId
                    ? 'Queue a regeneration — the accepted image stays until you accept the new candidate'
                    : 'Queue generation for this slot'}
                  className="flex items-center justify-center gap-1 px-1.5 py-0.5 rounded bg-sf-accent/15 text-sf-accent text-[9px] hover:bg-sf-accent/25 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  {row.assetId ? 'Regenerate' : 'Generate'}
                </button>
                {row.status === 'generating' && (
                  <span className="flex items-center justify-center gap-1 text-[9px] text-sf-accent">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    Queued
                  </span>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
