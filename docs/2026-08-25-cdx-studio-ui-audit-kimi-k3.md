# CDX Studio UI/UX Audit — Concrete Fixes

Audit branch: `cdx/studio-rebrand` at `/home/codex450/opensource/velorn`  
Scope: Electron + React 18 + Tailwind + lucide-react. No new dependencies.

---

## A) Ranked UI/UX Improvements

### 1. The Context Stack "READY" badge lies by omission
**Defect:** `ContextStackPanel.jsx` defaults to `showInactive=false`, so 7 of 10 layers are hidden. The top badge then says `ready` (or `3 gaps`) because `stack.ready` only means *active* layers have no gaps. A project with 3 inactive layers and 7 untouched layers reads as "all good."

**Why it hurts:** Users queue generations believing the full context is set, when most layers contribute nothing. The bug is in the metric, not just the label.

**Fix:** Change the badge to report the full stack state, not just active gaps.

- File: `src/components/studio/ContextStackPanel.jsx`
- Replace the badge span (lines 63–65) with:
  ```jsx
  <span className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${stack.ready && stack.counts.active === stack.counts.total ? STATUS_TONE.ready : STATUS_TONE.partial}`}>
    {stack.counts.active}/{stack.counts.total} active
    {stack.gaps.length > 0 && ` · ${stack.gaps.length} gap${stack.gaps.length === 1 ? '' : 's'}`}
  </span>
  ```
- Change the default to `showInactive = true` on line 36 so inactive layers are visible in a muted row.
- Add a one-line sub-caption: `7 inactive layers are not contributing to generation` when `counts.total - counts.active > 0`.

---

### 2. Generate workspace hides context at the moment of spend
**Defect:** `03-Generate.png` shows the workflow picker with an input source and a `Queue Video` button, but no context stack summary. Franchise, style, character, and blocking context are invisible while the user chooses a workflow and commits credits/GPU time.

**Why it hurts:** This is where expensive mistakes happen. A user can queue an `Image to Video (LTX 2.3)` workflow without seeing that the character layer is missing or the style is inherited from a franchise they did not intend.

**Fix:** Add a compact `ContextStackMini` component to the Generate sidebar, above `Queue Video`.

- New file: `src/components/studio/ContextStackMini.jsx`
- Use `resolveContextStack({ shot: currentShot, blocking })` from `src/services/contextStack.js`.
- Render a 10-dot horizontal pipeline (see Section B for the full component). Each dot maps to a layer status.
- If `stack.gaps.length > 0`, disable the queue button and show `N gaps · Review context`.
- Wire it into `src/components/GenerateWorkspace.jsx` (or the equivalent Generate view) in the right-hand queue panel.

---

### 3. StageRail blocker text is inert
**Defect:** `StageRail.jsx` shows `blocked at storyboard` as plain text. The pill has a `title` with blockers, but there is no click-through, no detail panel, and no visual priority.

**Why it hurts:** The rail is supposed to tell the user what to do next. Instead it states a fact and leaves them to hunt for the fix.

**Fix:** Make the blocked stage a clickable action that opens the relevant panel.

- File: `src/components/studio/StageRail.jsx`
- Change the trailing status span (lines 28–30) to a button:
  ```jsx
  {flow.stage_blocked_at ? (
    <button
      type="button"
      onClick={() => extras.onJumpToStage?.(flow.stage_blocked_at)}
      className="text-[10px] text-amber-300 hover:text-amber-200 underline underline-offset-2 self-center ml-1"
    >
      blocked at {flow.stage_blocked_at}
    </button>
  ) : (
    <span className="text-[10px] text-sf-text-muted self-center ml-1">rail clear</span>
  )}
  ```
- Add a tooltip (not just `title`) showing `node.blockers` as a bulleted list. Use a small popover or the existing tooltip primitive.
- In `StoryboardWorkspace.jsx`, pass `onJumpToStage` to `StageRail` so `storyboard` scrolls to the context stack, `cast` opens the character panel, etc.

---

### 4. Storyboard accordion hierarchy flattens the context stack
**Defect:** `StoryboardWorkspace.jsx` renders the Context stack as the 3rd of 7 identical `<details>` accordions, visually equal to "Character reference cards," "Location reference cards," etc. The stack is supposed to be a *summary* of those inputs, not a sibling.

**Why it hurts:** Users cannot tell that the context stack is the governing view. It looks like another settings panel.

**Fix:** Restructure the left panel into two visual zones.

- File: `src/components/StoryboardWorkspace.jsx`
- Keep `Context stack` as the first, always-open section with a distinct background:
  ```jsx
  <div className="rounded-lg border border-sf-dark-700 bg-sf-dark-900/60 p-2 mb-3">
    <ContextStackPanel showInactive />
  </div>
  ```
- Group the reference-card accordions under a sub-heading "Reference cards" with `pl-2 border-l border-sf-dark-700` to show they are inputs *to* the stack.
- Remove the `<details>` wrapper from the context stack; make it a persistent header panel.

---

### 5. Shot cards repeat their title and bury routing
**Defect:** Shot cards in `StoryboardWorkspace.jsx` show the title twice — once in the input field and once as an order badge (e.g., `3. o3-pier-broll`). The route chip (`ATMOSPHERE → MINIMAX-H3-T2V`) is tiny, monospace, and unstyled.

**Why it hurts:** Duplicated text adds noise without information. The route is the most actionable metadata on the card, but it looks like a debug string.

**Fix:** Collapse the title into one line and elevate the route chip.

- File: `src/components/StoryboardWorkspace.jsx` (shot card render)
- Render title once: `<span className="text-xs font-medium text-sf-text-primary">{shot.order}. {shot.title}</span>`.
- Replace the route chip with a status-styled badge:
  ```jsx
  <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border bg-sf-dark-800 border-sf-dark-700 text-sf-text-secondary">
    <span className="text-sf-accent">{route.lane}</span>
    <span className="text-sf-text-muted">→</span>
    <span>{route.workflow}</span>
  </span>
  ```
- Color-code the lane: `talking_character` amber, `atmosphere` blue, `action` emerald, etc.

---

### 6. Home hero still shows the Velorn logo
**Defect:** `01-launch.png` shows the old "Velorn" wordmark and planet logo in the center of the project picker. The rebrand to CDX Studio missed this asset.

**Why it hurts:** It is the first screen a user sees and it contradicts every other rebrand touchpoint.

**Fix:** Swap the hero image and fix the watermark duplication.

- File: likely `public/hero-v1.webp` (or the asset referenced by the launch view)
- Replace with a CDX Studio-branded hero plate. If no asset exists, render the logo with text in the component instead of an image:
  ```jsx
  <div className="flex items-center gap-3">
    <CDXLogo className="w-10 h-10" />
    <h1 className="text-3xl font-semibold tracking-tight text-sf-text-primary">CDX Studio</h1>
  </div>
  ```
- Fix the bottom-right watermark: `CDX STUDIO · CDX STUDIO` should read `CDX STUDIO` once, or better, remove it entirely from the launch screen.

---

### 7. Media pool folder tiles waste the left rail
**Defect:** `03-Storyboard.png` shows 9 large folder tiles (Cast, Keyframes, Storyboard, Video, Audio, Plates, Other, Pool, Generated, Storyboard). The "Other" folder has 922 items but the same tile size as empty folders. At 1600px this rail is mostly folders.

**Why it hurts:** Large item counts are hidden, empty folders get equal visual weight, and the user cannot scan long lists.

**Fix:** Add a list-view toggle and sort folders by item count.

- File: `src/components/MediaPool.jsx` (or the component rendering the folder grid)
- Add a toggle button group: grid / list icons from lucide-react.
- In list view, render rows with `justify-between`:
  ```jsx
  <div className="flex items-center justify-between text-[11px] py-1 px-2 rounded hover:bg-sf-dark-800">
    <span className="flex items-center gap-2"><Folder className="w-3.5 h-3.5" /> {name}</span>
    <span className="text-sf-text-muted tabular-nums">{count}</span>
  </div>
  ```
- Default to list view when any folder has more than 100 items.

---

### 8. Inspector empty state is a 300px dead panel
**Defect:** `02-project-open.png` shows the Inspector panel ~300px wide displaying only "No Selection." At 1600px total width, this is a lot of empty chrome.

**Why it hurts:** The empty panel competes for space with the timeline and storyboard. New users do not know what it is for.

**Fix:** Collapse the empty inspector or show a compact hint.

- File: `src/components/InspectorPanel.jsx` (or the right inspector in the NLE layout)
- When nothing is selected, render:
  ```jsx
  <div className="flex flex-col items-center justify-center h-full text-center px-4 text-sf-text-muted">
    <MousePointerClick className="w-5 h-5 mb-2 opacity-60" />
    <p className="text-[11px]">Select a clip, shot, or layer to edit.</p>
  </div>
  ```
- Consider collapsing the panel to ~160px with a `←` expand handle, or auto-hide it when empty. Do not redesign the timeline; only change the empty-state behavior.

---

## B) Context Stack Visual Flow Design

### Goal
Replace the flat numbered list with a **horizontal context pipeline** that makes the user see, at a glance:
1. Which of the 10 layers are active, partial, missing, or inactive.
2. How layers flow from outermost identity (franchise) to innermost action (blocking).
3. Which prompt lines and reference images each layer contributes.
4. When style is inherited from franchise.
5. The difference between project-level and shot-level stacks.

### Component: `ContextFlow`

**File:** `src/components/studio/ContextFlow.jsx`

**Props:**
```jsx
<ContextFlow
  shot={currentShot}        // null = project-level
  blocking={blockingScene}
  showAssembly={true}       // expand prompt-assembly drawer
  onLayerClick={(layer) => openPanelForLayer(layer.kind)}
