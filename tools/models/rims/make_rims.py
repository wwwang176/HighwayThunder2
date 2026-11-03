"""
The rim models (tools/models/rims/<name>.blend, read by tools/models/wheels.py): how they were first made.
A rim is a model: open its .blend in Blender to change it. For a new one, add a block at the end here (or model
it in Blender by wheels.py's rules), run, and look at it on its wheel before it goes on a car.

  blender -b --factory-startup -P tools/models/rims/make_rims.py

Each is made at 20 x 9 inches: beads at radius 0.266 (seat 0.254 + flange 0.012), x +-0.1143 (wheels.py
stretches it to the tyre). Low poly (a wheel under 1000 triangles): the spokes' ends and the nuts' backs are
buried (in the hub, in the rim), left open.
"""

import math
import os

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
SEG = 40  # wheels.SEGMENTS
HW, SEAT = 0.1143, 0.254
RB = SEAT + 0.012
# The lip (2 bands: its face, its inner edge) and the barrel (1 band, straight back to the inner bead).
LIP_AND_BARREL = [(HW, RB), (HW + 0.008, SEAT - 0.008), (HW - 0.006, SEAT - 0.018), (-HW, RB)]
DISC = 0xC8CCD2  # brake discs: bright steel (half metal: the game has no reflections to light a full metal)


