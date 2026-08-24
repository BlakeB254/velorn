// kimodoMotion.js — situational character pose/action generation for CDX Studio.
// Talks to the local kimodo.cpp motion service (kimodo_serve.py, GB10 Vulkan).
// Text prompt -> SMPL-X22 local quaternion rotations + root translation per frame.
// Retarget SMPL-X onto your rig (Mixamo/GLB) downstream; kimodo emits raw SMPL-X.
const KIMODO_URL =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_KIMODO_URL) ||
  'http://127.0.0.1:8094';

export async function kimodoHealth() {
  const r = await fetch(`${KIMODO_URL}/health`);
  if (!r.ok) throw new Error(`kimodo health ${r.status}`);
  return r.json();
}

/**
 * Generate a character motion clip from a natural-language action.
 * @param {string} prompt   e.g. "a fighter throws a right hook then backpedals"
 * @param {object} [opts]   { frames=90, steps=30, seed=42 }
 * @returns {Promise<{frames:number, joints:number, rotations_xyzw:number[][], root_positions:number[][], out_dir:string}>}
 */
export async function generateMotion(prompt, opts = {}) {
  const { frames = 90, steps = 30, seed = 42 } = opts;
  const r = await fetch(`${KIMODO_URL}/motion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, frames, steps, seed }),
  });
  if (!r.ok) throw new Error(`kimodo motion ${r.status}: ${await r.text()}`);
  return r.json();
}

export const KIMODO_MOTION_SERVICE = { url: KIMODO_URL, joints: 22, format: 'SMPL-X22', engine: 'kimodo.cpp' };

/**
 * Compose a multi-character scene (e.g. a fight) — one kimodo motion track per
 * character, each retarget-bound to a character reference and placed in a shared
 * arena coordinate space (root_offset + facing_deg). Runs are serialized on the
 * GB10 Vulkan device; the scene layer stitches them into one payload.
 * @param {Array<{id:string, ref?:string, prompt:string, frames?:number, steps?:number,
 *   seed?:number, root_offset?:[number,number,number], facing_deg?:number}>} characters
 * @param {object} [opts] { frames=90, steps=30 } defaults per character
 * @returns {Promise<{characters:Array, scene_frames:number, count:number}>}
 */
export async function generateScene(characters, opts = {}) {
  const { frames = 90, steps = 30 } = opts;
  const r = await fetch(`${KIMODO_URL}/scene`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frames, steps, characters }),
  });
  if (!r.ok) throw new Error(`kimodo scene ${r.status}: ${await r.text()}`);
  return r.json();
}
