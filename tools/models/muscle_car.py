"""
Muscle car model (concept: docs/art/muscle-car/), built in Blender from code.

Run (Blender 5.x, headless):
  blender -b --factory-startup -P tools/models/muscle_car.py -- --out public/models/muscle-car.glb [--preview DIR]

Proportions follow the concept (measured off its side view as fractions of the
length L = 4.4 m): front axle 0.275 L from the nose, rear axle 0.795 L, wheels
0.13 L across, roof from 0.41 L to 0.70 L, rear glass meeting the deck at 0.80 L,
beltline 0.19 L high. Not the game's present physics (wheelbase 2.6 m, wheel
radius 0.34): that is to be changed to suit the car when it goes into the game.

Builds in Blender space (X right, Y forward = nose, Z up, ground at z = 0), then
moves the body down so the origin is GROUND above the ground. Exported Y-up, so
the nose points to -Z in three.js like every other car in the game.

One watertight body: the shell, the greenhouse and the details are merged by
exact boolean union, the grille, intake and tail-light panel are cut in as
recesses; nothing lies inside or on anything else. The script prints the checks.

Objects in the GLB (the game finds them by name):
  body                        paint, stripe, glass, trim, lens
  head_L / head_R             headlamps (two round lamps per side, in pods)
  tail_L / tail_R             the tail light bar's halves (also the brake lights)
  ind_FL ind_FR ind_RL ind_RR indicators (glowing plates, hidden while off)
  wheel                       one wheel at the origin, axle along X, rim face +X (outer side on the right)
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

GROUND = 0.55  # the origin's height above the ground (the game's physics box centre)
L = 4.4
NOSE = L / 2
TAIL = -L / 2
WHEEL_R = 0.30
WHEEL_W = 0.40
WHEEL_X = 0.86  # the tyres' outer faces flush with the fender bulges
WHEEL_YF = NOSE - 0.275 * L  # 0.99
WHEEL_YR = NOSE - 0.795 * L  # -1.30
WHEEL_Z = WHEEL_R  # centre height above the ground
ARCH_R = 0.325  # hugging the tyre


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
    MAT["stripe"] = material("stripe", srgb(0x141414), 0.6)
    MAT["glass"] = material("glass", srgb(0x161A20), 0.3, 0.2)
    MAT["trim"] = material("trim", srgb(0x1C1C1C), 0.7)
    MAT["head"] = material("lamp_head", srgb(0xFFD890), 0.2, 0, 1.6)  # warm (the game swaps in its own glow)
    MAT["tail"] = material("lamp_tail", srgb(0xE00808), 0.2, 0, 3)
    MAT["ind"] = material("lamp_ind", srgb(0xFF9A10), 0.2, 0, 2)
    MAT["lens"] = material("lens", srgb(0xFFE8C0), 0.25, 0.1, 1.2)  # fog lamps, always on (indicators blink over them)
    MAT["tyre"] = material("tyre", srgb(0x0B0B0B), 0.95)
    MAT["rim"] = material("rim", srgb(0x1E1E22), 0.4, 0.6)
    MAT["spoke"] = material("spoke", srgb(0x4A4A52), 0.35, 0.8)  # gunmetal, standing out of the dark dish


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


BOX_FACES = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]


def box(name, x0, x1, y0, y1, z0, z1, mat, shear=None):
    """An axis-aligned box; `shear(y, z) -> y` leans it (the nose's lean)."""
    v = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    if shear:
        v = [(x, shear(y, z), z) for x, y, z in v]
    return mesh_object(name, v, BOX_FACES, [mat])


def disc(name, x, y, z, r, depth, mat, n=16, shear=None):
    """A round lamp (a short cylinder along Y), its front face at y."""
    v = []
    for yy in (y - depth, y):
        for i in range(n):
            a = 2 * math.pi * i / n
            v.append((x + r * math.cos(a), yy, z + r * math.sin(a)))
    if shear:
        v = [(x_, shear(y_, z_), z_) for x_, y_, z_ in v]
    f = [tuple(range(n)), tuple(range(n, 2 * n))]
    f += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return mesh_object(name, v, f, [mat])


def arc_solid(name, x0, x1, yc, zc, ri, ro, a0, a1, n, mat, ro1=None):
    """A slab bent round an axle along X: between radii ri and ro, from angle a0 to a1 (degrees, 0 = +Y,
    90 = up). With ro1 its outer radius shrinks to ro1 at x1: a chamfer."""
    verts, faces = [], []
    for k in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * k / n)
        c, s = math.cos(a), math.sin(a)
        for x, r in ((x0, ri), (x0, ro), (x1, ro if ro1 is None else ro1), (x1, ri)):
            verts.append((x, yc + r * c, zc + r * s))
    for k in range(n):
        a, b = 4 * k, 4 * (k + 1)
        faces += [(a + i, a + (i + 1) % 4, b + (i + 1) % 4, b + i) for i in range(4)]
    faces += [(0, 1, 2, 3), (4 * n + 3, 4 * n + 2, 4 * n + 1, 4 * n)]
    return mesh_object(name, verts, faces, [mat])


