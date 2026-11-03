"""
Car models finished in Blender from a generated body: what every car's script shares (see docs/car-models.md).
A car's script (muscle_car.py, supercar.py) describes its car (`Car`) and calls `run(car)`:

  blender -b --factory-startup -P tools/models/<car>.py -- [--out GLB] [--preview DIR] [--collider TS]

The body comes from tools/models/src/<car>-tripo.glb: Tripo3D's multiview-to-model from our concept images
(docs/art/<car>; smart low poly). `run`:
  - turns it into the game's frame (nose toward +y, wheels on the ground), works on it at LENGTH long and
    at the end scales it all up to the car's width,
  - makes it exactly symmetric (the right half mirrored onto the left),
  - strips the generated tyres (our own wheel goes in their place), mends the generation's flaws (and the
    car's own: `Car.mend`),
  - splits the windows off as `glass`,
  - repaints its texture once per livery (`Car.liveries`: paint, stripes), flat colours,
  - adds the lamps as separate objects over the texture's lamps (`Car.lamps`; the game switches them),
  - shows its collision shape over it in the preview (kept by hand in src/vehicles/cars/<car>Collider.ts;
    a new car gets a box round its body to start from),
  - puts its wheel together: its tyre size on its rim model (wheels.py).

Builds in Blender space (X right, Y forward = nose, Z up), then moves the body down so the origin
is GROUND above the ground, midway between the axles. Exported Y-up: the nose points to -Z in three.js.

Objects in the GLB (the game finds them by name):
  body                        paint (the first livery's texture), glass, wheel_well (near black)
  head_L / head_R             headlamps (lamps over the texture's)
  tail_L / tail_R             the tail light bar's halves (also the brake lights; extras "bar": a light bar)
  ind_FL ind_FR ind_RL ind_RR indicators (glowing plates, hidden while off)
  wheel                       one wheel at the origin, axle along X, rim face +X (outer side on the right);
                              extras x, front, rear (along the nose, + toward it), r: where the wheels go
  caliper                     (when the car has one) its brake caliper, where it sits on the wheel; it steers
                              with the wheel but doesn't roll (on the left, mirrored: behind the axle on both)
  exhaust_0, exhaust_1, ...   (when the car has them) its exhaust pipes, each with its origin at its tip (where
                              the game's flames come out), steel, sooty inside
Beside it, <out without .glb>/: each livery's texture (<name>.jpg, for `paint`) and liveries.json.
"""

import colorsys
import json
import math
import os
import re
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

import wheels

HERE = os.path.dirname(os.path.abspath(__file__))
GROUND = 0.55  # the origin's height above the ground
LENGTH = 4.25  # the length a car is worked on at (every size a Car gives is at this scale)
LIFT = 0.003  # how far a lamp floats off the body (no faces touching)


class Car:
    """One car: where its generated body is, what it is like, and its own steps.

    name        file stem: tools/models/src/<name>-tripo.glb, public/models/<name>.glb (and <name>/ beside it)
    width       the finished car's (all of it scaled up to this at the end)
    src_ground  how far below the generated car's centre its tyres touch the ground (it is 1 m long, nose +x)
    tyres       its tyres in our frame before centring: (axle y, axle z, radius, inner x, outer x) front to back (a
                truck's middle axles between: their tyres taken away too)
    tyre        its tyres' size, as written on one ("245/30 R20"; the game takes its radius)
    rim         its rim model: tools/models/rims/<rim>.blend (wheels.py)
    wheel_face  x (working frame) where the tyres' outer faces go (in the arches)
    caliper     its brake calipers' colour (0xRRGGBB; None: none, or the rim has no brake disc to show them)
    liveries    (name, paint, stripes or None) per paint job, the first the car's own
    glass_above z (working frame) above which its texture's glass grey is window
    glass_v     (lo, hi) brightness of its texture's glass grey (a car whose windows came near black: as dark
                as its black trim, told apart by where they are, `glass_y`)
    glass_y     (lo, hi) y (working frame) between which windows are (None: anywhere along it)
    roof_flat   how flat (normal's z) a face above `roof_above` is to be roof, not window
    glass_bend  degrees a window's faces may turn from its biggest one (a rounder windscreen wants more: its
                edges left out show as cracks and spikes across the glass)
    glass_fill  also glass: the faces above `glass_above` as dark as the glass or darker with glass on two sides
                (creases and smudges across a window), and slivers (under 2 cm across) lying in a window's plane
                beside it, whatever their colour (else paint-coloured slivers in it)
    frames_above z above which the faces round the side windows (not glass, facing sideways, within `glass_y`)
                are the roof's colour too: the window frames and pillars (None: as the texture has them)
    tops_above  z above which up-facing faces are the tops its stripes may cross
    roof_above  z above which it is all roof, the stripes' colour through and through, whatever paint the
                texture smudged onto it, and its up-facing faces never window, whatever grey the texture gave
                them (None: no such roof)
    collider    its collision shape's TS export name, in src/vehicles/cars/<collider_file>.ts (kept by hand; a
                traffic car's collider_file None: the game gives it boxes of its own)
    lamps       lamps(body, px, surface) -> lamp objects (head_L/R, tail_L/R, ind_FL/FR/RL/RR)
    mend        mend(body, px): the car's own fixes to its generated body (or None)
    paint_hue   (lo, hi) hue range of its paint on the texture (lo > hi: it wraps past 1, a red)
    paint_grey  (lo, hi) brightness of its paint on the texture when it is a grey (None: a colour, by hue)
    paint_fade  brightness below which its paint on the texture is taken for paint fading into black at an
                edge (the livery's darkened as much; a dark paint, a navy, wants it lower)
    trim        the faces whose texture isn't its paint (chassis, bumpers, grille) their own `trim` material,
                the generated texture as it is: the texture shares texels between them and the paint (a
                truck's chassis), which the livery would colour
    plain       (where(face centre, working frame) -> bool, 0xRRGGBB): the light faces (whites, light greys)
                there in that flat colour, their own `plain` material, not the livery's (a truck's box: its
                texture shares the cab's white, which takes the livery)
    tail        tail(h, s, v): whether a texel is its tail lights' red (None: saturated red; a red car's
                paint is red too, so it needs its own)
    exhaust     its exhaust pipes (None: none): {"tips": [(x, height above the ground)], "back": how far behind
                the axles' midpoint the tips are, and "r" (round, their radius) or "rect" (w, h: flat,
                square-cut)}, in metres on the finished car
    """

    def __init__(self, name, width, src_ground, tyres, tyre, rim, wheel_face, liveries, collider, collider_file, lamps,
                 mend=None, glass_above=0.8, tops_above=0.7, log=None, preview=None, paint_hue=(0.012, 0.14), tail=None,
                 roof_above=None, caliper=None, glass_v=(0.13, 0.25), glass_y=None, roof_flat=0.95, frames_above=None, paint_grey=None, glass_bend=12, glass_fill=False, plain=None, paint_fade=0.45, trim=False,
                 exhaust=None):
        self.name, self.width, self.src_ground, self.tyres = name, width, src_ground, tyres
        self.tyre, self.rim, self.wheel_face, self.caliper = tyre, rim, wheel_face, caliper
        self.liveries, self.collider, self.collider_file = liveries, collider, collider_file
        self.lamps, self.mend, self.glass_above, self.tops_above = lamps, mend, glass_above, tops_above
        self.glass_v, self.glass_y, self.roof_flat, self.frames_above = glass_v, glass_y, roof_flat, frames_above
        self.roof_above = roof_above
        self.paint_hue, self.tail, self.paint_grey, self.glass_bend = paint_hue, tail, paint_grey, glass_bend
        self.glass_fill, self.plain, self.paint_fade, self.trim = glass_fill, plain, paint_fade, trim
        self.exhaust = exhaust
        self.log = log or name.replace("-", "_")  # the prefix of what it prints
        self.preview = preview or name  # the prefix of its preview images
        self.src = os.path.join(HERE, "src", f"{name}-tripo.glb")
        self.axle_mid = (tyres[0][0] + tyres[-1][0]) / 2  # the origin goes here, midway between the front and back axles
        self.wheel_yf = tyres[0][0] - self.axle_mid
        self.wheel_yr = tyres[-1][0] - self.axle_mid


