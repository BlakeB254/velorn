# Blocking v7 — unified scene blocking, rigged stand-ins, camera-pose round-trip

Status: **complete** (all phases done, 2026-08-19)
Author: Kimi K3 (designer/frontend lane), 2026-08-19
Scope: Velorn studio + headless Blender bridge + `~/creative` data layout

## 1. Background

Scene blocking today is split across two systems:

- **cdx-video-director** (the legacy `~/cdx-platform` service, slated for deletion) owns the entire 3D lane: three.js dual-pane blocking UI
  (`views/studio/blocking.html`), Blender scene kits with real 17-bone COCO armatures
  (`~/creative/chi-town-triplets/ep001/blender/build_rig.py`), green/pose/depth control
  passes, and the ComfyUI IC-LoRA union-control conditioning pipeline
  (`app/studio/blocking_generate.py`).
- **Velorn** (this repo, the surviving app) has only `src/components/studio/BlockingPanel.jsx`:
  a 260 px canvas with camera + character dots. No frustum, no facing, no height,
  no environment, no time axis. Velorn is deliberately filesystem-isolated from the
  legacy service (`tests/cdxStudioIsolation.test.js`), so capabilities must be
  **ported**, not re-coupled.

## 2. The five breaks v7 must fix

1. `render_v6.py` **ignores** the `--blocking`/`--shot` args the service passes
   (`blocking_workspace.py:451-455`); shot tables, frame windows, cameras and the
   output BASE are hardcoded per .blend.
2. The apply direction (blocking.json → Blender) is a stub: `start_reblock_stub`
   (`app/studio/blocking.py:579`, provider `"blender-bridge-stub"`). The standalone
   `apply_blocking.py` (`~/creative/chi-town-triplets/blender/tools/`) expects
   schema v1 while `export_blocking_v6.py` writes v2, and nothing invokes it.
3. Two divergent schemas: pydantic schema-1 (`app/studio/blocking.py`,
   `~/creative/<slug>/blocking/<shot>/`) vs v6 plain-dict (`blocking_workspace.py`,
   `~/creative/<slug>/<episode>/blocking/<shot>/`). The spatial gate G1 only reads
   schema-1, so v6 shots report "no blocking".
4. Two divergent lexicon→geometry tables: canonical `shot_settings.py:82-113`
   (GEOMETRY) vs Velorn `cameraRig.js:156-211` — e.g. 135mm fov 18 vs 15;
   birds-eye z 6.5/pitch −88 vs z 8.0/pitch −75.
5. v6 blocking carries only hips position + object facing — **no skeletal pose**.
   Bone-level facing was tried and dropped (exporter comment).

## 3. Assets already on disk (reuse, don't rebuild)

- Camera math, round-trip-tested: `~/creative/chi-town-triplets/blender/tools/bridge_common.py`
  (`cam_quat`, `rig_rz_from_enu`, `cam_angles_from_matrix`).
- Motion library: `~/creative/_library/motions/` — 12+ retargetable Mesh2Motion rig
  clips (idle, walk, jog, sprint, sit, push, punch-cross, hit-knockback,
  fighting-idle, idle-talking, idle-listening) + rigged human base GLB
  (`motions/_vendor/mesh2motion/`). Indexed for stand-in retarget; no retarget
  script exists yet.
- Rig builder: `build_rig.py` — 17-bone COCO armature with bone-parented
  green capsules (`BOD_*`) and OpenPose-hue sticks (`STK_*`). Pose hues already
  match what the union-control IC-LoRA expects from DWPose.
- Per-character 4-view identity ref_sets (`cast.yaml`: front / three-quarter /
  full / pendant) — texture-ready for identity billboards in the green pass.
- Stable ComfyUI contract: `control/<shot>/<cam>/{green,pose,depth}/f####.png`
  → ffmpeg depth mp4 → `LTXAddVideoICLoRAGuide`. **Any rig upgrade keeps rendering
  into this exact contract; the diffusion side never changes.**

## 4. Design

### 4.1 Blocking v7 schema (single source of truth)

One JSON doc per shot, project-relative:
`<project>/docs/blocking/<shot>/blocking.json` (Velorn layout wins; legacy roots die
with the legacy service).

