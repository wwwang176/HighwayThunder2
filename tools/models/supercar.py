"""
Supercar model, finished in Blender from a generated body (tools/models/carkit.py does the most of it;
see docs/car-models.md).

Run (Blender 5.x, headless):
  blender -b --factory-startup -P tools/models/supercar.py -- [--out public/models/supercar.glb] [--preview DIR] [--collider TS]

Its own: the channel down the generated roof filled (`fill_roof`); its paint is red like its tail lights (`tail` tells them apart: the lights are the purer, fuller red),
its headlamps are thin angular LED strips (lamps laid cell by cell over the texture's), the front indicators
the strips' outer ends, its tail light bar a hairline on the texture (made 4 cm tall). Its black roof and
lower body stay black in every livery (the stripes' colour: black), the roof all of it (`roof_above`).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import carkit as kit  # noqa: E402


RIMS = ((0.461, 1.014), (0.095, 1.072), (-0.388, 1.030))  # the roof channel's rims (y, z), front to back


def fill_roof(body, px):
    """Fills the channel the generated roof has down its middle (the concept's roof is smooth): every vertex
    between its rims (|x| < 0.2), from the windscreen's top back to the rear window, raised to the rims'
    height there, so the roof runs flat across."""
    def rim(y):
        for (y0, z0), (y1, z1) in zip(RIMS, RIMS[1:]):
            if y1 <= y <= y0:
                return z0 + (z1 - z0) * (y0 - y) / (y0 - y1)

    raised = 0
    for v in body.data.vertices:
        if abs(v.co.x) < 0.2 and RIMS[-1][0] <= v.co.y < RIMS[0][0] - 0.01 and v.co.z > 0.99 and v.co.z < rim(v.co.y):
            v.co.z = rim(v.co.y)
            raised += 1
    print(f"[supercar] roof channel filled: {raised} vertices raised")


def lamps(body, px, s):
    """Headlamps: the white LED strips on the nose, cell by cell. Front indicators: over each strip's outer 8 cm.
    Then the tail lights (kit.tail_lamps)."""
    out = []
    white = s.hits(False, "white")
    for side, sx in (("L", -1), ("R", 1)):
        strip = [(x, z) for x, z in white if x * sx > 0]
        print(f"[supercar] head_{side}: {len(strip)} cells, |x| {min(abs(x) for x, z in strip):.2f}..{max(abs(x) for x, z in strip):.2f}")
        head = kit.cell_lamp(f"head_{side}", s, body, strip, "head")
        outer = max(abs(x) for x, z in strip) - 0.08
        ind = kit.cell_lamp(f"ind_F{side}", s, body, [(x, z) for x, z in strip if abs(x) >= outer], "ind",
                            lift=kit.LIFT * 2.5, others=[head])
        out += [head, ind]
    return out + kit.tail_lamps(s, body, min_height=0.04) + [kit.third_brake(s, body, seam=(-0.58, 0.997), half=0.2, height=0.03)]


CAR = kit.Car(
    name="supercar",
    width=2.0,
    src_ground=0.124,
    tyres=[(1.1645, 0.3124, 0.304, 0.604, 0.8755), (-1.196, 0.3124, 0.304, 0.6035, 0.884)],
    tyre="305/25 R20",
    rim="thin-10",
    wheel_face=0.89,
    caliper=0xD62828,
    # Paint, and the colour of the dark on its tops (its black roof and deck: black in all).
    liveries=[
        ("red", 0xD62828, 0x141414),
        ("yellow", 0xF2C21B, 0x141414),
        ("blue", 0x1F5FC4, 0x141414),
        ("white", 0xEDEDED, 0x141414),
        ("black", 0x1A1A1C, 0x141414),
        ("silver", 0xB8BCC2, 0x141414),
    ],
    collider="SUPERCAR_COLLIDER",
    collider_file="supercarCollider",
    exhaust={"tips": [(-0.3, 0.25), (0.3, 0.25)], "back": 2.1, "r": 0.045},  # in its diffuser, either side of the middle
    lamps=lamps,
    mend=fill_roof,
    paint_hue=(0.97, 0.03),
    tail=lambda h, s, v: s > 0.95 and v > 0.4 and (h < 0.004 or h > 0.95),
    glass_above=0.68,
    tops_above=0.6,
    roof_above=0.97,  # (the roof came smudged with paint, and its black the windows' grey; the engine's glass lies lower)
)

if __name__ == "__main__":
    kit.run(CAR)
