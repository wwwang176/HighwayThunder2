import * as THREE from 'three';
import type { Ghost } from '../ai/trainingSim';
import { buildCar } from '../vehicles/models';
import { PLAYER_H, PLAYER_L, PLAYER_W } from '../vehicles/playerCar';

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const M = new THREE.Matrix4();
const P = new THREE.Vector3();
const Q = new THREE.Quaternion();
const ONE = new THREE.Vector3(1, 1, 1);

/**
 * A generation's cars: every live one as a see-through red body (one draw call),
 * the leader drawn solid on top. Crashed cars disappear.
 */
export class GhostView {
  private readonly bodies: THREE.InstancedMesh;
  private readonly leader: THREE.Group;

  constructor(scene: THREE.Scene, capacity = 200) {
    // Body + cabin in one geometry, origin at the physics body centre (like the player model).
    const body = new THREE.BoxGeometry(PLAYER_W, PLAYER_H * 0.55, PLAYER_L).translate(0, -0.05, 0);
    const cabin = new THREE.BoxGeometry(PLAYER_W * 0.8, PLAYER_H * 0.45, PLAYER_L * 0.45).translate(0, PLAYER_H * 0.45, 0.2);
    const geo = mergeBoxes(body, cabin);
    this.bodies = new THREE.InstancedMesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.28, depthWrite: false }),
      capacity,
    );
    this.bodies.frustumCulled = false;
    this.bodies.renderOrder = 4;
    for (let i = 0; i < capacity; i++) this.bodies.setMatrixAt(i, HIDDEN);
    scene.add(this.bodies);

    // The leader gets the real car model, lit by the street lights like the player's.
    this.leader = buildCar(PLAYER_W, PLAYER_H, PLAYER_L, 0xd62828, true, true, false).root;
    scene.add(this.leader);
  }

  update(ghosts: Ghost[], leader: Ghost | null): void {
    ghosts.forEach((g, i) => {
      if (i >= this.bodies.count) return;
      if (!g.alive || g === leader) {
        this.bodies.setMatrixAt(i, HIDDEN);
        return;
      }
      const t = g.car.body.translation();
      const r = g.car.body.rotation();
      this.bodies.setMatrixAt(i, M.compose(P.set(t.x, t.y, t.z), Q.set(r.x, r.y, r.z, r.w), ONE));
    });
    for (let i = ghosts.length; i < this.bodies.count; i++) this.bodies.setMatrixAt(i, HIDDEN);
    this.bodies.instanceMatrix.needsUpdate = true;
    this.leader.visible = leader !== null;
    if (leader) {
      const t = leader.car.body.translation();
      const r = leader.car.body.rotation();
      // A crashed leader's body is disabled but keeps its last pose.
      this.leader.position.set(t.x, t.y, t.z);
      this.leader.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }
}

function mergeBoxes(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = [...(a.toNonIndexed().getAttribute('position').array as Float32Array), ...(b.toNonIndexed().getAttribute('position').array as Float32Array)];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