CAR = None  # the car being built (run)


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
    MAT["head"] = material("lamp_head", srgb(0xFFD890), 0.2, 0, 1.0)  # warm (the game swaps in its own glow)
    MAT["tail"] = material("lamp_tail", srgb(0xE00808), 0.2, 0, 1.2)  # (the game swaps in its own: dim, bright braking)
    MAT["ind"] = material("lamp_ind", srgb(0xFF9A10), 0.2, 0, 2)
    MAT["steel"] = material("exhaust", srgb(0xA8ACB2), 0.3, 0.9)
    MAT["soot"] = material("soot", srgb(0x050505), 1.0, 0)


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


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = ob.data.name = name
    return ob


# ---------------------------------------------------------------- the body

def load_body():
    """The generated body in our frame, symmetric, its tyres gone; and its texture (pixels, H x W x 4)."""
    bpy.ops.import_scene.gltf(filepath=CAR.src, merge_vertices=True)
    ob = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    ob.data.transform(Matrix.Translation((0, -CAR.axle_mid, CAR.src_ground * LENGTH)) @ Matrix.Scale(LENGTH, 4)
                      @ Matrix.Rotation(math.pi / 2, 4, "Z") @ ob.matrix_world)
    ob.matrix_world = Matrix.Identity(4)
    ob.name = ob.data.name = "body"
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    # The right half (+x) mirrored onto the left: exactly symmetric, the seam welded.
    bmesh.ops.symmetrize(bm, input=bm.verts[:] + bm.edges[:] + bm.faces[:], direction="X", dist=1e-4)

    def in_tyre(v):
        for wy, wz, r, x0, x1 in CAR.tyres:
            if math.hypot(v.co.y - (wy - CAR.axle_mid), v.co.z - wz) < r + 0.02 and x0 - 0.03 <= abs(v.co.x) <= x1 + 0.04:
                return True
        return False
    tyres = [f for f in bm.faces if all(in_tyre(v) for v in f.verts)]
    bmesh.ops.delete(bm, geom=tyres, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    # Bits of tread left floating where the tyres met the ground.
    bmesh.ops.delete(bm, geom=[v for part in loose_parts(bm) if len(part) < 20 for v in part], context="VERTS")
    # The holes the tyres left where they met the wheel wells (and a few the generation left): closed, each
    # corner taking its UV from the face beside it.
    uv = bm.loops.layers.uv.active
    around = {v: next(l[uv].uv.copy() for l in v.link_loops) for e in bm.edges if e.is_boundary for v in e.verts}
    new = bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)["faces"]
    new = bmesh.ops.triangulate(bm, faces=new, quad_method="BEAUTY", ngon_method="EAR_CLIP")["faces"]
    for f in new:
        for l in f.loops:
            l[uv].uv = around[l.vert]
    through = unfold(bm)
    if through:
        print(f"[{CAR.log}] parts going through each other (left be): {through} face pairs")
    bm.to_mesh(ob.data)
    bm.free()

    img = ob.data.materials[0].node_tree.nodes["Image Texture"].image
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    return ob, px


def crossing_pairs(bm):
    """Pairs of faces cutting through each other (sharing no corner)."""
    tri = bm.copy()
    owner = tri.faces.layers.int.new("owner")
    for f, g in zip(tri.faces, bm.faces):
        f[owner] = g.index
    bmesh.ops.triangulate(tri, faces=tri.faces)
    tri.faces.ensure_lookup_table()
    tree = BVHTree.FromBMesh(tri, epsilon=0.0)
    bm.faces.ensure_lookup_table()
    pairs = {tuple(sorted((tri.faces[i][owner], tri.faces[j][owner]))) for i, j in tree.overlap(tree)
             if not ({v.index for v in tri.faces[i].verts} & {v.index for v in tri.faces[j].verts})}
    tri.free()
    return [(bm.faces[i], bm.faces[j]) for i, j in pairs if i != j and not (set(bm.faces[i].verts) & set(bm.faces[j].verts))]


