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
    expect(by(t.body.material as THREE.Material)!.count).toBe(2);
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
    const ofBody = meshes(scene).filter((m) => m.material === t.body.material);
    const seen = ofBody.find((m) => !m.castShadow)!;
    const casts = ofBody.find((m) => m.castShadow)!;
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
    const body = () => meshes(scene).find((m) => m.material === t.body.material)!;
    expect(body().count).toBe(5);
    expect(meshes(scene).length).toBe(4); // body, brake (dim and on), indicator: still one each
    bodies.begin();
    bodies.end();
    expect(body().visible).toBe(false);
  });
});
