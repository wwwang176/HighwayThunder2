"""
The tuned JDM sedan's model, finished in Blender from a generated body (tools/models/carkit.py does the most of
it; see docs/car-models.md).

Run (Blender 5.x, headless):
  blender -b --factory-startup -P tools/models/jdm.py -- [--out public/models/jdm.glb] [--preview DIR] [--collider TS]

Its own: its headlamps three square LED cells in a row in each of the texture's light grey housings (the
texture has the housings, not the cells), front indicators a thin strip under them; its tail lights three
stacked bars each side over the texture's red rows, the rear indicators their outer ends. Its paint is
blue; the roof black in every livery (`roof_above`), as the aero (the stripes' colour: black).
"""

import os
import sys

from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import carkit as kit  # noqa: E402

HOUSING = (0.485, 0.555)  # z of the headlamp cells (the texture's grey housings: z 0.48..0.56, |x| 0.40..0.76)
CELLS = (0.46, 0.58, 0.70)  # |x| of the cells' middles
CELL = 0.08  # wide
# The tail lights: three bars each side over the texture's three rows of red (z 0.60..0.62, 0.65..0.66 - blurred -,
# 0.69..0.71), short of the tail's corner (it turns sharply at |x| 0.76: a lamp across it can't clear the body).
TAIL_BARS = ((0.600, 0.622), (0.645, 0.667), (0.690, 0.712))
TAIL_X = (0.46, 0.74)


def lamps(body, px, s):
    out = []
    for side, sx in (("L", -1), ("R", 1)):
        cells = [kit.surface_plate(f"head_{side}{i}", s.tree, *sorted((sx * (c - CELL / 2), sx * (c + CELL / 2))), *HOUSING,
                                   "head", back=False, nx=2, nz=2) for i, c in enumerate(CELLS)]
        head = kit.join(cells, f"head_{side}")
        kit.clear_of(head, [body], Vector((0, 1, 0)))
        ind = kit.surface_plate(f"ind_F{side}", s.tree, *sorted((sx * 0.62, sx * 0.76)), 0.455, 0.472, "ind", back=False, nx=4, nz=1)
        kit.clear_of(ind, [body, head], Vector((0, 1, 0)))
        out += [head, ind]
    for side, sx in (("L", -1), ("R", 1)):
        x0, x1 = sorted((sx * TAIL_X[0], sx * TAIL_X[1]))
        tail = kit.join([kit.surface_plate(f"tail_{side}{i}", s.tree, x0, x1, *bar, "tail", back=True, nx=6, nz=1)
                         for i, bar in enumerate(TAIL_BARS)], f"tail_{side}")
        kit.clear_of(tail, [body], Vector((0, -1, 0)))
        x0, x1 = sorted((sx * (TAIL_X[1] - 0.06), sx * TAIL_X[1]))  # over the bars' outer ends
        ind = kit.join([kit.surface_plate(f"ind_R{side}{i}", s.tree, x0, x1, *bar, "ind", back=True, nx=1, nz=1, lift=kit.LIFT * 2.5)
                        for i, bar in enumerate(TAIL_BARS)], f"ind_R{side}")
        kit.clear_of(ind, [body, tail], Vector((0, -1, 0)))
        out += [tail, ind]
    return out


CAR = kit.Car(
    name="jdm",
    width=1.92,
    src_ground=0.1478,
    tyres=[(1.256, 0.287, 0.287, 0.645, 0.87), (-1.081, 0.287, 0.287, 0.645, 0.87)],
    tyre="245/30 R18",
    rim="bronze-10",
    wheel_face=0.87,
    caliper=0xE8B828,
    # Paint, and the colour of the dark on its tops (its black roof, hood vents, aero: black in all).
    liveries=[
        ("blue", 0x3A8DDE, 0x141414),
        ("white", 0xEDEDED, 0x141414),
        ("black", 0x1A1A1C, 0x141414),
        ("silver", 0xB8BCC2, 0x141414),
        ("red", 0xC8202A, 0x141414),
        ("yellow", 0xF2C21B, 0x141414),
    ],
    collider="JDM_COLLIDER",
    collider_file="jdmCollider",
    exhaust={"tips": [(-0.55, 0.22), (0.55, 0.22)], "back": 2.08, "r": 0.048},  # either side of its diffuser
    lamps=lamps,
    paint_hue=(0.52, 0.68),
    glass_above=0.78,
    glass_v=(0.06, 0.14),  # its windows came near black, as its trim: between the windscreen's foot and the rear window's
    glass_y=(-1.6, 0.8),
    roof_flat=0.85,  # its roof is rounded
    frames_above=0.88,  # its window frames and pillars black, as the roof (paint smudged on its B pillars)
    tops_above=0.7,
    roof_above=1.15,
)

if __name__ == "__main__":
    kit.run(CAR)