/>
```

### Data contract (from `src/services/contextStack.js`)
Use the existing `resolveContextStack` output unchanged:
- `layers[]` in `CONTEXT_LAYER_ORDER`.
- Each layer: `{ kind, id, label, status, detail, contributes: { promptLines, referenceAssetIds, data }, gaps }`.
- `counts`, `ready`, `gaps`, `signature`, `promptLines`, `referenceAssetIds`.

### Visual structure

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Project context · 3/10 active · 7 inactive · 0 gaps          ctx_55db2f01  │
├────────────────────────────────────────────────────────────────────────────┤
│  ◉────◉────◉────◉────◎────◎────◎────◎────◎────◎                           │
│  FR   BR   ST   TY   LO   CH   WD   PR   MV   BL                           │
│  Chi- Triplets  halo Show  —    —    —    —    —    —                      │
├────────────────────────────────────────────────────────────────────────────┤
│ ▼ Prompt assembly (4 lines)                                                │
│   FRANCHISE  Three siblings handle street situations; every episode...     │
│   STYLE      Hex & Halo-inspired photoreal urban drama...                  │
│   TYPE       30-60s / episode · hook by 2s · max hold 4s                   │
├────────────────────────────────────────────────────────────────────────────┤
│ Reference images: [wide] [closeUp] [fullBody]                              │
└────────────────────────────────────────────────────────────────────────────┘
```

