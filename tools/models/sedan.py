"""
The traffic sedan's model, finished in Blender from a generated body (tools/models/carkit.py does the most of it;
see docs/car-models.md).

Run (Blender 5.x, headless):
  blender -b --factory-startup -P tools/models/sedan.py -- [--out public/models/sedan.glb] [--preview DIR]

Its own: background traffic, many on screen. Its paint is a grey (silver: told by brightness, `paint_grey`);
its liveries the traffic's colours (the game picks one per car). Its lamps plain plates over the texture's;
the indicators their outer ends. No collision file: the game gives traffic boxes of its own, and its own shared
wheels (the GLB's wheel is not used).
"""

import os
import sys

from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import carkit as kit  # noqa: E402


def mend(body, px):
    """Its generated body's flaws. The windscreen meets the roof's front edge in a small wavy step (1 to 3 cm,
    facing forward: from outside, paint dripping into the glass along its top): its lower corners raised to
    its upper ones beside them, so the glass runs up to the edge."""
    me = body.data
    lip = [p for p in me.polygons if p.normal.y > 0.8 and p.normal.z < 0.6 and p.center.z > 1.25 and abs(p.center.x) < 0.6
           and 0.15 < p.center.y < 0.4]
    vs = {i for p in lip for i in p.vertices}
    raised = 0
    for i in vs:
        v = me.vertices[i].co
        top = max(me.vertices[j].co.z for j in vs if abs(abs(me.vertices[j].co.x) - abs(v.x)) < 0.05)
        if v.z < top - 0.005:
            v.z = top
            raised += 1
    print(f"[sedan] windscreen header: {len(lip)} step faces, {raised} vertices raised")
    # Its roof peaks in the middle (4 to 5 cm over its edges, most halfway back, and on down to the rear
    # window's top): brought down to 40% of that over its edges (|x| 0.5: z 1.381 at the windscreen's top,
    # y 0.2; 1.394 at the roof's back, y -1.0; 1.339 along the rear window's top, y -1.14).
    lowered = 0
    for v in me.vertices:
        c = v.co
        if abs(c.x) <= 0.52 and -1.16 <= c.y <= 0.22:
            edge = (1.381 + (1.394 - 1.381) * (0.2 - c.y) / 1.2 if c.y >= -1.0
                    else 1.394 + (1.339 - 1.394) * min(1.0, (-1.0 - c.y) / 0.14))
            if c.z > edge:
                c.z = edge + (c.z - edge) * 0.4
                lowered += 1
    print(f"[sedan] roof: {lowered} vertices lowered")


def lamps(body, px, s):
    """Each lamp a plain plate over the texture's (a few triangles: traffic is many): the headlamps over its
    white, the front indicators over their outer 6 cm; the tail lights kit.tail_lamps."""
    out = []
    d = {False: Vector((0, 1, 0)), True: Vector((0, -1, 0))}  # (out of the nose, out of the tail)
    for want, back, lamp, ind in (("white", False, "head", "F"),):
        hits = s.hits(back, want, zs=range(30, 111))
        z0, z1 = min(z for x, z in hits), max(z for x, z in hits)
        x0, x1 = min(abs(x) for x, z in hits), max(abs(x) for x, z in hits)
        print(f"[sedan] {lamp}: {len(hits)} cells, z {z0:.2f}..{z1:.2f}, |x| {x0:.2f}..{x1:.2f}")
        for side, sx in (("L", -1), ("R", 1)):
            main = kit.surface_plate(f"{lamp}_{side}", s.tree, *sorted((sx * x0, sx * x1)), z0, z1, lamp, back=back, nx=4, nz=1)
            kit.clear_of(main, [body], d[back])
            sign = kit.surface_plate(f"ind_{ind}{side}", s.tree, *sorted((sx * (x1 - 0.06), sx * x1)), z0, z1, "ind", back=back,
                                     nx=1, nz=1, lift=kit.LIFT * 2.5)
            kit.clear_of(sign, [body, main], d[back])
            out += [main, sign]
    return out + kit.tail_lamps(s, body, most_x=0.70) + [kit.third_brake(s, body, seam=(-1.15, 1.331), half=0.25)]  # (its tail lights wrap round the corners)


CAR = kit.Car(
    name="sedan",
    width=1.94,  # its body 1.75 m across (1.804 working), the mirrors standing out to 1.94 m
    src_ground=0.1693,
    tyres=[(1.345, 0.305, 0.305, 0.62, 0.86), (-1.185, 0.305, 0.305, 0.62, 0.86)],
    tyre="185/60 R15",
    rim="bold-5",
    wheel_face=0.86,
    # The traffic's colours (src/vehicles/models.ts CAR_COLORS), named; plain paint.
    liveries=[
        ("silver", 0x8A8F96, None),
        ("white", 0xE8E8E8, None),
        ("black", 0x2B2B2B, None),
        ("blue", 0x1D4E89, None),
        ("red", 0xB3261E, None),
        ("green", 0x2E6B3A, None),
        ("beige", 0xD9C7A3, None),
        ("indigo", 0x5B5F97, None),
        ("yellow", 0xF0B429, None),
        ("brown", 0x6C3B2A, None),
    ],
    collider=None,
    collider_file=None,
    lamps=lamps,
    mend=mend,
    paint_grey=(0.42, 0.62),  # its silver, 0.53 to 0.58, its doors lower down to 0.43 (the windows 0.29, the rear bumper 0.33 to 0.41, the lamps over 0.75)
    glass_above=0.88,
    glass_v=(0.12, 0.32),  # its windows a little lighter than the racers' (their shaded feet 0.14 to 0.18)
    glass_bend=35,  # its windscreen and rear window rounder than the racers' (at 12 their edges were left paint)
    glass_fill=True,  # (slivers of paint across its rear window)
    tops_above=0.8,
)

if __name__ == "__main__":
    kit.run(CAR)
