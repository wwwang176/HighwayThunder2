"""
The traffic container truck's trailer: a 40-foot container on a skeletal chassis, built in Blender from boxes (a
container is one; the generated ones came out squashed, about 3 times as long as wide where it is 5).
Concept: docs/art/trailer.

Run (Blender 5.x, headless):
  blender -b --factory-startup -P tools/models/trailer.py -- [--out public/models/trailer.glb] [--preview DIR]

Built in Blender space (X right, Y forward = its front, the kingpin's end; Z up), in metres, the ground at z 0;
then moved down so the origin is the middle of its length, GROUND above the ground (as the cars, carkit.py).

Objects in the GLB (the game finds them by name):
  body                  paint (the container: flat white, the game colours it), trim (frame fittings, dark
                        grey), chassis (near black)
  tail_L / tail_R       the tail lights (also the brake lights) on the rear bumper
  ind_RL / ind_RR       the rear indicators beside them
No wheels: the game's traffic has shared ones (TRAILER axles: 1, 2 and 3 m in from the back; tyres 295/80 R22.5,
twins). Beside it, <out without .glb>/liveries.json: none (the game paints it a colour).
"""

import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import carkit as kit  # noqa: E402

L = 12.5  # the trailer, nose of the chassis to its rear bumper
CL, CW, CH = 12.19, 2.44, 2.59  # the container (40 ft): long, wide, high
DECK = 1.33  # the container's floor above the ground (on the fifth wheel's plate, 1.25, and the beams)
RIB = 0.28  # the corrugation's pitch along the sides (and across the front wall)
DEPTH = 0.035  # how deep
AXLES = (-L / 2 + 1.0, -L / 2 + 2.0, -L / 2 + 3.0)
TYRE_R, TYRE_W = 0.522, 0.295  # 295/80 R22.5
TWINS = (0.77, 1.075)  # the inner and outer tyres' middles from the centreline
LEGS = 3.5  # the landing legs, along it
KINGPIN = L / 2 - 0.6

PAINT, TRIM, CHASSIS = 0, 1, 2


def box(bm, x0, x1, y0, y1, z0, z1, mat):
    """An axis-aligned box (both sides of the centreline if x0 > 0: mirrored)."""
    for a, b in ((x0, x1), (-x1, -x0)) if x0 > 0 else ((x0, x1),):
        made = bmesh.ops.create_cube(bm, size=1.0)["verts"]
        for v in made:
            v.co = Vector((a if v.co.x < 0 else b, y0 if v.co.y < 0 else y1, z0 if v.co.z < 0 else z1))
        for f in {f for v in made for f in v.link_faces}:
            f.material_index = mat


def corrugated(bm, along, a0, a1, across, z0, z1, out, mat):
    """A corrugated wall: its ribs running up, `along` "y" (a side, at x = across, facing `out` = +-1) or "x" (an
    end, at y = across); from a0 to a1, z0 to z1. Each rib: out, down the slope, in, up the slope, a quarter of
    RIB each."""
    n = max(1, round((a1 - a0) / RIB))
    step = (a1 - a0) / (4 * n)
    pts = []
    for i in range(4 * n + 1):
        depth = 0.0 if i % 4 in (0, 1) else -DEPTH  # out, out, in, in (the slopes between)
        pts.append((a0 + i * step, across + out * depth))
    vs = []
    for a, c in pts:
        co = (c, a) if along == "y" else (a, c)
        vs.append((bm.verts.new((*co, z0)), bm.verts.new((*co, z1))))
    facing = Vector((out, 0, 0)) if along == "y" else Vector((0, out, 0))
    for (b0, t0), (b1, t1) in zip(vs, vs[1:]):
        f = bm.faces.new((b0, b1, t1, t0))
        f.normal_update()
        if f.normal.dot(facing) < 0:  # facing out (the game draws the front faces only)
            f.normal_flip()
        f.material_index = mat