def lerp_keys(keys, y):
    """Piecewise smooth interpolation over keyframes [(y, {param: value})]; a missing value is 0."""
    if y <= keys[0][0]:
        return dict(keys[0][1])
    for (ya, a), (yb, b) in zip(keys, keys[1:]):
        if y <= yb:
            t = (y - ya) / (yb - ya)
            t = t * t * (3 - 2 * t)
            return {k: a.get(k, 0) + (b.get(k, 0) - a.get(k, 0)) * t for k in a.keys() | b.keys()}
    return dict(keys[-1][1])


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = ob.data.name = name
    return ob


def boolean(target, others, op):
    """Exact boolean of each of `others` into `target` (removing them); new faces take the other's material."""
    for p in others:
        mod = target.modifiers.new("b", "BOOLEAN")
        mod.operation = op
        mod.solver = "EXACT"
        mod.material_mode = "TRANSFER"
        mod.object = p
        bpy.context.view_layer.objects.active = target
        bpy.ops.object.modifier_apply(modifier="b")
        bpy.data.objects.remove(p)
    return target


def union(target, parts):
    return boolean(target, parts, "UNION")


def cut(target, cutters):
    return boolean(target, cutters, "DIFFERENCE")


# ---------------------------------------------------------------- the body shell

# Side profile and plan, keyed along the car: half-width w (at the fender crest), flare f (how far the
# side swells out below it, over the wheels), bottom zb, hood / deck height ztop, crown over the middle,
# pk the fender crests standing up either side of the hood.
# dome: the hood's power bulge down the middle (the stripes run over it).
BODY_KEYS = [
    (TAIL, dict(w=0.74, f=0.0, zb=0.31, ztop=1.005, crown=0.01)),  # the ducktail's lip; the tail tapers in
    (-2.10, dict(w=0.84, f=0.03, zb=0.25, ztop=0.99, crown=0.015)),
    (-1.95, dict(w=0.90, f=0.07, zb=0.205, ztop=0.955, crown=0.02)),  # the deck, kicking up into the ducktail
    (-1.65, dict(w=0.93, f=0.10, zb=0.19, ztop=0.95, crown=0.02)),
    (WHEEL_YR, dict(w=0.94, f=0.12, zb=0.19, ztop=0.95, crown=0.02)),  # the haunches, much wider than the cabin
    (-0.95, dict(w=0.925, f=0.07, zb=0.19, ztop=0.935, crown=0.02)),
    (-0.50, dict(w=0.90, f=0.0, zb=0.19, ztop=0.865, crown=0.02)),  # the beltline climbs to the haunches
    (0.20, dict(w=0.885, f=0.0, zb=0.19, ztop=0.845, crown=0.02)),  # the waist, pinched in at the door; sills low
    (0.70, dict(w=0.905, f=0.03, zb=0.19, ztop=0.85, crown=0.01, pk=0.04, dome=0.015)),  # cowl
    (WHEEL_YF, dict(w=0.92, f=0.11, zb=0.19, ztop=0.845, crown=0.01, pk=0.08, dome=0.04)),  # front fenders over the wheels
    (1.55, dict(w=0.915, f=0.06, zb=0.20, ztop=0.835, crown=0.01, pk=0.08, dome=0.04)),
    (1.95, dict(w=0.90, f=0.0, zb=0.25, ztop=0.815, crown=0.01, pk=0.06, dome=0.03)),
    (NOSE, dict(w=0.86, f=0.0, zb=0.28, ztop=0.80, crown=0.01, pk=0.05, dome=0.025)),  # the hood's shape carried to one clean leading edge
]
NOSE_TOP = 0.80
LEAN = 0.40  # the shark nose: the nose face leans forward 0.40 m per metre up (the lower nose tucks back)


