---
description: Show the resolved context stack for the open project or a named shot, and what is blocking generation.
argument-hint: [shot name or card id]
---

Resolve and explain the CDX Studio context stack for **$ARGUMENTS** (the whole project if no shot is
named).

Read the `cdx-studio-context-stack` skill for the model, then:

1. Resolve the stack for the target. Use the MCP surface to read the project's references,
   production block and the shot, rather than reading files directly where a tool exists.

2. Present the layers **in the order they apply** — franchise → brand → style → production type →
   location → character → wardrobe → prop → movement → blocking — with each layer's status and what
   it actually contributes. Skip `inactive` layers unless the user asks for everything.

3. Call out the gaps explicitly. For each one, say what a person has to do to clear it — usually
   "accept the face and body anchors on <character>" or "no reference card exists for <name>".

4. State whether the target is ready to generate. If it is not, say what will be degraded if
   generation runs anyway, and let the user decide rather than refusing outright.

Do not queue any generation from this command. It is read-only.