def container(bm):
    y0, y1 = -L / 2 + 0.06, -L / 2 + 0.06 + CL  # flush with the back (over the bumper), the front over the plate
    x, z0, z1 = CW / 2, DECK, DECK + CH
    p = 0.11  # the corner posts and rails (the walls' edges, the ribs' ends behind them)
    for s in (-1, 1):
        corrugated(bm, "y", y0 + p, y1 - p, s * (x - 0.01), z0 + p, z1 - p, s, PAINT)
    corrugated(bm, "x", -x + p, x - p, y1 - 0.01, z0 + p, z1 - p, 1, PAINT)
    box(bm, -x + p, x - p, y0, y0 + 0.02, z0 + p, z1 - p, PAINT)  # the doors
    box(bm, -x + p, x - p, y0 + 0.02, y1 - 0.02, z1 - 0.03, z1, PAINT)  # the roof
    box(bm, -x, x, y0, y1, z0, z0 + p, PAINT)  # the bottom rails and floor
    box(bm, -x, x, y0, y1, z1 - p, z1 - 0.02, PAINT)  # the top rails
    for ya, yb in ((y0, y0 + p), (y1 - p, y1)):
        box(bm, x - p, x, ya, yb, z0, z1, PAINT)  # the corner posts
        for za, zb in ((z0, z0 + 0.12), (z1 - 0.12, z1)):
            box(bm, x - 0.17, x + 0.005, ya - 0.005 if ya == y0 else yb - 0.17, ya + 0.17 if ya == y0 else yb + 0.005,
                za, zb, TRIM)  # the corner castings
    # The doors: the line down their middle, four locking bars, the handles' brackets.
    box(bm, -0.01, 0.01, y0 - 0.006, y0, z0 + p, z1 - p, TRIM)
    for xb in (0.18, 0.62):
        box(bm, xb, xb + 0.04, y0 - 0.05, y0, z0 + 0.15, z1 - 0.15, TRIM)
        box(bm, xb - 0.03, xb + 0.07, y0 - 0.06, y0, z0 + 0.95, z0 + 1.05, TRIM)


def chassis(bm):
    zb0, zb1 = 0.95, DECK  # the main beams
    box(bm, 0.42, 0.58, -L / 2, L / 2, zb0, zb1, CHASSIS)
    box(bm, -1.2, 1.2, L / 2 - 2.3, L / 2, 1.22, DECK, CHASSIS)  # the plate over the fifth wheel (the kingpin under it)
    box(bm, -0.05, 0.05, KINGPIN - 0.05, KINGPIN + 0.05, 1.1, 1.22, CHASSIS)
    for y in [-L / 2 + 0.3 + 1.45 * i for i in range(8)]:  # the cross members
        box(bm, -1.2, 1.2, y, y + 0.1, 1.2, DECK, CHASSIS)
    # The rear bumper (an underride bar on two posts), its lights on it.
    box(bm, -1.2, 1.2, -L / 2, -L / 2 + 0.14, 0.42, 0.62, CHASSIS)
    box(bm, 0.45, 0.55, -L / 2 + 0.02, -L / 2 + 0.12, 0.62, zb0, CHASSIS)
    # The side guards from the legs to the wheels.
    box(bm, 1.12, 1.2, AXLES[2] + TYRE_R + 0.15, LEGS - 0.2, 0.62, 0.74, CHASSIS)
    for y in (AXLES[2] + TYRE_R + 0.25, 0.0, LEGS - 0.3):
        box(bm, 1.12, 1.2, y, y + 0.07, 0.74, 1.2, CHASSIS)
    # The axles' mudguards, over all three; the axles' beams and hangers.
    box(bm, 0.6, 1.24, AXLES[0] - TYRE_R - 0.08, AXLES[2] + TYRE_R + 0.08, 1.12, 1.16, CHASSIS)
    for y in AXLES:
        box(bm, -1.0, 1.0, y - 0.06, y + 0.06, TYRE_R - 0.06, TYRE_R + 0.06, CHASSIS)
        box(bm, 0.45, 0.55, y - 0.05, y + 0.05, TYRE_R, zb0, CHASSIS)
    # The landing legs (lowered), their feet and the brace between them.
    box(bm, 0.8, 0.92, LEGS - 0.06, LEGS + 0.06, 0.1, zb0, CHASSIS)
    box(bm, 0.74, 0.98, LEGS - 0.14, LEGS + 0.14, 0.0, 0.1, CHASSIS)
    box(bm, -0.86, 0.86, LEGS - 0.03, LEGS + 0.03, 0.45, 0.53, CHASSIS)


def lamp(name, x0, x1, z0, z1, mat):
    """A plate on the rear bumper's back face (a few mm off it)."""
    y = -L / 2 - kit.LIFT
    verts = [(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)]
    return kit.mesh_object(name, verts, [(0, 3, 2, 1)], [mat])