def nose_shear(y, z):
    """Lean the nose's last stretch forward at the top (applied to the shell and to what sits on the nose).
    Nothing above NOSE_TOP moves: the hood's leading edge stays one straight line."""
    k = max(0.0, min(1.0, (y - (NOSE - 0.24)) / 0.24))
    return y - k * LEAN * max(0.0, NOSE_TOP - z)


# Stripe edges (x) across the top: paint | stripe | gap | stripe | paint.
S_IN = 0.07
S_OUT = 0.31


def body_half(p):
    """One side of a cross-section, from the top centre out and down: [(x, z, material of the segment to the next)]."""
    w, f, zb, zt, cr, pk, dome = p["w"], p["f"], p["zb"], p["ztop"], p["crown"], p.get("pk", 0), p.get("dome", 0)
    # The hood: a gentle crown, a smooth dome down the middle (no edge to it), rising again to the crests.
    top = lambda x: zt + cr * (1 - (x / w) ** 2) + dome * (math.cos(math.pi * min(x, 0.4) / 0.8) ** 2)  # noqa: E731
    crest = w - 0.13
    gutter = (S_OUT + crest) / 2
    return [
        (S_IN, top(S_IN), "stripe"),
        ((S_IN + S_OUT) / 2, top((S_IN + S_OUT) / 2), "stripe"),
        (S_OUT, top(S_OUT), "paint"),
        ((S_OUT + gutter) / 2, top((S_OUT + gutter) / 2), "paint"),
        (gutter, top(gutter), "paint"),  # where the hood meets the fender
        ((gutter + crest) / 2, top((gutter + crest) / 2) + pk * 0.3, "paint"),
        (crest, zt + 0.004 + pk, "paint"),  # the fender's crest
        (w - 0.06, zt - 0.006 + pk * 0.7, "paint"),
        (w + 0.025 + f * 0.35, zt - 0.05, "paint"),  # the shoulder line: one crisp crease along the car
        (w + 0.002 + f * 0.35, zt - 0.08, "paint"),  # stepping in under it
        (w + f * 0.8, zt - 0.15, "paint"),
        (w + f, zt - 0.26, "paint"),  # the widest, round the top of the wheel
        (w - 0.01 + f * 0.85, zt - 0.38, "paint"),
        (w - 0.035 + f * 0.6, zb + 0.10, "paint"),  # tucking in to a slim dark sill
        (w - 0.07 + f * 0.4, zb + 0.025, "trim"),
        (w - 0.12 + f * 0.3, zb, "trim"),
    ]


def top_centre(p):
    return p["ztop"] + p["crown"] + p.get("dome", 0)


def body_loop(p):
    """The whole cross-section: points and the material of each segment (point i to i + 1, closing round)."""
    half = body_half(p)
    zb = p["zb"]
    pts = [(0.0, top_centre(p))] + [(x, z) for x, z, _ in half] + [(0.0, zb)] + [(-x, z) for x, z, _ in reversed(half)]
    # Right: centre -> S_IN paint, then each point's own; across the bottom trim; the left side mirrored.
    mats = ["paint"] + [m for _, _, m in half[:-1]] + ["trim", "trim"] + [m for _, _, m in reversed(half[:-1])] + ["paint"]
    return pts, mats


def body_top_z(y, x):
    """The height of the body's top at (y, x), along the top of the cross-section (for seating the greenhouse)."""
    p = lerp_keys(BODY_KEYS, y)
    chain = [(0.0, top_centre(p))] + [(px, pz) for px, pz, _ in body_half(p)[:9]]  # out to the shoulder crease
    x = abs(x)
    for (xa, za), (xb, zb_) in zip(chain, chain[1:]):
        if x <= xb:
            return za + (zb_ - za) * (x - xa) / (xb - xa)
    return chain[-1][1]


