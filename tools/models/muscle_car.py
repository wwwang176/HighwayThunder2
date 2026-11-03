"""
Muscle car model, finished in Blender from a generated body.

Run (Blender 5.x, headless):
  blender -b --factory-startup -P tools/models/muscle_car.py -- --out public/models/muscle-car.glb [--preview DIR]

The body comes from tools/models/src/muscle-car-tripo.glb: Tripo3D's multiview-to-model from our concept
images (docs/art/muscle-car: front34, side, rear34; smart low poly). This script:
  - turns it into the game's frame and size (nose toward +y, 4.25 m long, wheels on the ground),
  - makes it exactly symmetric (the right half mirrored onto the left),
  - strips the generated tyres (our own wheel goes in their place),
  - makes its texture's paint white, so the game can tint the `paint` material any colour,
  - adds the lamps as separate objects over the texture's lamps (the game switches them).

Builds in Blender space (X right, Y forward = nose, Z up), then moves the body down so the origin
is GROUND above the ground, midway between the axles. Exported Y-up: the nose points to -Z in three.js.

Objects in the GLB (the game finds them by name):
  body                        paint (the texture; tinted by the game)
  head_L / head_R             headlamps (the texture's lamp faces, lifted off the body)
  tail_L / tail_R             the tail light bar's halves (also the brake lights)
  ind_FL ind_FR ind_RL ind_RR indicators (glowing plates over the fog lamps and the bar's ends, hidden while off)
  wheel                       one wheel at the origin, axle along X, rim face +X (outer side on the right)
"""

import colorsys
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "src", "muscle-car-tripo.glb")
GROUND = 0.55  # the origin's height above the ground
LENGTH = 4.25

# The generated car (1 m long, nose toward +x, its tyres' bottom at z = -0.14), into ours.
SRC_SCALE = LENGTH / 1.0
SRC_GROUND = 0.14
# Its tyres, in our frame before centring: (axle y, axle z, radius, inner x, outer x).
SRC_TYRES = [(1.311, 0.321, 0.291, 0.578, 0.876), (-1.073, 0.325, 0.321, 0.604, 0.935)]
AXLE_MID = (SRC_TYRES[0][0] + SRC_TYRES[1][0]) / 2  # the origin goes here, midway between the axles

WHEEL_R = 0.305
WHEEL_W = 0.30
WHEEL_X = 0.74
WHEEL_YF = SRC_TYRES[0][0] - AXLE_MID
WHEEL_YR = SRC_TYRES[1][0] - AXLE_MID
WHEEL_Z = WHEEL_R

LIFT = 0.003  # how far a lamp floats off the body (no faces touching)


# ---------------------------------------------------------------- materials

def material(name, rgb, rough=0.5, metal=0.0, emit=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.roughness = rough
    m.metallic = metal
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*rgb, 1)
        bsdf.inputs["Emission Strength"].default_value = emit
    return m