def unfold(bm, most=0.03):
    """Where the generation folded the surface over itself (thin faces crossing), weld the two crossing faces'
    nearest corners together (at their midpoint), until no fold is left. Faces crossing with their nearest
    corners `most` or further apart are parts going through each other (a wing's stays through the deck): left
    be. Returns how many such pairs are left."""
    for _ in range(20):
        pairs = crossing_pairs(bm)
        bm.faces.ensure_lookup_table()
        welded = False
        for a, b in pairs:
            if not (a.is_valid and b.is_valid) or set(a.verts) & set(b.verts):  # (joined by a weld this round)
                continue
            va, vb = min(((p, q) for p in a.verts for q in b.verts), key=lambda pq: (pq[0].co - pq[1].co).length)
            if (va.co - vb.co).length >= most:
                continue
            bmesh.ops.pointmerge(bm, verts=[va, vb], merge_co=(va.co + vb.co) / 2)
            welded = True
        if not welded:
            return len(pairs)
        bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-5)
    raise AssertionError("faces still cross after welding")


def loose_parts(bm):
    """The mesh's connected pieces, as lists of verts."""
    seen, parts = set(), []
    for v in bm.verts:
        if v in seen:
            continue
        seen.add(v)
        stack, part = [v], []
        while stack:
            a = stack.pop()
            part.append(a)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b not in seen:
                    seen.add(b)
                    stack.append(b)
        parts.append(part)
    return parts


def in_paint_hue(h):
    """Whether hue `h` (0..1; a texel's, or an array of them) is the car's paint's (Car.paint_hue, may wrap past 1)."""
    lo, hi = CAR.paint_hue
    return (h >= lo) & (h < hi) if lo <= hi else (h >= lo) | (h < hi)


def grey_paint(s, v):
    """Whether a texel (saturation s, brightness v; or arrays of them) is the car's paint when its paint is a
    grey (Car.paint_grey: its brightness range; a grey has no hue to tell it by)."""
    lo, hi = CAR.paint_grey or (2, 2)
    return (s < 0.08) & (v >= lo) & (v <= hi)


def colour_class(rgb):
    h, s, v = colorsys.rgb_to_hsv(*rgb)
    if v > 0.75 and s < 0.3:
        return "white"
    if CAR.tail(h, s, v) if CAR.tail else s > 0.6 and v > 0.45 and (h < 0.012 or h > 0.95):
        return "red"
    if s > 0.45 and v > min(0.25, CAR.paint_fade) and in_paint_hue(h) or grey_paint(s, v):
        return "paint"
    return "dark" if v < 0.12 else "grey"


def sample(px, uv):
    h, w = px.shape[:2]
    return px[min(h - 1, max(0, int(uv.y % 1 * h))), min(w - 1, max(0, int(uv.x % 1 * w))), :3]


def hsv(px):
    """Hue, saturation and value of every texel (as colorsys, vectorised)."""
    rgb = px[..., :3]
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    hue = np.where(mx == r, ((g - b) / np.maximum(mx - mn, 1e-6)) % 6, np.where(mx == g, (b - r) / np.maximum(mx - mn, 1e-6) + 2,
                                                                                (r - g) / np.maximum(mx - mn, 1e-6) + 4)) / 6
    return hue, s, mx


def paint_mask(px):
    """The texture's paint pixels (colour_class "paint", vectorised) and every pixel's brightness."""
    hue, s, mx = hsv(px)
    return (s > 0.45) & (mx > min(0.25, CAR.paint_fade)) & in_paint_hue(hue) | grey_paint(s, mx), mx


def paint_uv(px):
    """A UV in the middle of a patch of plain paint, of the paint's usual brightness."""
    paint, mx = paint_mask(px)
    solid = paint.copy()
    for dy in range(-6, 7, 3):
        for dx in range(-6, 7, 3):
            solid &= np.roll(paint, (dy, dx), axis=(0, 1))
    ys, xs = np.nonzero(solid)
    i = np.argmin(np.abs(mx[ys, xs] - np.median(mx[paint])))
    h, w = paint.shape
    return Vector(((xs[i] + 0.5) / w, (ys[i] + 0.5) / h))


# ---------------------------------------------------------------- materials and liveries

LIVERY_SIZE = 1024


def face_points(f, uv):
    """UVs across a face: its centre, and halfway and most of the way to each corner."""
    c = sum((l[uv].uv for l in f.loops), Vector((0, 0))) / len(f.loops)
    return [c] + [c + (l[uv].uv - c) * k for l in f.loops for k in (0.5, 0.85)]


def face_colour(px, f, uv):
    """The median colour of a face's texture: its centre and halfway to each corner."""
    c = sum((l[uv].uv for l in f.loops), Vector((0, 0))) / len(f.loops)
    return np.median(np.array([sample(px, p) for p in [c] + [c + (l[uv].uv - c) * 0.5 for l in f.loops]]), axis=0)


