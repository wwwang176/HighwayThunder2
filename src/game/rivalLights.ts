import * as THREE from 'three';
import { AIM_DOWN, createHeadlight, HEADLIGHTS, RIVAL_DECAY } from '../vehicles/headlight';
import { MAX_RIVALS } from './carSelection';

/**
 * The rivals' real headlights: one spot light each (a fixed number of them: another number of lights recompiles
 * every lit shader, a hitch), in the middle of its nose, as bright as its two lamps. On what it lights it is a low
 * beam; on the ground it lights as the traffic's pair does (headlight's RIVAL_DECAY), shadowed - the player's car
 * shadowed on the road by the car behind. The shadows go to the lamps whose beams fall nearest the camera (a point
 * a little ahead of each nose; on screen first): in the race the cars behind the player, at the intro the ones the
 * shot sees. A car leaning far over (crashing, rolled) gets no lamp: its beam is painted on the road as the
 * traffic's (render/npcBeams), which follows its body whichever way it lies.
 */
export const RIVAL_LIGHTS = {
  /** Real lamps at all (off: every rival's beam painted on the road). */
  real: true,
  /** Shadows at full this far from the camera (m), fading out over `fade` past it. */
  shadowRange: 30,
  fade: 15,
};

/** The pool: a lamp per rival; the first `SHADOW_LAMPS` of them cast shadows (each map one of a shader's 16 textures). */
export const POOL_LAMPS = MAX_RIVALS;
export const SHADOW_LAMPS = 2;
/** The beam's point: this far ahead of the nose (m). */
const BEAM_AHEAD = 15;
/** Off the screen, a beam ranks this much (m) further away. */
const OFF_SCREEN = 1000;
/** Leaning past this (its up's height: cos 30 degrees), a car's lamp is given up for its painted beam. */
const UPRIGHT = Math.cos(THREE.MathUtils.degToRad(30));
const PARKED_Y = -500;

/** A rival as the pool sees it: its body (placed this frame) and its size. */
export interface LitCar {
  mesh: THREE.Object3D;
  width: number;
  length: number;
}

const P = new THREE.Vector3();
const F = new THREE.Vector3();
const U = new THREE.Vector3();
const SPHERE = new THREE.Sphere();
const FRUSTUM = new THREE.Frustum();
const VP = new THREE.Matrix4();

export class RivalLightPool {
  readonly lamps: THREE.SpotLight[] = [];

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < POOL_LAMPS; i++) {
      const l = createHeadlight(0);
      l.decay = RIVAL_DECAY;
      l.castShadow = i < SHADOW_LAMPS;
      scene.add(l, l.target);
      this.lamps.push(l);
      this.park(l);
    }
  }

  /**
   * Hand the lamps out to `cars` for `camera` (its matrices as last drawn). Returns the cars left without a lamp
   * (their beams to be painted) and the lamps whose shadows show.
   */
  assign(cars: LitCar[], camera: THREE.Camera): { painted: LitCar[]; shadows: THREE.SpotLight[] } {
    const L = RIVAL_LIGHTS;
    const cam = camera.getWorldPosition(new THREE.Vector3());
    FRUSTUM.setFromProjectionMatrix(VP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const painted: LitCar[] = [];
    const lit: { car: LitCar; d: number; score: number }[] = [];
    for (const car of cars) {
      // Its body where it is drawn this frame (its world matrix is otherwise last frame's, till the render: at
      // speed the lamp then sat a metre or more back inside the car, its own body shadowing its beam).
      car.mesh.updateMatrixWorld();
      if (!L.real || U.set(0, 1, 0).transformDirection(car.mesh.matrixWorld).y < UPRIGHT) {
        painted.push(car);
        continue;
      }
      F.set(0, 0, -1).transformDirection(car.mesh.matrixWorld);
      P.set(0, 0, -car.length / 2).applyMatrix4(car.mesh.matrixWorld).addScaledVector(F, BEAM_AHEAD);
      const d = P.distanceTo(cam);
      const seen = FRUSTUM.intersectsSphere(SPHERE.set(P, BEAM_AHEAD));
      lit.push({ car, d, score: seen ? d : d + OFF_SCREEN });
    }
    lit.sort((a, b) => a.score - b.score);
    const shadows: THREE.SpotLight[] = [];
    lit.forEach(({ car, d }, i) => {
      const l = this.lamps[i];
      l.position.set(0, -0.05, -car.length / 2 - 0.15).applyMatrix4(car.mesh.matrixWorld);
      l.target.position.set(0, -0.05 - Math.tan(AIM_DOWN) * 30, -car.length / 2 - 30).applyMatrix4(car.mesh.matrixWorld);
      l.target.updateMatrixWorld();
      l.intensity = HEADLIGHTS.pair; // (both its lamps' light)
      if (l.castShadow) {
        const fade = Math.max(0, Math.min(1, (L.shadowRange + L.fade - d) / L.fade));
        l.shadow.intensity = fade;
        l.shadow.autoUpdate = fade > 0; // (a shadow not showing: its map not drawn)
        if (fade > 0) shadows.push(l);
      }
    });
    for (let i = lit.length; i < POOL_LAMPS; i++) this.park(this.lamps[i]);
    return { painted, shadows };
  }

  /** Out of the way: far under the road, dark, pointing down (no point anything is drawn at is in its cone). */
  private park(l: THREE.SpotLight): void {
    l.intensity = 0;
    l.position.set(0, PARKED_Y, 0);
    l.target.position.set(0, PARKED_Y - 10, 0);
    l.target.updateMatrixWorld();
    if (l.castShadow) l.shadow.autoUpdate = false;
  }
}