def srgb(hex_):
    c = [((hex_ >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


MAT = {}


def make_materials():
    MAT["head"] = material("lamp_head", srgb(0xFFD890), 0.2, 0, 1.0)  # warm (the game swaps in its own glow)
    MAT["tail"] = material("lamp_tail", srgb(0xE00808), 0.2, 0, 1.2)  # (the game swaps in its own: dim, bright braking)
    MAT["ind"] = material("lamp_ind", srgb(0xFF9A10), 0.2, 0, 2)
    MAT["tyre"] = material("tyre", srgb(0x0B0B0B), 0.95)
    MAT["rim"] = material("rim", srgb(0x1E1E22), 0.4, 0.6)
    MAT["spoke"] = material("spoke", srgb(0x707078), 0.3, 0.8)


# ---------------------------------------------------------------- helpers

def mesh_object(name, verts, faces, mats, face_mats=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    for m in mats:
        me.materials.append(MAT[m])
    if face_mats:
        for poly, i in zip(me.polygons, face_mats):
            poly.material_index = i
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return ob


BOX_FACES = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]


def box(name, x0, x1, y0, y1, z0, z1, mat):
    v = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    return mesh_object(name, v, BOX_FACES, [mat])


def disc(name, x, y, z, r, depth, mat, n=16):
    """A round lamp (a short cylinder along Y), its front face at y."""
    v = []
    for yy in (y - depth, y):
        for i in range(n):
            a = 2 * math.pi * i / n
            v.append((x + r * math.cos(a), yy, z + r * math.sin(a)))
    f = [tuple(range(n)), tuple(range(n, 2 * n))]
    f += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return mesh_object(name, v, f, [mat])


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = ob.data.name = name
    return ob


def union(target, parts):
    """Exact boolean union of each of `parts` into `target` (removing them)."""
    for p in parts:
        mod = target.modifiers.new("b", "BOOLEAN")
        mod.operation = "UNION"
        mod.solver = "EXACT"
        mod.material_mode = "TRANSFER"
        mod.object = p
        bpy.context.view_layer.objects.active = target
        bpy.ops.object.modifier_apply(modifier="b")
        bpy.data.objects.remove(p)
    return target


# ---------------------------------------------------------------- the body

def load_body():
    """The generated body in our frame, symmetric, its tyres gone; and its texture (pixels, H x W x 4)."""
    bpy.ops.import_scene.gltf(filepath=SRC, merge_vertices=True)
    ob = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    ob.data.transform(Matrix.Translation((0, -AXLE_MID, SRC_GROUND * SRC_SCALE)) @ Matrix.Scale(SRC_SCALE, 4)
                      @ Matrix.Rotation(math.pi / 2, 4, "Z") @ ob.matrix_world)
    ob.matrix_world = Matrix.Identity(4)
    ob.name = ob.data.name = "body"
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    # The right half (+x) mirrored onto the left: exactly symmetric, the seam welded.
    bmesh.ops.symmetrize(bm, input=bm.verts[:] + bm.edges[:] + bm.faces[:], direction="X", dist=1e-4)

    def in_tyre(v):
        for wy, wz, r, x0, x1 in SRC_TYRES:
            if math.hypot(v.co.y - (wy - AXLE_MID), v.co.z - wz) < r + 0.02 and x0 - 0.03 <= abs(v.co.x) <= x1 + 0.04:
                return True
        return False
    tyres = [f for f in bm.faces if all(in_tyre(v) for v in f.verts)]
    bmesh.ops.delete(bm, geom=tyres, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    # Bits of tread left floating where the tyres met the ground.
    bmesh.ops.delete(bm, geom=[v for part in loose_parts(bm) if len(part) < 20 for v in part], context="VERTS")
    # The holes the tyres left where they met the wheel wells (and a few the generation left): closed, each
    # corner taking its UV from the face beside it.
    uv = bm.loops.layers.uv.active
    around = {v: next(l[uv].uv.copy() for l in v.link_loops) for e in bm.edges if e.is_boundary for v in e.verts}
    new = bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)["faces"]
    new = bmesh.ops.triangulate(bm, faces=new, quad_method="BEAUTY", ngon_method="EAR_CLIP")["faces"]
    for f in new:
        for l in f.loops:
            l[uv].uv = around[l.vert]
    bm.to_mesh(ob.data)
    bm.free()

    img = ob.data.materials[0].node_tree.nodes["Image Texture"].image
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    return ob, px


def loose_parts(bm):
    """The mesh's connected pieces, as lists of verts."""
    seen, parts = set(), []
    for v in bm.verts:
        if v in seen:
            continue
        seen.add(v)
        stack, part = [v], []
        while stack:
            a = stack.pop()
            part.append(a)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b not in seen:
                    seen.add(b)
                    stack.append(b)
        parts.append(part)
    return parts


def colour_class(rgb):
    h, s, v = colorsys.rgb_to_hsv(*rgb)
    if v > 0.75 and s < 0.3:
        return "white"
    if s > 0.6 and v > 0.45 and (h < 0.012 or h > 0.95):
        return "red"
    if s > 0.45 and v > 0.25 and 0.012 <= h < 0.14:
        return "paint"
    return "dark" if v < 0.12 else "grey"


def sample(px, uv):
    h, w = px.shape[:2]
    return px[min(h - 1, max(0, int(uv.y % 1 * h))), min(w - 1, max(0, int(uv.x % 1 * w))), :3]


def paint_mask(px):
    """The texture's paint pixels (colour_class "paint", vectorised) and every pixel's brightness."""
    rgb = px[..., :3]
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    hue = np.where(mx == r, ((g - b) / np.maximum(mx - mn, 1e-6)) % 6, np.where(mx == g, (b - r) / np.maximum(mx - mn, 1e-6) + 2,
                                                                                (r - g) / np.maximum(mx - mn, 1e-6) + 4)) / 6
    return (s > 0.45) & (mx > 0.25) & (hue >= 0.012) & (hue < 0.14), mx


def paint_uv(px):
    """A UV in the middle of a patch of plain paint, of the paint's usual brightness."""
    paint, mx = paint_mask(px)
    solid = paint.copy()
    for dy in range(-6, 7, 3):
        for dx in range(-6, 7, 3):
            solid &= np.roll(paint, (dy, dx), axis=(0, 1))
    ys, xs = np.nonzero(solid)
    i = np.argmin(np.abs(mx[ys, xs] - np.median(mx[paint])))
    h, w = paint.shape
    return Vector(((xs[i] + 0.5) / w, (ys[i] + 0.5) / h))


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
    plain = paint_uv(px)

    def uv_near(co):
        p, _, idx, _ = tree.find_nearest(co)
        f = bb.faces[idx]
        w = barycentric(p, *(l.vert.co for l in f.loops))
        uv = sum((l[buv].uv * k for l, k in zip(f.loops, w)), Vector((0, 0)))
        return uv if colour_class(sample(px, uv)) == "paint" else plain

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


def white_paint(ob, px):
    """The texture with its paint made white (keeping its light and shade), as the `paint` material."""
    paint, mx = paint_mask(px)
    ref = np.percentile(mx[paint], 90)  # the paint's bright, lit tone goes to white
    out = px.copy()
    out[paint, :3] = np.minimum(1.0, mx[paint] / ref)[:, None]
    h, w = px.shape[:2]
    img = bpy.data.images.new("paint", w, h, alpha=True)
    img.pixels.foreach_set(out.ravel())
    img.scale(1024, 1024)
    img.pack()
    m = ob.data.materials[0]
    m.name = "paint"
    m.node_tree.nodes["Image Texture"].image = img
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*srgb(0xF2780C), 1)
    # Base colour times the texture: the game's tint.
    nt = m.node_tree
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    mix.inputs[7].default_value = (*srgb(0xF2780C), 1)
    nt.links.new(nt.nodes["Image Texture"].outputs["Color"], mix.inputs[6])
    nt.links.new(mix.outputs[2], nt.nodes["Principled BSDF"].inputs["Base Color"])


# ---------------------------------------------------------------- lamps

def surface_plate(name, tree, x0, x1, z0, z1, mat, back, nx=8, nz=2, lift=LIFT):
    """A plate over the body's tail (or nose) between x0..x1, z0..z1, following its surface, `lift` off it."""
    d = Vector((0, 1, 0)) if back else Vector((0, -1, 0))
    verts = []
    for k in range(nz + 1):
        for i in range(nx + 1):
            x = x0 + (x1 - x0) * i / nx
            z = z0 + (z1 - z0) * k / nz
            hit = tree.ray_cast(Vector((x, 0, z)) - d * 5, d)[0]
            assert hit is not None, f"{name}: nothing at x {x:.2f} z {z:.2f}"
            verts.append(tuple(hit - d * lift))
    faces = [(k * (nx + 1) + i, k * (nx + 1) + i + 1, (k + 1) * (nx + 1) + i + 1, (k + 1) * (nx + 1) + i)
             for k in range(nz) for i in range(nx)]
    return mesh_object(name, verts, faces, [mat])


def round_lamp(name, tree, body, x, z, r, mat, n=14):
    """A flat round lamp centred over the nose at (x, z), square to the body there, just clear of it."""
    p, nrm, _, _ = tree.ray_cast(Vector((x, 5, z)), Vector((0, -1, 0)))
    u = nrm.cross(Vector((0, 0, 1))).normalized()
    w = u.cross(nrm).normalized()
    c = p + nrm * LIFT
    verts = [tuple(c)] + [tuple(c + (u * math.cos(2 * math.pi * i / n) + w * math.sin(2 * math.pi * i / n)) * r) for i in range(n)]
    ob = mesh_object(name, verts, [(0, 1 + i, 1 + (i + 1) % n) for i in range(n)], [mat])
    clear_of(ob, [body], nrm)
    return ob


def build_lights(body, px):
    """Found on the texture by casting rays at the nose and the tail and reading the colour where each lands.
    Headlamps: a round lamp over each white disc on the nose (two a side). Front indicators: over the white fog
    lamps below them. Tail lights: plates over the red bar across the tail; rear indicators over its ends."""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    tri = bm.copy()
    bmesh.ops.triangulate(tri, faces=tri.faces)
    tri.faces.ensure_lookup_table()
    tuv = tri.loops.layers.uv.active
    tree = BVHTree.FromBMesh(tri)

    def hits(back, want):
        d = Vector((0, 1, 0)) if back else Vector((0, -1, 0))
        out = []
        for i in range(-95, 96):
            for k in range(30, 101):
                x, z = i / 100, k / 100
                p, _, idx, _ = tree.ray_cast(Vector((x, 0, z)) - d * 5, d)
                if p is None:
                    continue
                f = tri.faces[idx]
                wa, wb, wc = barycentric(p, *(l.vert.co for l in f.loops))
                ua, ub, uc = (l[tuv].uv for l in f.loops)
                if colour_class(sample(px, ua * wa + ub * wb + uc * wc)) == want:
                    out.append((x, z))
        return out

    lamps = []
    white = hits(False, "white")
    for side, s in (("L", -1), ("R", 1)):
        head = sorted((x, z) for x, z in white if x * s > 0 and z > 0.5)
        gap = max(range(1, len(head)), key=lambda i: head[i][0] - head[i - 1][0])  # between the two lamps
        parts = []
        for k, grp in enumerate((head[:gap], head[gap:])):
            cx = sum(x for x, z in grp) / len(grp)
            cz = sum(z for x, z in grp) / len(grp)
            r = math.sqrt(len(grp) * 1e-4 / math.pi)  # each hit stands for 1 cm²
            print(f"[muscle_car] head_{side}{k}: x {cx:.2f} z {cz:.2f} r {r:.3f}")
            parts.append(round_lamp(f"head_{side}{k}", tree, body, cx, cz, r, "head"))
        lamps.append(join(parts, f"head_{side}"))
        fog = [(x, z) for x, z in white if x * s > 0 and z <= 0.5]
        x0, x1 = min(x for x, z in fog), max(x for x, z in fog)
        z0, z1 = min(z for x, z in fog), max(z for x, z in fog)
        lamps.append(surface_plate(f"ind_F{side}", tree, x0, x1, z0, z1, "ind", back=False, nx=2, nz=1))
        clear_of(lamps[-1], [body], Vector((0, 1, 0)))

    red = hits(True, "red")
    # The bar: the longest run of rows (1 cm apart) mostly red, not the odd red line above or below it.
    rows = {}
    for x, z in red:
        rows[round(z * 100)] = rows.get(round(z * 100), 0) + 1
    full = sorted(k for k, c in rows.items() if c >= 0.3 * max(rows.values()))
    runs = [[full[0]]]
    for k in full[1:]:
        if k == runs[-1][-1] + 1:
            runs[-1].append(k)
        else:
            runs.append([k])
    run = max(runs, key=len)
    bz0, bz1 = run[0] / 100, run[-1] / 100
    xs = sorted(abs(x) for x, z in red if bz0 <= z <= bz1)
    pick = lambda q, frac: q[int(frac * (len(q) - 1))]  # noqa: E731
    bx0, bx1 = max(0.02, pick(xs, 0.03)), pick(xs, 0.97)
    print(f"[muscle_car] tail bar: |x| {bx0:.2f}..{bx1:.2f}, z {bz0:.2f}..{bz1:.2f} ({len(red)} red hits)")
    seg = (bx1 - bx0) * 0.2
    for side, s in (("L", -1), ("R", 1)):
        x0, x1 = sorted((s * bx0, s * bx1))
        tail = surface_plate(f"tail_{side}", tree, x0, x1, bz0, bz1, "tail", back=True)
        out = LIFT + clear_of(tail, [body], Vector((0, -1, 0)))
        lamps.append(tail)
        x0, x1 = sorted((s * (bx1 - seg), s * bx1))  # over the tail light's outer end
        ind = surface_plate(f"ind_R{side}", tree, x0, x1, bz0 + 0.005, bz1 - 0.005, "ind", back=True, nx=2, nz=1,
                            lift=out + LIFT)
        clear_of(ind, [body, tail], Vector((0, -1, 0)))
        lamps.append(ind)
    tri.free()
    bm.free()
    return lamps


def clear_of(ob, others, d, step=0.002, most=0.03):
    """Move `ob` along `d` until no face of it touches any of `others` (the body bulges between the points a
    lamp was laid on); how far it went."""
    moved = 0.0
    while any(touching(ob, o) for o in others):
        assert moved < most, f"{ob.name} still touches after {most} m"
        ob.data.transform(Matrix.Translation(d * step))
        ob.data.update()
        moved += step
    return moved


def barycentric(p, a, b, c):
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11 = v0.dot(v0), v0.dot(v1), v1.dot(v1)
    d20, d21 = v2.dot(v0), v2.dot(v1)
    den = d00 * d11 - d01 * d01 or 1e-12
    wb = (d11 * d20 - d01 * d21) / den
    wc = (d00 * d21 - d01 * d20) / den
    return 1 - wb - wc, wb, wc


# ---------------------------------------------------------------- the wheel

def build_wheel():
    """Tyre with a chunky dark wall, a deep dark dish and five spokes; centred on the origin, the dish faces +X."""
    n = 20
    hw = WHEEL_W / 2
    r_in = WHEEL_R * 0.58
    verts, faces, fm = [], [], []

    def ring(x, r):
        base = len(verts)
        for i in range(n):
            a = 2 * math.pi * i / n
            verts.append((x, r * math.cos(a), r * math.sin(a)))
        return base

    rings = [
        ring(hw - 0.02, r_in),  # 0 rim lip, inner edge
        ring(hw, WHEEL_R * 0.88),  # 1 sidewall
        ring(hw - 0.015, WHEEL_R),  # 2 a square shoulder
        ring(-hw + 0.015, WHEEL_R),  # 3
        ring(-hw, WHEEL_R * 0.88),  # 4
        ring(-hw + 0.02, r_in),  # 5 inner side
        ring(hw - 0.15, r_in * 0.98),  # 6 the dish's floor, deep
        ring(-hw + 0.02, r_in * 0.5),  # 7 back
        ring(hw - 0.008, r_in + 0.02),  # 8 the rim's bright lip
    ]
    chain = [rings[0], rings[8], rings[1], rings[2], rings[3], rings[4], rings[5]]
    for k in range(len(chain) - 1):
        a, b = chain[k], chain[k + 1]
        for i in range(n):
            j = (i + 1) % n
            faces.append((a + i, a + j, b + j, b + i))
            fm.append(2 if k == 0 else 0)
    a, b = rings[0], rings[6]
    for i in range(n):
        j = (i + 1) % n
        faces.append((a + i, b + i, b + j, a + j))
        fm.append(1)
    faces.append(tuple(rings[6] + i for i in range(n)))
    fm.append(1)
    a, b = rings[5], rings[7]
    for i in range(n):
        j = (i + 1) % n
        faces.append((a + i, b + i, b + j, a + j))
        fm.append(0)
    faces.append(tuple(rings[7] + i for i in reversed(range(n))))
    fm.append(0)
    wheel = mesh_object("wheel", verts, faces, ["tyre", "rim", "spoke"], fm)

    parts = []
    hub = disc("hub", 0, 0, 0, 0.045, 0.10, "spoke", 10)  # its back sunk into the dish floor
    hub.rotation_euler = (0, 0, -math.pi / 2)
    hub.location = (hw - 0.07, 0, 0)
    parts.append(hub)
    for k in range(5):  # bold spokes standing up out of the deep floor
        sp = box("spoke", hw - 0.17, hw - 0.09, -0.034, 0.034, 0.03, r_in * 0.96, "spoke")
        sp.rotation_euler = (2 * math.pi * k / 5, 0, 0)
        parts.append(sp)
    for p in parts:
        bpy.ops.object.select_all(action="DESELECT")
        bpy.context.view_layer.objects.active = p
        p.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return union(wheel, parts)


# ---------------------------------------------------------------- checks

def mesh_check(ob):
    """Faces cutting through other faces (not just touching at an edge), and edges not shared by exactly two faces."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.faces.ensure_lookup_table()
    tree = BVHTree.FromBMesh(bm, epsilon=0.0)
    crossing = sum(1 for i, j in tree.overlap(tree)
                   if i < j and not ({v.index for v in bm.faces[i].verts} & {v.index for v in bm.faces[j].verts}))
    bad = sum(1 for e in bm.edges if not e.is_manifold)
    bm.free()
    return {"crossing_faces": crossing, "open_edges": bad}


def touching(a, b):
    """Faces of `a` crossing or touching faces of `b` (two objects)."""
    def tree(o):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.transform(o.matrix_world)
        t = BVHTree.FromBMesh(bm, epsilon=0.0)
        bm.free()
        return t

    return len(tree(a).overlap(tree(b)))


# ---------------------------------------------------------------- preview

def preview(out_dir, export_objs, wheel):
    scene = bpy.context.scene
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 32
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.world = bpy.data.worlds.new("w") if scene.world is None else scene.world
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.07, 0.07, 0.075, 1)
    bg.inputs[1].default_value = 1.0
    scene.view_settings.view_transform = "Standard"  # keep the lamps' red red
    lights = []
    for name, energy, loc, rot, size in (
        ("key", 500, (3.5, 3.0, 5.0), (math.radians(35), math.radians(25), math.radians(140)), 4.0),
        ("fill", 180, (-4.0, -2.0, 3.5), (math.radians(55), math.radians(-35), math.radians(-60)), 5.0),
        ("top", 300, (0, 0, 5.5), (0, 0, 0), 6.0),
    ):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = energy
        ld.size = size
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        lo.rotation_euler = rot
        bpy.context.collection.objects.link(lo)
        lights.append(lo)

    for o in export_objs:  # indicators off, as the game shows them most of the time
        o.hide_render = o.name.startswith("ind_")
    shown = []
    for x in (-WHEEL_X, WHEEL_X):
        for y in (WHEEL_YR, WHEEL_YF):
            w = wheel.copy()
            bpy.context.collection.objects.link(w)
            w.location = (x, y, WHEEL_Z - GROUND)
            w.rotation_euler = (0, 0, math.pi if x < 0 else 0)
            shown.append(w)
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, -GROUND))
    floor = bpy.context.active_object
    floor.data.materials.append(material("floor", (0.12, 0.12, 0.13), 0.9))

    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    target = Vector((0, 0, 0.05))
    views = {
        # The concept images' viewpoints (docs/art/muscle-car), to compare against.
        "front34": Vector((-5.0, 6.6, 2.3)),
        "side": Vector((-10.5, 2.0, 0.9)),
        "rear34": Vector((-5.4, -6.2, 2.9)),
        "top": Vector((0, 0.01, 11)),
        "front": Vector((0, 9, 0.5)),
        "trueside": Vector((-10.5, 0, 0.1)),
    }
    for name, pos in views.items():
        cam.location = pos
        cam.rotation_euler = (target - pos).to_track_quat("-Z", "Y").to_euler()
        cam_data.lens = 35 if name == "top" else 50
        cam_data.type = "ORTHO" if name == "trueside" else "PERSP"  # the true side view can be measured
        cam_data.ortho_scale = 5.2
        scene.render.filepath = os.path.join(out_dir, f"muscle-{name}.png")
        bpy.ops.render.render(write_still=True)
    for o in shown + lights + [floor, cam]:
        bpy.data.objects.remove(o)
    for o in export_objs:
        o.hide_render = False


# ---------------------------------------------------------------- main

def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[argv.index("--out") + 1] if "--out" in argv else "public/models/muscle-car.glb"
    prev = argv[argv.index("--preview") + 1] if "--preview" in argv else None

    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()

    body, px = load_body()
    build_apron(body, px)
    lamps = build_lights(body, px)
    white_paint(body, px)
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(30))  # low-poly facets, the curves still curved
    wheel = build_wheel()

    # Down to the origin (GROUND above the ground); the wheel stays centred on its axle.
    for o in [body, *lamps]:
        o.data.transform(Matrix.Translation((0, 0, -GROUND)))
        o.data.update()

    tri = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)  # noqa: E731
    print(f"[muscle_car] triangles: body {tri(body)}, lamps {sum(tri(o) for o in lamps)}, wheel {tri(wheel)}")
    print(f"[muscle_car] lamps: {', '.join(f'{o.name} {len(o.data.polygons)}' for o in lamps)}")
    for o in [body, wheel]:
        print(f"[muscle_car] check {o.name}: {mesh_check(o)}")
    size = Vector([max(v.co[i] for v in body.data.vertices) - min(v.co[i] for v in body.data.vertices) for i in range(3)])
    print(f"[muscle_car] body size: {size.x:.2f} x {size.y:.2f} x {size.z:.2f} m")
    assert all(len(o.data.polygons) for o in lamps), "a lamp found nothing on the texture"
    objs = [body, *lamps]
    touch = {f"{a.name}/{b.name}": n for i, a in enumerate(objs) for b in objs[i + 1:] if (n := touching(a, b))}
    print(f"[muscle_car] faces touching between objects: {touch or 0}")

    if prev:
        os.makedirs(prev, exist_ok=True)
        preview(prev, [body, *lamps], wheel)

    bpy.ops.object.select_all(action="DESELECT")
    for o in [body, *lamps, wheel]:
        o.select_set(True)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(out),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
    )
    print(f"[muscle_car] wrote {out}")


if __name__ == "__main__":
    main()
