# Velorn UX overhaul — kickoff prompt for a fresh session

Paste everything below the line into a fresh Kimi K3 session on this box.

---

You are taking over a planned, in-progress UX program on the Velorn app at
`~/opensource/velorn` (React 18 + Vite + Tailwind + Electron; user "Blake").
The plan is written — read it FIRST and follow it:

- `docs/ux-guided-mobile-plan.md` — the full program and phase list
- `docs/blocking-v7-plan.md` — reference for how we run programs here
  (plan doc → pure services + node tests → UI → e2e → docs)

Already done (do not rebuild):
- P0: `src/services/referenceCards.js` — reference-card data model + cascade
  rules (slot lifecycle empty→generating→review→accepted, anchor unlocks,
  replace+propagate, wardrobe, audio, landmarks). Tests:
  `npm run test:reference-cards` (11 passing).
- The blocking-v7 system is complete (gates G0–G6, bridge, e2e harness
  `scripts/blocking_panel_e2e.mjs` via `npm run test:blocking-panel-e2e`).

Build next, in plan order:
- P1: CreateProjectWizard in WelcomeScreen — project type dictates the
  guided steps (movie: script?→cast→locations→props→scenes; show: series
  bible→seasons→episodes→script per episode; commercial/psa/ig-short adapt
  existing AdEasyMode; music-video hands off to MusicVideoEasyMode), then
  scaffolds the project file (production block, seasons/episodes, empty
  reference cards) and lands on the project view.
- P2: CharacterReferencePanel — slot grid with accept/regenerate/replace,
  height/weight/body-type fields (unlocked after both anchors), wardrobe
  folder, audio reference.
- P3: Location + props panels (birds-eye with labelled landmarks).
- P4: Mobile parity — `useIsMobile` hook, bottom tab bar, stacked panes,
  full-screen steppers, same features at 390×844.
- P5: Generation wiring — inject accepted refs + body type into prompts;
  reference cards become the approved source for blocking `ref_set.front`.

Rules of the house:
- Pure logic in `src/services/*.js` with `node --test` suites in `tests/`
  (register each as `npm run test:<name>` in package.json). UI stays thin.
- Match the existing visual language: `sf-dark-*` / `sf-accent` Tailwind
  tokens, `text-[10px]`/`text-[11px]` micro type. No new design system, no
  new dependencies without asking.
- All 20 existing node suites + `test:blocking-roundtrip` must stay green;
  run them plus `npm run build` before declaring any phase done.
- For UI verification use the Electron e2e pattern from
  `scripts/blocking_panel_e2e.mjs` (xvfb + playwright-core, own MCP port,
  throwaway user-data) — screenshots or it isn't done.
- Update `docs/ux-guided-mobile-plan.md` phase statuses as you complete them.

Start by reading the plan doc and `src/services/referenceCards.js`, then
report your read of the current WelcomeScreen/creation flow before writing
P1 code.