def build_shell():
    ys, y = [], TAIL
    while y < NOSE - 1e-6:
        ys.append(y)
        y += 0.08
    ys.append(NOSE)
    names = ["paint", "stripe", "trim"]
    verts, faces, fm = [], [], []
    n = None
    for y in ys:
        pts, mats = body_loop(lerp_keys(BODY_KEYS, y))
        n = len(pts)
        # The nose also bows forward a little in plan (2.5 cm at the middle), over the lamps.
        k = max(0.0, min(1.0, (y - (NOSE - 0.24)) / 0.24))
        verts += [(x, nose_shear(y, z) + k * 0.025 * max(0.0, 1 - (x / 0.86) ** 2), z) for x, z in pts]
    for s in range(len(ys) - 1):
        a, b = s * n, (s + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append((a + i, a + j, b + j, b + i))
            fm.append(names.index(mats[i]))
    faces.append(tuple(reversed(range(n))))  # tail face
    faces.append(tuple(range(len(ys) * n - n, len(ys) * n)))  # nose face
    fm += [0, 0]
    shell = mesh_object("shell", verts, faces, names, fm)
    # The nose and tail faces are big concave polygons: triangulate them properly (polyfill) now,
    # rather than leave it to the booleans, whose quick triangulation of a concave face can overlap.
    bm = bmesh.new()
    bm.from_mesh(shell.data)
    caps = [f for f in bm.faces if len(f.verts) > 4]
    bmesh.ops.triangulate(bm, faces=caps, quad_method="BEAUTY", ngon_method="EAR_CLIP")
    bm.to_mesh(shell.data)
    bm.free()

    # A lip round each arch, sloping out of the fender's bulge (the arch cut below trims its inside).
    lips = []
    for wy in (WHEEL_YR, WHEEL_YF):
        p = lerp_keys(BODY_KEYS, wy)
        out = p["w"] + p["f"] + 0.035
        for side in (-1, 1):
            lips.append(arc_solid("lip", side * 0.80, side * out, wy, WHEEL_Z, 0.28, 0.45, -10, 190, 22, "paint", ARCH_R + 0.04))
    union(shell, lips)

    # Wheel arches, cut in from each side (the middle of the car stays whole); dark inside.
    arches = []
    for wy in (WHEEL_YR, WHEEL_YF):
        for side in (-1, 1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=ARCH_R, depth=0.7, location=(side * 1.1, wy, WHEEL_Z), rotation=(0, math.pi / 2, 0))
            c = bpy.context.active_object
            c.data.materials.append(MAT["trim"])
            arches.append(c)
    return cut(shell, arches)


# ---------------------------------------------------------------- the greenhouse

CABIN_FLOOR = 0.72  # the greenhouse is a closed solid reaching down into the body (merged into it)
RG = 0.53  # the rear glass's half-width: sail panels either side of it
WT_REF = 0.60


def build_cabin():
    """Windshield, a domed roof with the stripes, side windows leaning in, a fastback rear glass between
    thick C-pillars down to the deck. A closed solid, merged into the body."""
    stations = [
        # y, belt half-width, roof half-width, roof height at its edge (none: a base line on the hood / deck),
        # and what the band from here to the next station is
        (NOSE - 0.33 * L, 0.84, None, None, "windshield"),  # windshield base
        (0.45, 0.84, 0.575, 1.235, "roof"),  # the header, rounding the roof down into the windshield
        (NOSE - 0.41 * L, 0.84, 0.61, 1.285, "roof"),  # roof front
        (-0.25, 0.85, 0.64, 1.295, "roof"),
        (NOSE - 0.70 * L + 0.04, 0.90, 0.625, 1.272, "cpillar"),  # roof rear
        (NOSE - 0.70 * L - 0.05, 0.91, 0.61, 1.248, "rear"),  # rounding over into the rear glass
        (NOSE - 0.84 * L, 0.93, None, None, None),  # the rear glass, long and shallow, meets the deck; the C-pillars run out onto the haunches
    ]
    DOME = 0.06
    verts = []
    for y, wb, wt, zt, _ in stations:
        if wt is None:  # on the body: spread across like the roof, out to the belt
            xs = [0, S_IN, S_OUT, RG, WT_REF - 0.03, WT_REF, wb]
            half = [(x, body_top_z(y, x) - 0.004) for x in xs]
        else:
            top = lambda x: zt + DOME * (1 - (x / wt) ** 2)  # noqa: E731
            half = [(0, top(0)), (S_IN, top(S_IN)), (S_OUT, top(S_OUT)), (RG, top(RG)),
                    (wt - 0.03, zt - 0.006), (wt, zt - 0.03), (wb, body_top_z(y, wb) - 0.004)]
        row = [(-x, z) for x, z in reversed(half[1:])] + half  # left belt, over the roof, to the right belt
        row += [(-wb * 0.9, CABIN_FLOOR), (wb * 0.9, CABIN_FLOOR)]
        verts += [(x, y, z) for x, z in row]
    n = 15
    # Top segments across (12): 0 left side window band, 1 left roof roll, 2 left sail, 3 left outer,
    # 4 left stripe, 5-6 centre, 7 right stripe, 8 right outer, 9 right sail, 10 right roll, 11 right side band.
    faces, fm, group = [], [], []
    bands = len(stations) - 1
    for s in range(bands):
        a, b = s * n, (s + 1) * n
        kind = stations[s][4]
        for i in range(12):
            faces.append((a + i, a + i + 1, b + i + 1, b + i))
            side = i in (0, 11)
            if kind == "windshield":  # between the A-pillars, the side windows reaching forward to them
                fm.append(2)
                group.append(f"side{i}" if side else "windshield")
            elif kind in ("roof", "cpillar"):  # the roof with its stripes; side windows, then the C-pillars
                glass = side and kind == "roof"
                fm.append(2 if glass else (1 if i in (4, 7) else 0))
                group.append(f"side{i}" if glass else None)
            else:  # rear: glass between the sails; the C-pillars are body
                glass = 3 <= i <= 8
                fm.append(2 if glass else 0)
                group.append("rear" if glass else None)
        # Walls down into the body and the floor (hidden once merged).
        faces += [(a + 12, a + 14, b + 14, b + 12), (a + 14, a + 13, b + 13, b + 14), (a + 13, a, b, b + 13)]
        fm += [0, 0, 0]
        group += [None, None, None]
    last = bands * n
    faces += [tuple(range(13)) + (14, 13), tuple(last + i for i in (13, 14, *range(12, -1, -1)))]
    fm += [0, 0]
    group += [None, None]
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
        res = bmesh.ops.inset_region(bm, faces=faces_, thickness=0.022, depth=0.0, use_even_offset=True)
        for f in res["faces"]:
            f.material_index = 0

    # Round the glass's corners: bevel each corner of a window's outline; the corner piece goes to the frame.
    def is_edge(e):
        mats = {f.material_index == 2 for f in e.link_faces}
        return len(mats) == 2
    corners = []
    for v in bm.verts:
        edges = [e for e in v.link_edges if is_edge(e)]
        if len(edges) != 2:
            continue
        d1 = (edges[0].other_vert(v).co - v.co).normalized()
        d2 = (edges[1].other_vert(v).co - v.co).normalized()
        if d1.dot(d2) > -0.9:  # turning more than ~25 degrees
            corners.append(v)
    res = bmesh.ops.bevel(bm, geom=corners, offset=0.045, offset_type="OFFSET", segments=4, profile=0.5,
                          affect="VERTICES", clamp_overlap=True)
    for f in res["faces"]:
        f.material_index = 0
    bm.to_mesh(cabin.data)
    bm.free()
    return cabin


# ---------------------------------------------------------------- details

def build_scoop():
    """A scoop rising out of the hood, narrower on top, its dark mouth facing forward."""
    y0, y1 = 0.80, 1.62
    zb = 0.82  # under the hood's surface
    zr = body_top_z(y0, 0) + 0.002  # its back starts at the hood surface: it grows out of it
    zf = body_top_z(y1, 0) + 0.11
    v = [(-0.32, y0, zb), (0.32, y0, zb), (0.32, y1, zb), (-0.32, y1, zb),
         (-0.18, y0, zr), (0.18, y0, zr), (0.22, y1, zf), (-0.22, y1, zf)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (3, 0, 4, 7), (2, 3, 7, 6)]
    return mesh_object("scoop", v, f, ["paint", "trim"], [0, 0, 0, 0, 0, 1])


def build_details():
    """Solids merged into the body: the scoop and the splitter sweeping forward under the nose."""
    # The splitter: a lip sweeping forward under the nose, thinning to its edge.
    sv = [(x, y, z) for x in (-0.82, 0.82) for y, z in ((NOSE - 0.45, 0.21), (NOSE - 0.45, 0.34), (NOSE - 0.02, 0.225), (NOSE - 0.02, 0.25))]
    splitter = mesh_object("splitter", sv, [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)], ["paint"])
    # The ducktail: the deck's lip kicking up and jutting out past the tail panel.
    return [build_scoop(), splitter, build_ducktail()]


