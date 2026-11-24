"""
The police SUV's model, finished in Blender from a generated body (tools/models/carkit.py does the most of it; see
docs/car-models.md).

Run (Blender 5.x, headless):
  blender -b --factory-startup -P tools/models/police_suv.py -- [--out public/models/police-suv.glb] [--preview DIR] [--collider TS]

Its own:
- its LEFT half (-x) kept and mirrored (`mirror=-1`): the concept images showed its left side, the right one (its push
  bar's wrap-round) guessed;
- its headlamps over the texture's white slits on the nose, an outline of their shape drawn smooth (HEAD_SHAPE: the
  texture's white is ragged there, its cells a jagged lamp); its tail lights over the red C shapes on the tail (the
  texture's own shape: kit.cell_lamp); no indicators (the game shows none it hasn't);
- its roof light bar's lenses taken off the body as `lightbar-red` (its left, -x) and `lightbar-blue` (its right),
  their own materials, the game flashing them (src/game/police.ts); the bar's black middle and its feet stay body;
- its paint a dark navy: a low saturation for paint (`paint_sat`), its windscreen and rear window a bluish tint
  (`glass_s`);
- its big triangles cut along the texture's outlines first (`mend`): round the windscreen, between the light bar's
  lenses and its middle (a triangle straddling an outline goes all one way: a jagged edge);
- shaded by the generated body's own normals below the roof (`src_normals`: its hood smooth), its roof by its faces
  (the generation's ripples on it); the light bar's middle never window (`glass_not`);
- its fender flares kept their paint, only the arches' insides black (`well_out`);
- its front wheels 0.032 ahead of the generated tyres, in the middle of their arches (`axles`): the origin moved
  with them (its collider's kept by hand: moved too).
"""

import math
import os
import sys

import bmesh
from mathutils import Vector, geometry

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import carkit as kit  # noqa: E402

# The light bar (working frame): its lenses' faces above BAR_Z, between BAR_Y along it, out past BAR_MID either side.
BAR_Z = 1.49
BAR_Y = (-0.40, -0.07)
BAR_MID = 0.14
# How far apart along the car a headlamp facet's corners may land: its face slants back steeply round the hook (3 cm
# a cm); the steps (the hood's lip over it at z 0.80, 15 cm; a slot at |x| 0.40, 8 cm) the outline keeps clear of.
HEAD_SPREAD = 0.05
# The left headlamp's outline (x, z; seen from ahead, working frame), smooth where the texture's white is ragged (its
# cells: a slit z ~0.76..0.79 under the hood's lip, deeper outboard, its inner end hooking down to 0.71): its top,
# its inner end down the hook, the hook's foot, back up its inside, the slit's thin middle, outboard's deeper part,
# its outer end.
HEAD_SHAPE = [(-0.745, 0.791), (-0.428, 0.791), (-0.416, 0.712), (-0.436, 0.712), (-0.452, 0.767), (-0.598, 0.767),
              (-0.622, 0.753), (-0.745, 0.755)]
# The windscreen's outline on the texture, seen from above (its left half, x <= 0; y toward the nose): its top edge
# straight across the middle, then back toward the corners; its sides; its lower corners cut off; its foot.
SCREEN = [(0.0, 0.366), (-0.22, 0.366), (-0.60, 0.285), (-0.61, 0.30), (-0.68, 0.72), (-0.68, 0.75), (-0.605, 0.835),
          (-0.605, 0.848), (0.0, 0.848)]
# Up here only (the screen's foot sits at z ~1.03, the hood's top below it).
SCREEN_Z = 0.95


def cut(bm, a, b, low_z, reach=0.03):
    """Cut the faces up above `low_z` that the line from `a` to `b` (x, y: seen from above) crosses within its
    length (and `reach` past either end) along it, with the upright plane through the line: an edge along it."""
    a, b = Vector((*a, 0)), Vector((*b, 0))
    d = (b - a).normalized()
    n = Vector((-d.y, d.x, 0))
    length = (b - a).length
    faces = []
    for f in bm.faces:
        ps = [v.co for v in f.verts]
        if min(p.z for p in ps) < low_z:
            continue
        side = [n.dot(p - a) for p in ps]
        if min(side) > -1e-5 or max(side) < 1e-5:
            continue
        # where along the line the face crosses it: between its edges' crossings
        ts = []
        for i in range(len(ps)):
            p, q, sp, sq = ps[i], ps[(i + 1) % len(ps)], side[i], side[(i + 1) % len(ps)]
            if (sp < 0) != (sq < 0):
                c = p + (q - p) * (sp / (sp - sq))
                ts.append(d.dot(c - a))
        if ts and max(ts) > -reach and min(ts) < length + reach:
            faces.append(f)
    if not faces:
        return 0
    geom = list({v for f in faces for v in f.verts}) + list({e for f in faces for e in f.edges}) + faces
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=a, plane_no=n, dist=1e-5)
    return len(faces)


