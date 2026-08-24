---
description: Check everything that must be true before queueing a CDX Studio generation, without queueing one.
argument-hint: [shot name or card id]
---

Run the pre-generation checklist for **$ARGUMENTS**. This command **never queues a generation** — it
reports whether one would succeed and what it would cost.

Check, in order, and stop at the first hard blocker:

1. **App and MCP** — is CDX Studio open and answering on `127.0.0.1:19790`?

2. **ComfyUI** — reachable on `127.0.0.1:8188`? Report `devices[0].name` from `/system_stats` so it
   is explicit which GPU would do the work. If it is a tunnelled remote GPU, say so.

3. **Project and shot** — is a project open, and does the named shot exist?

4. **Cast gate** — do the characters in the shot have accepted face + body anchors? Unaccepted
   anchors are the most common cause of an off-model result. Name any character that fails.

5. **Context stack** — resolve it and list every gap, in the order the layers apply.

6. **Workflow** — which workflow would run, and does it need a source or reference image that is
   missing?

Then report:

- **verdict** — ready, ready-but-degraded, or blocked;
- **what would run** — workflow, resolution, frame count or duration, seed;
- **what it costs** — GPU time, and whether credits are involved;
- **what to fix first** if blocked.

End by asking whether to proceed. Do not queue anything until the user says yes.
