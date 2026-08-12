import { useEffect, useMemo, useRef, useState } from 'react'
import { Upload, X } from 'lucide-react'
import useAssetsStore from '../../stores/assetsStore'
import useProjectStore from '../../stores/projectStore'
import { getProjectFileUrl, importAsset } from '../../services/fileSystem'

export default function MediaPicker({
  assets,
  empty = 'Nothing in the pool yet.',
  onPick,
  accept = 'image/*',
  type = 'image',
  value = '',
  preferredFolderNames = [],
  allowClear = false,
}) {
  const currentProjectHandle = useProjectStore((state) => state.currentProjectHandle)
  const folders = useAssetsStore((state) => state.folders)
  const addAsset = useAssetsStore((state) => state.addAsset)
  const [query, setQuery] = useState('')
  const [folderId, setFolderId] = useState('all')
  const [urls, setUrls] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)
  const preferredApplied = useRef(false)

  const folderOptions = useMemo(() => {
    const counts = new Map()
    for (const asset of assets || []) {
      if (type && asset.type !== type) continue
      const id = asset.folderId || 'root'
      counts.set(id, (counts.get(id) || 0) + 1)
    }
    const options = [{ id: 'all', name: 'All folders', count: [...counts.values()].reduce((sum, n) => sum + n, 0) }]
    if (counts.get('root')) options.push({ id: 'root', name: 'Root', count: counts.get('root') })
    for (const folder of folders || []) {
      const count = counts.get(folder.id) || 0
      if (count) options.push({ id: folder.id, name: folder.name, count })
    }
    return options
  }, [assets, folders, type])

  useEffect(() => {
    if (preferredApplied.current) return
    const preferred = (preferredFolderNames || []).map((name) => String(name).toLowerCase())
    if (!preferred.length) return
    const match = folderOptions.find((folder) => preferred.includes(String(folder.name || '').toLowerCase()))
    if (match) {
      setFolderId(match.id)
      preferredApplied.current = true
    }
  }, [folderOptions, preferredFolderNames])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (assets || []).filter((asset) => {
      if (type && asset.type !== type) return false
      if (folderId === 'root' && asset.folderId) return false
      if (folderId !== 'all' && folderId !== 'root' && asset.folderId !== folderId) return false
      if (!needle) return true
      return String(asset.name || asset.path || '').toLowerCase().includes(needle)
    })
  }, [assets, folderId, query, type])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!currentProjectHandle || type === 'audio') return
      const next = {}
      for (const asset of filtered.slice(0, 200)) {
        const path = asset.path || asset.absolutePath
        if (!path) continue
        try {
          const url = asset.url && !String(asset.url).startsWith('blob:')
            ? asset.url
            : await getProjectFileUrl(currentProjectHandle, path)
          if (!cancelled && url) next[asset.id] = url
        } catch (_) { /* ignore */ }
      }
      if (!cancelled) setUrls((prev) => ({ ...prev, ...next }))
    }
    run()
    return () => { cancelled = true }
  }, [filtered, currentProjectHandle, type])

  const handleUpload = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    if (!currentProjectHandle) {
      setError('Open a project folder before uploading.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const category = type === 'audio' ? 'audio' : type === 'video' ? 'video' : 'images'
      let last = null
      for (const file of files) {
        const info = await importAsset(currentProjectHandle, file, category)
        last = addAsset({
          ...info,
          url: URL.createObjectURL(file),
          type: info.type || (type === 'audio' ? 'audio' : type === 'video' ? 'video' : 'image'),
        })
      }
      if (last) onPick(last)
    } catch (err) {
      setError(err?.message || 'Could not import that file.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded border border-sf-dark-700 bg-sf-dark-950 p-2 space-y-2">
      <div className="flex gap-1.5">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search media pool…"
          className="flex-1 min-w-0 bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-[11px] text-sf-text-primary outline-none"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-sf-dark-800 border border-sf-dark-600 text-[11px] text-sf-text-primary hover:border-sf-accent disabled:opacity-50"
        >
          <Upload className="w-3 h-3" />
          {busy ? 'Importing…' : 'Upload'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          multiple
          className="hidden"
          onChange={handleUpload}
        />
      </div>
      {folderOptions.length > 2 && (
        <div className="flex flex-wrap gap-1">
          {folderOptions.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => setFolderId(folder.id)}
              className={`px-1.5 py-0.5 rounded text-[10px] border ${
                folderId === folder.id
                  ? 'border-sf-accent bg-sf-accent/15 text-sf-text-primary'
                  : 'border-sf-dark-700 text-sf-text-muted hover:text-sf-text-primary'
              }`}
            >
              {folder.name} {folder.count}
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-[10px] text-red-400">{error}</p>}
      <p className="text-[10px] text-sf-text-muted">{filtered.length} items · click a thumbnail to assign</p>
      {filtered.length === 0 ? (
        <p className="text-[10px] text-sf-text-muted px-1 py-2">{empty} Use Upload to add a file from disk.</p>
      ) : type === 'audio' ? (
        <div className="max-h-48 overflow-auto space-y-0.5">
          {filtered.slice(0, 200).map((asset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => onPick(asset)}
              className={`w-full text-left px-2 py-1 text-[11px] rounded ${
                value === asset.id ? 'bg-sf-accent/20 text-sf-text-primary' : 'text-sf-text-secondary hover:bg-sf-dark-800'
              }`}
            >
              {asset.name}
            </button>
          ))}
        </div>
      ) : (
        <div className="max-h-72 overflow-auto grid grid-cols-4 gap-1.5">
          {filtered.slice(0, 200).map((asset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => onPick(asset)}
              className={`rounded border bg-sf-dark-900 overflow-hidden text-left ${
                value === asset.id ? 'border-sf-accent ring-1 ring-sf-accent/50' : 'border-sf-dark-700 hover:border-sf-accent'
              }`}
              title={asset.name}
            >
              <div className="aspect-square bg-sf-dark-800">
                {urls[asset.id] ? (
                  <img src={urls[asset.id]} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[9px] text-sf-text-muted">No preview</div>
                )}
              </div>
              <div className="px-1 py-0.5 text-[9px] text-sf-text-secondary truncate">{asset.name}</div>
            </button>
          ))}
        </div>
      )}
      {allowClear && value ? (
        <button
          type="button"
          onClick={() => onPick({ id: '' })}
          className="inline-flex items-center gap-1 text-[10px] text-sf-text-muted hover:text-sf-text-primary"
        >
          <X className="w-3 h-3" />
          Clear assignment
        </button>
      ) : null}
    </div>
  )
}
