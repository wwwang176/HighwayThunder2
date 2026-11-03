"""
Muscle car model, finished in Blender from a generated body (tools/models/carkit.py does the most of it;
see docs/car-models.md).

Run (Blender 5.x, headless):
  blender -b --factory-startup -P tools/models/muscle_car.py -- [--out public/models/muscle-car.glb] [--preview DIR] [--collider TS]

Its own: the generated nose's jaw filled (`build_apron`), round twin headlamps over the texture's, front
indicators over its fog lamps.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import carkit as kit  # noqa: E402


def build_apron(body, px, z_out=0.345, inset=0.01, n=8):
    """Fills the generated nose's slot between the bumper and the splitter (a jaw from the side): a solid lower
    apron following the bumper's outline (at z_out) just inside it, from the splitter up under the bumper,
    unioned in. Each face takes the texture's colour at the body nearest it (so its paint shades on from the
    body's), or plain paint where that isn't paint."""
    bb = bmesh.new()
    bb.from_mesh(body.data)
    bmesh.ops.triangulate(bb, faces=bb.faces)
    bb.faces.ensure_lookup_table()
    buv = bb.loops.layers.uv.active
    tree = BVHTree.FromBMesh(bb)
    plain = kit.paint_uv(px)

    def uv_near(co):
        p, _, idx, _ = tree.find_nearest(co)
        f = bb.faces[idx]
        w = kit.barycentric(p, *(l.vert.co for l in f.loops))
        uv = sum((l[buv].uv * k for l, k in zip(f.loops, w)), Vector((0, 0)))
        return uv if kit.colour_class(kit.sample(px, uv)) == "paint" else plain

    back, z0, z1 = 1.58, 0.215, 0.335
    centre = Vector((0, back, z_out))
    side = []  # the bumper's outline at z_out, from the right side round to the front centre
    for i in range(n + 1):
        a = math.pi / 2 * i / n
        d = Vector((math.cos(a), math.sin(a), 0))
        p = tree.ray_cast(centre + d * 3, -d)[0]
        assert p is not None, f"apron: nothing at {math.degrees(a):.0f} degrees"
        side.append(p - d * inset)
    outline = [(-p.x, p.y) for p in side] + [(p.x, p.y) for p in reversed(side[:-1])]
    n = len(outline)
    verts = [(x, y, z) for z in (z0, z1) for x, y in outline]
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    me = bpy.data.meshes.new("apron")
    me.from_pydata(verts, [], faces)
    me.materials.append(body.data.materials[0])
    apron = bpy.data.objects.new("apron", me)
    bpy.context.collection.objects.link(apron)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4], ngon_method="EAR_CLIP")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    uv = bm.loops.layers.uv.new(body.data.uv_layers.active.name)
    for f in bm.faces:  # one texel a face (a UV per corner would stretch across the texture's islands)
        texel = uv_near(f.calc_center_median())
        for l in f.loops:
            l[uv].uv = texel
    bm.to_mesh(me)
    bm.free()
    bb.free()
    mod = body.modifiers.new("b", "BOOLEAN")
    mod.operation = "UNION"
    mod.solver = "EXACT"
    mod.use_hole_tolerant = True
    mod.object = apron
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier="b")
    bpy.data.objects.remove(apron)


def lamps(body, px, s):
    """Headlamps: a round lamp over each white disc on the nose (two a side). Front indicators: over the white
    fog lamps below them. Then the tail lights (kit.tail_lamps)."""
    out = []
    white = s.hits(False, "white")
    for side, sx in (("L", -1), ("R", 1)):
        head = sorted((x, z) for x, z in white if x * sx > 0 and z > 0.5)
        gap = max(range(1, len(head)), key=lambda i: head[i][0] - head[i - 1][0])  # between the two lamps
        parts = []
        for k, grp in enumerate((head[:gap], head[gap:])):
            cx = sum(x for x, z in grp) / len(grp)
            cz = sum(z for x, z in grp) / len(grp)
            r = math.sqrt(len(grp) * 1e-4 / math.pi)  # each hit stands for 1 cm²
            print(f"[muscle_car] head_{side}{k}: x {cx:.2f} z {cz:.2f} r {r:.3f}")
            parts.append(kit.round_lamp(f"head_{side}{k}", s.tree, body, cx, cz, r, "head"))
        out.append(kit.join(parts, f"head_{side}"))
        fog = [(x, z) for x, z in white if x * sx > 0 and z <= 0.5]
        x0, x1 = min(x for x, z in fog), max(x for x, z in fog)
        z0, z1 = min(z for x, z in fog), max(z for x, z in fog)
        out.append(kit.surface_plate(f"ind_F{side}", s.tree, x0, x1, z0, z1, "ind", back=False, nx=2, nz=1))
        kit.clear_of(out[-1], [body], Vector((0, 1, 0)))
    return out + kit.tail_lamps(s, body)


CAR = kit.Car(
    name="muscle-car",
    preview="muscle",
    width=1.99,
    src_ground=0.14,
    tyres=[(1.311, 0.321, 0.291, 0.578, 0.876), (-1.073, 0.325, 0.321, 0.604, 0.935)],
    tyre="275/40 R17",
    rim="bold-5",
    wheel_face=0.89,
    caliper=0x222225,
    # Paint and stripes (None: plain). The first is the car's own; the game picks among them by name.
    liveries=[
        ("orange-black", 0xF2780C, 0x141414),
        ("orange", 0xF2780C, None),
        ("blue-white", 0x1F5FC4, 0xF0F0F0),
        ("blue", 0x1F5FC4, None),
        ("black", 0x1A1A1C, None),
        ("black-white", 0x1A1A1C, 0xF0F0F0),
    ],
    collider="MUSCLE_CAR_COLLIDER",
    collider_file="muscleCarCollider",
    lamps=lamps,
    mend=build_apron,
)

if __name__ == "__main__":
    kit.run(CAR)
