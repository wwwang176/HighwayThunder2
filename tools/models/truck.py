"""
The traffic box truck's model, finished in Blender from a generated body (tools/models/carkit.py does the most of
it; see docs/car-models.md).

Run (Blender 5.x, headless):
  blender -b --factory-startup -P tools/models/truck.py -- [--out public/models/truck.glb] [--preview DIR]

Its own: a medium box truck, background traffic. Its cab takes the livery; its box stays white, a flat material of
its own (`plain`: the texture shares the cab's white with it). Its body all white, the headlamps can't be told by
colour: plates where they are, measured off a square front view. No collision file: the game gives traffic boxes of its own, and
its own shared wheels (the GLB's wheel is not used).
"""

import os
import sys

from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import carkit as kit  # noqa: E402

HEAD = (0.414, 0.593, 0.534, 0.667)  # the headlamps (|x| from, to, z from, to; working frame), off a square front view


def lamps(body, px, s):
    """Headlamps: plates over the texture's (HEAD), the front indicators over their outer 6 cm; the tail
    lights kit.tail_lamps."""
    out = []
    x0, x1, z0, z1 = HEAD
    for side, sx in (("L", -1), ("R", 1)):
        main = kit.surface_plate(f"head_{side}", s.tree, *sorted((sx * x0, sx * x1)), z0, z1, "head", back=False, nx=4, nz=1)
        kit.clear_of(main, [body], Vector((0, 1, 0)))
        sign = kit.surface_plate(f"ind_F{side}", s.tree, *sorted((sx * (x1 - 0.06), sx * x1)), z0, z1, "ind", back=False,
                                 nx=1, nz=1, lift=kit.LIFT * 2.5)
        kit.clear_of(sign, [body, main], Vector((0, 1, 0)))
        out += [main, sign]
    return out + kit.tail_lamps(s, body)


CAR = kit.Car(
    name="truck",
    # Its body 2.5 m across (1.438 working), the mirrors standing out to 3.11 m: about 7.4 m long, 3.3 m tall.
    width=3.11,
    src_ground=0.2260,
    tyres=[(1.290, 0.285, 0.285, 0.55, 0.71), (-1.168, 0.285, 0.285, 0.55, 0.70)],
    tyre="275/80 R22.5",
    rim="bold-5",
    wheel_face=0.71,
    # The traffic trucks' colours (src/vehicles/models.ts TRUCK_COLORS), named: the cab's.
    liveries=[
        ("white", 0xF2F2F2, None),
        ("blue", 0x2A5AA0, None),
        ("green", 0x2D7A46, None),
        ("yellow", 0xD6C13A, None),
    ],
    collider=None,
    collider_file=None,
    lamps=lamps,
    paint_grey=(0.795, 0.88),  # the cab's white, 0.81 to 0.84 (the box's 0.66 to 0.78, the headlamps 1.0)
    plain=(lambda c: c.y < 0.80, 0xE6E6E6),  # the box (its front 0.72; the cab's back 0.84): white whatever the cab
    glass_above=1.0,
    glass_v=(0.28, 0.38),  # its windows a blue-grey, 0.33 (the chassis 0.12 to 0.19)
    glass_y=(0.95, 2.1),  # the cab's (not the box's front)
)

if __name__ == "__main__":
    kit.run(CAR)
