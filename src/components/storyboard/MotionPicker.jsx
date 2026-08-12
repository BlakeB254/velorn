import { useEffect, useMemo, useState } from 'react'
import { findMotion, loadMotionCatalog, motionPreviewUrl } from '../../services/motionLibrary'

export default function MotionPicker({ value, onChange }) {
  const [catalog, setCatalog] = useState({ items: [] })
  const [urls, setUrls] = useState({})
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    loadMotionCatalog().then((next) => {
      if (!cancelled) setCatalog(next)
    })
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = catalog.items || []
    if (!needle) return list
    return list.filter((item) => (
      `${item.title} ${item.slug} ${item.tags.join(' ')} ${item.approval}`.toLowerCase().includes(needle)
    ))
  }, [catalog.items, query])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const next = {}
      for (const item of filtered.slice(0, 24)) {
        try {
          const url = await motionPreviewUrl(item)
          if (!cancelled && url) next[item.slug] = url
        } catch (_) { /* ignore */ }
      }
      if (!cancelled) setUrls((prev) => ({ ...prev, ...next }))
    }
    run()
    return () => { cancelled = true }
  }, [filtered])

  const selected = findMotion(value, catalog)

  return (
    <div className="rounded border border-sf-dark-700 bg-sf-dark-950 p-2 space-y-2">
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search motions…"
          className="flex-1 min-w-0 bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-[11px] text-sf-text-primary outline-none"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-[10px] text-sf-text-muted hover:text-sf-text-primary"
          >
            Clear
          </button>
        ) : null}
      </div>
      {selected && (
        <p className="text-[10px] text-emerald-300">
          {selected.title} · {selected.approval}
          {selected.license ? ` · ${selected.license}` : ''}
        </p>
      )}
      <div className="max-h-56 overflow-auto grid grid-cols-3 gap-1.5">
        {filtered.map((item) => (
          <button
            key={item.slug}
            type="button"
            onClick={() => onChange(item.slug)}
            className={`rounded border overflow-hidden text-left ${
              value === item.slug ? 'border-sf-accent ring-1 ring-sf-accent/50' : 'border-sf-dark-700 hover:border-sf-accent'
            }`}
            title={item.source}
          >
            <div className="aspect-square bg-sf-dark-800">
              {urls[item.slug] ? (
                <img src={urls[item.slug]} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[9px] text-sf-text-muted px-1 text-center">
                  {item.title}
                </div>
              )}
            </div>
            <div className="px-1 py-0.5 text-[9px] text-sf-text-secondary truncate">{item.title}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