def preview(out_dir, objs):
    """The trailer in three colours from the front and the back, and square from the side, wheels on."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.view_settings.view_transform = "Standard"
    scene.world = bpy.data.worlds.new("w")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.07, 0.07, 0.075, 1)
    for name, energy, loc, rot, size in (("key", 1600, (9, 8, 12), (0.6, 0.4, 2.4), 10), ("fill", 600, (-10, -6, 8), (0.9, -0.6, -1.0), 12),
                                         ("top", 900, (0, 0, 14), (0, 0, 0), 14)):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy, ld.size = energy, size
        lo = bpy.data.objects.new(name, ld)
        lo.location, lo.rotation_euler = loc, rot
        scene.collection.objects.link(lo)
    tyre = kit.material("tyre", kit.srgb(0x141414), 0.9)
    rim = kit.material("rim", kit.srgb(0x9A9EA4), 0.4, 0.5)
    for y in AXLES:
        for s in (-1, 1):
            for xm in TWINS:
                bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=TYRE_R, depth=TYRE_W, location=(s * xm, y, TYRE_R - kit.GROUND),
                                                    rotation=(0, math.pi / 2, 0))
                bpy.context.active_object.data.materials.append(tyre)
            bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.3, depth=0.02, location=(s * (TWINS[1] + TYRE_W / 2), y, TYRE_R - kit.GROUND),
                                                rotation=(0, math.pi / 2, 0))
            bpy.context.active_object.data.materials.append(rim)
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, -kit.GROUND))
    bpy.context.active_object.data.materials.append(kit.material("floor", (0.12, 0.12, 0.13), 0.9))
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    target = Vector((0, 0, 1.4 - kit.GROUND))
    paint = objs[0].data.materials["paint"].node_tree.nodes["Principled BSDF"].inputs["Base Color"]
    for colour, view, pos in ((0xB8352A, "front34", (-11, 15, 6)), (0x1F5FA8, "rear34", (-12, -14, 7)),
                              (0x2F7D4A, "front34", (-11, 15, 6)), (0x6B6B6B, "side", (-26, 0, 1.6))):
        paint.default_value = (*kit.srgb(colour), 1)
        cam.location = pos
        cam.rotation_euler = (target - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
        cam.data.lens = 50
        scene.render.filepath = os.path.join(os.path.abspath(out_dir), f"trailer-{colour:06x}-{view}.png")
        bpy.ops.render.render(write_still=True)


def run():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[argv.index("--out") + 1] if "--out" in argv else "public/models/trailer.glb"
    prev = argv[argv.index("--preview") + 1] if "--preview" in argv else None
    bpy.ops.wm.read_factory_settings(use_empty=True)
    kit.make_materials()
    me = bpy.data.meshes.new("body")
    for m in (kit.material("paint", (1, 1, 1), 0.6), kit.material("trim", kit.srgb(0x3A3A3C), 0.6, 0.3),
              kit.material("chassis", kit.srgb(0x161617), 0.8)):
        me.materials.append(m)
    bm = bmesh.new()
    container(bm)
    chassis(bm)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    body = bpy.data.objects.new("body", me)
    bpy.context.collection.objects.link(body)
    lamps = []
    for side, s in (("L", -1), ("R", 1)):
        lamps.append(lamp(f"tail_{side}", *sorted((s * 0.72, s * 1.0)), 0.45, 0.59, "tail"))
        lamps.append(lamp(f"ind_R{side}", *sorted((s * 1.02, s * 1.16)), 0.45, 0.59, "ind"))
    for o in [body, *lamps]:
        o.data.transform(Matrix.Translation((0, 0, -kit.GROUND)))
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    print(f"[trailer] body: {tris} triangles; {L} m long, the container {CL} x {CW} x {CH} m from {DECK} m up")

    if prev:
        os.makedirs(prev, exist_ok=True)
        preview(prev, [body, *lamps])
        body.data.materials["paint"].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (1, 1, 1, 1)
    folder = os.path.splitext(os.path.abspath(out))[0]
    os.makedirs(folder, exist_ok=True)
    for f in os.listdir(folder):
        os.remove(os.path.join(folder, f))
    with open(os.path.join(folder, "liveries.json"), "w") as f:
        json.dump([], f)
        f.write("\n")
    bpy.ops.object.select_all(action="DESELECT")
    for o in [body, *lamps]:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(out), export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_materials="EXPORT")
    print(f"[trailer] wrote {out}")


if __name__ == "__main__":
    run()