```jsonc
{
  "schema_version": 7,
  "coordinate_frame": "blender_enu_meters",   // X east, Y north, Z up; yaw 0°=+Y, clockwise
  "fps": 25,
  "camera": {
    "position": {"x_m": 0, "y_m": -2, "z_m": 1.55},
    "facing_deg": 0, "pitch_deg": -4, "roll_deg": 0, "fov_deg": 40.95,
    "path": [ {"t_s": 0, "position": {...}, "facing_deg": ..., "pitch_deg": ..., "fov_deg": ...} ],
    "cuts": [ {"t_s": 2.0, "camera_id": "CAM_push_in"} ]
  },
  "characters": [
    {
      "cast_id": "stud", "label": "The Stud",
      "position": {"x_m": 0.4, "y_m": 3.5, "z_m": 0},
      "facing_deg": 180, "height_m": 1.85,
      "pose_slug": "idle-guard",            // static pose from pose bank
      "motion_slug": "punch-cross",         // clip from _library/motions
      "bone_overrides": [],                 // optional v7 escape hatch
      "path": [ {"t_s": 0, "position": {...}, "facing_deg": ...} ],
      "ref_set": {"front": "assets/ctt-stud-ref-front.png", "...": "..."}
    }
  ],
  "props": [],
  "environment": {"blend_path": "...", "glb_path": "...", "plate_image": "...", "birds_eye": "..."},
  "export": {                               // written BACK by the Blender bridge
    "exported_at": "...", "blend": "...",
    "samples": [ {"frame": 1, "cast_id": "stud", "screen_x": 0.61, "screen_y": 0.44, "on_screen": true} ]
  }
}
```

Read-compat: the loader accepts v6 plain-dict and schema-1 pydantic dumps and
upgrades in memory; writes are always v7. Screen direction is provable from the
doc via the `export.samples` block.

### 4.2 Shared lexicon→geometry table

`src/config/lexiconGeometry.json` — generated from the canonical
`shot_settings.py:82-113` GEOMETRY table (lens→fov, angle→(pitch,z,roll),
framing→subject distance). Velorn `cameraRig.js` consumes it instead of its
divergent hardcoded copy. Velorn-only ids (`worms-eye`, `top-down`) are added to
the shared table with canonical-style values. `MIN_CAMERA_Z_M = 0.6` everywhere
(ground-plane edge-on trap).

### 4.3 Blender bridge — `render_apply.py`

Headless, generic, no hardcoded shots. Lives in
`~/creative/_library/blender-bridge/` (shared across projects), invoked:

```
blender -b <kit.blend> --python render_apply.py -- \
  --blocking <blocking.json> --shot <shot_slug> --out <control_root> \
  [--qa] [--export-samples]
```

Responsibilities:
1. Parse v7 (accept v6/schema-1 via upgrader).
2. **Create** stand-ins that don't exist (armature + BOD/STK primitives from the
   build_rig pattern), or re-drive existing `RIG_<cast_id>` objects.
3. Bake camera(s) from the doc using `bridge_common.cam_quat` / `rig_rz_from_enu`
   (round-trip-tested math — do not reinvent). Path keys at `f0 + round(t_s*fps)`,
   linear interpolation.
4. Render the same passes into the same contract:
   `<out>/<shot>/<CAM>/{green,pose,depth}/f%04d.png` (Eevee; depth via compositor
   MapRange 0.5–60 m, near=white).
5. `--export-samples`: per frame, per character, write
   `world_to_camera_view` screen-x/y/on_screen back into blocking.json `export.samples`.

Velorn's "Generate from blocking" action calls this bridge via the
`blocking:render` Electron-main spawn (§6); the ComfyUI conditioning pipeline
downstream is unchanged.

### 4.4 Phase 2 — rigged stand-ins + motion retarget (not in this phase)

- Import Mesh2Motion human GLB as canonical stand-in mesh (capsules stay as QA option).
- `motion_slug` → retarget clip from `_library/motions/catalog.json` onto the
  armature via NLA. Rest-pose validation render required before production use —
  this is the riskiest piece (Mesh2Motion vs COCO armature rest poses differ).
- Green pass: bone-parented billboards textured with the character's ref_set
  front/¾ image → real identity signal instead of flat green capsules.
- Pose pass stays OpenPose-hue sticks.

### 4.5 Phase 3 — 2D representation upgrade (Velorn)

Port the legacy three.js dual-pane (top-down + ortho side, `blocking.html:182-200`,
including the documented ENU→three conversion `(x,y,z)_enu → (x,z,−y)_three`,
`rotation.y = −θ`) into Velorn as a studio panel:

- Camera **frustum cone** from fov/pitch (not a dot).
- Characters as facing arrows scaled by `height_m` (not uniform dots).
- Environment footprint from GLB bounds / plate underlay.
- Time-scrubbed path playback sharing one clock with video (`sample_path` lerp).
- Overlay `export.samples` screen-space markers so Blake sees where each
  character actually lands in frame.

### 4.6 Phase 4 — gates + tests (done)