def mend(body, px):
    """Edges along the texture's outlines where a face-by-face split needs them (this body's triangles are big:
    one straddling an outline goes all one way, a jagged edge): round the windscreen, for `glass`; between the
    light bar's lenses and its black middle (x = ±BAR_MID), for `light_bar`."""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    n = 0
    for s in (1, -1):
        pts = [(x * s, y) for x, y in SCREEN]
        for a, b in zip(pts, pts[1:]):
            n += cut(bm, a, b, SCREEN_Z)
        n += cut(bm, (BAR_MID * s, BAR_Y[0] - 0.1), (BAR_MID * s, BAR_Y[1] + 0.1), BAR_Z - 0.05)
    bm.to_mesh(body.data)
    bm.free()
    print(f"[police_suv] mend: {n} faces cut along the windscreen's and the light bar's outlines")


def light_bar(body):
    """The bar's lenses off the body: (lightbar-red: its left, -x; lightbar-blue: its right)."""
    kit.MAT["bar_red"] = kit.material("lightbar_red", kit.srgb(0xD01818), 0.3, 0, 1.0)
    kit.MAT["bar_blue"] = kit.material("lightbar_blue", kit.srgb(0x1838E0), 0.3, 0, 1.0)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    out = []
    taken = []
    for name, mat, side in (("lightbar-red", "bar_red", -1), ("lightbar-blue", "bar_blue", 1)):
        faces = [f for f in bm.faces if (c := f.calc_center_median()).z > BAR_Z and BAR_Y[0] < c.y < BAR_Y[1] and c.x * side > BAR_MID]
        index = {}
        verts, polys = [], []
        for f in faces:
            ids = []
            for v in f.verts:
                if v not in index:
                    index[v] = len(verts)
                    verts.append(tuple(v.co))
                ids.append(index[v])
            polys.append(tuple(ids))
        print(f"[police_suv] {name}: {len(polys)} faces")
        out.append(kit.mesh_object(name, verts, polys, [mat]))
        taken += faces
    bmesh.ops.delete(bm, geom=taken, context="FACES")
    bm.to_mesh(body.data)
    bm.free()
    return out


def flat_lamp(name, s, body, cells, mat, back=False, spread=0.01):
    """kit.cell_lamp, but only the cells whose four corners land within `spread` of each other along the car: a cell
    whose corners fall on two surfaces (a lamp's face and the hood's lip over it, the bumper under it) makes a
    facet through the body no lift clears."""
    d = Vector((0, 1, 0)) if back else Vector((0, -1, 0))
    verts, faces, skipped = [], [], 0
    for x, z in cells:
        corners = []
        for dx, dz in ((-0.005, -0.005), (0.005, -0.005), (0.005, 0.005), (-0.005, 0.005)):
            p = s.tree.ray_cast(Vector((x + dx, 0, z + dz)) - d * 5, d)[0]
            if p is None:
                break
            corners.append(p - d * kit.LIFT)
        if len(corners) < 4 or max(c.y for c in corners) - min(c.y for c in corners) > spread:
            skipped += 1
            continue
        faces.append(tuple(range(len(verts), len(verts) + 4)))
        verts += [tuple(c) for c in corners]
    print(f"[police_suv] {name}: {len(faces)} cells ({skipped} across two surfaces left out)")
    ob = kit.mesh_object(name, verts, faces, [mat])
    kit.clear_of(ob, [body], -d)
    return ob


