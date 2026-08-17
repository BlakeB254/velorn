import { checkFranchiseConsistency, franchiseForApi, loadFranchise } from '../../services/franchises'
import { loadStylePack } from '../../services/stylePacks'
import { getAnimationStyle } from '../../services/animationStyles'

function Swatches({ colors = [] }) {
  if (!colors.length) return null
  return (
    <span className="inline-flex items-center gap-0.5 ml-1 align-middle">
      {colors.slice(0, 4).map((color) => (
        <span
          key={color}
          className="inline-block w-2.5 h-2.5 rounded-sm border border-black/40"
          style={{ background: color }}
          title={color}
        />
      ))}
    </span>
  )
}

export default function StyleBiblePanel({ production, onBindFranchise, onSelectPack, onSealBible }) {
  const franchise = production?.franchiseSlug ? loadFranchise(production.franchiseSlug) : null
  const pack = production?.stylePack ? loadStylePack(production.stylePack) : null
  const animation = production?.animationStyle ? getAnimationStyle(production.animationStyle) : null
  const consistency = checkFranchiseConsistency(production || {})
  const sealed = Boolean(production?.bible?.sealed)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="uppercase tracking-wide text-sf-text-muted">Franchise</span>
        <span className="text-sf-text-primary">{franchise ? franchiseForApi(franchise).name : 'none'}</span>
        {franchise?.style_pack && (
          <button
            type="button"
            className="text-[10px] text-amber-200 hover:underline"
            onClick={() => onBindFranchise?.(franchise.slug)}
          >
            rebind house look
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="uppercase tracking-wide text-sf-text-muted">Style pack</span>
        <span className="text-sf-text-primary">{pack?.name || 'none'}</span>
        <Swatches colors={pack?.swatches} />
        {pack && (
          <button
            type="button"
            className="text-[10px] text-sf-text-secondary hover:underline"
            onClick={() => onSelectPack?.(pack.id)}
          >
            {pack.lora_stack.length} LoRA{pack.lora_stack.length === 1 ? '' : 's'}
          </button>
        )}
      </div>
      {animation && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="uppercase tracking-wide text-sf-text-muted">Animation</span>
          <span className="text-sf-text-primary">{animation.name}</span>
          <Swatches colors={animation.swatches} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className={`uppercase tracking-wide ${sealed ? 'text-emerald-300' : 'text-sf-text-muted'}`}>
          Bible {sealed ? 'sealed' : 'live'}
        </span>
        {production?.bible?.contentHash && (
          <span className="font-mono text-[10px] text-sf-text-muted">{production.bible.contentHash}</span>
        )}
        {!sealed && onSealBible && (
          <button type="button" className="text-[10px] text-amber-200 hover:underline" onClick={onSealBible}>
            seal snapshot
          </button>
        )}
      </div>
      {!consistency.ok && consistency.issues?.length > 0 && (
        <p className="text-[10px] text-amber-300">{consistency.issues[0]}</p>
      )}
      {franchise?.invariants?.length > 0 && (
        <ul className="text-[10px] text-sf-text-secondary list-disc pl-4 space-y-0.5">
          {franchise.invariants.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
