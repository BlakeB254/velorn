# CDX Studio plugin

Everything an AI agent needs to drive [CDX Studio](../README.md) without rediscovering how the app
works: the live MCP server, the models that govern generation, and the safety discipline that keeps
an agent from wrecking someone's project.

## Install

```
/plugin marketplace add /path/to/cdx-studio
/plugin install cdx-studio
```

Or point the marketplace at the repository once it is hosted:

```
/plugin marketplace add BlakeB254/cdx-studio
/plugin install cdx-studio
```

## What's inside

### MCP server (`.mcp.json`)

`cdx-studio` → `http://127.0.0.1:19790/mcp`

Started automatically whenever the CDX Studio app is open, exposing ~178 tools across the project,
timeline, assets, storyboard, production, generation queue, captions and export. If the app is
closed, the server does not exist — the tools will simply be unavailable, which is the correct
signal.

The server identifies itself as `velorn` upstream. That is deliberate compatibility surface, not a
misconfiguration.

### Skills

| Skill | Covers |
|---|---|
| `cdx-studio-mcp` | The tool surface, how to find the right tool among ~178, and the preview-before-apply discipline. |
| `cdx-studio-context-stack` | The layered context model that feeds every generation, how to read a `partial` layer, and generation provenance. |
| `cdx-studio-production-types` | The 14 current production types (plus one legacy alias) with their pacing, aspect and flows, and how to pick one. |
| `cdx-studio-references` | Character anchor cascades, location landmarks, prop hero shots, kimodo movement clips — and diagnosing a blocked shot. |
| `cdx-studio-remote-gpu` | Running the UI on one machine and ComfyUI on another, given the loopback-only rule. |

### Commands

| Command | Does |
|---|---|
| `/studio-status` | Is the app up, is ComfyUI reachable, which GPU, what project is open. |
| `/studio-context` | The resolved context stack for a shot or the project, and what is blocking it. |
| `/studio-preflight` | Everything that must be true before a generation, without queueing one. |

All three are read-only.

### Agent

`cdx-studio-operator` — for multi-step production work that spans many MCP calls and needs the
safety discipline held consistently: storyboard building, cast and location setup, running a shot
through to an accepted take, assembling and exporting a cut.

## The short version

If you read nothing else:

1. **Preview before you apply.** These tools mutate a real project someone is working in.
2. **Never queue a generation without approval.** It costs GPU time and possibly credits.
3. **Resolve the context stack before generating.** An unaccepted character anchor produces an
   off-model shot every single time.
4. **Never overwrite a cut.** They are the review checkpoints.
5. **Report what actually happened**, including failures.

## License

GPL-3.0-only, the same as CDX Studio and its upstream, Velorn.
