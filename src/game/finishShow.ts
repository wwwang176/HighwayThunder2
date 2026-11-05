import * as THREE from 'three';
import { MEDIAN_NEAR_X, RAIL_D } from '../config';
import type { PlayerCar } from '../vehicles/playerCar';

/**
 * Past the line, the race eased down from full speed to `scale` of it over `ease` s (the show's own, real time),
 * and held there through the shots; the panel in, eased to `panel` over `settle` s, and kept there.
 */
export const FINISH_SLOW = { scale: 0.15, ease: 0.6, panel: 0.2, settle: 0.8 };

/**
 * How fast the race runs `t` s (real) into the finish's show, its panel in at `panelAt` s; skipped to it, from
 * the speed it was at then (`from`).
 */
export function finishTimeScale(t: number, panelAt: number, from?: number): number {
  const S = FINISH_SLOW;
  if (t < panelAt) return THREE.MathUtils.lerp(1, S.scale, THREE.MathUtils.smoothstep(t, 0, S.ease));
  return THREE.MathUtils.lerp(from ?? S.scale, S.panel, THREE.MathUtils.smoothstep(t, panelAt, panelAt + S.settle));
}

/** How much of the race's time passes in the first `t` s (real) past the line (before the panel). */
export function slowedSeconds(t: number): number {
  const n = 100;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += finishTimeScale(((i + 0.5) / n) * t, Infinity);
  return (sum / n) * t;
}

/** A camera pose in the car's frame: x right, y up from the ground, z ahead (the car on the origin). */
interface Pose {
  pos: [number, number, number];
  look: [number, number, number];
  fov: number;
}

/** A shot: the camera from one pose to another over `seconds` (a cut into it, as the intro's: game/intro). */
interface Shot {
  seconds: number;
  from: Pose;
  to: Pose;
  ease: (t: number) => number;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const linear = (t: number) => t;

/** The first shot (s): from the roadside past the gate, the car seen coming through it, slowed (FINISH_SLOW). */
const THROUGH = 1.7;
/** After the shots, the camera going on round the car (rad/s) behind the finish's panel. */
const ORBIT = 0.12;

/**
 * The finish's show (as the race's intro, game/intro): from the line, a few shots of the player's car - seen from
 * the roadside coming past the finish, slowing into slow motion, then low behind it as it brakes,
 * then from up ahead of it looking back at the finish - and then on round it, slowly,
 * behind the panel (`done`: the panel's time). Runs on real time (it is what slows the race down: finishTimeScale);
 * a key skips it to its end.
 */
export class FinishShow {
  private readonly shots: Shot[];
  /** The first shot's spot (world): beside the road past the car, low. */
  private readonly roadside = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private readonly ahead = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private elapsed = 0;
  /** Skipped: how fast the race ran then (the slow-down behind the panel from there). */
  private skippedAt: number | undefined;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly car: PlayerCar,
  ) {
    this.frame();
    const at = car.mesh.position;
    // Past the car by a bit more than it goes in the first shot (the race slowed: it stops short), beside the road
    // on the nearest side with room (not where the car is: it would come through the camera).
    const goes = THREE.MathUtils.clamp(Math.abs(car.speed) * slowedSeconds(THROUGH) * 1.15, 8, 50);
    const edges = [RAIL_D - 0.8, MEDIAN_NEAR_X + 0.8];
    const room = edges.filter((x) => Math.abs(x - at.x) >= 6);
    const x = room.length ? room.reduce((a, b) => (Math.abs(b - at.x) < Math.abs(a - at.x) ? b : a)) : edges.reduce((a, b) => (Math.abs(b - at.x) > Math.abs(a - at.x) ? b : a));
    this.roadside.set(x, 1.0, at.z).addScaledVector(this.ahead, goes).setX(x);
    // The shots after it from that side of the car, so it keeps going the same way across the picture.
    const side = Math.sign((x - at.x) * this.right.x + 1e-6);
    this.shots = [
      { seconds: THROUGH, from: { pos: [0, 0, 0], look: [0, 0, 0], fov: 28 }, to: { pos: [0, 0, 0], look: [0, 0, 0], fov: 38 }, ease: linear },
      {
        // Low behind it on that side, going along with it: its tail lights, the road ahead.
        seconds: 1.6,
        from: { pos: [side * 3.0, 1.1, -7.5], look: [0, 0.7, 0.8], fov: 45 },
        to: { pos: [side * 2.6, 1.0, -6.6], look: [0, 0.7, 0.8], fov: 45 },
        ease: linear, // (still moving at the cut)
      },
      {
        // Up ahead of it looking back, it coming on under its own lights, the finish behind it.
        seconds: 1.8,
        from: { pos: [side * 2.6, 2.4, 9], look: [0, 0.7, -3], fov: 44 },
        to: { pos: [side * 3.4, 3.4, 12], look: [0, 0.7, -3], fov: 42 },
        ease: easeOut,
      },
    ];
  }

