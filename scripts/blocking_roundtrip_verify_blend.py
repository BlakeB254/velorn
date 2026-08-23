"""blocking_roundtrip.sh helper: camera round-trip verification, run INSIDE
Blender against the applied blend:

  blender -b applied.blend --python blocking_roundtrip_verify_blend.py -- \
    --blocking <blocking.json> --bridge <blender-bridge dir>

Reads the applied camera (the bridge's export) per frame with
bridge_common.cam_angles_from_matrix and diffs against the fixture's camera
path within the bridge's documented tolerances (position 1 mm, angles 0.5°).
Exits os._exit(0) on PASS, os._exit(1) on FAIL.
"""
import json
import math
import os
import sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
blocking_path = argv[argv.index('--blocking') + 1]
bridge_dir = argv[argv.index('--bridge') + 1]
sys.path.insert(0, bridge_dir)
import bridge_common as bc  # noqa: E402

TOL_DEG = 0.5   # bridge-documented angle tolerance
TOL_M = 1e-3    # bridge-documented position tolerance

failures = []


def check(name, got, want, tol):
    if abs(got - want) > tol:
        failures.append("%s: got %.4f want %.4f (tol %.4f)" % (name, got, want, tol))


def lerp(a, b, u):
    return a + (b - a) * u


def lerp_angle(a, b, u):
    return a + (((b - a + 180) % 360) - 180) * u


def sample(keys, t, fields):
    keys = sorted(keys, key=lambda k: k["t_s"])
    if t <= keys[0]["t_s"]:
        return {f: keys[0][f] for f in fields}
    if t >= keys[-1]["t_s"]:
        return {f: keys[-1][f] for f in fields}
    for i in range(1, len(keys)):
        a, b = keys[i - 1], keys[i]
        if a["t_s"] <= t <= b["t_s"]:
            u = (t - a["t_s"]) / (b["t_s"] - a["t_s"] or 1e-9)
            out = {}
            for f in fields:
                if f in ("facing_deg", "pitch_deg", "roll_deg"):
                    out[f] = lerp_angle(a[f], b[f], u)
                else:
                    out[f] = lerp(a[f], b[f], u)
            return out
    return {f: keys[-1][f] for f in fields}


def flat(key):
    pos = key.get("position") or key
    return {
        "t_s": key["t_s"],
        "x_m": pos["x_m"], "y_m": pos["y_m"], "z_m": pos["z_m"],
        "facing_deg": key["facing_deg"], "pitch_deg": key["pitch_deg"],
        "roll_deg": key.get("roll_deg", 0.0), "fov_deg": key["fov_deg"],
    }


def main():
    with open(blocking_path) as fh:
        doc = json.load(fh)
    sc = bpy.context.scene
    fps = doc.get("fps") or sc.render.fps
    f0, f1 = sc.frame_start, sc.frame_end
    cam_doc = doc["camera"]
    cam = bpy.data.objects.get(cam_doc.get("camera_id") or "CAM_canonical")
    assert cam is not None, "applied camera object missing"

    path = [flat(k) for k in cam_doc.get("path") or []]
    if not path:
        path = [flat({**cam_doc, "t_s": 0.0})]
    fields = ["x_m", "y_m", "z_m", "facing_deg", "pitch_deg", "roll_deg", "fov_deg"]
    for f in range(f0, f1 + 1):
        t = (f - f0) / fps
        want = sample(path, t, fields)
        sc.frame_set(f)
        facing, pitch, roll = bc.cam_angles_from_matrix(cam.matrix_world)
        check("cam.facing f%d" % f, facing, want["facing_deg"] % 360.0, TOL_DEG)
        check("cam.pitch  f%d" % f, pitch, want["pitch_deg"], TOL_DEG)
        check("cam.roll   f%d" % f, roll, want["roll_deg"], TOL_DEG)
        check("cam.fov    f%d" % f, math.degrees(cam.data.angle), want["fov_deg"], TOL_DEG)
        loc = cam.matrix_world.translation
        check("cam.x f%d" % f, loc.x, want["x_m"], TOL_M)
        check("cam.y f%d" % f, loc.y, want["y_m"], TOL_M)
        check("cam.z f%d" % f, loc.z, want["z_m"], TOL_M)

    if failures:
        print("CAMERA ROUNDTRIP FAIL (%d):" % len(failures), flush=True)
        for x in failures:
            print("  " + x, flush=True)
        os._exit(1)
    print("CAMERA ROUNDTRIP PASS (position 1mm, angles 0.5deg)", flush=True)
    os._exit(0)


main()
