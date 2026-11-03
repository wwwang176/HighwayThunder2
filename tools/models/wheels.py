"""
Wheels: a tyre made from its size as written on one (e.g. "245/30 R20"), on a rim made from a model of one
spoke's share of it (tools/models/rims/<name>.blend), turned round once a spoke. The tyre and the rim meet on
the same ring of SEGMENTS vertices at each bead, welded there: one closed wheel, no seam.

A rim model (open it in Blender to change it), in metres, the axle along X, its face toward +X:
  slice   the rim's lip and barrel, an open surface from its outer bead round to its inner one, for one
          spoke's share of the way round: from 0 to 360/spokes degrees about X (a point at angle a is at
          (x, r cos a, r sin a)), the spoke in the middle; along each bead a vertex every 360/SEGMENTS degrees,
          and none between (the tyre's vertices meet them)
  spoke   the spoke in that share (turned round with the slice), its ends buried in the hub and the rim
  hub     optional: once, in the middle (centre, nuts)
  brake   optional: once, apart from the rest (a brake disc behind the spokes); with it the wheel can have a
          caliper, a half moon over the disc's edge, its own object (it doesn't turn with the wheel)
The spoke and the hub are laid in, not cut in: what of them is buried (in the rim, in each other) stays there,
unseen, and may be left open. Low poly: a wheel under 1000 triangles.
The slice says what size it was made at: `spokes` (SEGMENTS a multiple of it), `bead_r` (the beads' radius) and
`half_width` (the beads' x, +-). A rim fits any tyre: it is stretched to the tyre's beads, across and along.
"""

import math
import os
import re
from types import SimpleNamespace

import bmesh
import bpy
from mathutils import Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
RIMS = os.path.join(HERE, "rims")
SEGMENTS = 40  # round the wheel: 4, 5, 8, 10 or 20 spokes fit
FLANGE = 0.012  # how far the rim's flange stands above its seat (the size's diameter); the tyre shows above it
RIM_WIDTH = 0.85  # the rim's width, of the tyre's


def tyre_size(spec):
    """'245/30 R20': the tyre 245 mm wide, its wall 30 % of that tall, on a 20 inch rim. In metres."""
    m = re.fullmatch(r"\s*(\d+)\s*/\s*(\d+)\s*R\s*(\d+(?:\.\d+)?)\s*", spec)
    assert m, f"tyre size {spec!r}: want e.g. 245/30 R20"
    width = int(m[1]) / 1000
    wall = width * int(m[2]) / 100
    seat = float(m[3]) * 0.0254 / 2
    return SimpleNamespace(spec=spec, width=width, radius=seat + wall, bead_r=seat + FLANGE, half_width=width * RIM_WIDTH / 2)


def tyre(size):
    """The tyre: round its section from the outer bead over the tread to the inner bead, open at the beads."""
    hw, w2, rb, top = size.half_width, size.width / 2, size.bead_r, size.radius
    wall = top - rb
    # Out: bulging over the rim, then onto the tread; in (toward the car, unseen): straight back to the bead.
    profile = [(hw, rb), (w2, rb + 0.5 * wall), (w2 - 0.02, top), (-(w2 - 0.02), top), (-hw, rb)]
    verts = [(x, r * math.cos(2 * math.pi * i / SEGMENTS), r * math.sin(2 * math.pi * i / SEGMENTS))
             for x, r in profile for i in range(SEGMENTS)]
    faces = [(k * SEGMENTS + i, k * SEGMENTS + (i + 1) % SEGMENTS, (k + 1) * SEGMENTS + (i + 1) % SEGMENTS, (k + 1) * SEGMENTS + i)
             for k in range(len(profile) - 1) for i in range(SEGMENTS)]
    me = bpy.data.meshes.new("tyre")
    me.from_pydata(verts, [], faces)
    mat = bpy.data.materials.get("tyre") or _material("tyre", (0.0034, 0.0034, 0.0034), 0.95)
    me.materials.append(mat)
    ob = bpy.data.objects.new("tyre", me)
    bpy.context.collection.objects.link(ob)
    return ob


