import * as THREE from 'three';
import type { PlayerCar } from '../vehicles/playerCar';
import { POLICE_TUNING } from './policeLogic';

/**
 * The bust's slow motion: the race eased down from full speed to `scale` of it over `ease` s (real time), and held
 * there. (0.4 s at first: at its slowest at once - the user's call, slowed down gradually from full speed.) Put
 * back, eased back up to full speed over `back` s (real time; at once at first - the user's call, ~1 s). (`scale`
 * 0.15 at first, as the finish's: too slow, the user's call.)
 */
export const BUST_SLOW = { scale: 0.4, ease: 1.5, back: 1 };
/**
 * The camera's orbit round the car (rad/s, real time; 0.9 at first: too fast, the user's call 66% less), how far out
 * (m), how high (m), its field of view (deg).
 */
const ORBIT = { rate: 0.9 * 0.34, radius: 7, height: 2.2, fov: 45 };

/** How fast the race runs `t` s (real) into the bust. */
export function bustTimeScale(t: number): number {
  return THREE.MathUtils.lerp(1, BUST_SLOW.scale, THREE.MathUtils.smoothstep(t, 0, BUST_SLOW.ease));
}

/** How fast the race runs `t` s (real) after the bust's put-back: from its slow motion back up to full speed. */
export function bustRecoverScale(t: number): number {
  return THREE.MathUtils.lerp(BUST_SLOW.scale, 1, THREE.MathUtils.smoothstep(t, 0, BUST_SLOW.back));
}

/**
 * Busted (src/game/police.ts): the race slowed down (bustTimeScale), the camera going round the player's car, for
 * POLICE_TUNING.bustSeconds s of real time (`done`) - then it is put back on the road (game). Steps on real time, but
 * only while the race is on: a pause holds it too (game.frame steps it with the frame's dt only then).
 */
export class BustShow {
  private elapsed = 0;
  /** Where round the car the orbit starts (rad): behind it, to one side. */
  private readonly start: number;
  private readonly look = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly car: PlayerCar,
  ) {
    const m = car.mesh;
    const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(m.quaternion);
    this.start = Math.atan2(-ahead.x, -ahead.z) + 0.6; // (behind it, a little to its side)
  }

  /** How fast the race runs now. */
  get timeScale(): number {
    return bustTimeScale(this.elapsed);
  }

  get done(): boolean {
    return this.elapsed >= POLICE_TUNING.bustSeconds;
  }

  /** `dt` s (real) on. */
  step(dt: number): void {
    this.elapsed += dt;
  }

  /** The camera round the car. */
  placeCamera(): void {
    const p = this.car.mesh.position;
    const a = this.start + this.elapsed * ORBIT.rate;
    this.camera.position.set(p.x + Math.sin(a) * ORBIT.radius, p.y + ORBIT.height, p.z + Math.cos(a) * ORBIT.radius);
    this.camera.lookAt(this.look.set(p.x, p.y + 0.5, p.z));
    if (Math.abs(this.camera.fov - ORBIT.fov) > 0.01) {
      this.camera.fov = ORBIT.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