### Tailwind/React implementation

```jsx
import { useMemo, useState } from 'react'
import { Check, AlertTriangle, Minus, ChevronDown, ChevronRight, ArrowRight } from 'lucide-react'
import useProjectStore from '../../stores/projectStore'
import { LAYER_LABELS, resolveContextStack } from '../../services/contextStack'

const LAYER_ORDER = [
  'franchise', 'brand', 'style', 'productionType',
  'location', 'character', 'wardrobe', 'prop', 'movement', 'blocking',
]

const TONE = {
  ready:   'bg-emerald-500 border-emerald-400 text-emerald-950',
  partial: 'bg-amber-500 border-amber-400 text-amber-950',
  missing: 'bg-red-500 border-red-400 text-red-950',
  inactive:'bg-sf-dark-800 border-sf-dark-700 text-sf-text-muted',
}

const RING = {
  ready:   'ring-2 ring-emerald-500/50',
  partial: 'ring-2 ring-amber-500/50',
  missing: 'ring-2 ring-red-500/50',
  inactive:'ring-1 ring-sf-dark-700',
}

export default function ContextFlow({ shot = null, blocking = null, onLayerClick }) {
  const currentProject = useProjectStore((s) => s.currentProject)
  const [open, setOpen] = useState(false)

  const stack = useMemo(() => resolveContextStack({
    references: currentProject?.references,
    production: currentProject?.production,
    creation: currentProject?.creation,
    shot,
    blocking,
  }), [currentProject, shot, blocking])

  const layerMap = Object.fromEntries(stack.layers.map((l) => [l.kind, l]))
  const inheritedStyle =
    layerMap.style?.status !== 'missing' &&
    layerMap.style?.contributes?.data?.id &&
    !currentProject?.production?.stylePack &&
    currentProject?.production?.franchiseSlug

  return (
    <div className="rounded-lg border border-sf-dark-700 bg-sf-dark-900/60 p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-sf-text-primary">
          {shot ? 'Shot context' : 'Project context'}
        </span>
        <span className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${stack.ready && stack.counts.active === stack.counts.total ? 'border-emerald-500/50 text-emerald-300' : 'border-amber-500/40 text-amber-300'}`}>
          {stack.counts.active}/{stack.counts.total} active
          {stack.gaps.length > 0 && ` · ${stack.gaps.length} gap${stack.gaps.length === 1 ? '' : 's'}`}
        </span>
        <span className="flex-1" />
        <span className="text-[9px] font-mono text-sf-text-muted" title="Context signature">
          {stack.signature}
        </span>
      </div>

      {/* Pipeline */}
      <div className="flex items-start gap-1 overflow-x-auto pb-1">
        {LAYER_ORDER.map((kind, i) => {
          const layer = layerMap[kind]
          const status = layer?.status || 'inactive'
          const isLast = i === LAYER_ORDER.length - 1
          return (
            <div key={kind} className="flex items-center shrink-0">
              <button
                type="button"
                onClick={() => layer && onLayerClick?.(layer)}
                className={`group flex flex-col items-center gap-1 min-w-[52px] p-1.5 rounded ${RING[status]} hover:bg-sf-dark-800 transition-colors`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center border ${TONE[status]}`}>
                  {status === 'ready' && <Check className="w-3 h-3" />}
                  {status === 'partial' && <AlertTriangle className="w-3 h-3" />}
                  {status === 'missing' && <AlertTriangle className="w-3 h-3" />}
                  {status === 'inactive' && <Minus className="w-3 h-3" />}
                </span>
                <span className="text-[8px] uppercase tracking-wide text-sf-text-muted">
                  {LAYER_LABELS[kind]}
                </span>
                {layer?.label && status !== 'inactive' && (
                  <span className="text-[9px] text-sf-text-primary truncate max-w-[72px]">
                    {layer.label}
                  </span>
                )}
                {status === 'inactive' && (
                  <span className="text-[9px] text-sf-text-muted">—</span>
                )}
                {layer?.gaps.length > 0 && (
                  <span className="text-[8px] text-amber-300 text-center leading-tight max-w-[72px]">
                    {layer.gaps[0].reason}
                  </span>
                )}
              </button>
              {!isLast && (
                <ArrowRight className="w-3 h-3 text-sf-dark-700 mx-0.5 mt-2 shrink-0" />
              )}
              {kind === 'franchise' && inheritedStyle && (
                <div className="absolute -top-2 left-full ml-1 text-[8px] text-sf-text-muted whitespace-nowrap">
                  inherits → style
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Prompt assembly drawer */}
      {stack.promptLines.length > 0 && (
        <div className="border-t border-sf-dark-800 pt-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 text-[10px] text-sf-text-secondary hover:text-sf-text-primary"
          >
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Prompt assembly · {stack.promptLines.length} line{stack.promptLines.length === 1 ? '' : 's'}
          </button>
          {open && (
            <ol className="mt-2 space-y-1">
              {stack.layers
                .filter((l) => l.contributes.promptLines.length > 0)
                .flatMap((l) =>
                  l.contributes.promptLines.map((line, i) => (
                    <li key={`${l.kind}-${i}`} className="flex gap-2 text-[10px]">
                      <span className="uppercase tracking-wide text-sf-text-muted w-16 shrink-0">
                        {LAYER_LABELS[l.kind]}
                      </span>
                      <span className="text-sf-text-secondary">{line}</span>
                    </li>
                  ))
                )}
            </ol>
          )}
        </div>
      )}

      {/* Reference strip */}
      {stack.referenceAssetIds.length > 0 && (
        <div className="border-t border-sf-dark-800 pt-2">
          <p className="text-[9px] uppercase tracking-wide text-sf-text-muted mb-1.5">Reference images</p>
          <div className="flex gap-1.5 overflow-x-auto">
            {stack.referenceAssetIds.map((id) => (
              <div
                key={id}
                className="w-12 h-12 rounded border border-sf-dark-700 bg-sf-dark-800 flex items-center justify-center text-[8px] text-sf-text-muted font-mono"
                title={id}
              >
                {id.slice(0, 6)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Gaps */}
      {stack.gaps.length > 0 && (
        <div className="rounded border border-red-500/20 bg-red-500/5 p-2 space-y-1">
          {stack.gaps.map((gap, i) => (
            <p key={i} className="text-[10px] text-red-300">{gap.reason}</p>
          ))}
        </div>
      )}
    </div>
  )
}
```

### Where to place it

1. **Storyboard workspace:** Replace the current `ContextStackPanel` accordion in `StoryboardWorkspace.jsx` with `<ContextFlow showAssembly />` as the persistent top panel.
2. **Generate workspace:** Add a compact `<ContextFlow shot={currentShot} />` above the `Queue Video` button. Here the assembly drawer should default to collapsed to keep the queue panel dense.
3. **Shot-level difference:** When `shot` is passed, dim the project layers that are not overridden by the shot and add a small `Shot override` badge on layers that differ from the project-level stack.

### Behavior notes

- Clicking a pipeline node calls `onLayerClick(layer)` so the app can open the relevant reference panel or production settings.
- Inactive layers stay visible as gray nodes; this fixes the "READY" deception.
- The `signature` chip stays at the top-right, preserving provenance visibility.
- The assembly drawer shows exactly which layer contributed each prompt line, making the stack transparent.

---

## Summary

The highest-impact fixes are: (1) stop lying about context readiness, (2) surface context in Generate before spend, and (3) make the StageRail blocker actionable. The new `ContextFlow` component addresses the core mental-model problem: users currently cannot see how 10 layers combine into a generation. Implement it as a reusable panel used in both Storyboard and Generate, and the rest of the UI defects (hero, cards, media pool, inspector) can be fixed in parallel with small, scoped changes.