def build_ducktail():
    """The ducktail lip: growing out of the deck at y -1.85 and sweeping up in a curve to its edge 9 cm
    behind the tail, narrowing with the tail, its top corners rounded."""
    y0, y1 = -1.85, TAIL - 0.09
    za = body_top_z(y0, 0.8) - 0.004  # its front edge just under the deck
    ze = 1.045
    n = 8
    verts, faces = [], []
    for k in range(n + 1):
        t = k / n
        y = y0 + (y1 - y0) * t
        hw = 0.80 - 0.10 * t
        zt = za + (ze - za) * t ** 1.8  # concave: flat out of the deck, then kicking up
        zb = 0.90 + (ze - 0.04 - 0.90) * t  # inside the body until it leaves the tail
        verts += [(-hw, y, zb), (hw, y, zb), (hw, y, zt - 0.015), (hw - 0.035, y, zt), (-hw + 0.035, y, zt), (-hw, y, zt - 0.015)]
    m = 6
    for k in range(n):
        a, b = k * m, (k + 1) * m
        faces += [(a + i, a + (i + 1) % m, b + (i + 1) % m, b + i) for i in range(m)]
    faces += [tuple(range(m)), tuple(n * m + i for i in reversed(range(m)))]
    return mesh_object("ducktail", verts, faces, ["paint"])