def shape_lamp(name, s, body, outline, mat, spread, step=0.005, grid=0.01):
    """A lamp of the outline (x, z) on the body seen from ahead: the outline (a point every `step`) and a `grid` of
    points inside, triangulated, each laid on the body; a facet whose corners land more than `spread` apart along the
    car (across a step in the surface) left out (flat_lamp's)."""
    loop = []
    for (x0, z0), (x1, z1) in zip(outline, outline[1:] + outline[:1]):
        n = max(1, round(math.hypot(x1 - x0, z1 - z0) / step))
        loop += [(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n) for i in range(n)]

    def inside(x, z):
        c = False
        for (x0, z0), (x1, z1) in zip(outline, outline[1:] + outline[:1]):
            if (z0 > z) != (z1 > z) and x < x0 + (z - z0) * (x1 - x0) / (z1 - z0):
                c = not c
        return c

    xs, zs = [p[0] for p in outline], [p[1] for p in outline]
    pts = [(min(xs) + grid * i, min(zs) + grid * j) for i in range(round((max(xs) - min(xs)) / grid) + 1)
           for j in range(round((max(zs) - min(zs)) / grid) + 1)]
    pts = [p for p in pts if inside(*p) and min(math.hypot(p[0] - q[0], p[1] - q[1]) for q in loop) > step * 0.6]
    co2 = [Vector(p) for p in loop + pts]
    out = geometry.delaunay_2d_cdt(co2, [(i, (i + 1) % len(loop)) for i in range(len(loop))], [list(range(len(loop)))], 1, 1e-6)
    d = Vector((0, -1, 0))
    on = []
    for v in out[0]:
        p = s.tree.ray_cast(Vector((v.x, 0, v.y)) - d * 5, d)[0]
        on.append(None if p is None else p - d * kit.LIFT)
    verts, faces, skipped = [], [], 0
    for f in out[2]:
        ps = [on[i] for i in f]
        if any(p is None for p in ps) or max(p.y for p in ps) - min(p.y for p in ps) > spread:
            skipped += 1
            continue
        if (ps[1] - ps[0]).cross(ps[2] - ps[0]).y < 0:  # facing ahead
            ps = ps[::-1]
        faces.append(tuple(range(len(verts), len(verts) + 3)))
        verts += [tuple(p) for p in ps]
    print(f"[police_suv] {name}: {len(faces)} facets ({skipped} across a step left out)")
    ob = kit.mesh_object(name, verts, faces, [mat])
    kit.clear_of(ob, [body], -d)
    return ob


def lamps(body, px, s):
    out = []
    red = s.hits(True, "red")
    for side, sx in (("L", -1), ("R", 1)):
        tail = [(x, z) for x, z in red if x * sx > 0.2]
        xs, zs = [abs(x) for x, z in tail], [z for x, z in tail]
        print(f"[police_suv] tail_{side}: {len(tail)} cells, |x| {min(xs):.2f}..{max(xs):.2f}, z {min(zs):.2f}..{max(zs):.2f}")
        shape = [(-x * sx, z) for x, z in HEAD_SHAPE]
        out.append(shape_lamp(f"head_{side}", s, body, shape if sx < 0 else shape[::-1], "head", HEAD_SPREAD))
        out.append(flat_lamp(f"tail_{side}", s, body, tail, "tail", back=True))
    return out + light_bar(body)


CAR = kit.Car(
    name="police-suv",
    preview="police",
    width=2.15,  # its mirrors' (1.838 working); its body ~2.0 m across
    src_ground=0.1849,
    tyres=[(1.21, 0.35, 0.35, 0.58, 0.83), (-1.21, 0.35, 0.35, 0.58, 0.83)],
    tyre="285/45 R22",
    rim="thin-10",
    wheel_face=0.82,
    caliper=0x222225,
    liveries=[("police", 0x1B1F2A, 0x141414)],  # its navy; the dark on its tops (hood vents) black
    collider="POLICE_SUV_COLLIDER",
    collider_file="policeSuvCollider",
    lamps=lamps,
    mend=mend,
    mirror=-1,
    paint_hue=(0.58, 0.68),
    paint_sat=0.2,
    paint_fade=0.1,
    glass_s=0.3,
    glass_v=(0.15, 0.235),
    glass_above=1.0,
    glass_y=(-2.1, 1.0),
    roof_above=1.40,
    roof_flat=0.9,
    tops_above=0.95,
    src_normals=lambda c: c.z < 1.35,  # (not the roof: the generation's ripples on it, flat by its faces)
    well_out=0.5,  # (its fender flares come in close round the tyres)
    livery_size=2048,  # (the biggest body: at 1024, 111 texels a metre, the cars' 120-170)
    axles=(1.242, -1.21),  # (the generated front tyres sat 0.032 back in their arches; the back ones in the middle)
    glass_not=lambda c: c.z > BAR_Z - 0.05 and BAR_Y[0] - 0.05 < c.y < BAR_Y[1] + 0.05,  # the bar's black middle
)

if __name__ == "__main__":
    kit.run(CAR)