def _material(name, rgb, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = rough
    return m


CALIPER_AT = math.radians(150)  # where round the disc (from the nose, up): behind its top, on either side


def caliper(disc, colour, span=math.radians(60), n=6):
    """A brake caliper over the disc's rim: a half moon (a sector of a ring, 5 cm deep, `span` round) wrapped
    round the disc's edge from both faces, in `colour` (0xRRGGBB)."""
    r_disc = max(math.hypot(v.co.y, v.co.z) for v in disc.data.vertices)
    x0, x1 = min(v.co.x for v in disc.data.vertices), max(v.co.x for v in disc.data.vertices)
    r0, r1 = r_disc - 0.05, r_disc + 0.012
    angles = [CALIPER_AT - span / 2 + span * i / n for i in range(n + 1)]
    outline = [(r1, a) for a in angles] + [(r0, a) for a in reversed(angles)]
    verts = [(x, r * math.cos(a), r * math.sin(a)) for x in (x0 - 0.012, x1 + 0.012) for r, a in outline]
    k = len(outline)
    faces = [tuple(range(k))[::-1], tuple(range(k, 2 * k))] + [(i, (i + 1) % k, k + (i + 1) % k, k + i) for i in range(k)]
    me = bpy.data.meshes.new("caliper")
    me.from_pydata(verts, [], faces)
    srgb = [((colour >> s) & 255) / 255 for s in (16, 8, 0)]
    me.materials.append(_material("caliper", tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb), 0.35))
    ob = bpy.data.objects.new("caliper", me)
    bpy.context.collection.objects.link(ob)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return ob


def load_rim(name):
    """The rim model's objects, linked into the scene: {"slice": ..., "spoke": ..., ...}."""
    path = os.path.join(RIMS, f"{name}.blend")
    wanted = ("slice", "spoke", "hub", "brake")
    with bpy.data.libraries.load(path) as (src, dst):
        names = [n for n in wanted if n in list(src.objects)]
        dst.objects = list(names)  # (filled in place with the objects)
    parts = dict(zip(names, dst.objects))
    for o in parts.values():
        bpy.context.collection.objects.link(o)
        o.data = o.data.copy()  # (its own, not the library's)
    assert "slice" in parts and "spoke" in parts, f"{path}: a rim needs a slice and a spoke"
    return parts


def _beads(ob, hw, r):
    """The slice's vertices on its beads (x = +-hw, radius r), each side's sorted round."""
    out = {}
    for side in (1, -1):
        vs = [v.co for v in ob.data.vertices if abs(v.co.x - side * hw) < 1e-5 and abs(math.hypot(v.co.y, v.co.z) - r) < 1e-5]
        out[side] = sorted(math.degrees(math.atan2(v.z, v.y)) for v in vs)
    return out


def _turned(ob, n):
    """`ob` and n - 1 copies of it, turned round the axle (X) a 1/n step each."""
    out = [ob]
    for k in range(1, n):
        c = ob.copy()
        c.data = ob.data.copy()
        c.data.transform(Matrix.Rotation(2 * math.pi * k / n, 4, "X"))
        bpy.context.collection.objects.link(c)
        out.append(c)
    return out


def _join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = ob.data.name = name
    return ob


def build_wheel(spec, rim, caliper_colour=None):
    """The wheel: a `spec` tyre ("245/30 R20") on the `rim` model, centred on the origin, its face toward +X.
    Returns it, its caliper (in `caliper_colour`, when given and the rim has a brake disc; else None) and the
    tyre's size (tyre_size)."""
    size = tyre_size(spec)
    parts = load_rim(rim)
    sl = parts["slice"]
    n = int(sl["spokes"])
    assert SEGMENTS % n == 0, f"{rim}: {n} spokes don't share {SEGMENTS} segments"
    beads = _beads(sl, sl["half_width"], sl["bead_r"])
    step = 360 / SEGMENTS
    want = [k * step for k in range(SEGMENTS // n + 1)]
    for side, angles in beads.items():
        assert len(angles) == len(want) and all(abs(a - b) < 1e-3 for a, b in zip(angles, want)), \
            f"{rim}: its slice's {'outer' if side > 0 else 'inner'} bead has vertices at {angles} degrees, want {want}"
    kr = size.bead_r / sl["bead_r"]
    stretch = Matrix.Diagonal((size.half_width / sl["half_width"], kr, kr, 1))
    for o in parts.values():
        o.data.transform(stretch)

    shell = _join([tyre(size)] + _turned(sl, n), "wheel")
    bm = bmesh.new()
    bm.from_mesh(shell.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)  # the slices to each other, the tyre to the rim
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    open_edges = sum(1 for e in bm.edges if not e.is_manifold)
    bm.to_mesh(shell.data)
    bm.free()
    assert open_edges == 0, f"{rim}: the tyre and rim don't close up ({open_edges} open edges)"
    cal = caliper(parts["brake"], caliper_colour) if "brake" in parts and caliper_colour is not None else None
    laid_in = _turned(parts["spoke"], n) + [parts[k] for k in ("hub", "brake") if k in parts]
    shell = _join([shell] + laid_in, "wheel")
    bpy.ops.object.select_all(action="DESELECT")
    shell.select_set(True)
    bpy.context.view_layer.objects.active = shell
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(30))
    return shell, cal, size