def build_recesses():
    """Cut into the body: the grille (lamps in pods inside it), the lower intake, the tail-light panel."""
    lean = lambda y, z: y - LEAN * (NOSE_TOP - z)  # noqa: E731  (the nose face's lean)
    grille = box("grille", -0.775, 0.775, NOSE - 0.045, NOSE + 0.3, 0.53, 0.75, "trim", lean)  # clear of the nose's sides
    intake = box("intake", -0.70, 0.70, NOSE - 0.04, NOSE + 0.3, 0.385, 0.435, "trim", lean)  # a thin slit
    tail = box("tailpanel", -0.68, 0.68, TAIL - 0.3, TAIL + 0.035, 0.68, 0.92, "trim")
    valance = box("valance", -0.55, 0.55, TAIL - 0.3, TAIL + 0.03, 0.38, 0.50, "trim")  # a dark diffuser low on the tail
    return [grille, intake, tail, valance]


def build_inserts():
    """Merged into the recesses once they are cut: a bar across the grille, fins in the tail's diffuser.
    Each stands up from its recess's floor and stops short of the surface."""
    lean = lambda y, z: y - LEAN * (NOSE_TOP - z)  # noqa: E731
    parts = [box("grillebar", -0.29, 0.29, NOSE - 0.055, NOSE - 0.02, 0.624, 0.656, "spoke", lean)]  # a heavy bar, tucked in
    for x in (-0.34, -0.12, 0.12, 0.34):
        parts.append(box("fin", x - 0.01, x + 0.01, TAIL + 0.008, TAIL + 0.04, 0.385, 0.495, "trim"))
    return parts


def build_lights():
    """Separate objects (the game switches them). Head and tail lamps sit each in its own socket
    (`sockets`, to be cut out of the body: 2 mm wider all round and deeper, so lamp and body never
    touch). An indicator is hidden while off, so its glass is part of the body (`lenses`, merged in)
    and the indicator a glowing plate floating 2 mm in front of it."""
    lamps, sockets, lenses = [], [], []
    G = 0.002
    lean = lambda y, z: y - LEAN * (NOSE_TOP - z)  # noqa: E731

    # Headlamps: big round lamps deep in pods in the grille's floor (NOSE - 0.045, leaning), a dark ring round each.
    floor = NOSE - 0.045
    for name, s in (("head_L", -1), ("head_R", 1)):
        parts = []
        for k, x in enumerate((s * 0.42, s * 0.668)):
            # Standing 3 cm up from the grille's floor: in plain sight, 1.5 cm inside the opening.
            parts.append(disc(f"{name}{k}", x, floor + 0.03, 0.638, 0.092, 0.04, "head", 20, lean))
            sockets.append(disc(f"{name}{k}_socket", x, floor + 0.06, 0.638, 0.092 + 0.014, 0.10, "trim", 20, lean))
        lamps.append(join(parts, name))

    # Front indicators / fog lamps at the intake's ends (its floor at NOSE - 0.04, leaning).
    floor = NOSE - 0.04
    for name, s in (("ind_FL", -1), ("ind_FR", 1)):
        x0, x1 = sorted((s * 0.52, s * 0.66))
        lenses.append(box(name + "_lens", x0, x1, floor - 0.01, floor + 0.012, 0.392, 0.428, "lens", lean))
        lamps.append(box(name, x0, x1, floor + 0.014, floor + 0.017, 0.392, 0.428, "ind", lean))

    # Tail light bar across the tail panel (its floor at TAIL + 0.035), indicators blinking over its ends.
    # Four segments a side, dark ribs between them.
    floor = TAIL + 0.035
    seg = (0.64 - 0.004 - 3 * 0.014) / 4
    for name, s in (("tail_L", -1), ("tail_R", 1)):
        parts = []
        for k in range(4):
            x0, x1 = sorted((s * (0.004 + k * (seg + 0.014)), s * (0.004 + k * (seg + 0.014) + seg)))
            parts.append(box(f"{name}{k}", x0, x1, floor - 0.015, floor + 0.025, 0.72, 0.86, "tail"))
            sockets.append(box(f"{name}{k}_socket", x0 - G, x1 + G, floor - 0.03, floor + 0.04, 0.72 - G, 0.86 + G, "trim"))
        lamps.append(join(parts, name))
    for name, s in (("ind_RL", -1), ("ind_RR", 1)):  # over the outermost segment
        x0, x1 = sorted((s * (0.64 - seg), s * 0.64))
        lamps.append(box(name, x0, x1, floor - 0.020, floor - 0.017, 0.72, 0.86, "ind"))
    return lamps, sockets, lenses


