"""
The traffic container truck's tractor unit (its cab and chassis; the trailer is a model of its own), finished in
Blender from a generated body (tools/models/carkit.py does the most of it; see docs/car-models.md).

Run (Blender 5.x, headless):
  blender -b --factory-startup -P tools/models/cab.py -- [--out public/models/cab.glb] [--preview DIR]

Its own: three axles (the two at the back with twin tyres); its paint a navy, dark (`paint_fade`); its liveries the
trucks' colours. The generated mirrors came out small (a little block on a thin arm): it gets heads of a truck's
size at the arms' ends. No collision file: the game gives traffic boxes of its own, and its own shared wheels (the
GLB's wheel is not used).
"""

import os
import sys

import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import carkit as kit  # noqa: E402

# A mirror head (working frame, before centring; the right one, the left mirrored): x, y, z from and to. Hung
# under the generated arm's end ((0.96, 1.79, 1.38..1.43)), outboard of its little block ((0.74..0.85, 1.67..1.79,
# 1.24..1.32)).
MIRROR = ((0.92, 1.0), (1.72, 1.84), (1.08, 1.45))


def mend(body, px):
    """Its mirrors' heads: boxes in the body, taking the texture's colour of the generated mirror block (black)."""
    me = body.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.active
    (x0, x1), (y0, y1), (z0, z1) = MIRROR
    mid = kit.CAR.axle_mid
    block = min(bm.faces, key=lambda f: (f.calc_center_median() - Vector((0.80, 1.73 - mid, 1.28))).length)
    dark = block.loops[0][uv].uv.copy()
    for sx in (-1, 1):
        a, b = sorted((sx * x0, sx * x1))
        made = bmesh.ops.create_cube(bm, size=1.0)["verts"]
        for v in made:
            v.co = Vector((a if v.co.x < 0 else b, (y0 if v.co.y < 0 else y1) - mid, z0 if v.co.z < 0 else z1))
        for f in {f for v in made for f in v.link_faces}:
            f.material_index = block.material_index
            for loop in f.loops:
                loop[uv].uv = dark
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    print(f"[cab] mirrors: heads {x1 - x0:.2f} x {y1 - y0:.2f} x {z1 - z0:.2f} (working)")


def lamps(body, px, s):
    """Headlamps: plates over the texture's white, the front indicators over their outer 6 cm; the tail lights
    kit.tail_lamps."""
    out = []
    hits = s.hits(False, "white", zs=range(30, 111))
    z0, z1 = min(z for x, z in hits), max(z for x, z in hits)
    x0, x1 = min(abs(x) for x, z in hits), max(abs(x) for x, z in hits)
    print(f"[cab] head: {len(hits)} cells, z {z0:.2f}..{z1:.2f}, |x| {x0:.2f}..{x1:.2f}")
    for side, sx in (("L", -1), ("R", 1)):
        main = kit.surface_plate(f"head_{side}", s.tree, *sorted((sx * x0, sx * x1)), z0, z1, "head", back=False, nx=4, nz=1)
        kit.clear_of(main, [body], Vector((0, 1, 0)))
        sign = kit.surface_plate(f"ind_F{side}", s.tree, *sorted((sx * (x1 - 0.06), sx * x1)), z0, z1, "ind", back=False,
                                 nx=1, nz=1, lift=kit.LIFT * 2.5)
        kit.clear_of(sign, [body, main], Vector((0, 1, 0)))
        out += [main, sign]
    return out + kit.tail_lamps(s, body)


CAR = kit.Car(
    name="cab",
    # Its cab 2.5 m across (1.69 working), the mirrors' heads standing out to 2.96 m: about 6.3 m long, 3.7 m tall.
    width=2.96,
    src_ground=0.2945,
    # Front; the back two, twin tyres (their inner one's inner side 0.43). Out to 0.82: the hubs' faces left at 0.80, black.
    tyres=[(1.189, 0.345, 0.345, 0.60, 0.82), (-0.842, 0.345, 0.345, 0.43, 0.82), (-1.555, 0.345, 0.345, 0.43, 0.82)],
    tyre="295/80 R22.5",
    rim="bold-5",
    wheel_face=0.81,
    # The traffic trucks' colours (src/vehicles/models.ts TRUCK_COLORS), named.
    liveries=[
        ("white", 0xF2F2F2, None),
        ("blue", 0x2A5AA0, None),
        ("green", 0x2D7A46, None),
        ("yellow", 0xD6C13A, None),
    ],
    collider=None,
    collider_file=None,
    lamps=lamps,
    mend=mend,
    paint_hue=(0.52, 0.65),  # its navy, hue 0.58
    paint_fade=0.2,  # its navy dark, 0.24 to 0.28 (fading into black only below that)
    trim=True,  # (its chassis and fifth wheel share the navy's texels)
    glass_above=1.2,
    glass_y=(2.0, 3.0),  # the windscreen only: its side windows are in the texture, across big faces of the doors

    glass_v=(0.33, 0.45),  # its windows a light grey, 0.38 (its paint 0.27, saturated; the chassis under 0.06)
)

if __name__ == "__main__":
    kit.run(CAR)
