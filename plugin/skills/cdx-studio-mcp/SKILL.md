---
name: cdx-studio-mcp
description: Drive the CDX Studio video workstation over its MCP server (127.0.0.1:19790). Use when asked to inspect or edit a CDX Studio / Velorn project, timeline, assets, storyboard or cuts; to queue a generation; to export; or when a task mentions the studio app, the timeline, shots, or takes. Covers the preview-before-apply discipline and which tool to start from.
tools: Read, Bash, Grep
---

# Driving CDX Studio over MCP

CDX Studio runs an MCP server at `http://127.0.0.1:19790/mcp` whenever the app is open. It exposes
~178 tools across the project, timeline, assets, storyboard, production, generation queue, captions
and export.

The server identifies itself as `velorn` — that is the upstream project name and is deliberate
compatibility surface, not a mistake.

## Before anything else

**Is the app even running?** The MCP server only exists while CDX Studio is open.

```bash
curl -s --max-time 5 -X POST http://127.0.0.1:19790/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 200
```

No response means the app is closed. Say so instead of guessing — do not report work you could not
perform.

Then orient with **`get_project`**. It returns the open project, the current timeline, asset counts,
and MCP snapshot freshness. `"project": null` means no project is open, and almost every other tool
will refuse until one is.

For episodic work start with **`get_production_context`** instead — it returns the bible, the current
episode, the board and the cuts in one call.

## The four rules

### 1. Preview before you apply

Most write tools take `previewOnly`. Run with it, show the user what would change, get approval,
then apply. This is the single most important habit: these tools mutate a real project on disk that
someone is actively working in.

### 2. Generation is serial and expensive

`queue_prompt_generation_batch` and its relatives occupy a GPU and may spend credits. Always preview
first — show prompts, workflow, counts, seeds, resolution and output folder — and queue only after
explicit approval. Never queue a batch to "see what happens".

### 3. Check the context stack before generating

Reference cards gate generation. A character whose anchors were never accepted will produce an
off-model shot. Resolve the context first and report the gaps rather than generating into them —
see the `cdx-studio-context-stack` skill.

### 4. Never overwrite a cut blindly

Cuts are the review checkpoints. `list_cuts` → `checkout_cut` → `save_cut` under a new name.
`promote_cut` is a publishing action; treat it as one.

## Finding the right tool

There are ~178, so do not guess names:

- `get_mcp_recipes` — task-shaped recipes for common jobs.
- `discover_production` / `list_production_catalog` — the production types and their flows.
- `find_timeline_items` — resolve a natural-language reference to clips, tracks, markers or
  transitions *before* trying to target them.

## Common paths

**Inspect an edit** — `get_project` → `get_timeline` → `analyze_timeline`, and
`inspect_visible_shots` for a fast-cut review pass.

**Place generated media** — `import_asset_from_path` → `add_asset_to_timeline` (or
`add_assets_to_timeline` for review lanes) → `save_cut`.

**Titles and graphics** — `add_text_clip` / `add_shape_clip` / `add_adjustment_clip`, all with
`previewOnly` first. End cards and CTAs belong in post, never generated as text inside an image.

**Delivery** — `check_media_health` → `export_timeline`, or `export_fcpxml` for a Resolve / Premiere
/ Final Cut handoff.

## Editing without a GPU

Timeline editing, captions, export, project management and every editorial tool work with no
ComfyUI running. Only generation needs it. If ComfyUI is down, keep working — just do not claim a
generation succeeded.