# ---------------------------------------------------------------- the wheel

def build_wheel():
    """Wide tyre with a tall dark wall, a deep dark dish and five spokes; centred on the origin, the dish faces +X."""
    n = 28
    hw = WHEEL_W / 2
    r_in = WHEEL_R * 0.60  # rim lip radius
    verts, faces, fm = [], [], []

    def ring(x, r):
        base = len(verts)
        for i in range(n):
            a = 2 * math.pi * i / n
            verts.append((x, r * math.cos(a), r * math.sin(a)))
        return base

    rings = [
        ring(hw - 0.02, r_in),  # 0 rim lip, outer side
        ring(hw, WHEEL_R * 0.88),  # 1 sidewall
        ring(hw - 0.015, WHEEL_R),  # 2 a square shoulder
        ring(-hw + 0.015, WHEEL_R),  # 3
        ring(-hw, WHEEL_R * 0.88),  # 4
        ring(-hw + 0.02, r_in),  # 5 rim lip, inner side
        ring(hw - 0.15, r_in * 0.98),  # 6 the dish's floor, deep
        ring(-hw + 0.02, r_in * 0.5),  # 7 back
    ]
    for k in range(5):
        a, b = rings[k], rings[k + 1]
        for i in range(n):
            j = (i + 1) % n
            faces.append((a + i, a + j, b + j, b + i))
            fm.append(0)
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

    parts = []
    hub = disc("hub", 0, 0, 0, 0.05, 0.08, "spoke", 10)  # its back sunk into the dish floor
    hub.rotation_euler = (0, 0, -math.pi / 2)
    hub.location = (hw - 0.085, 0, 0)
    parts.append(hub)
    for k in range(5):  # bold spokes standing up out of the dish
        sp = box("spoke", hw - 0.17, hw - 0.095, -0.038, 0.038, 0.03, r_in * 0.96, "spoke")
        sp.rotation_euler = (2 * math.pi * k / 5, 0, 0)
        parts.append(sp)
    for p in parts:
        bpy.ops.object.select_all(action="DESELECT")
        bpy.context.view_layer.objects.active = p
        p.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return union(wheel, parts)


# ---------------------------------------------------------------- checks

def mesh_check(ob):
    """Faces cutting through other faces (not just touching at an edge), and edges not shared by exactly two faces."""
    from mathutils.bvhtree import BVHTree

    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.faces.ensure_lookup_table()
    tree = BVHTree.FromBMesh(bm, epsilon=0.0)
    crossing = 0
    for i, j in tree.overlap(tree):
        if i < j and not ({v.index for v in bm.faces[i].verts} & {v.index for v in bm.faces[j].verts}):
            crossing += 1
    bad = [e for e in bm.edges if not e.is_manifold]
    where = sorted({tuple(round(c, 2) for c in (e.verts[0].co + e.verts[1].co) / 2) for e in bad})[:6]
    bm.free()
    out = {"crossing_faces": crossing, "non_manifold_edges": len(bad)}
    if where:
        out["at"] = where
    return out


