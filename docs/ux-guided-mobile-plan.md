# Velorn UX — guided creation, reference cards, mobile parity

Status: **done** (P0 done 2026-08-19, P1–P5 done 2026-08-20)

Follow-ups (smoke test, ChipRow fix, wardrobe/audio consumption, music-video
wiring, ad concept + KB faces): `ux-p6-followups.md` — **done** 2026-08-20.
Author: Kimi K3 (designer/frontend lane), 2026-08-19
Scope: Velorn app (`~/opensource/velorn`) — all views, all production types

## 1. Goal

Take the studio from "tabs full of tools" to a **guided, project-type-driven
production flow** that also works fully on a phone. Three pillars:

1. **Guided creation** — the project type dictates the wizard: what it asks
   for, in what order, and what gets scaffolded.
2. **Reference cards** — characters, locations, and props get structured
   reference-image sets with a generation cascade (face → body → auto-rest)
   and accept/regenerate/replace semantics. Generation quality gates read
   these cards — no accepted refs, no character generation.
3. **Mobile parity** — every view usable on a phone with the SAME features,
   reflowed, not amputated.

## 2. Current state (recon 2026-08-19)

- Top-level tabs (TitleBar): Editor, Storyboard, Sequence, Generate, Stock,
  ComfyUI, Export. Plus WelcomeScreen (project picker / first-run).
- Studio stage rail inside Storyboard view: Script, Cast, Scenes, Storyboard,
  Flf, Video, Review, Edit, Deliver (with blockers per stage).
- Type-specific creators already exist but are siloed in the Generate tab:
  ShortFilmEasyMode (2.3k lines), MusicVideoEasyMode, AdEasyMode,
  UGCAdCreator, BusinessAdCreator. No shared wizard; creation itself
  (WelcomeScreen "New Project") is a bare name prompt.
- CastPanel is read-only cast chips. No reference-image structure anywhere:
  cast refs today are loose assets picked per-shot via AssetPicker.
- No systematic responsive handling; a few `md:` classes in Generate
  components only. `Mobile 9:16` output target exists but the APP itself is
  desktop-only in practice.

## 3. Guided creation (per production type)

New project → **CreateProjectWizard** (replaces the bare name prompt):

1. **Type** — pick from PRODUCTION_TYPES (icons + one-line description +
   output target default from productionTypes.js).
2. **Type-specific steps**, skippable (everything optional but surfaced):
   - **movie / narrative / animated-short**: script import (optional) →
     cast → locations → (props) → scenes → storyboard.
   - **show**: series bible (concept/tone, optional) → seasons (1+) →
     episodes per season → script PER EPISODE → per-episode
     cast/locations layered on the series cast (existing
     series→season→episode resolve in studioStore stays canonical).
   - **commercial / psa / hype-video / ig-short / skit / parody**: product or
     subject refs → hook/CTA beats → single-storyboard fast path
     (adapts the existing AdEasyMode instead of duplicating it).
   - **music-video**: song + lyrics (existing MusicVideoEasyMode stays the
     deep flow; wizard hands off into it).
   - **website-tour / site-update / documentary**: subject assets → beats.
3. **Scaffold** — wizard writes the project file (production block, seasons/
   episodes for shows, empty reference cards for each cast/location entry)
   and lands on the **project view** with the stage rail showing what to do
   first.

**Project view guidance**: each stage-rail node shows its missing inputs and
a primary next action (extend the existing desk/flow pattern — don't build a
second navigation system).

## 4. Reference cards (the core system)

Every character / location / key prop gets a **reference card**: a named
slot grid stored in the project file and linked to DAM assets.

### 4.1 Character card

Anchors (manual: upload or generate, must be ACCEPTED):
- `close_up_face` — always first. Accepting it unlocks `full_body`.
- `full_body` — accepting it unlocks: height/weight/body-type fields
  (stored on the card, injected into generation prompts) and the auto set.

Auto-generated set (queued after both anchors accepted, each cell:
generating → review → accept / regenerate):
- `side_view`
- `emotions` ×6 — happy, sad, angry, surprised, fearful, disgusted
- `seated`

