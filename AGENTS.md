# Agent Notes

## Naming

- The product/app is called **CDX Studio**. Do not refer to it as Velorn or ComfyStudio in
  user-facing text, MCP metadata, docs, or chat.
- CDX Studio is a fork of **Velorn**, which was formerly named **ComfyStudio**. That lineage is
  documented in `README.md` and `NOTICE`, and the upstream copyright must stay intact — this project
  is GPL-3.0-only and cannot be relicensed.
- `velorn` and `comfystudio` still appear as package names, protocol and file-extension namespaces
  (`project.comfystudio`), bridge identifiers (`comfystudio_bridge`), wire keys (`velornMeta`,
  `velorn_workflows`, `velornBlitToken`), the MCP `serverInfo.name`, MCP tool names
  (`list_velorn_workflows`), and repository URLs. **Treat these as internal compatibility
  identifiers and do not rename them** — they are shared with the injected ComfyUI Python bridge and
  with existing on-disk projects. Renaming any of them breaks compatibility.
- When rebranding user-facing strings, match `Velorn` only on a word boundary that treats `_` as a
  word character. A naive substitution rewrites identifiers like `buildVelornMeta` and
  `listVelornResources` and breaks the build.

## Working in this codebase

- Read `docs/AI_PROJECT_CONTEXT.md` before substantial implementation work.
- Read `docs/AI_CURRENT_HANDOFF.md` for the current branch, migration, and verification state.
- Read `docs/AI_RELEASE_HANDOFF.md` before commits, tags, releases, or GitHub Actions work.
- CDX Studio is a creator-facing desktop video editor. Preserve simple guided workflows; do not turn
  routine product surfaces into ComfyUI-style node configuration.
- Keep project files portable. Store project-owned media paths relative to the project when possible
  and preserve legacy project compatibility (`project.comfystudio`, and older `project.storyflow`).
- Treat generation and editing as separate layers: editing, captions, and export must not require
  ComfyUI unless the specific feature is explicitly a ComfyUI workflow.
- Agent write actions should inspect first, preview when supported, and use the app's existing
  undo/checkpoint paths.
- Keep changes narrowly scoped and test risky behavior at the renderer, Electron IPC, and
  packaged-platform boundaries it touches.

## Architecture conventions

- Logic belongs in `src/services/` as **pure, Node-testable** functions — no Electron, no `fetch` —
  with a test under `tests/`. UI components stay thin mappings over those services. This is why the
  suite runs under plain `node --test` with no browser.
- State that must reach generation goes through the **context stack**
  (`src/services/contextStack.js`), not through a new bespoke path. Adding a layer there means it
  shows up in the panel, the prompt, and the provenance record at once.
- The ComfyUI connection is **loopback-only by design**
  (`src/services/localComfyConnection.js`). Do not add a remote-host escape hatch; forward the
  remote port onto loopback instead.
- On an unpackaged checkout `isDev = !app.isPackaged`, and the app loads **only** from the Vite dev
  server with no `dist/` fallback. Run `npm run electron:dev`; plain `npm run electron` opens a
  blank window.

## Contributing upstream

Fixes that are not CDX-specific belong in [Velorn](https://github.com/VelornLabs/velorn). Send them
there first — they help everyone, and it keeps this fork's diff small.