def srgb(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def material(name, hex_, rough, metal):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb(hex_), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    m.diffuse_color = (*srgb(hex_), 1)
    return m


def obj(name, verts, faces, mats, face_mats=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    for m in mats:
        me.materials.append(m)
    if face_mats:
        for p, i in zip(me.polygons, face_mats):
            p.material_index = i
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return o


def P(x, r, a, s=0.0):
    """x along the axle, r out from it at angle a, s sideways (square to the radius)."""
    return (x, r * math.cos(a) - s * math.sin(a), r * math.sin(a) + s * math.cos(a))


def slice_(n, profile, lip_bands, mats):
    """The rim's surface (profile (x, r) from the outer bead to the inner) for one of its n spokes' shares, a
    vertex every 360/SEG degrees; the first `lip_bands` bands mats[0], the rest mats[1]."""
    m = SEG // n
    verts = [P(x, r, 2 * math.pi * k / SEG) for x, r in profile for k in range(m + 1)]
    faces, fm = [], []
    for i in range(len(profile) - 1):
        for k in range(m):
            a, b = i * (m + 1) + k, (i + 1) * (m + 1) + k
            faces.append((a, b, b + 1, a + 1))
            fm.append(0 if i < lip_bands else 1)
    o = obj("slice", verts, faces, mats, fm)
    o["spokes"], o["bead_r"], o["half_width"] = n, RB, HW
    return o


def spoke(n, sections, depth, ch, mat):
    """sections: (r, x of its face, width) from the hub out; square to the radius, `depth` deep, its face's
    edges chamfered `ch` (0: square). A tube: both ends buried (in the hub, in the rim)."""
    a = math.pi / n  # the share's middle
    if ch:
        shape = lambda xf, w: ((-w / 2, xf - depth), (-w / 2, xf - ch), (-w / 2 + ch, xf), (w / 2 - ch, xf), (w / 2, xf - ch), (w / 2, xf - depth))  # noqa: E731
    else:
        shape = lambda xf, w: ((-w / 2, xf - depth), (-w / 2, xf), (w / 2, xf), (w / 2, xf - depth))  # noqa: E731
    verts = [P(x, r, a, s) for r, xf, w in sections for s, x in shape(xf, w)]
    k = 6 if ch else 4
    faces = [(i * k + j, (i + 1) * k + j, (i + 1) * k + (j + 1) % k, i * k + (j + 1) % k)
             for i in range(len(sections) - 1) for j in range(k)]
    return obj("spoke", verts, faces, [mat])


def cylinder(name, x0, x1, r, mat, n, centre=(0.0, 0.0), phase=0.0, back=True):
    """Along X from x0 (back) to x1 (front), n sides, capped in front (and behind, unless `back` is False)."""
    cy, cz = centre
    verts = [(x, cy + r * math.cos(phase + 2 * math.pi * i / n), cz + r * math.sin(phase + 2 * math.pi * i / n))
             for x in (x0, x1) for i in range(n)]
    faces = [tuple(range(n, 2 * n))] + ([tuple(range(n))[::-1]] if back else [])
    faces += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return obj(name, verts, faces, [mat])


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = o.data.name = name
    return o


def hub(r, x0, x1, nut_r, mats, n=12):
    """Hub (n sides) and five hex nuts on its face at the 114.3 mm bolt circle (at 0 degrees and every 72:
    between the spokes of a 5 or 10 spoke rim)."""
    parts = [cylinder("hub", x0, x1, r, mats["hub"], n)]
    for i in range(5):
        a = 2 * math.pi * i / 5
        parts.append(cylinder("nut", x1 - 0.004, x1 + 0.010, nut_r, mats["lug"], 6, (0.05715 * math.cos(a), 0.05715 * math.sin(a)), a, back=False))
    return join(parts, "hub")


def faced(o):
    """Its faces turned consistently (outward)."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(o.data)
    bm.free()


def save(name):
    path = os.path.join(HERE, f"{name}.blend")
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    print(f"[rim] wrote {path}")


# thin-10 (the supercar): ten thin straight spokes, gently dished, all black; the brake disc behind them.
bpy.ops.wm.read_factory_settings(use_empty=True)
M = {"lip": material("wheel_lip", 0x2C2C30, 0.3, 0.6), "rim": material("wheel_rim", 0x111113, 0.8, 0.1),
     "spoke": material("wheel_spoke", 0x1C1C1F, 0.4, 0.5), "hub": material("wheel_hub", 0x1C1C1F, 0.4, 0.5),
     "lug": material("wheel_lug", 0x9A9AA0, 0.3, 0.9), "brake": material("wheel_brake", DISC, 0.3, 0.6)}
slice_(10, LIP_AND_BARREL, 2, [M["lip"], M["rim"]])
for o in (spoke(10, [(0.068, HW - 0.060, 0.028), (0.16, HW - 0.042, 0.023), (0.246, HW - 0.012, 0.018)], 0.032, 0, M["spoke"]),
          hub(0.078, HW - 0.098, HW - 0.050, 0.0085, M),
          cylinder("brake", HW - 0.150, HW - 0.122, 0.190, M["brake"], 20)):
    faced(o)
save("thin-10")

# bold-5 (the muscle car): five broad spokes, polished lip; the brake disc behind them.
bpy.ops.wm.read_factory_settings(use_empty=True)
M = {"lip": material("wheel_lip", 0xC8C8D0, 0.2, 0.9), "rim": material("wheel_rim", 0x1E1E22, 0.45, 0.4),
     "spoke": material("wheel_spoke", 0x8A8A92, 0.3, 0.85), "hub": material("wheel_hub", 0x8A8A92, 0.3, 0.85),
     "lug": material("wheel_lug", 0xA0A0A8, 0.3, 0.9), "brake": material("wheel_brake", DISC, 0.3, 0.6)}
slice_(5, LIP_AND_BARREL, 2, [M["lip"], M["rim"]])
for o in (spoke(5, [(0.065, HW - 0.072, 0.080), (0.16, HW - 0.052, 0.066), (0.246, HW - 0.013, 0.052)], 0.050, 0.010, M["spoke"]),
          hub(0.075, HW - 0.125, HW - 0.062, 0.0095, M),
          cylinder("brake", HW - 0.165, HW - 0.140, 0.190, M["brake"], 20)):
    faced(o)
save("bold-5")

# bronze-10 (the JDM car): ten spokes deep in a bronze dish, the lip bronze too; the brake disc behind them.
bpy.ops.wm.read_factory_settings(use_empty=True)
M = {"lip": material("wheel_lip", 0x9A7442, 0.3, 0.7), "rim": material("wheel_rim", 0x2E2418, 0.7, 0.3),
     "spoke": material("wheel_spoke", 0x8A6A3C, 0.35, 0.7), "hub": material("wheel_hub", 0x8A6A3C, 0.35, 0.7),
     "lug": material("wheel_lug", 0x2A2A2C, 0.4, 0.6), "brake": material("wheel_brake", DISC, 0.3, 0.6)}
slice_(10, LIP_AND_BARREL, 2, [M["lip"], M["rim"]])
for o in (spoke(10, [(0.068, HW - 0.085, 0.030), (0.16, HW - 0.060, 0.026), (0.246, HW - 0.016, 0.022)], 0.032, 0, M["spoke"]),
          hub(0.078, HW - 0.120, HW - 0.075, 0.0085, M),
          cylinder("brake", HW - 0.170, HW - 0.142, 0.190, M["brake"], 20)):
    faced(o)
save("bronze-10")