- Full G0–G6 gate table from the legacy director docs, ported as the pure
  service `src/services/blockingGates.js` (verdict `{gate, status: pass|fail|skip,
  reasons, details}`; `evaluateGates(doc, opts)` → all seven + `ready` = no fail):
  - G0 env flat: footprint finite (2D → z-flat by construction), explicit env
    tilt ≤ 1.5°; **skip** when the doc carries no environment data.
  - G1 blocking exists: `validateBlockingDoc` clean (warnings allowed).
  - G2 map underlay: `environment.footprint` ≥ 3 finite points; **skip** when absent.
  - G3 character plant: |z_m| ≤ `plantToleranceM` (default 0.05 — seating on
    furniture is an explicit opt-in via the parameter), facing in [0, 360).
  - G4 t_s scrub: max path t_s ≤ `duration_s`/`playback.duration_s` × 1.15
    (draft tolerance; overrun fails, shorter paths clamp); **skip** without timing.
  - G5 control (finals): green/pose/depth frame-locked 1:1 over an **injected
    dir listing** (the service never touches the fs; node-test-safe). **skip**
    without a listing.
  - G6 identity: every `ref_set.front` under an approved cast-ref root
    (`approvedRoots` + `baseDir` args, `..`-safe) and existing on disk
    (injected `fileExists`); characters without refs **skip** per character —
    the gate fails on refs OUTSIDE the root (invented/unvetted faces).
- Panel surfacing: `BlockingPanel.jsx` renders a compact G0..G6 pill strip
  (pass=green / fail=red / skip=grey, first reason in the tooltip), recomputed
  per doc change. G5 shows **skip — "evaluated at generation time"** because
  the control dir only exists after a bridge render; this avoids a new
  Electron IPC channel (the existing `fs:listDirectory` bridge stays unused
  for now — see §6).
