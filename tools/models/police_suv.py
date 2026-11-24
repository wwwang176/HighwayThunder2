"""
The police SUV's model, finished in Blender from a generated body (tools/models/carkit.py does the most of it; see
docs/car-models.md).

Run (Blender 5.x, headless):
  blender -b --factory-startup -P tools/models/police_suv.py -- [--out public/models/police-suv.glb] [--preview DIR] [--collider TS]

Its own:
- its LEFT half (-x) kept and mirrored (`mirror=-1`): the concept images showed its left side, the right one (its push
  bar's wrap-round) guessed;
- its headlamps over the texture's white slits on the nose, its tail lights over the red C shapes on the tail (each
  the texture's own shape: kit.cell_lamp); no indicators (the game shows none it hasn't);
- its roof light bar's lenses taken off the body as `lightbar-red` (its left, -x) and `lightbar-blue` (its right),
  their own materials, the game flashing them (src/game/police.ts); the bar's black middle and its feet stay body;
- its paint a dark navy: a low saturation for paint (`paint_sat`), its windscreen and rear window a bluish tint
  (`glass_s`);
- its big triangles cut along the texture's outlines first (`mend`): round the windscreen, between the light bar's
  lenses and its middle (a triangle straddling an outline goes all one way: a jagged edge);
- shaded by the generated body's own normals below the roof (`src_normals`: its hood smooth), its roof by its faces
  (the generation's ripples on it); the light bar's middle never window (`glass_not`).
"""

import os
import sys

import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import carkit as kit  # noqa: E402

# The light bar (working frame): its lenses' faces above BAR_Z, between BAR_Y along it, out past BAR_MID either side.
BAR_Z = 1.49
BAR_Y = (-0.40, -0.07)
BAR_MID = 0.14
# The headlamps' slits on the nose: up to |x| HEAD_X, between HEAD_Z (the front render: |x| 0.42..0.76, z 0.71..0.77).
HEAD_X = 0.78
HEAD_Z = (0.65, 0.86)
# How far apart along the car a headlamp cell's corners may land (its slits lie in a slanted, stepped face).
HEAD_SPREAD = 0.025
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


def lamps(body, px, s):
    out = []
    # (the slits: past them, the rays from ahead graze the front wings onto the white doors)
    white = [(x, z) for x, z in s.hits(False, "white") if HEAD_Z[0] <= z <= HEAD_Z[1] and abs(x) <= HEAD_X]
    red = s.hits(True, "red")
    for side, sx in (("L", -1), ("R", 1)):
        head = [(x, z) for x, z in white if x * sx > 0.2]
        tail = [(x, z) for x, z in red if x * sx > 0.2]
        print(f"[police_suv] head_{side}: {len(head)} cells, tail_{side}: {len(tail)} cells")
        for nm, cells in (("head", head), ("tail", tail)):
            xs, zs = [abs(x) for x, z in cells], [z for x, z in cells]
            print(f"[police_suv]   {nm}_{side}: |x| {min(xs):.2f}..{max(xs):.2f}, z {min(zs):.2f}..{max(zs):.2f}; by |x|: " + " ".join(f"{k / 10:.1f}:{sum(1 for x in xs if round(x, 1) == k / 10)}" for k in range(2, 10)))
        out.append(flat_lamp(f"head_{side}", s, body, head, "head", spread=HEAD_SPREAD))
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
    glass_not=lambda c: c.z > BAR_Z - 0.05 and BAR_Y[0] - 0.05 < c.y < BAR_Y[1] + 0.05,  # the bar's black middle
)

if __name__ == "__main__":
    kit.run(CAR)
