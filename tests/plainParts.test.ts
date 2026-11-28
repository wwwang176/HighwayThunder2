import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mergePlainParts, SHADOW_LAYER } from '../src/render/plainParts';
import { BRAKE_DIM, type VehicleModel } from '../src/vehicles/models';

/**
 * A racer as built: a painted shell (a map: not plain) casting, glass (plain, double-sided, not casting), two pipes
 * (plain, double-sided, casting), a brake light, a police light bar half (looked up by name), a hidden wheel.
 */
function racer(): { model: VehicleModel; shell: THREE.Mesh; brake: THREE.Mesh; bar: THREE.Mesh; wheel: THREE.Mesh } {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.set(0, 0.2, 0);
  root.add(body);
  const paint = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  paint.shadowSide = THREE.BackSide;
  const shell = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4), paint);
  shell.castShadow = true;
  shell.add(new THREE.Mesh(shell.geometry, new THREE.MeshStandardMaterial({ side: THREE.BackSide }))); // (its inside, as a file car's)
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 2), new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.1, side: THREE.DoubleSide }));
  glass.position.set(0, 0.7, 0);
  const metal = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.9, side: THREE.DoubleSide });
  metal.shadowSide = THREE.BackSide;
  const pipes = [-0.5, 0.5].map((x) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3), metal);
    p.position.set(x, -0.3, 2);
    p.castShadow = true;
    return p;
  });
  body.add(shell, glass, ...pipes);
  const brake = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.05), BRAKE_DIM);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.3), new THREE.MeshStandardMaterial({ color: 0xff0000 }));
  bar.name = 'lightbar-red';
  bar.castShadow = true;
  const hub = new THREE.Group();
  hub.visible = false;
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2), new THREE.MeshStandardMaterial());
  wheel.castShadow = true;
  hub.add(wheel);
  root.add(brake, bar, hub);
  return { model: { root, lights: { left: [], right: [], brake: [brake], third: [] } }, shell, brake, bar, wheel };
}

const named = (root: THREE.Object3D, name: string) => {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => void ((o as THREE.Mesh).isMesh && o.name === name && out.push(o as THREE.Mesh)));
  return out;
};

describe('mergePlainParts', () => {
  it("a racer's plain parts drawn as one a side, its shadow casters as one only the shadow lights see", () => {
    const { model, shell, brake, bar, wheel } = racer();
    mergePlainParts(model);
    const root = model.root;

    // The glass and the pipes (double-sided, plain): one mesh, casting nothing itself - their colours on its vertices.
    const [plain] = named(root, 'plain');
    expect(named(root, 'plain')).toHaveLength(1);
    expect(plain.castShadow).toBe(false);
    expect((plain.material as THREE.Material).side).toBe(THREE.DoubleSide);
    const colors = plain.geometry.getAttribute('plainColor');
    const glassC = new THREE.Color(0x223344);
    expect([colors.getX(0), colors.getY(0), colors.getZ(0)]).toEqual([glassC.r, glassC.g, glassC.b].map((v) => Math.fround(v)));
    expect(plain.userData.ownGeometry).toBe(true);

    // The shell (its inside in it), the pipes and the light bar (all into the maps back faces) cast as one, on the
    // shadow layer: none of them casting itself.
    expect(named(root, 'shadows')).toHaveLength(1);
    const [shadows] = named(root, 'shadows');
    expect(shadows.castShadow).toBe(true);
    expect(shadows.layers.mask).toBe(1 << SHADOW_LAYER);
    expect((shadows.material as THREE.Material).shadowSide).toBe(THREE.BackSide);
    const verts = (g: THREE.BufferGeometry) => g.getAttribute('position').count;
    expect(verts(shadows.geometry)).toBe(verts(shell.geometry) + 2 * verts(new THREE.CylinderGeometry(0.05, 0.05, 0.3)) + verts(bar.geometry));
    expect(shell.castShadow).toBe(false);
    expect(bar.castShadow).toBe(false);

    // Left as they were: the shell (painted), the brake light, the light bar (found by name), the hidden wheel.
    for (const m of [shell, brake, bar, wheel]) expect(m.parent).not.toBeNull();
    expect(root.getObjectByName('lightbar-red')).toBe(bar);
    expect(wheel.castShadow).toBe(true);
  });

  it('a part where it was: the merged geometry in the root\'s space', () => {
    const { model } = racer();
    mergePlainParts(model);
    const [plain] = named(model.root, 'plain');
    plain.geometry.computeBoundingBox();
    // The pipes' bottoms: their middles at y -0.3 in the body (itself 0.2 up), 0.15 down from it.
    expect(plain.geometry.boundingBox!.min.y).toBeCloseTo(0.2 - 0.3 - 0.15, 5);
  });
});
