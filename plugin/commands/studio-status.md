---
description: Report whether CDX Studio, ComfyUI and the MCP server are up, and what project is open.
---

Report the current state of the CDX Studio stack. Check each of these and give a short status
table — do not guess any of them.

1. **MCP server** — `POST http://127.0.0.1:19790/mcp` with
   `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`. No response means the app is closed; say that
   plainly and stop, since everything else depends on it.

2. **Open project** — call the `get_project` tool. Report the project name, current timeline, and
   asset count. `"project": null` means no project is open.

3. **ComfyUI** — `GET http://127.0.0.1:8188/system_stats`. Report the device name from
   `devices[0].name` so it is clear *which* GPU would run a generation, and whether it is local or
   arriving over a tunnel. Unreachable means generation is unavailable — editing still works.

4. **Context readiness** — if a project is open, summarise how many context layers are ready,
   partial or missing, and name the gaps.

Close with one line on what is and is not possible right now, e.g. "editing and export available;
generation unavailable — ComfyUI unreachable".
