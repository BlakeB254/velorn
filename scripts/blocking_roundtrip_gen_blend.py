"""blocking_roundtrip.sh helper: generate the minimal base blend for the
round-trip (ground plane in ENV + a deliberately mis-posed CAM_canonical).

Run: blender -b --python scripts/blocking_roundtrip_gen_blend.py -- <out.blend>
"""
import sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
out = argv[0]

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.frame_start = 1
sc.frame_end = 9
sc.render.fps = 25
sc.render.resolution_x = 320
sc.render.resolution_y = 180

# ENV collection + ground plane (gray diffuse — depth/green passes need env geo)
env = bpy.data.collections.new("ENV")
sc.collection.children.link(env)
bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 4, 0))
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

bpy.ops.wm.save_as_mainfile(filepath=out)
print("WROTE", out, flush=True)