  /** Whether the camera stands still (the first shot's, by the road), not going along with the car. */
  get standing(): boolean {
    return this.elapsed < THROUGH;
  }

  /** Total length of the shots (s): then the panel. */
  get seconds(): number {
    return this.shots.reduce((a, s) => a + s.seconds, 0);
  }

  /** The shots over (or skipped): the panel's time. */
  get done(): boolean {
    return this.elapsed >= this.seconds;
  }

  /** How fast the race runs now (finishTimeScale). */
  get timeScale(): number {
    return finishTimeScale(this.elapsed, this.seconds, this.skippedAt);
  }

  /** `dt` s (real) on. */
  step(dt: number): void {
    this.elapsed += dt;
  }

  /** Straight to its end (the panel), the race slowing from how fast it ran then. */
  skip(): void {
    if (this.done) return;
    this.skippedAt = this.timeScale;
    this.elapsed = this.seconds;
  }

  /** The camera where the show has it now. */
  placeCamera(): void {
    this.frame();
    const cam = this.camera;
    let t = this.elapsed;
    let i = 0;
    while (i < this.shots.length - 1 && t >= this.shots[i].seconds) t -= this.shots[i++].seconds;
    const s = this.shots[i];
    const k = s.ease(Math.min(1, t / s.seconds));
    const fov = THREE.MathUtils.lerp(s.from.fov, s.to.fov, k);
    if (i === 0) {
      // From the roadside, following the car.
      cam.position.copy(this.roadside);
      cam.lookAt(this.look.copy(this.car.mesh.position).setY(0.6));
    } else {
      const lerp = (a: number[], b: number[]) => [0, 1, 2].map((j) => THREE.MathUtils.lerp(a[j], b[j], k));
      const pos = lerp(s.from.pos, s.to.pos);
      // The shots over: on round the car.
      const turn = Math.max(0, t - s.seconds) * ORBIT;
      const [x, z] = [pos[0] * Math.cos(turn) - pos[2] * Math.sin(turn), pos[0] * Math.sin(turn) + pos[2] * Math.cos(turn)];
      cam.position.copy(this.world([x, pos[1], z]));
      cam.lookAt(this.world(lerp(s.from.look, s.to.look)));
    }
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  /** The car's frame now (as it is drawn: its mesh). */
  private frame(): void {
    const m = this.car.mesh;
    this.origin.set(m.position.x, 0, m.position.z);
    this.ahead.set(0, 0, -1).applyQuaternion(m.quaternion).setY(0).normalize();
    this.right.set(-this.ahead.z, 0, this.ahead.x);
  }

  private world([x, y, z]: number[]): THREE.Vector3 {
    return new THREE.Vector3().copy(this.origin).addScaledVector(this.right, x).addScaledVector(this.ahead, z).setY(y);
  }
}