Optional:
- **wardrobe folder** — outfit variants; each variant is its own mini-card
  (full_body + close_up) selected per scene/episode.
- **audio reference** — voice sample for TTS/clone; stored on the card.

Slot semantics (all slots):
- **accept** — locks the image as the slot's ref.
- **regenerate** — re-queues that slot only.
- **replace** (manual add over any slot) — then offers "update the rest to
  match": regenerates dependent slots using the replaced image as the new
  anchor (optional, per replace).
- Cards are versioned: accepted refs keep their asset ids; a regenerate
  never destroys the current accepted image until a new one is accepted.

### 4.2 Location card

- `wide`, `medium`, `detail` angles.
- `birds_eye` — top-down with labelled landmarks (labels stored as
  {name, x_m, y_m} — feeds the blocking v7 environment.footprint +
  panel underlay directly).
- Same accept/regenerate/replace semantics.

### 4.3 Props folder

- Key props, each with a hero shot + optional angle shots. Referenced from
  scenes/cards like characters are.

### 4.4 Data model (P0, src/services/referenceCards.js)

Project-file shape (pure service, node-test-safe):

```
references: {
  characters: [{ id, name, slots: { close_up_face: Slot, full_body: Slot,
                 side_view: Slot, seated: Slot,
                 emotion_happy: Slot, ... },
                 body: { height_cm, weight_kg, body_type },
                 wardrobe: [{ id, label, slots }], audio: Slot|null }],
  locations: [{ id, name, slots: { wide, medium, detail, birds_eye },
                landmarks: [{ name, x_m, y_m }] }],
  props:      [{ id, name, slots: { hero, alt_1, alt_2 } }],
}
Slot = { status: 'empty'|'generating'|'review'|'accepted',
         assetId: string|null, updatedAt: iso }
```

Cascade rules implemented as pure functions (acceptSlot, requestRegenerate,
replaceSlot(propagate), unlocks(card), canGenerateSet(card)) so the UI,
generation wiring, and gates all read one source of truth.

### 4.5 Gates

- Character generation (storyboard stills, keyframes, blocking identity
  billboards ref_set.front) requires the character's accepted anchors
  (`close_up_face` + `full_body`); the auto set is recommended-not-required.
- The blocking G6 identity gate already vets ref paths — character cards
  become the approved source of `ref_set.front`.

## 5. Mobile parity

- `useIsMobile()` (matchMedia `<768px`) in src/hooks.
- **Shell**: top TitleBar → bottom tab bar (same tabs, icons + labels,
  ≥44px targets); secondary rows become horizontal scroll chips.
- **WelcomeScreen**: single column, full-width project cards, wizard =
  full-screen stepper with back/next footer.
- **Storyboard**: one card per row; card actions collapse into an overflow
  bottom sheet; BlockingPanel dual panes stack (top-down above side) at
  full width; camera inputs wrap 2-col.
- **Sequence/Editor**: tracks area gets horizontal scroll with sticky
  ruler; inspector becomes a bottom sheet.
- **Generate**: wizard/creator steps become full-screen steppers.
- All motion respects prefers-reduced-motion (existing guardrail).
- Verification: blocking-panel-e2e pattern extended with a 390×844
  viewport pass over the main views (screenshot assertions).

## 6. Phases

- **P0 (done 2026-08-19)**: this plan + `src/services/referenceCards.js`
  (data model + cascade rules) + node tests.
- **P1 (done 2026-08-20)**: CreateProjectWizard (type → steps → scaffold) in
  WelcomeScreen. `src/services/createWizard.js` (per-type step flows, draft
  validation, `scaffoldFromWizard` → production block + empty reference cards
  + creation record + pendingImports) + `src/services/cdxDirectory.js`
  (fail-open CDX core API client: org search, offerings, unified KB search).
  Ad types get subject (CDX org w/ offering multi-select, manual, or none) →
  concept (paste/file/prompt) → faces; music-video gets song → artists →
  scenes. UI: `src/components/CreateProjectWizard.jsx` (replaces
  NewProjectDialog in WelcomeScreen); `projectStore.createProject` accepts an
  optional `scaffold`. Tests: `test:create-wizard` (9), `test:cdx-directory`
  (9), e2e `test:create-wizard-e2e`.
