"""blocking:render helper (docs/blocking-v7-plan.md §6) — generate the minimal
base blend for a shot: ground plane in ENV + a deliberately mis-posed
CAM_canonical that render_apply.py must re-drive (never duplicate).

Run: blender -b --python electron/blockingGenScene.py -- <out.blend> \
       [--fps 25] [--start 1] [--end 25] [--width 768] [--height 1344]
"""
import argparse
import sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('out')
ap.add_argument('--fps', type=float, default=25)
ap.add_argument('--start', type=int, default=1)
ap.add_argument('--end', type=int, default=25)
ap.add_argument('--width', type=int, default=768)
ap.add_argument('--height', type=int, default=1344)
args = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.frame_start = args.start
sc.frame_end = args.end
sc.render.fps = int(round(args.fps))  # RenderSettings.fps is int-only
sc.render.resolution_x = args.width
sc.render.resolution_y = args.height
sc.render.resolution_percentage = 100

# ENV collection + ground plane (gray diffuse — depth/green passes need env geo)
env = bpy.data.collections.new("ENV")
sc.collection.children.link(env)
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 4, 0))
plane = bpy.context.view_layer.objects.active
plane.name = "ENV_ground"
mat = bpy.data.materials.new("MAT_ground")
mat.diffuse_color = (0.35, 0.35, 0.35, 1.0)
plane.data.materials.append(mat)
for c in plane.users_collection:
    c.objects.unlink(plane)
env.objects.link(plane)

# pre-existing canonical camera (render_apply must re-drive, not duplicate)
cam_data = bpy.data.cameras.new("CAM_canonical")
cam = bpy.data.objects.new("CAM_canonical", cam_data)
sc.collection.objects.link(cam)
cam.location = (0, -2, 1.55)
cam.rotation_euler = (1.5708, 0, 0)  # wrong on purpose; apply must fix it
sc.camera = cam

bpy.ops.wm.save_as_mainfile(filepath=args.out)
print("WROTE", args.out, flush=True)