- Round-trip test: `npm run test:blocking-roundtrip` →
  `scripts/blocking_roundtrip.sh` (blender `-b`, headless; **skips cleanly
  when blender/bridge are absent** so app CI doesn't hard-fail):
  `tests/fixtures/blocking_roundtrip.json` (2 characters, one 2-keyframe path,
  one `ref_set.front` → generated `tests/fixtures/ref_front_stud.png`,
  footprint) → bridge `render_apply.py --export-samples` into a tmp dir →
  `scripts/blocking_roundtrip_verify_blend.py` diffs the applied camera
  against the fixture per frame within the bridge's documented tolerances
  (position 1 mm, angles 0.5°) → `scripts/blocking_roundtrip_verify.mjs`
  asserts G5 frame-lock via the gate service, `export.samples` sanity (every
  character, on_screen, x/y ∈ [0,1]), and a ready gate table. Unit tests:
  `npm run test:blocking-gates` (17 tests).

## 5. Phasing & status

| Phase | Deliverable | Status |
|---|---|---|
| 0 | `lexiconGeometry.json`, cameraRig unification, v7 schema + upgrader | **done** (2026-08-19; `src/config/lexiconGeometry.json`, `src/services/blockingV7.js`, cameraRig/blockingStore rewired, 11/11 new tests + 24/24 productionStore tests pass) |
| 1 | `render_apply.py` bridge + round-trip test | **done** (2026-08-19; `~/creative/_library/blender-bridge/`, clean-rebuild round-trip verified: camera within 0.5°, rig positions within 1 mm, 27 control PNGs, 18 export samples) |
| 2 | Mesh stand-ins, motion retarget, identity billboards | **done** (2026-08-19; `bridge_motion.py` + `bridge_billboards.py` in the shared bridge — clip retarget from `_library/motions` GLB onto the 17-bone rig (NLA `ACT_<slug>`), Mannequin mesh stand-ins in green/depth, camera-facing `BB_*` ref_set billboards in green only; run_test + run_motion_test + run_billboard_test all pass, frames visually verified) |
| 3 | Velorn 2D/3D blocking panel | **done** (2026-08-19; `src/services/blockingScene.js` (ENU→three, `samplePath` port, frustum rays, footprint normalize), three.js 0.160.1 dual-pane `BlockingPanel.jsx` — top-down + side ortho, frustum cone from fov/pitch, facing arrows × height_m, drag camera/characters, view-only wheel zoom, time scrub with path lerp, `export.samples` frame readout, optional `environment.footprint` underlay; 24/24 blocking tests pass) |
| 4 | Gate completion, CI round-trip | **done** (2026-08-19; `src/services/blockingGates.js` G0–G6 pure gate service, gate pill strip in `BlockingPanel.jsx` (G5 skip "evaluated at generation time"), `scripts/blocking_roundtrip.sh` headless CI round-trip — 17/17 gate tests, bridge apply → 27 control PNGs frame-locked 1:1, 18 export samples all on-screen, camera round-trip within 1 mm / 0.5°) |

## 6. Open questions

- ~~Bridge invocation: Electron-main spawn vs tiny localhost service~~ —
  **resolved (2026-08-19)**: Electron-main spawn. `blocking:render` IPC
  (electron/main.js) runs two headless spawns, mirroring
  scripts/blocking_roundtrip.sh: `electron/blockingGenScene.py` builds the
  base scene (ENV ground + mis-posed CAM_canonical) into
  `docs/blocking/<slug>/_bridge/`, then the bridge's render_apply produces
  the control passes and writes export.samples back. cwd is the PROJECT ROOT
  so `ref_set.front` resolves project-relative — the same semantics G6
  enforces. Renderer flow lives in src/services/blockingRender.js (save →
  gates → bridge → reload → G5 re-check) and is wired into the BlockingPanel
  "Generate from blocking" button. Bridge dir: `$VELORN_BLENDER_BRIDGE` or
  `~/creative/_library/blender-bridge`; Blender: `$BLENDER` or PATH.
- ~~Does the legacy `cdx-video-director` MCP keep its blocking tools until
  Phase 3, or do we freeze it read-only now?~~ — **resolved (2026-08-19)**:
  frozen. Its AGENTS.md carries a FROZEN banner over the whole blocking lane
  (v6 docs, three.js blocking UI, `studio_blocking_*` tools,
  `generate-from-blocking` route); cast lock, keyframes, and ComfyUI
  orchestration stay live.
- ~~Root motion from `*_RM` clip variants~~ — **resolved (2026-08-19)**: the
  bridge strips authored root travel (vendor `root` bone location channel)
  to in-place at bake time — `bake_retarget` for the COCO rig,
  `bake_rm_inplace` for mesh stand-ins — recording `act["root_travel_m"]`
  and logging `ROOTMOTION … stripped X m`. Doc `path` remains the only
  travel source. New slug `roll` (Roll_RM) exercises it;
  `test/run_rm_test.sh` verifies the character stays planted ≤0.6 m while
  the roll survives. A bake-found bug worth remembering: `Object.copy()`
  inherits the source pose, so any unkeyed channel freezes at the copied
  value — the stand-in bake keys root+pelvis location and resets the pose
  first.
- ~~Vendor clips for the two missing slugs~~ — **resolved (2026-08-19)**:
  the GLB never shipped `Fighting Idle` / `Idle Listening`. Remapped in
  `meta.yaml` + `catalog.json`: `fighting-idle → Idle_Sword`,
  `idle-listening → Idle_FoldArms` (attentive/guard idles; preview assets
  still show the intended clips until regenerated).
- ~~Multi-camera cuts in one shot~~ — **resolved (2026-08-19)**: one bridge
  invocation renders every camera. `camera.cuts[]` entries are full camera
  specs (normalized + validated in blockingV7: unique non-empty camera_id,
  z-floor, fov range, path order). render_apply bakes each cut onto its OWN
  camera object (the old `CAM_canonical` fallback would have clobbered the
  primary), renders each into its own `<out>/<shot>/<CAM>` dir (control
  contract unchanged), retargets identity billboards per camera, and tags
  export.samples rows with `camera_id`. G5 goes multi: `evalG5Multi` checks
  every doc camera's dir — a missing cam dir after a render is a FAIL, never
  a skip. The panel gains a cam pill selector (switching swaps rig inputs,
  frustum, and the sample readout; edits land on the selected cut). Covered
  by test/run_cuts_test.sh (bridge), cuts cases in the v7/gates/render node
  suites, and the panel e2e (seeded CAM_close, both dirs frame-locked).
- ~~Visual screenshot check of the new panel~~ — **resolved (2026-08-19)**:
  `npm run test:blocking-panel-e2e` (scripts/blocking_panel_e2e.mjs, xvfb +
  playwright-core driving the packaged Electron app with its own
  `VELORN_MCP_PORT` and a throwaway `--user-data-dir`). Seeds a project,
  opens it by clicking the picker row, opens the card's Blocking panel,
  asserts the gate strip + dual three.js canvases, edits camera x_m and
  verifies the save lands in blocking.json, then runs "Generate from
  blocking" end-to-end and asserts the bridge's green/pose/depth frame lock
  and export.samples write-back. Screenshots (incl. element-level canvas
  captures) land in tests/out/blocking-panel-e2e/. Two real bugs were found
  and fixed by this harness: `upgradeBlockingDoc` dropped `duration_s`
  (G4 silently degraded to skip, bridge renders ignored shot length), and
  characters were invisible in the top-down pane (sub-pixel cylinder from
  directly above) — they now get a flat ground disc + facing wedge.
- ~~G5 evaluation point~~ — **resolved (Phase 4)**: the gate service evaluates
  G5 from an injected dir listing, so it runs identically in node tests, CI
  (round-trip step 4), and eventually the renderer. The panel reports G5 as
  skip "evaluated at generation time" because the control dir is only known
  once a bridge render lands; if live G5 in the panel is ever wanted, the
  existing `fs:listDirectory` IPC (`window.electronAPI.listDirectory`) is
  sufficient — no new channel needed.
