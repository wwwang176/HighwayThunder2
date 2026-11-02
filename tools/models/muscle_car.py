"""
Muscle car model (concept: docs/art/muscle-car/), built in Blender from code.

Run (Blender 5.x, headless):
  blender -b --factory-startup -P tools/models/muscle_car.py -- --out public/models/muscle-car.glb [--preview DIR]

The body is lofted from the cross-sections in muscle_car_shape.json (plain numbers, metres, ground at
z = 0, nose toward +y): each station is a band of points across the top at fixed x (the stripes' edges
fall on them), then points round the side to the bottom centre (right half; the car is symmetric).
Onto that: wheel arches, windows and the light panels cut in as recesses, the concept's details
(stripes, hood bulge, ducktail, splitter, bright blades) merged in.

Builds in Blender space (X right, Y forward = nose, Z up), then moves the body down so the origin
is GROUND above the ground. Exported Y-up: the nose points to -Z in three.js like every other car.

One watertight body, nothing inside or on anything else; the script prints the checks.

Objects in the GLB (the game finds them by name):
  body                        paint, stripe, glass, trim, chrome, lens
  head_L / head_R             headlamps (two round lamps per side, in pods)
  tail_L / tail_R             the tail light bar's halves (also the brake lights)
  ind_FL ind_FR ind_RL ind_RR indicators (glowing plates, hidden while off)
  wheel                       one wheel at the origin, axle along X, rim face +X (outer side on the right)
"""

import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

GROUND = 0.55  # the origin's height above the ground
SHAPE = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "muscle_car_shape.json")))
NOSE = SHAPE["stations"][-1]["y"]  # the end stations: the nose and tail faces
TAIL = SHAPE["stations"][0]["y"]

WHEEL_R = 0.305
WHEEL_W = 0.30
WHEEL_X = 0.72
WHEEL_YF = 1.37
WHEEL_YR = -1.20
WHEEL_Z = WHEEL_R
ARCH_R = 0.365

# Stripe edges (x) across the top: paint | stripe | gap | stripe | paint (they are among SHAPE's top_x).
S_IN = 0.06
S_OUT = 0.345


# ---------------------------------------------------------------- materials

def material(name, rgb, rough=0.5, metal=0.0, emit=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
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
    MAT["chrome"] = material("chrome", srgb(0xB4B4B8), 0.25, 0.9)
    MAT["head"] = material("lamp_head", srgb(0xFFD890), 0.2, 0, 1.0)  # warm (the game swaps in its own glow)
    MAT["tail"] = material("lamp_tail", srgb(0xE00808), 0.2, 0, 3)
    MAT["ind"] = material("lamp_ind", srgb(0xFF9A10), 0.2, 0, 2)
    MAT["lens"] = material("lens", srgb(0xFFE8C0), 0.25, 0.1, 1.2)  # fog lamps, always on (indicators blink over them)
    MAT["tyre"] = material("tyre", srgb(0x0B0B0B), 0.95)
    MAT["rim"] = material("rim", srgb(0x1E1E22), 0.4, 0.6)
    MAT["spoke"] = material("spoke", srgb(0x707078), 0.3, 0.8)


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
    big = [f for f in bm.faces if len(f.verts) > 4]  # concave caps: polyfill them now (a boolean's own triangulation can overlap)
    if big:
        bmesh.ops.triangulate(bm, faces=big, quad_method="BEAUTY", ngon_method="EAR_CLIP")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return ob


BOX_FACES = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]


def box(name, x0, x1, y0, y1, z0, z1, mat):
    v = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    return mesh_object(name, v, BOX_FACES, [mat])


def disc(name, x, y, z, r, depth, mat, n=16):
    """A round lamp (a short cylinder along Y), its front face at y."""
    v = []
    for yy in (y - depth, y):
        for i in range(n):
            a = 2 * math.pi * i / n
            v.append((x + r * math.cos(a), yy, z + r * math.sin(a)))
    f = [tuple(range(n)), tuple(range(n, 2 * n))]
    f += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return mesh_object(name, v, f, [mat])


