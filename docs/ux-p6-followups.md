# UX guided-mobile follow-ups (post P0–P5)

Status: **done** (2026-08-20) — all five items landed and verified.

Continuation of `ux-guided-mobile-plan.md` (P0–P5 complete 2026-08-20). Five
follow-ups ordered after the plan closed: live smoke test of the reference-slot
loop, the ChipRow setState bug, consuming wardrobe/audio card data, music-video
pipeline wiring, and the ad concept/KB-faces edges.

## 1. Reference-slot generation loop — live smoke test

`scripts/reference_slot_e2e.mjs` (`npm run test:reference-slot-e2e`) drives the
full loop against the LIVE ComfyUI at 127.0.0.1:8188 (z-image-turbo, local
model, no partner credits): seed project → Generate on an empty Close-up face
slot → slot `generating` → real GPU job → watcher parks the image as a review
candidate (`candidateId`, accepted asset untouched) → Accept promotes it.
Every transition is asserted against the project file on disk; screenshots in
`tests/out/reference-slot-e2e/`.

Result: **PASS (2026-08-20, live GPU job)** — slot → `generating` → real
z-image-turbo job on :8188 → watcher parked the image as a review candidate
(accepted asset untouched) → Accept promoted it. Screenshots:
`tests/out/reference-slot-e2e/` (01 generating, 02 review candidate with the
generated face + Accept/Reject, 03 accepted).

Environment note: the e2e harnesses need the vite dev server already serving
127.0.0.1:5173 (`npm run dev`) — `electron/main.js` in dev mode only LOADS
5173–5176, it never spawns vite. A black window + picker timeout is that
missing prerequisite, not an app failure (now documented in the harness
header).

## 2. ChipRow setState loop — fixed

`src/components/storyboard/ShotParamsPanel.jsx`: `optionsForMode(...)` returned
a fresh array every render and sat in the preview-effect deps, so the effect
re-fired and `setUrls` re-rendered forever (max-update-depth warnings on every
storyboard render). Fix: `useMemo` on `[categoryId, mode, featuredOnly]`.
Warning gone from e2e logs after this change.

## 3. Wardrobe + audio refs consumed

- `referenceCards.js`: `activeWardrobeId` on character cards,
  `setActiveWardrobe` (validates, clears with null), `activeWardrobe`.
- `generationRefs.js`: `generationAnchorAssetIds` (active variant's filled
  slots win per-slot over the base anchors), `wardrobeLine`
  ("Mara wardrobe: Suit"), `characterVoiceAssetId`, `findLocationCard`
  (loc-/location- prefix tolerant). `cardBackedRefIds` is now wardrobe-aware;
  `applyCharacterCardRefSets` deliberately stays on the BASE anchors (the
  blocking identity lock must not move with wardrobe).
- `boardShared.composeGenerationPrompt` emits the wardrobe line next to the
  build line; `CharacterReferencePanel` wardrobe rows carry a Use/Active
  toggle (deleting the active variant clears the selection).
- Audio: `characterVoiceAssetId` is the lookup; the per-shot consumer is the
  music-video vocal-ref path (§4). The bundled ElevenLabs TTS graph takes
  preset voice NAMES only — there is no sample-clone node, so card audio is
  not wired into ElevenLabs VO (would need a clone-capable workflow; deferred
  by design, not forgotten).
- Tests: reference-cards (15), generation-refs (13). Panel e2e extended with
  the wardrobe Use/Active roundtrip.

## 4. Music-video pipeline fed from reference cards

New pure service `src/services/musicVideoRefs.js` (composes generationRefs):
`musicMemberAnchorSlots` (cast member → wardrobe-aware card anchors),
`musicCastReferenceCandidates` (ordered ref candidates, card anchors first),
`musicArtistBuildLines`, `musicShotVocalAssetId` (first resolved artist's
card audio), `musicLocationReferenceAssetId` (shot/coverage label → accepted
wide, fallback medium). GenerateWorkspace wiring (music-video areas only):
the plan builder takes `references` and fills keyframe ref slots from card
anchors (closeUp + fullBody) instead of raw cast images; reference prompts
carry the artists' build lines; each shot stores `resolvedLocationAssetId`
(threaded through `flattenYoloPlanVariants`) which the keyframe queue uses as
the b-roll/non-performer reference — those shots no longer fall to the
prompt-only path when a location card is accepted; the wizard's song is
auto-selected from `creation.musicVideo.songFileName`; and the video queue
prefers a resolved artist's card vocal sample over the global song when the
workflow accepts audio (forced `vocal_stem` kind, ltx23-ia2v via the UGC
voice pattern). Tests: `test:music-video-refs` (6); generation-refs (13) and
music-visual-style (8) untouched and green.

## 5. Ad flow: concept generation + KB face picker

- `src/services/conceptGenerator.js` (new): `buildAdConceptPrompt` (pure,
  node-tested) + `generateAdConcept` — fail-open backend chain: ComfyUI
  Gemini text workflow (new `runTextWorkflow` export factored out of
  `flowAiRuntime.js`) → LM Studio (`localhost:1234`) → `{ ok:false, error }`.
- `AdEasyMode` finally consumes `creation.ad`: mount prefill (brand from
  subject org, product from first offering — only while fields hold demo
  defaults), and a "Generate concept from brief" card in the Script step that
  writes the result into the director-script state. GenerateWorkspace passes
  `creation` at the mount site.
- KB face picker: `cdxDirectory.pickImageUrl` + `imageUrl` pass-through on
  `mapEntityOption`/`mapKnowledgeHit`; the wizard faces step stores picked
  `imageUrl`s and `runPendingImports` downloads them through the same
  import→acceptSlot path as local face images. NOTE: verified against the
  live core API (:7017) — no image fields today, so the picker operates at
  name level and activates automatically once the API emits image URLs.
- Tests: concept-generator (6), cdx-directory (12), create-wizard (10).

## Verification ledger

| Check | Result |
|---|---|
| Full node battery (26 suites) | PASS — 0 failures, incl. concept-generator (6), music-video-refs (6), cdx-directory (12), create-wizard (10), reference-cards (15), reference-panels (9), generation-refs (13) |
| `test:blocking-roundtrip` | PASS |
| `npm run build` | PASS (10.6s, only pre-existing chunk-size warnings) |
| e2e: reference-slot (live ComfyUI) | PASS — full loop incl. Accept; screenshots `tests/out/reference-slot-e2e/` |
| e2e: reference-panel (extended, 20 checks) | PASS — incl. wardrobe Use/Active roundtrip; `tests/out/reference-panel-e2e/` |
| e2e: blocking-panel | PASS — incl. ref_set.front from accepted card; ChipRow max-update-depth warnings: 0 (fix confirmed in logs) |
| e2e: create-wizard | PASS (15 checks) |
| e2e: mobile-shell (390×844) | PASS (10 checks) |
