<div align="center">

# CDX Studio

**An AI video workstation where every layer of creative context is explicit, inspectable, and feeds generation.**

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue)](LICENSE)
[![Based on Velorn](https://img.shields.io/badge/based%20on-Velorn-6C63FF)](https://github.com/VelornLabs/velorn)
[![Platforms](https://img.shields.io/badge/Platforms-Linux%20%C2%B7%20macOS%20%C2%B7%20Windows-444444)](#running-it)

</div>

CDX Studio is a desktop video editor and AI production environment. It is a customized fork of
[**Velorn**](https://github.com/VelornLabs/velorn), which was itself formerly named **ComfyStudio**.

It keeps everything Velorn does well — a real timeline, project-based media management, captions,
effects, export, and a large MCP surface for agents — and adds a **context stack**: an explicit model
of every layer of creative context that feeds a generation, so a shot is never generated with half
its context silently missing.

---

## Credit and lineage

This project stands on other people's work, and the chain is worth stating plainly:

| Stage | Name | Notes |
|---|---|---|
| Original | **ComfyStudio** | The project's original name. Still visible throughout this codebase as the `comfystudio` namespace — the `project.comfystudio` project file, the `comfystudio_bridge` ComfyUI extension, and the `comfystudio-*` browser events. |
| Upstream | **[Velorn](https://github.com/VelornLabs/velorn)** | ComfyStudio renamed. Everything in `src/`, `electron/`, the MCP server, the timeline, the export pipeline and the generation stack originates here. Copyright © Velorn contributors. |
| This fork | **CDX Studio** | A customized downstream build. See [What this fork adds](#what-this-fork-adds). |

An even earlier `project.storyflow` file name is still honored when opening old projects, so the
lineage runs at least four names deep.

**The overwhelming majority of this code was written by the Velorn contributors, not by us.** This
fork exists to serve one production pipeline; it is not a competing product, and upstream Velorn is
where you should start if you want the maintained, supported application. The original Velorn README
is preserved at [`docs/upstream/README.velorn.md`](docs/upstream/README.velorn.md).

### License

CDX Studio is **GPL-3.0-only**, the same license as Velorn, because it must be — GPL-3.0 is a
copyleft license and a derivative work cannot be relicensed. That means:

- the complete corresponding source for anything distributed lives in this repository;
- the upstream copyright and license notices are preserved verbatim in [`LICENSE`](LICENSE);
- modified files carry a change notice, per GPL-3.0 §5 (see [`NOTICE`](NOTICE));
- if you redistribute this, in source or binary form, you inherit the same obligations.

Identifiers that read `velorn` or `comfystudio` in the code — `velornMeta`, `velorn_workflows`,
the MCP `serverInfo.name`, the `comfystudio_bridge` — are **deliberately left alone**. They are wire
protocol shared with the injected ComfyUI Python bridge and with existing project files. Renaming
them would break compatibility and erase provenance, so they stay.

---

## How it works

CDX Studio is an Electron app in two halves, plus whatever GPU you point it at.

```
┌──────────────────────────────────────────────────────────────┐
│  Renderer (React + Vite)                                     │
│    timeline · storyboard · generate · captions · inspector   │
│    reference cards · context stack panel                     │
└───────────────┬──────────────────────────────────────────────┘
                │ Electron IPC (preload.js)
┌───────────────▼──────────────────────────────────────────────┐
│  Main process (Node)                                         │
│    file system · ffmpeg export · ComfyUI launcher            │
│    MCP server  ──────────────────►  127.0.0.1:19790/mcp      │
└───────────────┬──────────────────────────────────────────────┘
                │ HTTP / WebSocket, loopback only
┌───────────────▼──────────────────────────────────────────────┐
│  ComfyUI  127.0.0.1:8188   (the GPU)                         │
└──────────────────────────────────────────────────────────────┘
```

**Editing does not require a GPU.** Timeline editing, captions, export, project management and the
editorial MCP tools all work with no ComfyUI running. Only generation needs it.

### The loopback rule

CDX Studio will only talk to ComfyUI on `127.0.0.1` or `localhost`
(`src/services/localComfyConnection.js`). A remote host is rejected outright. This is inherited from
Velorn and it is a good default — it keeps a creative tool from being pointed at an arbitrary
network endpoint.

It also means **you do not need to patch anything to use a remote GPU** — see
[Running the GPU on another machine](#running-the-gpu-on-another-machine).

### The project model

A project is a folder, not a database. It holds media, a `project.comfystudio` manifest, and the
derived caches. Media paths are stored relative to the project where possible, so a project folder
can be moved or synced between machines and still open.

Versions of a show live *inside* the show as production cuts — never as sibling project folders.

---

## What this fork adds

Everything below is additive; none of it changes Velorn's editing behavior.

### 1. The context stack

Upstream, each layer of creative context reached generation by its own path: franchise and style
through the production block, character anchors and wardrobe through `generationRefs`, landmarks
through blocking. Nothing showed the whole set, so a shot could be generated with half its context
absent and nobody would know.

`src/services/contextStack.js` resolves every layer in the order it applies:

```
franchise → brand → style → production type → location
          → character → wardrobe → prop → movement → blocking
```

For each layer it reports **what it contributes** (prompt lines, reference images, structured data),
whether it is `ready` / `partial` / `missing` / `inactive`, and **why** it is not ready. The
flattened contributions are what generation actually consumes, so the panel and the prompt cannot
disagree.

Two layers that upstream dropped on the floor now reach the prompt: **franchise invariants** (the
durable "never break this" rules of a shared universe) and the **movement action** bound to a
character.

Every generation is stamped with a `contextProvenance` record — a stable signature plus the layer
ids and statuses — so a clip that already exists can still say what produced it.

Reference-image selection is deliberately *not* driven by the stack: the stack's asset list is
ordered by layer (location before character), and feeding that to `referenceImage1/2` would
silently reorder identity references. The character anchor pair remains the authority there.

### 2. Movement references (kimodo.cpp)

A fourth reference kind alongside character / location / prop. A movement binds one named action
("throws a right hook then backpedals") to one character and is realised by a local kimodo.cpp
service as SMPL-X22 motion data.

Movements have no slot grid — their product is motion, not images — so they carry their own
`empty → generating → review → accepted` lifecycle. Regenerating keeps the accepted clip in place so
a character is never left bare mid-flight, and only motion *metadata* is stored in the project;
kimodo's per-frame rotation and root-translation arrays stay on disk behind `out_dir`.

Multi-character beats can be generated as one shared arena via kimodo's `/scene` endpoint rather
than as unrelated single clips.

### 3. Home organization

Projects group by **franchise** (the durable IP universe) and filter by **production type** — show,
movie, skit, commercial, parody, music video, PSA, documentary and more, each carrying its own
pacing, aspect and output target in `src/services/productionTypes.js`, and each mapped to a
production flow.

### 4. Brand context for advertising work

Ad-style productions link an org and the offerings they are selling. Upstream captured this at
project creation and never displayed it again. Here it is a real context layer — a commercial
contributes `Brand: <org>` and `Featured offerings: …` to its own prompts — and a panel shows the
linked org with its offerings refreshed live from the directory service, flagging any that have
drifted out of the catalog.

---

## Running it

```bash
npm install
npm run electron:dev     # vite dev server + electron
```

> **Note:** on an unpackaged checkout, `npm run electron` alone opens a **blank window**.
> `electron/main.js` sets `isDev = !app.isPackaged` and then loads only from the Vite dev server,
> with no `dist/` fallback. Use `electron:dev` for development, or package the app
> (`npm run electron:build:linux`) for a normal desktop launch.

Point CDX Studio at ComfyUI in Settings → ComfyUI Connection (port only; the host is always
loopback).

### Running the GPU on another machine

Because the app only accepts a loopback ComfyUI, the way to use a remote GPU is to *make it
loopback* — forward the remote port onto `127.0.0.1:8188` on the machine running the UI:

```bash
ssh -N -L 127.0.0.1:8188:127.0.0.1:8188 your-gpu-host
```

The app then sees an ordinary local ComfyUI, stays completely stock, and every generation executes
on the remote GPU. The client machine needs no NVIDIA hardware at all.

If the project folder also lives on the GPU host, mount it at the **same absolute path** on both
machines. Path parity matters: the absolute paths recorded in a project resolve identically on both
sides, and output written by ComfyUI on the GPU host appears in the project with no copy step.

---

## For AI systems

CDX Studio is built to be driven by agents, and ships a Claude Code plugin so an agent arrives
already knowing how it works.

**MCP server:** `http://127.0.0.1:19790/mcp`, started automatically with the app — 178 tools covering
the project, timeline, assets, storyboard, production, generation queue, captions and export.

The plugin lives in [`plugin/`](plugin/) and bundles:

- **`.mcp.json`** — the MCP server, pre-wired.
- **Skills** — driving the MCP surface safely, the context stack model, the production-type
  taxonomy, the reference-card cascades, and the remote-GPU topology.
- **Commands** — `/studio-status`, `/studio-context`, `/studio-preflight`.
- **An agent** — `cdx-studio-operator`, for multi-step production work.

Install it from a checkout:

```
/plugin marketplace add /path/to/cdx-studio
/plugin install cdx-studio
```

See [`plugin/README.md`](plugin/README.md) for what each piece does.

### The rules an agent should know

1. **Preview before you apply.** Most write tools accept `previewOnly`. Use it, show the user what
   would change, and only then apply.
2. **Generation is serial and expensive.** It occupies a GPU and may spend credits. Never queue a
   batch without explicit approval.
3. **Check the context stack before generating.** It reports exactly which layers are missing. A
   `partial` character means its anchors were never accepted, and generating anyway produces an
   off-model shot.
4. **Never overwrite a cut blindly.** Cuts are the review checkpoints — list them, check one out,
   save a new one.

`AGENTS.md` carries the working conventions for editing this codebase.

---

## Development

```bash
node --test tests/*.test.js   # the whole suite
npm run build                 # vite production build
```

`package.json` also exposes each suite individually as `test:*` scripts.

The service layer under `src/services/` is deliberately pure and Node-testable — no Electron, no
`fetch` — so the rules can be tested without a browser. UI components stay thin mappings over it.
New logic belongs in a service with a test, not in a component.

---

## Contributing upstream

Fixes that are not CDX-specific belong in [Velorn](https://github.com/VelornLabs/velorn), where they
help everyone. Please send them there first.