def touching(a, b):
    """Faces of `a` crossing or touching faces of `b` (two objects)."""
    from mathutils.bvhtree import BVHTree

    def tree(o):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.transform(o.matrix_world)
        t = BVHTree.FromBMesh(bm, epsilon=0.0)
        bm.free()
        return t

    return len(tree(a).overlap(tree(b)))


# ---------------------------------------------------------------- preview

def preview(out_dir, export_objs, wheel):
    scene = bpy.context.scene
    # EEVEE, so the lamps glow and the paint shades like the concept's renders.
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 32
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.world = bpy.data.worlds.new("w") if scene.world is None else scene.world
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.07, 0.07, 0.075, 1)
    bg.inputs[1].default_value = 1.0
    scene.view_settings.view_transform = "Standard"  # keep the lamps' red red
    lights = []
    for name, kind, energy, loc, rot, size in (
        ("key", "AREA", 500, (3.5, 3.0, 5.0), (math.radians(35), math.radians(25), math.radians(140)), 4.0),
        ("fill", "AREA", 180, (-4.0, -2.0, 3.5), (math.radians(55), math.radians(-35), math.radians(-60)), 5.0),
        ("top", "AREA", 300, (0, 0, 5.5), (0, 0, 0), 6.0),
    ):
        ld = bpy.data.lights.new(name, kind)
        ld.energy = energy
        ld.size = size
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        lo.rotation_euler = rot
        bpy.context.collection.objects.link(lo)
        lights.append(lo)

    # Indicators off, as the game shows them most of the time.
    for o in export_objs:
        o.hide_render = o.name.startswith("ind_")
    shown = []
    for x in (-WHEEL_X, WHEEL_X):
        for y in (WHEEL_YR, WHEEL_YF):
            w = wheel.copy()
            bpy.context.collection.objects.link(w)
            w.location = (x, y, WHEEL_Z - GROUND)
            w.rotation_euler = (0, 0, math.pi if x < 0 else 0)
            shown.append(w)
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, -GROUND))
    floor = bpy.context.active_object
    floor.data.materials.append(material("floor", (0.12, 0.12, 0.13), 0.9))

    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    target = Vector((0, 0, 0.05))
    views = {
        # The concept images' viewpoints (docs/art/muscle-car), to compare against.
        "front34": Vector((-5.0, 6.6, 2.3)),
        "side": Vector((-10.5, 2.0, 0.9)),
        "rear34": Vector((-5.4, -6.2, 2.9)),
        "top": Vector((0, 0.01, 11)),
        "front": Vector((0, 9, 0.5)),
        "trueside": Vector((-10.5, 0, 0.1)),
    }
    for name, pos in views.items():
        cam.location = pos
        cam.rotation_euler = (target - pos).to_track_quat("-Z", "Y").to_euler()
        cam_data.lens = 35 if name == "top" else 50
        # The true side view is orthographic: no perspective, so it can be measured.
        cam_data.type = "ORTHO" if name == "trueside" else "PERSP"
        cam_data.ortho_scale = 5.2
        scene.render.filepath = os.path.join(out_dir, f"muscle-{name}.png")
        bpy.ops.render.render(write_still=True)
    for o in shown + lights + [floor, cam]:
        bpy.data.objects.remove(o)
    for o in export_objs:
        o.hide_render = False


# ---------------------------------------------------------------- main

def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[argv.index("--out") + 1] if "--out" in argv else "public/models/muscle-car.glb"
    prev = argv[argv.index("--preview") + 1] if "--preview" in argv else None

    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()

    lamps, sockets, lenses = build_lights()
    body = union(build_shell(), [build_cabin(), *build_details()])
    body = cut(body, build_recesses())
    body = cut(union(body, [*lenses, *build_inserts()]), sockets)
    body.name = body.data.name = "body"
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(55))  # soft roof edges; creases and openings stay sharp
    wheel = build_wheel()

    # Down to the origin (GROUND above the ground); the wheel stays centred on its axle.
    for o in [body, *lamps]:
        o.data.transform(Matrix.Translation((0, 0, -GROUND)))
        o.data.update()

    tri = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)  # noqa: E731
    print(f"[muscle_car] triangles: body {tri(body)}, lamps {sum(tri(o) for o in lamps)}, wheel {tri(wheel)}")
    for o in [body, wheel]:
        print(f"[muscle_car] check {o.name}: {mesh_check(o)}")
    objs = [body, *lamps]
    print(f"[muscle_car] faces touching between objects: {sum(touching(a, b) for i, a in enumerate(objs) for b in objs[i + 1:])}")

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
