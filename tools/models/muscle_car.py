"""
Muscle car model (concept: docs/art/muscle-car/), built in Blender from code.

Run (Blender 5.x, headless):
  blender -b --factory-startup -P tools/models/muscle_car.py -- --out public/models/muscle-car.glb [--preview DIR]

Builds in Blender space (X right, Y forward = nose, Z up, ground at z = 0), then
moves everything down so the origin is the centre of the game's physics box
(1.86 x 1.1 x 4.4: ground at -0.55). Exported Y-up, so the nose points to -Z in
three.js like every other car in the game.

Objects in the GLB (the game finds them by name):
  body                        paint, stripe, glass, trim, chrome
  head_L / head_R             headlamps (two round lamps per side)
  tail_L / tail_R             tail light bar halves (also the brake lights)
  ind_FL ind_FR ind_RL ind_RR indicators
  wheel                       one wheel at the origin, axle along X, rim face +X (outer side on the right)
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

GROUND = 0.55  # the physics box is 1.1 tall, centred on the origin
WHEEL_R = 0.34
WHEEL_W = 0.30
WHEEL_X = 0.80
WHEEL_Y = 1.30
WHEEL_Z = 0.34  # centre height above the ground at rest


# ---------------------------------------------------------------- materials

def material(name, rgb, rough=0.5, metal=0.0, emit=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)  # what Workbench shows
    m.roughness = rough
    m.metallic = metal
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*rgb, 1)
        bsdf.inputs["Emission Strength"].default_value = emit
    return m


def srgb(hex_):
    c = [((hex_ >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


MAT = {}


def make_materials():
    MAT["paint"] = material("paint", srgb(0xF2780C), 0.3, 0.3)
    MAT["stripe"] = material("stripe", srgb(0x141414), 0.4, 0.2)
    MAT["glass"] = material("glass", srgb(0x1A2028), 0.1, 0.6)
    MAT["trim"] = material("trim", srgb(0x1C1C1C), 0.7)
    MAT["chrome"] = material("chrome", srgb(0x9A9A9A), 0.3, 0.8)
    MAT["head"] = material("lamp_head", srgb(0xFFF6E0), 0.2, 0, 4)
    MAT["tail"] = material("lamp_tail", srgb(0xD01010), 0.2, 0, 2)
    MAT["ind"] = material("lamp_ind", srgb(0xFF9A10), 0.2, 0, 2)
    MAT["tyre"] = material("tyre", srgb(0x151515), 0.9)
    MAT["rim"] = material("rim", srgb(0x2A2A2C), 0.35, 0.7)


# ---------------------------------------------------------------- helpers

def mesh_object(name, verts, faces, mats, face_mats=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    for m in mats:
        me.materials.append(MAT[m])
    if face_mats:
        for poly, i in zip(me.polygons, face_mats):
            poly.material_index = i
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return ob


def box(name, x0, x1, y0, y1, z0, z1, mat):
    v = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    f = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return mesh_object(name, v, f, [mat])


def wedge(name, x0, x1, y0, y1, z0, zlow, zhigh, mat, front_mat=None):
    """A ramp: bottom at z0, top rising from zlow at y0 to zhigh at y1 (the tall face at y1)."""
    v = [
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, zlow), (x1, y0, zlow), (x1, y1, zhigh), (x0, y1, zhigh),
    ]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (3, 0, 4, 7), (2, 3, 7, 6)]
    mats = [mat] + ([front_mat] if front_mat else [])
    fm = [0, 0, 0, 0, 0, 1 if front_mat else 0]
    return mesh_object(name, v, f, mats, fm)


def disc(name, x, y, z, r, depth, mat, n=14):
    """A round lamp facing +Y (y is its front face) or -Y when depth < 0."""
    v = []
    for yy in (y - depth, y):
        for i in range(n):
            a = 2 * math.pi * i / n
            v.append((x + r * math.cos(a), yy, z + r * math.sin(a)))
    f = [tuple(range(n)), tuple(range(n, 2 * n))]
    f += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return mesh_object(name, v, f, [mat])


def lerp_keys(keys, y):
    """Piecewise smooth interpolation over keyframes [(y, {param: value})]."""
    if y <= keys[0][0]:
        return dict(keys[0][1])
    for (ya, a), (yb, b) in zip(keys, keys[1:]):
        if y <= yb:
            t = (y - ya) / (yb - ya)
            t = t * t * (3 - 2 * t)
            return {k: a[k] + (b[k] - a[k]) * t for k in a}
    return dict(keys[-1][1])


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


# ---------------------------------------------------------------- the body

# Body length runs from TAIL to NOSE (bumpers stick out a little further).
NOSE = 2.14
TAIL = -2.16

# Side profile and plan: half-width w, bottom zb, hood / deck edge height ztop, crown over the middle.
BODY_KEYS = [
    (TAIL, dict(w=0.86, zb=0.30, ztop=0.93, crown=0.02)),
    (-2.05, dict(w=0.90, zb=0.24, ztop=0.95, crown=0.02)),
    (-1.75, dict(w=0.935, zb=0.21, ztop=0.955, crown=0.02)),
    (-1.30, dict(w=0.955, zb=0.21, ztop=0.95, crown=0.02)),  # hips over the rear wheels
    (-0.85, dict(w=0.93, zb=0.21, ztop=0.94, crown=0.02)),
    (0.00, dict(w=0.915, zb=0.21, ztop=0.925, crown=0.02)),
    (0.75, dict(w=0.915, zb=0.21, ztop=0.91, crown=0.03)),  # cowl
    (1.00, dict(w=0.93, zb=0.21, ztop=0.90, crown=0.065)),  # hood power bulge
    (1.30, dict(w=0.945, zb=0.21, ztop=0.885, crown=0.065)),  # front wheel flare
    (1.75, dict(w=0.93, zb=0.22, ztop=0.86, crown=0.05)),
    (2.00, dict(w=0.91, zb=0.24, ztop=0.835, crown=0.02)),
    (NOSE, dict(w=0.88, zb=0.27, ztop=0.80, crown=0.01)),
]

# Stripe edges (x) across the top: paint | stripe | gap | stripe | paint.
S_IN = 0.07
S_OUT = 0.31


def body_loop(p):
    """Closed cross-section, starting at the top centre and going round the right side first."""
    w, zb, zt, cr = p["w"], p["zb"], p["ztop"], p["crown"]
    top = lambda x: zt + cr * (1 - (x / w) ** 2)  # noqa: E731
    right = [
        (S_IN, top(S_IN)),
        (S_OUT, top(S_OUT)),
        (w - 0.09, zt + 0.004),
        (w, zt - 0.07),  # shoulder
        (w - 0.012, zt - 0.30),  # beltline crease
        (w - 0.045, zb + 0.07),  # tuck under
        (w - 0.11, zb),
    ]
    loop = [(0.0, top(0.0))] + right + [(0.0, zb)] + [(-x, z) for x, z in reversed(right)]
    return loop  # 16 points


# Segment i joins loop[i] and loop[i + 1]; these are the stripe segments (both sides).
STRIPE_SEGS = {1, 14}


def build_body():
    ys = []
    y = TAIL
    while y < NOSE - 1e-6:
        ys.append(y)
        y += 0.1
    ys.append(NOSE)
    verts, faces, fm = [], [], []
    n = 16
    for y in ys:
        for x, z in body_loop(lerp_keys(BODY_KEYS, y)):
            verts.append((x, y, z))
    for s in range(len(ys) - 1):
        a, b = s * n, (s + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append((a + i, a + j, b + j, b + i))
            fm.append(1 if i in STRIPE_SEGS else 0)
    faces.append(tuple(reversed(range(n))))  # tail face
    faces.append(tuple(range(len(ys) * n - n, len(ys) * n)))  # nose face
    fm += [0, 0]
    body = mesh_object("shell", verts, faces, ["paint", "stripe", "trim"], fm)

    # Wheel arches: cut from each side, leaving the middle of the car whole.
    for wy in (-WHEEL_Y, WHEEL_Y):
        for side in (-1, 1):
            bpy.ops.mesh.primitive_cylinder_add(
                vertices=20, radius=0.415, depth=0.6, location=(side * 1.05, wy, WHEEL_Z), rotation=(0, math.pi / 2, 0)
            )
            cut = bpy.context.active_object
            cut.data.materials.append(MAT["trim"])
            mod = body.modifiers.new("arch", "BOOLEAN")
            mod.operation = "DIFFERENCE"
            mod.solver = "EXACT"
            mod.material_mode = "TRANSFER"
            mod.object = cut
            bpy.context.view_layer.objects.active = body
            bpy.ops.object.modifier_apply(modifier="arch")
            bpy.data.objects.remove(cut)
    return body


def build_cabin():
    """Greenhouse: windshield, roof (with the stripes), fastback rear glass; open at the bottom."""
    stations = [
        # y, base half-width, base z, roof half-width, roof z, collapsed (a base line)
        (0.66, 0.80, 0.94, None, None),  # on the hood's crown, so the hood does not poke through the glass
        (0.08, 0.80, 0.925, 0.635, 1.305),
        (-0.62, 0.82, 0.94, 0.65, 1.30),
        (-1.55, 0.84, 0.957, None, None),
    ]
    verts = []
    for y, wb, zb, wt, zt in stations:
        if wt is None:
            half = [(0, zb), (S_IN * 0.95, zb), (S_OUT * 0.95, zb), (wb * 0.97, zb), (wb, zb)]
        else:
            top = lambda x: zt + 0.025 * (1 - (x / wt) ** 2)  # noqa: E731
            half = [(0, top(0)), (S_IN, top(S_IN)), (S_OUT, top(S_OUT)), (wt, zt), (wb, zb)]
        # Left base, over the roof, down to the right base (open underneath).
        row = [(-x, z) for x, z in reversed(half[1:])] + half
        verts += [(x, y, z) for x, z in row]
    n = 9
    # Segments across: 0 left side, 1 left outer, 2 left stripe, 3-4 the gap, 5 right stripe, 6 right outer, 7 right side.
    SIDES, STRIPES = (0, 7), (2, 5)
    faces, fm, group = [], [], []
    # materials: 0 paint, 1 stripe, 2 glass. Glass groups (each framed on its own):
    # windshield, rear glass, a side window either side (A-pillar to the roof's end), a quarter window either side.
    for s in range(3):
        a, b = s * n, (s + 1) * n
        for i in range(n - 1):
            faces.append((a + i, a + i + 1, b + i + 1, b + i))
            if i in SIDES:
                fm.append(2)
                group.append(("side" if s < 2 else "quarter") + str(i))
            elif s == 1:
                fm.append(1 if i in STRIPES else 0)
                group.append(None)
            else:
                fm.append(2)
                group.append("windshield" if s == 0 else "rear")
    cabin = mesh_object("cabin", verts, faces, ["paint", "stripe", "glass"], fm)

    # Frame every window: inset each glass region, the rim goes back to paint.
    bm = bmesh.new()
    bm.from_mesh(cabin.data)
    bm.faces.ensure_lookup_table()
    centres = {tuple(round(c, 4) for c in f.calc_center_median()): g for f, g in zip(bm.faces, group)}
    regions = {}
    for f in bm.faces:
        g = centres.get(tuple(round(c, 4) for c in f.calc_center_median()))
        if g:
            regions.setdefault(g, []).append(f)
    for faces_ in regions.values():
        res = bmesh.ops.inset_region(bm, faces=faces_, thickness=0.045, depth=0.0, use_even_offset=True)
        for f in res["faces"]:
            f.material_index = 0
    bm.to_mesh(cabin.data)
    bm.free()
    return cabin


def build_details():
    parts = []
    # Hood scoop: a ramp over the bulge, its open mouth facing forward.
    parts.append(wedge("scoop", -0.21, 0.21, 0.98, 1.52, 0.90, 0.96, 1.025, "paint", "trim"))
    # Ducktail on the rear deck.
    parts.append(wedge("duck", -0.86, 0.86, -1.90, -2.17, 0.90, 0.958, 1.005, "paint"))
    # Front: grille band across the nose, bumper, chin splitter.
    parts.append(box("grille", -0.80, 0.80, NOSE - 0.02, NOSE + 0.012, 0.52, 0.71, "trim"))
    parts.append(box("fbumper", -0.89, 0.89, NOSE - 0.12, NOSE + 0.035, 0.33, 0.49, "paint"))
    parts.append(box("chin", -0.84, 0.84, NOSE - 0.30, NOSE + 0.05, 0.19, 0.23, "trim"))
    # Rear: dark panel round the lights, chrome bumper.
    parts.append(box("rpanel", -0.86, 0.86, TAIL - 0.012, TAIL + 0.02, 0.64, 0.86, "trim"))
    parts.append(box("rbumper", -0.92, 0.92, TAIL - 0.04, TAIL + 0.12, 0.36, 0.49, "chrome"))
    # Mirrors.
    for s in (-1, 1):
        parts.append(box("mirror", s * 0.80, s * 0.97, 0.50, 0.60, 0.91, 0.99, "paint"))
    return parts


def build_lights():
    lamps = []
    y = NOSE + 0.016
    for name, s in (("head_L", -1), ("head_R", 1)):
        l1 = disc(name, s * 0.50, y, 0.615, 0.075, 0.03, "head")
        l2 = disc(name + "b", s * 0.70, y, 0.615, 0.075, 0.03, "head")
        lamps.append(join([l1, l2], name))
    for name, s in (("ind_FL", -1), ("ind_FR", 1)):
        lamps.append(box(name, *sorted((s * 0.62, s * 0.78)), NOSE + 0.04, NOSE + 0.056, 0.38, 0.44, "ind"))
    ty = TAIL - 0.016
    for name, s in (("tail_L", -1), ("tail_R", 1)):
        lamps.append(box(name, *sorted((s * 0.03, s * 0.70)), ty - 0.012, ty, 0.71, 0.79, "tail"))
    for name, s in (("ind_RL", -1), ("ind_RR", 1)):
        lamps.append(box(name, *sorted((s * 0.72, s * 0.83)), ty - 0.012, ty, 0.71, 0.79, "ind"))
    return lamps


def build_wheel():
    """Tyre with a deep dark dish and five spokes; centred on the origin, the dish faces +X."""
    n = 24
    hw = WHEEL_W / 2
    r_in = WHEEL_R * 0.66  # rim lip radius
    verts, faces, fm = [], [], []

    def ring(x, r):
        base = len(verts)
        for i in range(n):
            a = 2 * math.pi * i / n
            verts.append((x, r * math.cos(a), r * math.sin(a)))
        return base

    # Tyre: outer tread, side walls with a rounded shoulder, down to the rim lip.
    rings = [
        ring(hw - 0.02, r_in),
        ring(hw, WHEEL_R * 0.86),
        ring(hw - 0.025, WHEEL_R),
        ring(-hw + 0.025, WHEEL_R),
        ring(-hw, WHEEL_R * 0.86),
        ring(-hw + 0.02, r_in),
        ring(hw - 0.09, r_in * 0.98),  # inside the lip: the dish
        ring(-hw + 0.02, r_in * 0.5),
    ]
    mats = [1, 0, 0, 0, 0]
    for k in range(5):
        a, b = rings[k], rings[k + 1]
        for i in range(n):
            j = (i + 1) % n
            faces.append((a + i, a + j, b + j, b + i))
            fm.append(0 if k in (1, 2, 3) else 0)
    # Dish: from the lip in, then the dish floor.
    a, b = rings[0], rings[6]
    for i in range(n):
        j = (i + 1) % n
        faces.append((a + i, b + i, b + j, a + j))
        fm.append(1)
    faces.append(tuple(rings[6] + i for i in range(n)))
    fm.append(1)
    a, b = rings[5], rings[7]
    for i in range(n):
        j = (i + 1) % n
        faces.append((a + i, b + i, b + j, a + j))
        fm.append(0)
    faces.append(tuple(rings[7] + i for i in reversed(range(n))))
    fm.append(0)
    wheel = mesh_object("wheel", verts, faces, ["tyre", "rim"], fm)

    parts = [wheel]
    hub = disc("hub", 0, 0, 0, 0.05, 0.05, "rim", 10)
    hub.rotation_euler = (0, 0, -math.pi / 2)
    hub.location = (hw - 0.04, 0, 0)
    parts.append(hub)
    for k in range(5):
        sp = box("spoke", hw - 0.10, hw - 0.06, -0.025, 0.025, 0.03, r_in * 0.97, "rim")
        sp.rotation_euler = (2 * math.pi * k / 5, 0, 0)
        parts.append(sp)
    for p in parts:
        bpy.context.view_layer.objects.active = p
        p.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return join(parts, "wheel")


# ---------------------------------------------------------------- preview

def preview(out_dir, export_objs, wheel):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_cavity = True
    scene.display.shading.show_shadows = True
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.world = bpy.data.worlds.new("w") if scene.world is None else scene.world
    scene.world.color = (0.05, 0.05, 0.055)
    scene.render.film_transparent = False

    # Four wheels in place (preview only; the game places its own).
    shown = []
    for x in (-WHEEL_X, WHEEL_X):
        for y in (-WHEEL_Y, WHEEL_Y):
            w = wheel.copy()
            bpy.context.collection.objects.link(w)
            w.location = (x, y, WHEEL_Z - GROUND)
            w.rotation_euler = (0, 0, math.pi if x < 0 else 0)
            shown.append(w)
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, -GROUND))
    floor = bpy.context.active_object
    floor.data.materials.append(material("floor", (0.12, 0.12, 0.13), 0.9))

    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 50
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    target = Vector((0, 0, 0.05 - GROUND + 0.55))
    views = {
        "front34": Vector((5.2, 6.4, 2.6)),
        "side": Vector((10.5, 0, 0.6)),
        "rear34": Vector((-5.2, -6.4, 2.6)),
        "top": Vector((0, 0.01, 11)),
        "front": Vector((0, 9, 0.5)),
    }
    for name, pos in views.items():
        cam.location = pos
        cam.rotation_euler = (target - pos).to_track_quat("-Z", "Y").to_euler()
        cam_data.lens = 35 if name == "top" else 50
        scene.render.filepath = os.path.join(out_dir, f"muscle-{name}.png")
        bpy.ops.render.render(write_still=True)
    for o in shown + [floor, cam]:
        bpy.data.objects.remove(o)


# ---------------------------------------------------------------- main

def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[argv.index("--out") + 1] if "--out" in argv else "public/models/muscle-car.glb"
    prev = argv[argv.index("--preview") + 1] if "--preview" in argv else None

    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()

    body = join([build_body(), build_cabin(), *build_details()], "body")
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(32))
    lamps = build_lights()
    wheel = build_wheel()

    # Down to the physics box centre (ground at -0.55); the wheel stays centred on its axle.
    for o in [body, *lamps]:
        o.data.transform(__import__("mathutils").Matrix.Translation((0, 0, -GROUND)))
        o.data.update()

    tris = sum(len(p.vertices) - 2 for o in [body, *lamps, wheel] for p in o.data.polygons)
    print(f"[muscle_car] triangles: body+lamps {tris - sum(len(p.vertices) - 2 for p in wheel.data.polygons)}, wheel {sum(len(p.vertices) - 2 for p in wheel.data.polygons)}")

    if prev:
        os.makedirs(prev, exist_ok=True)
        preview(prev, [body, *lamps], wheel)

    bpy.ops.object.select_all(action="DESELECT")
    for o in [body, *lamps, wheel]:
        o.select_set(True)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(out),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
    )
    print(f"[muscle_car] wrote {out}")


main()