- **P2 (done 2026-08-20)**: CharacterReferencePanel — slot grid with the
  anchor cascade (locked cells until face/body accepted), upload/replace
  (with optional propagate re-queue), accept-from-review, regenerate re-queue
  (queue wiring is P5), height/weight/body-type fields gated on both anchors,
  wardrobe variants (face+body slots each), audio voice reference. Lives in
  StoryboardWorkspace under "Character reference cards". New service
  `src/services/referencePanels.js` (list ops + slot-row view model);
  `acceptWardrobeSlot` added to referenceCards.js. Tests:
  `test:reference-panels` (7) + wardrobe test in `test:reference-cards` (12);
  e2e `test:reference-panel-e2e`.
- **P3 (done 2026-08-20)**: LocationReferencePanel (wide/medium/detail/
  birds-eye + labelled landmarks in meters feeding the blocking environment)
  and PropsReferencePanel (hero + alt shots), both built on a shared
  `SimpleReferencePanel` + `referencePanelShared.jsx` SlotGrid that the
  character panel now also uses. `removeLandmark` added to referenceCards.js.
  Mounted as sections in StoryboardWorkspace. Tests: reference-cards (13),
  reference-panels (8); e2e `test:reference-panel-e2e` extended — 16 checks
  covering cascade locks, landmark add/persist, prop add/persist.
- **P4 (done 2026-08-20)**: Mobile parity. `src/hooks/useIsMobile.js`
  (matchMedia <768px); phone shell = compact TitleBar (center strip + layout
  switcher hidden) + `MobileTabBar` bottom bar (same tabs, icons+labels,
  ≥44px targets); side panels (LeftPanel/Inspector/MediaPool) auto-collapse
  to icon bars on the mobile transition. WelcomeScreen single-column with a
  reduced hero; CreateProjectWizard becomes a full-screen stepper
  (max-sm:h-full); reference slot grids 2-col on phones; BlockingPanel
  camera inputs wrap 2-col; Storyboard header wraps. E2e:
  `test:mobile-shell-e2e` — 390×844 CDP viewport, 10 checks, screenshots
  over Welcome/wizard/Storyboard/references/Editor/Generate.
- **P5 (done 2026-08-20)**: Generation wiring. `src/services/generationRefs.js`
  (pure bridge: `characterBuildLine` body-type prompt lines, `cardBackedRefIds`
  accepted anchors → referenceImage1/2, `missingAnchorWarnings` gate message,
  `applyCharacterCardRefSets` sources blocking `characters[].ref_set.front`
  from the accepted close-up, `slotGenerationSpec` per-slot queue specs tagged
  `refslot:<cardId>:<slotId>`). `boardShared.composeGenerationPrompt` accepts
  `extra.references` and `primaryRefIds` prefers accepted card anchors;
  StoryboardWorkspace blocks character generation with a missing-anchor
  warning and passes card refs; BlockingPanel runs its doc through
  `applyCharacterCardRefSets` for gates/save/generate (e2e-proven:
  `ref_set.front` lands on disk). Panels queue real ComfyUI jobs via
  `comfystudio-mcp-prepare-generation` (z-image-turbo, anchor refs attached,
  autoQueue); `referenceCards.reviewSlot` parks the finished image as a
  `candidateId` without disturbing the accepted asset, and a watcher in
  StoryboardWorkspace routes `refslot:`-tagged assets back onto their slot as
  review candidates (Accept promotes, Reject restores). Tests:
  `test:generation-refs` (8), reference-cards (14), reference-panels (9);
  e2e `test:reference-panel-e2e` + `test:blocking-panel-e2e` green.

## 7. Non-goals (for now)

- No new generation backends — the cascade drives the existing queue.
- No redesign of visual tokens/brand; this is flow + layout, not a re-skin.
- Multi-user/collab editing stays out of scope.
