---
name: cdx-studio-context-stack
description: The layered creative-context model that feeds every CDX Studio generation — franchise, brand, style, production type, location, character, wardrobe, prop, movement, blocking. Use before generating a shot, when a generation comes back off-model or off-brand, when asked what context a clip was made with, or when reasoning about why a shot is blocked.
tools: Read, Grep, Bash
---

# The context stack

A generated shot is the product of many layers of context. CDX Studio resolves all of them in one
place — `src/services/contextStack.js` — so you can see the whole set before spending a GPU on it.

```
franchise → brand → style → production type → location
          → character → wardrobe → prop → movement → blocking
```

The order is outermost identity to innermost action. Franchise rules outrank the look; the look
outranks the shot.

## What each layer contributes

| Layer | Contributes |
|---|---|
| **franchise** | The universe's invariants — "Trio identities locked", "Photoreal 9:16". These are durable rules and belong in every prompt made under that franchise. |
| **brand** | For ad work: the org and the offerings being sold, plus brand voice when available. This is why a commercial names its own product. |
| **style** | The style pack. Inherited from the franchise when the production doesn't set one. |
| **production type** | Pace, aspect, output target, hook timing. See `cdx-studio-production-types`. |
| **location** | The accepted wide plate as a reference image, plus labelled landmarks in meters. |
| **character** | Body description line, and the accepted face + full-body anchors as reference images. |
| **wardrobe** | The active variant. Its own layer because swapping it changes the shot without touching the identity lock. |
| **prop** | The accepted hero shot. |
| **movement** | The action line, and the kimodo motion clip bound to a character. |
| **blocking** | The 3D arena — character positions and camera. |

## Reading a resolved stack

Every layer reports a status:

- **`ready`** — contributing fully.
- **`partial`** — present but incomplete. *This is the one that bites.* A `partial` character means
  its anchors were never accepted, so generation falls back to whatever it can find and the shot
  comes back off-model.
- **`missing`** — the shot names something that has no reference card at all.
- **`inactive`** — not used by this shot. Contributes nothing, blocks nothing.

`gaps` explains, per layer, exactly why it is not ready. `ready: true` on the stack means no gaps.

## Use it before you generate

When asked to generate a shot, resolve the stack first and report what is missing. "Mara has no
accepted anchor pair" is a useful thing to say *before* burning a GPU minute, not after.

If the user wants to proceed anyway, that is their call — say what will be degraded and continue.

## Provenance: what made this clip?

Every storyboard generation is stamped with a `contextProvenance` record — a stable `signature`
plus the layer ids and statuses — carried in the generation's metadata. When asked "why does this
shot look wrong" or "what fed this clip", that record answers it even long after the reference cards
have moved on.

The signature is a deterministic hash of the active layers. Same context, same signature; add or
change a layer and it moves.

## What the stack does *not* control

Reference-image selection. The stack's asset list is ordered by layer, which puts the location plate
before the character anchors — feeding that straight into `referenceImage1/2` would silently reorder
identity references and degrade output. The character anchor pair remains the authority there.

So: the stack drives the *prompt* and the provenance record. It does not pick the identity refs.
