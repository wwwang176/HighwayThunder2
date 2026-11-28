import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BodyInstances, SHADOW_LAYER } from '../src/render/bodyInstances';
import { BRAKE_DIM, BRAKE_ON, type VehicleLights } from '../src/vehicles/models';

/** A body (one box), a brake light and a left indicator, as a compacted template is made. */
function template() {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4), new THREE.MeshStandardMaterial());
  body.position.set(0, 0.5, 0);
  const brake = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.05), BRAKE_DIM);
  brake.position.set(0.6, 0.6, 2);
  brake.userData.role = 'B';
  const ind = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.05), new THREE.MeshBasicMaterial());
  ind.position.set(-0.8, 0.6, -2);
  ind.userData.role = 'L';
  ind.visible = false;
  root.add(body, brake, ind);
  return { root, body, brake, ind };
}

const lights = (brakeOn: boolean, left: boolean): VehicleLights => {
  const b = new THREE.Mesh(undefined, brakeOn ? BRAKE_ON : BRAKE_DIM);
  const l = new THREE.Object3D();
  l.visible = left;
  return { left: [l], right: [], brake: [b], third: [] };
};

const meshes = (scene: THREE.Scene) => scene.children.filter((o) => (o as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh[];
/** The pool of a template's plain parts as one (their colour, roughness and metalness on their vertices). */
const plainOf = (ms: THREE.InstancedMesh[]) => ms.find((m) => !m.castShadow && m.geometry.getAttribute('plainColor'));
const castersOf = (ms: THREE.InstancedMesh[]) => ms.filter((m) => m.castShadow);

describe('BodyInstances', () => {
  it('every vehicle of a template drawn by one instanced mesh per part, its lights by their state', () => {
    const scene = new THREE.Scene();
    const bodies = new BodyInstances(scene);
    const t = template();
    const at = new THREE.Matrix4().makeTranslation(10, 0, -50);
    bodies.begin();
    bodies.add('car', t.root, at, lights(true, true));
    bodies.add('car', t.root, new THREE.Matrix4().makeTranslation(-10, 0, -80), lights(false, false));
    bodies.end();

    const shown = meshes(scene).filter((m) => m.visible);
    const by = (mat: THREE.Material) => shown.find((m) => m.material === mat);
    const body = plainOf(shown)!;
    expect(body.count).toBe(2);
    // (its own material's colour, roughness and metalness on it)
    const mat = t.body.material as THREE.MeshStandardMaterial;
    expect([...body.geometry.getAttribute('plainColor').array.slice(0, 3)]).toEqual([mat.color.r, mat.color.g, mat.color.b].map(Math.fround));
    expect([...body.geometry.getAttribute('plainRM').array.slice(0, 2)]).toEqual([mat.roughness, mat.metalness].map(Math.fround));
    expect(by(BRAKE_ON)!.count).toBe(1); // the first one braking
    expect(by(BRAKE_DIM)!.count).toBe(1);
    expect(by(t.ind.material as THREE.Material)!.count).toBe(1); // only its indicator on

    // Each instance where the vehicle is, the part where it sits on it.
    const m = new THREE.Matrix4();
    by(BRAKE_ON)!.getMatrixAt(0, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    expect(p.distanceTo(new THREE.Vector3(10.6, 0.6, -48))).toBeLessThan(1e-5);
  });

  it('shadows: a vehicle in a shadow-casting light\'s reach casts (on the shadow layer only), one out of it not', () => {
    const scene = new THREE.Scene();
    const bodies = new BodyInstances(scene);
    const t = template();
    t.body.castShadow = true;
    const light = new THREE.SpotLight(0xffffff, 1, 50, 0.5);
    light.castShadow = true;
    light.position.set(0, 1, 0);
    light.target.position.set(0, 1, -10); // looking down -z, 50 m
    scene.add(light, light.target);
    scene.updateMatrixWorld(true);
    bodies.begin(undefined, [light]);
    bodies.add('car', t.root, new THREE.Matrix4().makeTranslation(0, 0, -20), lights(false, false)); // in its beam
    bodies.add('car', t.root, new THREE.Matrix4().makeTranslation(0, 0, 40), lights(false, false)); // behind it
    bodies.end();
    const seen = plainOf(meshes(scene))!;
    const [casts, ...more] = castersOf(meshes(scene));
    expect(more).toHaveLength(0);
    expect(seen.count).toBe(2); // both drawn
    expect(casts.count).toBe(1); // only the one in the beam casts
    expect(casts.layers.mask).toBe(1 << SHADOW_LAYER); // not seen by the camera
    expect(light.shadow.camera.layers.isEnabled(SHADOW_LAYER)).toBe(true);
  });

  it('a frame without a template\'s vehicles draws none of it; more than it had room for, it grows', () => {
    const scene = new THREE.Scene();
    const bodies = new BodyInstances(scene, 2);
    const t = template();
    bodies.begin();
    for (let i = 0; i < 5; i++) bodies.add('car', t.root, new THREE.Matrix4().makeTranslation(i, 0, 0), lights(false, false));
    bodies.end();
    const body = () => plainOf(meshes(scene))!;
    expect(body().count).toBe(5);
    expect(meshes(scene).length).toBe(4); // body, brake (dim and on), indicator: still one each
    bodies.begin();
    bodies.end();
    expect(body().visible).toBe(false);
  });

  it('plain parts drawn as one a side; the same parts in another paint share them, and the shadow casters as one', () => {
    const scene = new THREE.Scene();
    const bodies = new BodyInstances(scene);
    // A model with two plain parts (one double-sided) and a painted one (a map: its own pool), in two paints.
    const glass = new THREE.MeshStandardMaterial({ color: 0x161a20, roughness: 0.15, metalness: 0.3, side: THREE.DoubleSide });
    const trim = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
    trim.shadowSide = THREE.BackSide; // (as the files' materials: their back faces into the shadow maps, as the paint's)
    const shell = new THREE.BoxGeometry(2, 1, 4), window = new THREE.BoxGeometry(1.8, 0.4, 1.5), bumper = new THREE.BoxGeometry(2, 0.2, 0.2);
    const model = (paint: THREE.Material) => {
      const root = new THREE.Group();
      const parts = [new THREE.Mesh(shell, paint), new THREE.Mesh(window, glass), new THREE.Mesh(bumper, trim)];
      parts[1].position.set(0, 0.7, 0);
      parts[2].position.set(0, 0.1, 2);
      for (const p of parts) p.castShadow = p.material !== glass;
      root.add(...parts);
      return root;
    };
    const map = new THREE.Texture();
    const red = new THREE.MeshStandardMaterial({ map, color: 0xff0000 }), blue = new THREE.MeshStandardMaterial({ map, color: 0x0000ff });
    const light = new THREE.SpotLight(0xffffff, 1, 50, 0.5);
    light.castShadow = true;
    light.target.position.set(0, 0, -10);
    scene.add(light, light.target);
    scene.updateMatrixWorld(true);
    bodies.begin(undefined, [light]);
    bodies.add('car|red', model(red), new THREE.Matrix4().makeTranslation(0, 0, -20), lights(false, false));
    bodies.add('car|blue', model(blue), new THREE.Matrix4().makeTranslation(0, 0, -30), lights(false, false));
    bodies.end();
    const shown = meshes(scene).filter((m) => m.visible);
    // glass and trim as one, for both paints; each paint its own
    const plain = shown.filter((m) => m.geometry.getAttribute('plainColor'));
    expect(plain).toHaveLength(1);
    expect(plain[0].count).toBe(2);
    expect(plain[0].geometry.getAttribute('position').count).toBe(window.getAttribute('position').count + bumper.getAttribute('position').count);
    expect(shown.filter((m) => m.material === red || m.material === blue).map((m) => m.count)).toEqual([1, 1]);
    // the shell and the trim cast (not the glass), as one, for both paints - drawing the faces their materials would
    const casters = castersOf(shown);
    expect(casters).toHaveLength(1);
    expect(casters[0].count).toBe(2);
    expect(casters[0].geometry.getAttribute('position').count).toBe(shell.getAttribute('position').count + bumper.getAttribute('position').count);
    expect(casters[0].layers.mask).toBe(1 << SHADOW_LAYER);
  });

  it('shadow casters drawing different faces into the shadow maps stay apart', () => {
    const scene = new THREE.Scene();
    const bodies = new BodyInstances(scene);
    const root = new THREE.Group();
    const front = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()); // (FrontSide: back faces)
    const both = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }));
    const own = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }));
    (own.material as THREE.Material).shadowSide = THREE.BackSide;
    for (const m of [front, both, own]) m.castShadow = true;
    root.add(front, both, own);
    const light = new THREE.SpotLight(0xffffff, 1, 50, 0.5);
    light.castShadow = true;
    light.target.position.set(0, 0, -10);
    scene.add(light, light.target);
    scene.updateMatrixWorld(true);
    bodies.begin(undefined, [light]);
    bodies.add('box', root, new THREE.Matrix4().makeTranslation(0, 0, -20), lights(false, false));
    bodies.end();
    const sides = castersOf(meshes(scene).filter((m) => m.visible)).map((m) => [m.material as THREE.Material, m.geometry.getAttribute('position').count] as const);
    // front and own both draw back faces: one pool of two boxes; both: double-sided, its own
    expect(sides.map(([m, n]) => [m.shadowSide, n]).sort()).toEqual([[THREE.BackSide, 48], [THREE.DoubleSide, 24]].sort());
  });
});
