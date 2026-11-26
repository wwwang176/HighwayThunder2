"""
The police SUV's model, finished in Blender from a generated body (tools/models/carkit.py does the most of it; see
docs/car-models.md).

Run (Blender 5.x, headless):
  blender -b --factory-startup -P tools/models/police_suv.py -- [--out public/models/police-suv.glb] [--preview DIR] [--collider TS]

Its own:
- its LEFT half (-x) kept and mirrored (`mirror=-1`): the concept images showed its left side, the right one (its push
  bar's wrap-round) guessed;
- its headlamps over the texture's white slits on the nose, its tail lights over the C shapes on the tail: outlines
  of their shapes drawn smooth (HEAD_SHAPE, TAIL_SHAPE: the texture's are blurred and broken, its cells a jagged
  lamp); no indicators (the game shows none it hasn't);
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
# How far apart along the car a headlamp facet's corners may land: its face slants back steeply round the hook (3 cm
# a cm); the steps (the hood's lip over it at z 0.80, 15 cm; a slot at |x| 0.40, 8 cm) the outline keeps clear of.
HEAD_SPREAD = 0.05
# The left headlamp's outline (x, z; seen from ahead, working frame), smooth where the texture's white is ragged (its
# cells: a slit z ~0.76..0.79 under the hood's lip, deeper outboard, its inner end hooking down to 0.71): its top,
# its inner end down the hook, the hook's foot, back up its inside, the slit's thin middle, outboard's deeper part,
# its outer end.
HEAD_SHAPE = [(-0.745, 0.791), (-0.428, 0.791), (-0.416, 0.712), (-0.436, 0.712), (-0.452, 0.767), (-0.598, 0.767),
              (-0.622, 0.753), (-0.745, 0.755)]
# The left tail light's outline (x, z; seen from behind, working frame): the texture's C (a white core in a red rim),
# open inboard: its outside from the top arm's end round the rounded corners to the bottom arm's end, then its inside
# back. Its face slants round the corner smoothly (no step).
TAIL_SHAPE = [(-0.578, 0.977), (-0.685, 0.977), (-0.696, 0.973), (-0.700, 0.962), (-0.700, 0.745), (-0.695, 0.732),
              (-0.682, 0.725), (-0.578, 0.725), (-0.578, 0.758), (-0.660, 0.758), (-0.666, 0.764), (-0.666, 0.938),
              (-0.660, 0.944), (-0.578, 0.944)]
TAIL_SPREAD = 0.025
# The third brake light: a bar across the rear window's top, under the roof's spoiler lip (the texture's red is on
# the lip's underside, facing down: unseen from behind; the window starts under the lip at z ~1.345, y -1.751).
BRAKE3_SHAPE = [(-0.25, 1.300), (0.25, 1.300), (0.25, 1.335), (-0.25, 1.335)]
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


def lamps(body, px, s):
    out = []
    for side, sx in (("L", -1), ("R", 1)):
        for nm, outline, spread, back in (("head", HEAD_SHAPE, HEAD_SPREAD, False), ("tail", TAIL_SHAPE, TAIL_SPREAD, True)):
            out.append(kit.shape_lamp(f"{nm}_{side}", s, body, outline, nm, spread, back, flip=sx > 0))
    out.append(kit.shape_lamp("brake_C", s, body, BRAKE3_SHAPE, "brake", TAIL_SPREAD, back=True))
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
