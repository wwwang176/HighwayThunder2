import * as THREE from 'three';
import { AIM_DOWN, createHeadlight, HEADLIGHTS } from '../vehicles/headlight';

/**
 * The rivals' real headlights, from a pool of a fixed number of spot lights (another number of lights recompiles
 * every lit shader: a hitch), handed out each frame by where each rival's beam falls: the point a little ahead of
 * its nose, the nearer the camera (and on screen) the sooner - in the race the cars behind the player first (their
 * beams light it and the road in view), at the intro the ones the shot sees. Near, a car gets two lamps (the first
 * ones casting shadows: the pool's first `SHADOW_LAMPS`); further, one in the middle as bright as the two; far, or
 * the pool used up, none - the traffic's beam painted on the road (render/npcBeams) instead. A lamp not handed out
 * is parked (out of reach of anything: the lit shaders skip it).
 */
export const RIVAL_LIGHTS = {
  /** Real lamps at all (off: every rival's beam painted on the road). */
  real: true,
  /** Its beam's point this far within the camera (m): two lamps... */
  pairRange: 40,
  /** ...within this: one. Past it: painted. */
  singleRange: 150,
  /** A car keeps what it has this much (m) past the range it got it in (no flicker at the edge). */
  hold: 5,
  /** Shadows (the shadow lamps') at full this far from the camera (m), fading out over `fade` past it. */
  shadowRange: 30,
  fade: 15,
};

/** The pool's lamps, and how many of them cast shadows (each shadow map takes one of a shader's 16 textures). */
export const POOL_LAMPS = 8;
export const SHADOW_LAMPS = 4;
/** The beam's point: this far ahead of the nose (m). */
const BEAM_AHEAD = 15;
/** Off the screen, a beam ranks this much (m) further away. */
const OFF_SCREEN = 1000;
const PARKED_Y = -500;

/** A rival as the pool sees it: its body (placed this frame) and its size. */
export interface LitCar {
  mesh: THREE.Object3D;
  width: number;
  length: number;
}

const P = new THREE.Vector3();
const F = new THREE.Vector3();
const SPHERE = new THREE.Sphere();
const FRUSTUM = new THREE.Frustum();
const VP = new THREE.Matrix4();

export class RivalLightPool {
  readonly lamps: THREE.SpotLight[] = [];
  /** How many lamps each car had last frame (its hold). */
  private had = new Map<THREE.Object3D, number>();

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < POOL_LAMPS; i++) {
      const l = createHeadlight(0);
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
    const ranked = cars
      .map((car) => {
        // Its body where it is drawn this frame (its world matrix is otherwise last frame's, till the render: at
        // speed the lamps then sat a metre or more back inside the car, its own body shadowing their beams).
        car.mesh.updateMatrixWorld();
        F.set(0, 0, -1).transformDirection(car.mesh.matrixWorld);
        P.set(0, 0, -car.length / 2).applyMatrix4(car.mesh.matrixWorld).addScaledVector(F, BEAM_AHEAD);
        const d = P.distanceTo(cam);
        const seen = FRUSTUM.intersectsSphere(SPHERE.set(P, BEAM_AHEAD));
        return { car, d, score: seen ? d : d + OFF_SCREEN };
      })
      .sort((a, b) => a.score - b.score);
    const painted: LitCar[] = [];
    const shadows: THREE.SpotLight[] = [];
    const had = new Map<THREE.Object3D, number>();
    let next = 0;
    for (const { car, d, score } of ranked) {
      const before = this.had.get(car.mesh) ?? 0;
      const pairTo = L.pairRange + (before === 2 ? L.hold : 0);
      const singleTo = L.singleRange + (before >= 1 ? L.hold : 0);
      let want = !L.real || score >= OFF_SCREEN ? 0 : score < pairTo ? 2 : score < singleTo ? 1 : 0;
      want = Math.min(want, POOL_LAMPS - next);
      had.set(car.mesh, want);
      if (!want) {
        painted.push(car);
        continue;
      }
      const fade = Math.max(0, Math.min(1, (L.shadowRange + L.fade - d) / L.fade));
      for (let k = 0; k < want; k++) {
        const l = this.lamps[next++];
        // Two: at the lamps (the player's places); one: in the middle, as bright as both.
        const x = want === 2 ? (k ? 1 : -1) * (car.width / 2 - 0.4) : 0;
        l.position.set(x, -0.05, -car.length / 2 - 0.15).applyMatrix4(car.mesh.matrixWorld);
        l.target.position.set(x, -0.05 - Math.tan(AIM_DOWN) * 30, -car.length / 2 - 30).applyMatrix4(car.mesh.matrixWorld);
        l.target.updateMatrixWorld();
        l.intensity = (HEADLIGHTS.pair / 2) * (want === 2 ? 1 : 2);
        if (l.castShadow) {
          l.shadow.intensity = fade;
          l.shadow.autoUpdate = fade > 0; // (a shadow not showing: its map not drawn)
          if (fade > 0) shadows.push(l);
        }
      }
    }
    for (let i = next; i < POOL_LAMPS; i++) this.park(this.lamps[i]);
    this.had = had;
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