def split_glass(body, px):
    """The windows to their own `glass` material; the rest stays `paint`. A window: the texture's glass grey
    (0.13 to 0.25, colourless; the stripes are blacker, 0.11) above the belt, as one piece facing one way:
    grown from its biggest face over the faces turned less than 12 degrees from it (not the roof's, the
    hood's, the deck's, where the stripes' soft edges can read as that grey).
    The light faces Car.plain picks out: their own flat `plain` material.
    Returns the faces stripes may cross (up-facing tops: hood, roof, deck, ducktail) and the roof's (above
    Car.roof_above, not glass), as UV triangles."""
    body.data.materials[0].name = "paint"
    body.data.materials.append(material("glass", srgb(0x161A20), 0.15, 0.3))
    bm = bmesh.new()
    bm.from_mesh(body.data)
    uv = bm.loops.layers.uv.active
    cand = set()
    for f in bm.faces:
        _, s, v = colorsys.rgb_to_hsv(*face_colour(px, f, uv))
        c = f.calc_center_median()
        roof = CAR.roof_above is not None and c.z > CAR.roof_above and f.normal.z > CAR.roof_flat
        along = CAR.glass_y is None or CAR.glass_y[0] <= c.y <= CAR.glass_y[1]
        if c.z > CAR.glass_above and CAR.glass_v[0] < v < CAR.glass_v[1] and s < 0.15 and along and not roof:
            cand.add(f)
    glass = set()
    left = set(cand)
    while left:  # each window: grown edge to edge from the biggest candidate left, over faces facing its way
        seed = max(left, key=lambda g: g.calc_area())
        piece, stack = {seed}, [seed]
        while stack:
            a = stack.pop()
            for e in a.edges:
                for b in e.link_faces:
                    if b in left and b not in piece and b.normal.angle(seed.normal, 0) < math.radians(CAR.glass_bend):
                        piece.add(b)
                        stack.append(b)
        left -= piece
        if sum(g.calc_area() for g in piece) > 0.02:
            glass |= piece
    dark = {f for f in bm.faces if f.calc_center_median().z > CAR.glass_above
            and (lambda s, v: v < CAR.glass_v[1] and s < 0.15)(*colorsys.rgb_to_hsv(*face_colour(px, f, uv))[1:])}
    thin = {f for f in bm.faces if f.calc_center_median().z > CAR.glass_above
            and 2 * f.calc_area() / max(e.calc_length() for e in f.edges) < 0.02}
    while CAR.glass_fill:
        # creases across a window, and its darker smudges: glass-grey or darker, glass on two sides; and slivers
        # along its edge, whatever colour the texture smudged on them (under 2 cm across, in its plane)
        more = {f for f in dark - glass if sum(1 for e in f.edges for g in e.link_faces if g in glass) >= 2}
        more |= {f for f in thin - glass
                 if any(g in glass and g.normal.angle(f.normal, 0) < math.radians(15) for e in f.edges for g in e.link_faces)}
        if not more:
            break
        glass |= more
    mats = body.data.materials
    if CAR.plain is not None:
        mats.append(material("plain", srgb(CAR.plain[1]), 0.5))
    if CAR.trim:  # the generated texture, its paint's colour black (on the trim: edges, the wells), the liveries' size
        trim = mats[0].copy()
        trim.name = "trim"
        hue, s, _ = hsv(px)
        dark = px.copy()
        dark[(s > 0.45) & in_paint_hue(hue), :3] = 0.04
        img = bpy.data.images.new("trim", px.shape[1], px.shape[0], alpha=False)
        img.pixels.foreach_set(dark.astype(np.float32).ravel())
        img.scale(LIVERY_SIZE, LIVERY_SIZE)
        img.pack()
        trim.node_tree.nodes["Image Texture"].image = img
        mats.append(trim)
    plain = trimmed = 0
    tops, roof = [], []
    for f in bm.faces:
        c = f.calc_center_median()
        if f in glass:
            f.material_index = 1
            continue
        if CAR.plain is not None and CAR.plain[0](c):
            _, s, v = colorsys.rgb_to_hsv(*face_colour(px, f, uv))
            if v > 0.6 and s < 0.1:
                f.material_index = mats.find("plain")
                plain += 1
                continue
        if CAR.trim and not any(colour_class(sample(px, p)) == "paint" for p in face_points(f, uv)):  # (paint anywhere on it: paint)
            f.material_index = mats.find("trim")
            trimmed += 1
            continue
        uvs = [l[uv].uv.copy() for l in f.loops]
        tris = [(uvs[0], uvs[i], uvs[i + 1]) for i in range(1, len(uvs) - 1)]
        if f.normal.z > 0.5 and c.z > CAR.tops_above:
            tops += tris
        if CAR.roof_above is not None and c.z > CAR.roof_above:
            roof += tris
        elif (CAR.frames_above is not None and c.z > CAR.frames_above and abs(f.normal.x) > 0.5
              and (CAR.glass_y is None or CAR.glass_y[0] <= c.y <= CAR.glass_y[1])):
            roof += tris  # the window frames and pillars, as the roof
    bm.to_mesh(body.data)
    bm.free()
    print(f"[{CAR.log}] glass faces: {len(glass)} (of {len(cand)} glass-grey ones up top)"
          + (f"; plain: {plain}" if CAR.plain is not None else "") + (f"; trim: {trimmed}" if CAR.trim else ""))
    return tops, roof


def wheel_wells(body, reach=1.7, facing=0.3, ring=1.25):
    """The wheel wells' faces near black (`wheel_well`, as the underside), whatever the texture has there (the
    holes the tyres left were filled with the paint beside them):
    - round each axle within `reach` tyre radii of it, between the tyre's inner side and the arch's outer edge,
      the faces turned toward the axle (at least `facing` of their normal; the fenders' outsides face away);
    - just round the tyre (within `ring` radii), the flat ones facing out across it, inside the arch's outer
      edge (the fill round the generated tyre's wall).
    (Above, the generated wells are open: one sees the shell's inside, its faces' backs. The game draws the
    backs dark.)"""
    me = body.data
    me.materials.append(material("wheel_well", srgb(0x0B0B0C), 0.9))
    k = len(me.materials) - 1
    glass = me.materials.find("glass")
    n = 0
    for p in me.polygons:
        if p.material_index == glass:
            continue
        c = p.center
        for wy, wz, r, x0, x1 in CAR.tyres:
            to_axle = Vector((0, wy - CAR.axle_mid - c.y, wz - c.z))
            if (to_axle.length < r * reach and x0 - 0.15 <= abs(c.x) <= x1 + 0.02 and p.normal.dot(to_axle.normalized()) > facing
                    or to_axle.length < r * ring and x0 <= abs(c.x) <= x1 - 0.01 and abs(p.normal.x) > 0.9):
                p.material_index = k
                n += 1
                break
    print(f"[{CAR.log}] wheel wells: {n} faces")


def flat_windows(body):
    """Each window one pane: all its corners take the pane's (area-weighted) normal, so it shines as one sheet
    (the mirrored halves meet at a slight crease down the middle, a bright line across the glass)."""
    me = body.data
    glass = me.materials.find("glass")
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    normals = [Vector(c.vector) for c in me.corner_normals]
    left = {f for f in bm.faces if f.material_index == glass}
    while left:
        pane, stack = set(), [left.pop()]
        while stack:
            a = stack.pop()
            pane.add(a)
            for e in a.edges:
                for b in e.link_faces:
                    if b in left:
                        left.discard(b)
                        stack.append(b)
        way = sum((f.normal * f.calc_area() for f in pane), Vector()).normalized()
        for f in pane:
            for i in me.polygons[f.index].loop_indices:
                normals[i] = way
    bm.free()
    me.normals_split_custom_set(normals)


def read_collider(path):
    """The car's collision shape, kept by hand in the game's src/vehicles/cars/<car>Collider.ts (convex pieces of
    points, three.js body space: x, y up, z = -nose), as pieces of points in Blender space - to see it over the
    car in the preview. (Kept by hand, not measured: the model hardly changes, and each point is tuned.)"""
    pieces, piece = [], None
    for line in open(path, encoding="utf-8"):
        code = line.split("//")[0].strip()
        if code.startswith("[") and not code.startswith("[]"):
            piece = []
        nums = [float(n) for n in re.findall(r"-?\d+\.\d+", code)]
        if piece is not None:
            piece += nums
        if code.startswith("]") and piece is not None:
            pieces.append([(piece[i], -piece[i + 2], piece[i + 1]) for i in range(0, len(piece), 3)])
            piece = None
    assert pieces, f"{path}: no collision shape in it"
    return pieces