def prism(name, outline, inner, outer, mats=("glass", "trim", "trim")):
    """A solid standing on a 2D outline: inner(p) and outer(p) give its two ends' 3D points for each
    outline point p. Materials: the inner end, the walls, the outer end."""
    n = len(outline)
    verts = [inner(p) for p in outline] + [outer(p) for p in outline]
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    faces += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    names = list(dict.fromkeys(mats))
    fm = [names.index(mats[0]), names.index(mats[2])] + [names.index(mats[1])] * n
    return mesh_object(name, verts, faces, names, fm)


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
        before, name = len(target.data.polygons), p.name
        bpy.ops.object.modifier_apply(modifier="b")
        bpy.data.objects.remove(p)
        if os.environ.get("MODEL_DEBUG"):
            check = f" {mesh_check(target)}" if os.environ.get("MODEL_DEBUG") == "2" else ""
            print(f"[boolean] {op} {name}: {before} -> {len(target.data.polygons)} faces{check}")
    return target


def union(target, parts):
    return boolean(target, parts, "UNION")


def cut(target, cutters):
    return boolean(target, cutters, "DIFFERENCE")


# ---------------------------------------------------------------- the shape

def shape_rings():
    """The stations' half cross-sections: the top at fixed x, then the side at heights spread evenly from
    under the top's edge to the sill, then the sill above the bottom, then the bottom centre - the same
    point on the same feature (roof edge, belt, shoulder, sill) at every station, so they run as lines
    down the car. Inside the wheel arches the side comes from the stations either side."""
    tx = SHAPE["top_x"]
    st = SHAPE["stations"]
    ys = [s["y"] for s in st]
    # The side: evenly from just under the top's edge down to the sill, then the sill above the bottom.
    side = [[tuple(p) for p in s["side"] + s["low"]] for s in st]
    for wy in (WHEEL_YF, WHEEL_YR):
        inside = [i for i, y in enumerate(ys) if abs(y - wy) < ARCH_R + 0.02]
        a, b = inside[0] - 1, inside[-1] + 1
        for i in inside:
            t = (ys[i] - ys[a]) / (ys[b] - ys[a])
            for j in range(len(side[i])):
                if side[i][j][1] < WHEEL_Z + ARCH_R + 0.12:
                    pa, pb = side[a][j], side[b][j]
                    side[i][j] = (pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t)
    rings = [list(zip(tx, s["top"])) + sd + [(0.0, s["bottom"])] for s, sd in zip(st, side)]
    return ys, rings, len(tx)


YS, RINGS, NT = shape_rings()


def at_station(y):
    """The two stations around y and the blend between them."""
    i = next((k for k in range(len(YS) - 1) if YS[k + 1] >= y), len(YS) - 2)
    t = max(0.0, min(1.0, (y - YS[i]) / (YS[i + 1] - YS[i])))
    return i, t


def top_z(y, x):
    """The body's top height at (y, |x|) along the top band (and on out to the first side point)."""
    i, t = at_station(y)
    x = abs(x)

    def one(r):
        chain = r[:NT + 1]
        for (xa, za), (xb, zb) in zip(chain, chain[1:]):
            if x <= xb:
                return za + (zb - za) * (x - xa) / ((xb - xa) or 1e-9)
        return chain[-1][1]
    return one(RINGS[i]) * (1 - t) + one(RINGS[i + 1]) * t


def side_x(y, z):
    """The body's half-width at (y, z): round the whole half ring (the greenhouse's sides are among the top
    points), the outermost where it folds."""
    i, t = at_station(y)

    def one(r):
        chain = r
        best = None
        for (xa, za), (xb, zb) in zip(chain, chain[1:]):
            lo_, hi_ = min(za, zb), max(za, zb)
            if lo_ <= z <= hi_ and hi_ > lo_:
                x = xa + (xb - xa) * (z - za) / (zb - za)
                best = x if best is None else max(best, x)
        return best if best is not None else 0.0
    return one(RINGS[i]) * (1 - t) + one(RINGS[i + 1]) * t


# ---------------------------------------------------------------- the body shell

