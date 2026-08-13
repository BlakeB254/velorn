import { useMemo, useState } from 'react'
import useProjectStore from '../../stores/projectStore'
import { listCuts } from '../../services/productionCuts'
import { listEpisodes } from '../../services/productionStore'
import {
  handleCheckoutCut,
  handleCreateEpisode,
  handlePromoteCut,
  handleSaveCut,
  handleSwitchEpisode,
  handleWatchCut,
} from '../../services/mcpProduction'

export default function CutBar() {
  const currentProject = useProjectStore((state) => state.currentProject)
  const getProduction = useProjectStore((state) => state.getProduction)
  const [name, setName] = useState('')
  const [author, setAuthor] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const production = useMemo(
    () => getProduction?.() || currentProject?.production || null,
    [currentProject, getProduction],
  )
  const seasons = useMemo(() => listEpisodes(production || {}), [production])
  const episodes = useMemo(
    () => seasons.flatMap((season) => season.episodes.map((episode) => ({
      ...episode,
      seasonId: season.id,
      seasonNumber: season.number,
    }))),
    [seasons],
  )
  const episodeId = production?.current?.episodeId || ''
  const listing = useMemo(
    () => listCuts(currentProject?.productionCuts, episodeId),
    [currentProject?.productionCuts, episodeId],
  )
  const isShow = (production?.type || 'show') === 'show' || episodes.length > 0

  if (!isShow && !episodeId) return null

  const run = async (label, fn) => {
    setBusy(label)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="rounded-md border border-sf-dark-700 bg-sf-dark-900/70 px-3 py-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-sf-text-primary">Episode</span>
        <select
          value={episodeId}
          disabled={Boolean(busy) || episodes.length === 0}
          onChange={(event) => run('episode', () => handleSwitchEpisode({
            episodeId: event.target.value,
            previewOnly: false,
          }))}
          className="rounded border border-sf-dark-600 bg-sf-dark-800 px-2 py-1 text-[11px] text-sf-text-primary outline-none"
        >
          {episodes.length === 0 ? <option value="">No episodes</option> : null}
          {episodes.map((episode) => (
            <option key={episode.id} value={episode.id}>
              {episode.code || episode.id} · {episode.title || 'Untitled'}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => run('episode', () => handleCreateEpisode({ previewOnly: false }))}
          className="px-2 py-1 rounded text-[11px] border border-sf-dark-600 text-sf-text-secondary hover:text-sf-text-primary disabled:opacity-40"
        >
          New episode
        </button>
        <span className="text-[10px] text-sf-text-muted">
          Versions stay on this show. Do not make a second project.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-sf-text-primary">Versions</span>
        {listing.cuts.length === 0 && (
          <span className="text-[10px] text-sf-text-muted">No versions yet. Save this board as Draft 1.</span>
        )}
        {listing.cuts.map((cut) => {
          const current = cut.id === listing.currentId
          const primary = cut.id === listing.primaryId
          return (
            <button
              key={cut.id}
              type="button"
              title={`${cut.name}${primary ? ' · primary' : ''}${current ? ' · open' : ''} · ${cut.stats.cardCount} cards / ${cut.stats.clipCount} clips`}
              disabled={Boolean(busy) || !episodeId}
              onClick={() => run('version', () => handleCheckoutCut({ cutId: cut.id, episodeId, previewOnly: false }))}
              className={`px-2 py-1 rounded text-[11px] border ${
                current
                  ? 'border-sf-accent bg-sf-accent/15 text-sf-text-primary'
                  : 'border-sf-dark-600 text-sf-text-muted hover:text-sf-text-secondary'
              }`}
            >
              {cut.name}
              {primary ? <span className="ml-1 text-[10px] text-amber-300">★</span> : null}
            </button>
          )
        })}
        <span className="text-[10px] text-sf-text-muted">
          {listing.primaryId ? `primary ${listing.cuts.find((cut) => cut.id === listing.primaryId)?.name || listing.primaryId}` : 'no primary'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Draft 1 / Grok Draft 1"
          className="w-40 rounded border border-sf-dark-600 bg-sf-dark-800 px-2 py-1 text-[11px] text-sf-text-primary outline-none"
        />
        <input
          value={author}
          onChange={(event) => setAuthor(event.target.value)}
          placeholder="author"
          className="w-24 rounded border border-sf-dark-600 bg-sf-dark-800 px-2 py-1 text-[11px] text-sf-text-primary outline-none"
        />
        <button
          type="button"
          disabled={Boolean(busy) || !name.trim() || !episodeId}
          onClick={() => run('save', async () => {
            await handleSaveCut({ name: name.trim(), author: author.trim(), episodeId, previewOnly: false })
            setName('')
          })}
          className="px-2 py-1 rounded text-[11px] border border-sf-dark-600 text-sf-text-secondary hover:text-sf-text-primary disabled:opacity-40"
        >
          Save as version
        </button>
        <button
          type="button"
          disabled={Boolean(busy) || !listing.currentId}
          onClick={() => run('save', () => handleSaveCut({
            name: listing.cuts.find((cut) => cut.id === listing.currentId)?.name || 'Draft',
            cutId: listing.currentId,
            author: author.trim(),
            episodeId,
            previewOnly: false,
          }))}
          className="px-2 py-1 rounded text-[11px] border border-sf-dark-600 text-sf-text-secondary hover:text-sf-text-primary disabled:opacity-40"
        >
          Save current
        </button>
        <button
          type="button"
          disabled={Boolean(busy) || !listing.currentId}
          onClick={() => run('watch', () => handleWatchCut({ cutId: listing.currentId, episodeId, previewOnly: false }))}
          className="px-2 py-1 rounded text-[11px] border border-sf-dark-600 text-sf-text-secondary hover:text-sf-text-primary disabled:opacity-40"
        >
          Watch
        </button>
        <button
          type="button"
          disabled={Boolean(busy) || !listing.currentId}
          onClick={() => run('promote', () => handlePromoteCut({ cutId: listing.currentId, episodeId, previewOnly: false }))}
          className="px-2 py-1 rounded text-[11px] border border-amber-400/40 text-amber-200 hover:bg-amber-400/10 disabled:opacity-40"
        >
          Promote
        </button>
        {busy ? <span className="text-[10px] text-sf-text-muted">{busy}…</span> : null}
      </div>
      {error ? <p className="text-[10px] text-red-400">{error}</p> : null}
    </div>
  )
}