def starter_collider(body, path):
    """A new car's first collision shape: one box round its body, for the hand to shape from."""
    vs = [v.co for v in body.data.vertices]
    lo = Vector([min(v[i] for v in vs) for i in range(3)])
    hi = Vector([max(v[i] for v in vs) for i in range(3)])
    rows = "".join(f"    {x:.3f}, {z:.3f}, {-y:.3f},\n" for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z))
    with open(path, "w") as f:
        f.write(f"// {CAR.name}'s collision shape: convex pieces of points (x, y, z in body space, m: x right, y up - the\n"
                "// ground 0.55 m below -, the nose toward -z). Kept by hand: a box round the body to start from.\n"
                f"export const {CAR.collider}: number[][] = [\n  [\n{rows}  ],\n];\n")
    print(f"[{CAR.log}] wrote a starting collision shape (a box) to {path}: shape it by hand")


def raster(tris, h, w):
    """Texels (h x w) covered by UV triangles, grown 3 texels (for the texture's filtering at their edges)."""
    mask = np.zeros((h, w), bool)
    for a, b, c in tris:
        pts = np.array([[p.x * w, p.y * h] for p in (a, b, c)])
        x0, y0 = np.floor(pts.min(axis=0)).astype(int)
        x1, y1 = np.ceil(pts.max(axis=0)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w - 1), min(y1, h - 1)
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = pts
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12:
            continue
        l1 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / den
        l2 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / den
        inside = (l1 >= 0) & (l2 >= 0) & (l1 + l2 <= 1)
        mask[y0:y1 + 1, x0:x1 + 1] |= inside
    grown = mask.copy()
    for d in range(1, 4):
        for ax in (0, 1):
            grown |= np.roll(mask, d, axis=ax) | np.roll(mask, -d, axis=ax)
    return grown


def hex_rgb(hex_):
    return np.array([((hex_ >> s) & 255) / 255 for s in (16, 8, 0)], np.float32)  # sRGB, as the texture's bytes


def livery_textures(px, tops_roof):
    """One texture per livery, all from the generated one: its paint (and the dark it fades into at an edge)
    becomes the livery's paint, flat; the dark on the tops (the stripes) its stripe colour, or paint; the roof
    all its stripe colour; the rest (grille, lamps, trim) as it was. Returns {name: image}."""
    tops, roof_tris = tops_roof
    h, w = px.shape[:2]
    rgb = px[..., :3]
    hue, s, mx = hsv(px)
    allowed = raster(tops, h, w)[..., None]
    roof = raster(roof_tris, h, w)[..., None] if roof_tris else np.zeros((h, w, 1), bool)
    orange = ((s > 0.3) & in_paint_hue(hue) | grey_paint(s, mx))[..., None]  # (the paint: orange on the muscle car)
    dark = ((~orange[..., 0]) & (mx < 0.3))[..., None]
    t = np.clip((CAR.paint_fade - mx) / 0.33, 0, 1)[..., None]  # 0 paint .. 1 black
    black = np.full(3, 0.07, np.float32)
    out = {}
    for name, paint, stripe in CAR.liveries:
        p = hex_rgb(paint)
        top = hex_rgb(stripe) if stripe is not None else p
        mixed = np.where(allowed, p * (1 - t) + top * t, p * (1 - t) + black * t)
        img_px = np.where(orange | (dark & allowed), mixed, rgb)
        if stripe is not None:
            img_px = np.where(roof, hex_rgb(stripe), img_px)
        full = np.concatenate([img_px, np.ones((h, w, 1), np.float32)], axis=2)
        img = bpy.data.images.new(f"livery-{name}", w, h, alpha=False)
        img.pixels.foreach_set(full.astype(np.float32).ravel())
        img.scale(LIVERY_SIZE, LIVERY_SIZE)
        out[name] = img
    return out