def build_shell():
    verts, faces, fm = [], [], []
    names = ["paint", "stripe", "trim"]
    for y, half in zip(YS, RINGS):
        full = [(-x, z) for x, z in reversed(half[1:-1])] + half  # left (bottom centre excluded) .. top centre .. right .. bottom centre
        verts += [(x, y, z) for x, z in full]
    n = len(verts) // len(YS)
    nl = len(RINGS[0]) - 2  # left points before the top centre

    def seg_mat(i):
        """Material of the segment from ring point i to i + 1 (on the first station; the same along the car)."""
        a, b = verts[i], verts[(i + 1) % n]
        if a[2] < 0.30 and b[2] < 0.30:
            return "trim"  # sill and underside
        top_band = nl - (NT - 1) <= i < nl + NT - 1
        xa, xb = sorted((abs(a[0]), abs(b[0])))
        if top_band and xa >= S_IN - 1e-6 and xb <= S_OUT + 1e-6:
            return "stripe"
        return "paint"
    mats = [seg_mat(i) for i in range(n)]
    for s in range(len(YS) - 1):
        a, b = s * n, (s + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append((a + i, a + j, b + j, b + i))
            fm.append(names.index(mats[i]))
    faces += [tuple(reversed(range(n))), tuple(range(len(verts) - n, len(verts)))]
    fm += [0, 0]
    shell = mesh_object("shell", verts, faces, names, fm)
    # Fix how each (slightly twisted) quad splits, rather than leave it to each boolean.
    bm = bmesh.new()
    bm.from_mesh(shell.data)
    bmesh.ops.triangulate(bm, faces=bm.faces, quad_method="BEAUTY", ngon_method="EAR_CLIP")
    bm.to_mesh(shell.data)
    bm.free()

    # A flared lip round each arch, sloping out of the body (the arch cut below trims its inside).
    lips = []
    for wy in (WHEEL_YR, WHEEL_YF):
        out = side_x(wy, WHEEL_Z + ARCH_R) + 0.035
        for s in (-1, 1):
            lips.append(arc_solid("lip", s * 0.70, s * out, wy, WHEEL_Z, 0.28, 0.44, -8, 188, 10, "paint", ARCH_R + 0.04))
    union(shell, lips)

    # Wheel arches, cut in from each side; dark inside.
    arches = []
    for wy in (WHEEL_YR, WHEEL_YF):
        for s in (-1, 1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=ARCH_R, depth=1.1, location=(s * 1.05, wy, WHEEL_Z), rotation=(0, math.pi / 2, 0))
            c = bpy.context.active_object
            c.data.materials.append(MAT["trim"])
            arches.append(c)
    return cut(shell, arches)


# ---------------------------------------------------------------- windows

GLASS_DEPTH = 0.025  # how far the glass sits in from the body's surface


def side_windows():
    """Door glass and a quarter window either side (the B-pillar between them), recessed into the
    greenhouse's side; outlines in (y, z)."""
    # (Edges kept 2 cm or more off the stations' y and the side heights: a cut grazing a vertex goes wrong.)
    # (The door glass starts behind the windshield's cut at the A-pillar, clear of it.)
    door = [(0.62, 0.93), (0.25, 1.145), (-0.47, 1.145), (-0.47, 0.93)]
    quarter = [(-0.53, 0.93), (-0.53, 1.13), (-0.60, 1.08), (-0.685, 0.975), (-0.685, 0.93)]
    cutters = []
    for name, outline, depth in (("door", door, GLASS_DEPTH), ("quarter", quarter, GLASS_DEPTH + 0.01)):
        for s in (-1, 1):
            cutters.append(prism(f"{name}glass", outline,
                                 lambda p, s=s, d=depth: (s * (side_x(p[0], p[1]) - d), p[0], p[1]),
                                 lambda p, s=s: (s * 1.6, p[0], p[1])))
    return cutters


def top_windows():
    """Windshield and rear glass, recessed into the top; outlines in (y, x)."""
    # (Edges 2 cm or more off the top points' x: 0.45, 0.55.)
    windshield = [(0.725, -0.58), (0.725, 0.58), (0.30, 0.52), (0.30, -0.52)]
    rear = [(-1.03, -0.52), (-1.03, 0.52), (-1.31, 0.475), (-1.31, -0.475)]
    return [prism(name, outline, lambda p: (p[1], p[0], top_z(p[0], p[1]) - GLASS_DEPTH), lambda p: (p[1], p[0], 3.0))
            for name, outline in (("windshield", windshield), ("rearglass", rear))]


# ---------------------------------------------------------------- details

def build_scoop():
    """The hood scoop, mid-hood: a low flat body-colour box rising quickly out of the hood and running level
    to its dark mouth facing forward; its sides slope down into the hood (the stripes show either side)."""
    y0, y1 = 1.05, 1.55
    n = 4
    verts, faces = [], []
    for k in range(n + 1):
        t = k / n
        y = y0 + (y1 - y0) * t
        h = 0.07 * min(1.0, t / 0.4) - 0.008  # buried at the back, up to its height within the first 40 %
        zs = top_z(y, 0)
        half = [(0.0, zs + h), (0.17, zs + h), (0.205, zs + h - 0.012), (0.27, top_z(y, 0.27) - 0.03)]
        row = [(-x, z) for x, z in reversed(half[1:])] + half + [(0.27, zs - 0.10), (-0.27, zs - 0.10)]
        verts += [(x, y, z) for x, z in row]
    m = 9
    for k in range(n):
        a, b = k * m, (k + 1) * m
        faces += [(a + i, a + (i + 1) % m, b + (i + 1) % m, b + i) for i in range(m)]
    faces += [tuple(reversed(range(m))), tuple(n * m + i for i in range(m))]
    fm = [0] * (len(faces) - 1) + [1]  # paint all over, the mouth dark
    return mesh_object("scoop", verts, faces, ["paint", "trim"], fm)


def build_ducktail():
    """A lip growing out of the deck and sweeping up past the tail, its top corners rounded."""
    y0, y1 = -1.70, TAIL - 0.07
    za = top_z(y0, 0.6) - 0.03  # its front edge well under the deck
    zb0 = top_z(TAIL, 0) - 0.12
    ze = top_z(TAIL, 0) + 0.11
    n = 8
    verts, faces = [], []
    for k in range(n + 1):
        t = k / n
        y = y0 + (y1 - y0) * t
        hw = 0.76 - 0.08 * t
        zt = za + (ze - za) * t ** 1.8
        zb = zb0 + (ze - 0.04 - zb0) * t
        verts += [(-hw, y, zb), (hw, y, zb), (hw, y, zt - 0.015), (hw - 0.035, y, zt), (-hw + 0.035, y, zt), (-hw, y, zt - 0.015)]
    m = 6
    for k in range(n):
        a, b = k * m, (k + 1) * m
        faces += [(a + i, a + (i + 1) % m, b + (i + 1) % m, b + i) for i in range(m)]
    faces += [tuple(range(m)), tuple(n * m + i for i in reversed(range(m)))]
    return mesh_object("ducktail", verts, faces, ["paint"])


def build_details():
    """Merged into the body: the hood scoop, the ducktail, a chin spoiler and a bumper bar under the nose,
    a bright blade across the tail."""
    parts = [build_scoop(), build_ducktail()]
    # The chin: from under the nose, sloping forward and down, its front corners drawn in. (It starts
    # ahead of the front wheel arch: reaching into the arch's cut it would graze it.)
    cv = [(s * xa, y, z) for s in (-1, 1) for y, xa, z0, z1 in ((NOSE - 0.20, 0.84, 0.27, 0.33), (NOSE + 0.06, 0.78, 0.245, 0.29))
          for z in (z0, z1)]
    parts.append(mesh_object("chin", cv, BOX_FACES, ["paint"]))
    # A bumper bar across the nose under the grille, its front corners drawn in. (Its back is buried in the
    # nose, inside the body's sides: it meets only the flat nose face.)
    bv = [(s * xa, y, z) for s in (-1, 1) for y, xa in ((NOSE - 0.04, 0.80), (NOSE + 0.07, 0.74)) for z in (0.41, 0.49)]
    parts.append(mesh_object("fbumper", bv, BOX_FACES, ["paint"]))
    parts.append(box("rbumper", -0.80, 0.80, TAIL - 0.08, TAIL + 0.06, 0.42, 0.48, "chrome"))
    return parts


# The nose face is the shell's end at y = NOSE (flat); the tail's at TAIL.
GRILLE = dict(x=0.80, z0=0.52, z1=0.72, depth=0.07)  # deep under the hood's edge (its floor 3 cm off the station at 1.95)
TAILPANEL = dict(x=0.72, z0=0.57, z1=0.69, depth=0.035)


def build_recesses():
    """Cut into the body: the grille (the lamps in it), a slim intake low on the nose, the tail light panel."""
    g, t = GRILLE, TAILPANEL
    return [
        box("grille", -g["x"], g["x"], NOSE - g["depth"], NOSE + 0.3, g["z0"], g["z1"], "trim"),
        box("intake", -0.62, 0.62, NOSE - 0.04, NOSE + 0.3, 0.32, 0.36, "trim"),
        box("tailpanel", -t["x"], t["x"], TAIL - 0.3, TAIL + t["depth"], t["z0"], t["z1"], "trim"),
    ]


def build_inserts():
    """Merged into the recesses once cut: a bar across the grille (between the lamps)."""
    floor = NOSE - GRILLE["depth"]
    return [box("grillebar", -0.33, 0.33, floor - 0.01, NOSE - 0.015, 0.607, 0.633, "spoke")]


def build_lights():
    """Separate objects (the game switches them). Head and tail lamps sit each in its own socket
    (`sockets`, cut out of the body 2 mm wider all round and deeper, so lamp and body never touch).
    An indicator is hidden while off, so its glass is part of the body (`lenses`, merged in) and the
    indicator a glowing plate floating 2 mm in front of it."""
    lamps, sockets, lenses = [], [], []
    G = 0.002
    floor = NOSE - GRILLE["depth"]
    zc = (GRILLE["z0"] + GRILLE["z1"]) / 2
    for name, s in (("head_L", -1), ("head_R", 1)):
        parts = []
        for k, x in enumerate((s * 0.47, s * 0.68)):
            parts.append(disc(f"{name}{k}", x, floor + 0.015, zc, 0.082, 0.04, "head", 14))
            sockets.append(disc(f"{name}{k}_socket", x, floor + 0.04, zc, 0.082 + 0.012, 0.095, "trim", 14))
        lamps.append(join(parts, name))
    floor = NOSE - 0.04
    for name, s in (("ind_FL", -1), ("ind_FR", 1)):  # fog lamps at the intake's ends
        x0, x1 = sorted((s * 0.46, s * 0.58))
        lenses.append(box(name + "_lens", x0, x1, floor - 0.01, floor + 0.012, 0.326, 0.354, "lens"))
        lamps.append(box(name, x0, x1, floor + 0.014, floor + 0.017, 0.326, 0.354, "ind"))
    t = TAILPANEL
    floor = TAIL + t["depth"]
    bar = t["x"] - 0.02
    seg = (bar - 0.004 - 3 * 0.014) / 4
    z0, z1 = t["z0"] + 0.02, t["z1"] - 0.02
    for name, s in (("tail_L", -1), ("tail_R", 1)):
        parts = []
        for k in range(4):
            x0, x1 = sorted((s * (0.004 + k * (seg + 0.014)), s * (0.004 + k * (seg + 0.014) + seg)))
            parts.append(box(f"{name}{k}", x0, x1, floor - 0.015, floor + 0.025, z0, z1, "tail"))
            sockets.append(box(f"{name}{k}_socket", x0 - G, x1 + G, floor - 0.03, floor + 0.04, z0 - G, z1 + G, "trim"))
        lamps.append(join(parts, name))
    for name, s in (("ind_RL", -1), ("ind_RR", 1)):  # over the outermost segment
        x0, x1 = sorted((s * (bar - seg), s * bar))
        lamps.append(box(name, x0, x1, floor - 0.020, floor - 0.017, z0, z1, "ind"))
    return lamps, sockets, lenses


# ---------------------------------------------------------------- the wheel

def build_wheel():
    """Tyre with a chunky dark wall, a deep dark dish and five spokes; centred on the origin, the dish faces +X."""
    n = 20
    hw = WHEEL_W / 2
    r_in = WHEEL_R * 0.58
    verts, faces, fm = [], [], []

    def ring(x, r):
        base = len(verts)
        for i in range(n):
            a = 2 * math.pi * i / n
            verts.append((x, r * math.cos(a), r * math.sin(a)))
        return base

    rings = [
        ring(hw - 0.02, r_in),  # 0 rim lip, inner edge
        ring(hw, WHEEL_R * 0.88),  # 1 sidewall
        ring(hw - 0.015, WHEEL_R),  # 2 a square shoulder
        ring(-hw + 0.015, WHEEL_R),  # 3
        ring(-hw, WHEEL_R * 0.88),  # 4
        ring(-hw + 0.02, r_in),  # 5 inner side
        ring(hw - 0.15, r_in * 0.98),  # 6 the dish's floor, deep
        ring(-hw + 0.02, r_in * 0.5),  # 7 back
        ring(hw - 0.008, r_in + 0.02),  # 8 the rim's bright lip
    ]
    chain = [rings[0], rings[8], rings[1], rings[2], rings[3], rings[4], rings[5]]
    for k in range(len(chain) - 1):
        a, b = chain[k], chain[k + 1]
        for i in range(n):
            j = (i + 1) % n
            faces.append((a + i, a + j, b + j, b + i))
            fm.append(2 if k == 0 else 0)
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
    wheel = mesh_object("wheel", verts, faces, ["tyre", "rim", "spoke"], fm)

    parts = []
    hub = disc("hub", 0, 0, 0, 0.045, 0.10, "spoke", 10)  # its back sunk into the dish floor
    hub.rotation_euler = (0, 0, -math.pi / 2)
    hub.location = (hw - 0.07, 0, 0)
    parts.append(hub)
    for k in range(5):  # bold spokes standing up out of the deep floor
        sp = box("spoke", hw - 0.17, hw - 0.09, -0.034, 0.034, 0.03, r_in * 0.96, "spoke")
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
    crossing, spots = 0, []
    for i, j in tree.overlap(tree):
        if i < j and not ({v.index for v in bm.faces[i].verts} & {v.index for v in bm.faces[j].verts}):
            crossing += 1
            spots.append(tuple(round(c, 2) for c in bm.faces[i].calc_center_median()))
    bad = [e for e in bm.edges if not e.is_manifold]
    where = sorted({tuple(round(c, 2) for c in (e.verts[0].co + e.verts[1].co) / 2) for e in bad} | set(spots))[:6]
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
    for name, energy, loc, rot, size in (
        ("key", 500, (3.5, 3.0, 5.0), (math.radians(35), math.radians(25), math.radians(140)), 4.0),
        ("fill", 180, (-4.0, -2.0, 3.5), (math.radians(55), math.radians(-35), math.radians(-60)), 5.0),
        ("top", 300, (0, 0, 5.5), (0, 0, 0), 6.0),
    ):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = energy
        ld.size = size
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        lo.rotation_euler = rot
        bpy.context.collection.objects.link(lo)
        lights.append(lo)

    for o in export_objs:  # indicators off, as the game shows them most of the time
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
        cam_data.type = "ORTHO" if name == "trueside" else "PERSP"  # the true side view can be measured
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
    body = union(build_shell(), build_details())
    body = cut(body, [*side_windows(), *top_windows(), *build_recesses()])
    body = cut(union(body, [*lenses, *build_inserts()]), sockets)
    body.name = body.data.name = "body"
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    # Low-poly facets: every panel shades flat (only near-coplanar neighbours share normals).
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(12))
    # Normals weighted by face area: big panels shade flat and clean, the booleans' slivers don't bend them.
    wn = body.modifiers.new("wn", "WEIGHTED_NORMAL")
    wn.mode = "FACE_AREA"
    wn.weight = 100
    wn.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier="wn")
    wheel = build_wheel()

    # Down to the origin (GROUND above the ground); the wheel stays centred on its axle.
    for o in [body, *lamps]:
        o.data.transform(Matrix.Translation((0, 0, -GROUND)))
        o.data.update()

    tri = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)  # noqa: E731
    print(f"[muscle_car] triangles: body {tri(body)}, lamps {sum(tri(o) for o in lamps)}, wheel {tri(wheel)}")
    for o in [body, wheel]:
        print(f"[muscle_car] check {o.name}: {mesh_check(o)}")
    # A boolean gone wrong can leave a small closed mesh that passes the checks above.
    size = Vector([max(v.co[i] for v in body.data.vertices) - min(v.co[i] for v in body.data.vertices) for i in range(3)])
    print(f"[muscle_car] body size: {size.x:.2f} x {size.y:.2f} x {size.z:.2f} m")
    assert size.y > 4.2 and size.x > 1.7 and size.z > 1.0, "the body is not the whole car: a boolean failed"
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