def use_livery(body, img):
    """The `paint` material shows `img` as it is (white base colour)."""
    m = body.data.materials["paint"]
    img.pack()
    nt = m.node_tree
    nt.nodes["Image Texture"].image = img
    nt.links.new(nt.nodes["Image Texture"].outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.35


# ---------------------------------------------------------------- lamps

def surface_plate(name, tree, x0, x1, z0, z1, mat, back, nx=8, nz=2, lift=LIFT):
    """A plate over the body's tail (or nose) between x0..x1, z0..z1, following its surface, `lift` off it."""
    d = Vector((0, 1, 0)) if back else Vector((0, -1, 0))
    verts = []
    for k in range(nz + 1):
        for i in range(nx + 1):
            x = x0 + (x1 - x0) * i / nx
            z = z0 + (z1 - z0) * k / nz
            hit = tree.ray_cast(Vector((x, 0, z)) - d * 5, d)[0]
            assert hit is not None, f"{name}: nothing at x {x:.2f} z {z:.2f}"
            verts.append(tuple(hit - d * lift))
    faces = [(k * (nx + 1) + i, k * (nx + 1) + i + 1, (k + 1) * (nx + 1) + i + 1, (k + 1) * (nx + 1) + i)
             for k in range(nz) for i in range(nx)]
    return mesh_object(name, verts, faces, [mat])


def round_lamp(name, tree, body, x, z, r, mat, n=14):
    """A flat round lamp centred over the nose at (x, z), square to the body there, just clear of it."""
    p, nrm, _, _ = tree.ray_cast(Vector((x, 5, z)), Vector((0, -1, 0)))
    u = nrm.cross(Vector((0, 0, 1))).normalized()
    w = u.cross(nrm).normalized()
    c = p + nrm * LIFT
    verts = [tuple(c)] + [tuple(c + (u * math.cos(2 * math.pi * i / n) + w * math.sin(2 * math.pi * i / n)) * r) for i in range(n)]
    ob = mesh_object(name, verts, [(0, 1 + i, 1 + (i + 1) % n) for i in range(n)], [mat])
    clear_of(ob, [body], nrm)
    return ob


class Surface:
    """The body's surface, for finding the texture's lamps: rays cast at it, the texture's colour where each lands."""

    def __init__(self, body, px):
        bm = bmesh.new()
        bm.from_mesh(body.data)
        self.tri = bm.copy()
        bm.free()
        bmesh.ops.triangulate(self.tri, faces=self.tri.faces)
        self.tri.faces.ensure_lookup_table()
        self.uv = self.tri.loops.layers.uv.active
        self.tree = BVHTree.FromBMesh(self.tri)
        self.px = px

    def hits(self, back, want, xs=range(-95, 96), zs=range(30, 101)):
        """(x, z) on a cm grid (xs, zs in cm) where a ray at the nose (or the tail: `back`) lands on `want`."""
        d = Vector((0, 1, 0)) if back else Vector((0, -1, 0))
        out = []
        for i in xs:
            for k in zs:
                x, z = i / 100, k / 100
                p, _, idx, _ = self.tree.ray_cast(Vector((x, 0, z)) - d * 5, d)
                if p is None:
                    continue
                f = self.tri.faces[idx]
                wa, wb, wc = barycentric(p, *(l.vert.co for l in f.loops))
                ua, ub, uc = (l[self.uv].uv for l in f.loops)
                if colour_class(sample(self.px, ua * wa + ub * wb + uc * wc)) == want:
                    out.append((x, z))
        return out

    def free(self):
        self.tri.free()


def cell_lamp(name, s, body, cells, mat, back=False, lift=LIFT, others=()):
    """A lamp the shape of the texture's own: a facet over each 1 cm grid cell (x, z) a ray found it in, lying on
    the body (`back`: on the tail), `lift` off it and then clear of the body and `others`."""
    d = Vector((0, 1, 0)) if back else Vector((0, -1, 0))
    verts, faces = [], []
    for x, z in cells:
        corners = []
        for dx, dz in ((-0.005, -0.005), (0.005, -0.005), (0.005, 0.005), (-0.005, 0.005)):
            p = s.tree.ray_cast(Vector((x + dx, 0, z + dz)) - d * 5, d)[0]
            if p is None:
                break
            corners.append(tuple(p - d * lift))
        if len(corners) == 4:
            faces.append(tuple(range(len(verts), len(verts) + 4)))
            verts += corners
    ob = mesh_object(name, verts, faces, [mat])
    clear_of(ob, [body, *others], -d)
    return ob


def tail_lamps(s, body, min_height=0.0, most_x=None):
    """Tail lights: plates over the texture's red bar across the tail (its two halves), at least `min_height`
    tall (a hairline bar would hardly show), out to `most_x` at most (where the tail lights wrap round the
    corner: a plate laid from behind would run into the side); rear indicators over its ends.
    [tail_L, ind_RL, tail_R, ind_RR]"""
    tree = s.tree
    lamps = []
    red = s.hits(True, "red")
    # The bar: the longest run of rows (1 cm apart) mostly red, not the odd red line above or below it.
    rows = {}
    for x, z in red:
        rows[round(z * 100)] = rows.get(round(z * 100), 0) + 1
    full = sorted(k for k, c in rows.items() if c >= 0.3 * max(rows.values()))
    runs = [[full[0]]]
    for k in full[1:]:
        if k == runs[-1][-1] + 1:
            runs[-1].append(k)
        else:
            runs.append([k])
    run = max(runs, key=len)
    bz0, bz1 = run[0] / 100, run[-1] / 100
    xs = sorted(abs(x) for x, z in red if bz0 <= z <= bz1)
    if bz1 - bz0 < min_height:
        mid = (bz0 + bz1) / 2
        bz0, bz1 = mid - min_height / 2, mid + min_height / 2
    pick = lambda q, frac: q[int(frac * (len(q) - 1))]  # noqa: E731
    bx0, bx1 = max(0.02, pick(xs, 0.03)), min(pick(xs, 0.97), most_x or 9)
    print(f"[{CAR.log}] tail bar: |x| {bx0:.2f}..{bx1:.2f}, z {bz0:.2f}..{bz1:.2f} ({len(red)} red hits)")
    seg = (bx1 - bx0) * 0.2
    for side, s in (("L", -1), ("R", 1)):
        x0, x1 = sorted((s * bx0, s * bx1))
        tail = surface_plate(f"tail_{side}", tree, x0, x1, bz0, bz1, "tail", back=True)
        out = LIFT + clear_of(tail, [body], Vector((0, -1, 0)))
        lamps.append(tail)
        x0, x1 = sorted((s * (bx1 - seg), s * bx1))  # over the tail light's outer end
        ind = surface_plate(f"ind_R{side}", tree, x0, x1, bz0 + 0.005, bz1 - 0.005, "ind", back=True, nx=2, nz=1,
                            lift=out + LIFT)
        clear_of(ind, [body, tail], Vector((0, -1, 0)))
        lamps.append(ind)
    return lamps


def clear_of(ob, others, d, step=0.002, most=0.03):
    """Move `ob` along `d` until no face of it touches any of `others` (the body bulges between the points a
    lamp was laid on); how far it went."""
    moved = 0.0
    while any(touching(ob, o) for o in others):
        assert moved < most, f"{ob.name} still touches after {most} m"
        ob.data.transform(Matrix.Translation(d * step))
        ob.data.update()
        moved += step
    return moved


def barycentric(p, a, b, c):
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11 = v0.dot(v0), v0.dot(v1), v1.dot(v1)
    d20, d21 = v2.dot(v0), v2.dot(v1)
    den = d00 * d11 - d01 * d01 or 1e-12
    wb = (d11 * d20 - d01 * d21) / den
    wc = (d00 * d21 - d01 * d20) / den
    return 1 - wb - wc, wb, wc


# ---------------------------------------------------------------- checks

def mesh_check(ob):
    """Faces cutting through other faces (not just touching at an edge), and edges not shared by exactly two faces."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.faces.ensure_lookup_table()
    tree = BVHTree.FromBMesh(bm, epsilon=0.0)
    crossing = sum(1 for i, j in tree.overlap(tree)
                   if i < j and not ({v.index for v in bm.faces[i].verts} & {v.index for v in bm.faces[j].verts}))
    bad = sum(1 for e in bm.edges if not e.is_manifold)
    bm.free()
    return {"crossing_faces": crossing, "open_edges": bad}


def touching(a, b):
    """Faces of `a` crossing or touching faces of `b` (two objects)."""
    def tree(o):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.transform(o.matrix_world)
        t = BVHTree.FromBMesh(bm, epsilon=0.0)
        bm.free()
        return t

    return len(tree(a).overlap(tree(b)))


# ---------------------------------------------------------------- preview

def preview(out_dir, export_objs, wheel, caliper, spots, body, liveries, pieces):
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
    for x in (-spots["x"], spots["x"]):
        k = spots["front"] / CAR.wheel_yf  # (working frame to the finished size)
        for y in (spots["rear"], *((t[0] - CAR.axle_mid) * k for t in CAR.tyres[1:-1]), spots["front"]):
            w = wheel.copy()
            bpy.context.collection.objects.link(w)
            w.location = (x, y, spots["r"] - GROUND)
            w.rotation_euler = (0, 0, math.pi if x < 0 else 0)
            shown.append(w)
            if caliper:  # (as the game: mirrored on the left, so behind the axle on both sides)
                c = caliper.copy()
                bpy.context.collection.objects.link(c)
                c.location = w.location
                c.scale = (-1 if x < 0 else 1, 1, 1)
                shown.append(c)
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, -GROUND))
    floor = bpy.context.active_object
    floor.data.materials.append(material("floor", (0.12, 0.12, 0.13), 0.9))

    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    # Set for a car (to 4.6 m long, 2.2 m tall); a longer or taller vehicle (a truck) is seen from as much further off.
    ext = lambda i: max(v.co[i] for v in body.data.vertices) - min(v.co[i] for v in body.data.vertices)  # noqa: E731
    s = max(1.0, ext(1) / 4.6, ext(2) / 2.2)
    for lo in lights:
        lo.location *= s
        lo.data.energy *= s * s
    target = Vector((0, 0, (0.05 + GROUND) * s - GROUND))
    views = {
        # The concept images' viewpoints (docs/art/<car>), to compare against.
        "front34": Vector((-5.0, 6.6, 2.3)),
        "side": Vector((-10.5, 2.0, 0.9)),
        "rear34": Vector((-5.4, -6.2, 2.9)),
        "top": Vector((0, 0.01, 11)),
        "front": Vector((0, 9, 0.5)),
        "trueside": Vector((-10.5, 0, 0.1)),
    }
    views = {name: target + (pos - Vector((0, 0, 0.05))) * s for name, pos in views.items()}
    for name, pos in views.items():
        cam.location = pos
        cam.rotation_euler = (target - pos).to_track_quat("-Z", "Y").to_euler()
        cam_data.lens = 35 if name == "top" else 50
        cam_data.type = "ORTHO" if name == "trueside" else "PERSP"  # the true side view can be measured
        cam_data.ortho_scale = 5.2 * s
        scene.render.filepath = os.path.join(out_dir, f"{CAR.preview}-{name}.png")
        bpy.ops.render.render(write_still=True)
    cam_data.type = "PERSP"
    cam_data.lens = 50
    for name, img in liveries.items():  # each livery from the front and the back
        use_livery(body, img)
        for view in ("front34", "rear34"):
            cam.location = views[view]
            cam.rotation_euler = (target - views[view]).to_track_quat("-Z", "Y").to_euler()
            scene.render.filepath = os.path.join(out_dir, f"livery-{name}-{view}.png")
            bpy.ops.render.render(write_still=True)
    # The collision shape over the car: each piece's edges, glowing.
    use_livery(body, next(iter(liveries.values())))
    edge = material("collider", (0.1, 1.0, 0.4), 0.5, 0, 4)
    hulls = []
    for i, piece in enumerate(pieces):
        bm = bmesh.new()
        for p in piece:
            bm.verts.new(p)
        bmesh.ops.convex_hull(bm, input=bm.verts)
        bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1), verts=bm.verts, edges=bm.edges)  # its flat sides whole
        me = bpy.data.meshes.new(f"collider{i}")
        bm.to_mesh(me)
        bm.free()
        me.materials.append(edge)
        ob = bpy.data.objects.new(f"collider{i}", me)
        bpy.context.collection.objects.link(ob)  # (the pieces are in the body's space, as the car stands)
        wire = ob.modifiers.new("w", "WIREFRAME")
        wire.thickness = 0.015
        hulls.append(ob)
    for name in ("trueside", "front34", "rear34", "front", "top"):
        cam.location = views[name]
        cam.rotation_euler = (target - views[name]).to_track_quat("-Z", "Y").to_euler()
        cam_data.type = "ORTHO" if name == "trueside" else "PERSP"
        cam_data.lens = 35 if name == "top" else 50
        scene.render.filepath = os.path.join(out_dir, f"collider-{name}.png")
        bpy.ops.render.render(write_still=True)
    for o in hulls + shown + lights + [floor, cam]:
        bpy.data.objects.remove(o)
    for o in export_objs:
        o.hide_render = False


# ---------------------------------------------------------------- main

PIPE_L = 0.4  # how far an exhaust pipe reaches in from its tip, under the body
PIPE_WALL = 0.006
SOOT_IN = 0.06  # how far in a pipe goes dark


def pipe_outline(ex, grow, n=16):
    """A pipe's cross-section round its middle: (x, z) counter-clockwise seen from behind; round, or a rectangle
    with rounded corners (4 points each)."""
    if "rect" in ex:
        w, h = ex["rect"][0] / 2 + grow, ex["rect"][1] / 2 + grow
        c = min(w, h) * 0.35
        pts = []
        for cx, cz, a0 in ((w - c, -h + c, -90), (w - c, h - c, 0), (-w + c, h - c, 90), (-w + c, -h + c, 180)):
            pts += [(cx + c * math.cos(math.radians(a0 + 30 * k)), cz + c * math.sin(math.radians(a0 + 30 * k)))
                    for k in range(4)]
        return pts
    r = ex["r"] + grow
    return [(r * math.cos(2 * math.pi * k / n), r * math.sin(2 * math.pi * k / n)) for k in range(n)]


def exhaust_pipes(ex):
    """The car's exhaust pipes (`Car.exhaust`), in the finished car's frame (the origin GROUND above the ground,
    the nose +y): a steel tube from each tip in toward the nose, its rim facing back, dark a little way in.
    Each its own object, its origin at its tip."""
    outer, inner = pipe_outline(ex, PIPE_WALL), pipe_outline(ex, 0)
    n = len(outer)
    verts = ([(x, 0, z) for x, z in outer] + [(x, PIPE_L, z) for x, z in outer]
             + [(x, 0, z) for x, z in inner] + [(x, PIPE_L, z) for x, z in inner]
             + [(x, SOOT_IN, z) for x, z in inner])
    o0, o1, i0, i1, s = 0, n, 2 * n, 3 * n, 4 * n
    faces, mats = [], []
    for k in range(n):
        j = (k + 1) % n
        faces += [(o0 + k, o1 + k, o1 + j, o0 + j),  # outside
                  (i0 + k, i0 + j, i1 + j, i1 + k),  # inside
                  (o0 + k, o0 + j, i0 + j, i0 + k)]  # the rim, facing back
        mats += [0, 0, 0]
    faces.append(tuple(s + k for k in range(n)))  # the soot, facing back
    mats.append(1)
    out = []
    for i, (x, h) in enumerate(ex["tips"]):
        ob = mesh_object(f"exhaust_{i}", verts, faces, ["steel", "soot"], mats)
        ob.location = (x, -ex["back"], h - GROUND)
        out.append(ob)
    return out


def run(car):
    """Build `car`: its GLB, liveries and collision shape (paths from the command line, else the game's)."""
    global CAR
    CAR = car
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[argv.index("--out") + 1] if "--out" in argv else f"public/models/{car.name}.glb"
    prev = argv[argv.index("--preview") + 1] if "--preview" in argv else None
    collider_path = (argv[argv.index("--collider") + 1] if "--collider" in argv else
                     os.path.join(HERE, "..", "..", "src", "vehicles", "cars", f"{car.collider_file}.ts"))

    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()

    body, px = load_body()
    if car.mend:
        car.mend(body, px)
    surface = Surface(body, px)
    lamps = car.lamps(body, px, surface)
    surface.free()
    for o in lamps:
        if o.name.startswith("tail_"):
            o["bar"] = True  # a light bar: lit all along, no flare at its centre
    liveries = livery_textures(px, split_glass(body, px))
    use_livery(body, liveries[car.liveries[0][0]])
    wheel_wells(body)
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(30))  # low-poly facets, the curves still curved
    # Normals weighted by face area: the big panels set them, the generation's long thin slivers (under the rear
    # window, along the stripes) don't bend them into streaks of light.
    wn = body.modifiers.new("wn", "WEIGHTED_NORMAL")
    wn.mode = "FACE_AREA"
    wn.weight = 100
    wn.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier="wn")
    flat_windows(body)

    # Up to the car's size (the ground and the axles' midpoint stay put), then down to the origin (GROUND
    # above the ground).
    g = car.width / (max(v.co.x for v in body.data.vertices) - min(v.co.x for v in body.data.vertices))
    for o in [body, *lamps]:
        o.data.transform(Matrix.Scale(g, 4))
        o.data.transform(Matrix.Translation((0, 0, -GROUND)))
        o.data.update()
    # The wheel, real size (centred on its axle), its tyres' outer faces where the generated ones' were.
    wheel, caliper, size = wheels.build_wheel(car.tyre, car.rim, car.caliper)
    spots = {"x": car.wheel_face * g - size.width / 2, "front": car.wheel_yf * g, "rear": car.wheel_yr * g, "r": size.radius}
    print(f"[{CAR.log}] wheels: {car.tyre} on {car.rim}: " + ", ".join(f"{k} {v:.3f}" for k, v in spots.items())
          + f" (the generated tyres' radius {max(t[2] for t in car.tyres) * g:.3f})")
    for k, v in spots.items():  # where the wheels go (along the nose: + toward it), for the game (extras)
        wheel[k] = round(v, 4)
    pipes = exhaust_pipes(car.exhaust) if car.exhaust else []
    pieces = []  # (traffic: the game gives it boxes of its own)
    if car.collider_file:
        if not os.path.exists(collider_path):
            starter_collider(body, collider_path)
        pieces = read_collider(collider_path)

    tri = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)  # noqa: E731
    print(f"[{CAR.log}] triangles: body {tri(body)}, lamps {sum(tri(o) for o in lamps)}, wheel {tri(wheel)}"
          + (f", caliper {tri(caliper)}" if caliper else ""))
    print(f"[{CAR.log}] lamps: {', '.join(f'{o.name} {len(o.data.polygons)}' for o in lamps)}")
    for o in [body, wheel]:
        print(f"[{CAR.log}] check {o.name}: {mesh_check(o)}")
    size = Vector([max(v.co[i] for v in body.data.vertices) - min(v.co[i] for v in body.data.vertices) for i in range(3)])
    print(f"[{CAR.log}] body size: {size.x:.2f} x {size.y:.2f} x {size.z:.2f} m")
    assert all(len(o.data.polygons) for o in lamps), "a lamp found nothing on the texture"
    objs = [body, *lamps]
    touch = {f"{a.name}/{b.name}": n for i, a in enumerate(objs) for b in objs[i + 1:] if (n := touching(a, b))}
    print(f"[{CAR.log}] faces touching between objects: {touch or 0}")

    if prev:
        os.makedirs(prev, exist_ok=True)
        preview(prev, [body, *lamps], wheel, caliper, spots, body, liveries, pieces)
        use_livery(body, liveries[car.liveries[0][0]])

    # The liveries beside the GLB (it holds the first): <out without .glb>/<name>.jpg and liveries.json.
    # (JPEG: the texture's trim keeps the generation's grain, which PNG can't squeeze.)
    folder = os.path.splitext(os.path.abspath(out))[0]
    os.makedirs(folder, exist_ok=True)
    for f in os.listdir(folder):
        os.remove(os.path.join(folder, f))
    for name, img in liveries.items():
        img.file_format = "JPEG"
        img.save(filepath=os.path.join(folder, f"{name}.jpg"), quality=90)
    with open(os.path.join(folder, "liveries.json"), "w") as f:
        json.dump([{"name": name, "paint": f"#{paint:06x}", "stripe": None if stripe is None else f"#{stripe:06x}",
                    "file": f"{name}.jpg"} for name, paint, stripe in car.liveries], f, indent=2)
        f.write("\n")

    bpy.ops.object.select_all(action="DESELECT")
    for o in [body, *lamps, wheel, *pipes] + ([caliper] if caliper else []):
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(out),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
        export_image_format="JPEG",
        export_extras=True,  # the tail lights' "bar"
    )
    print(f"[{CAR.log}] wrote {out} and {len(liveries)} liveries in {folder}")
