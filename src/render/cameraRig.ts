import * as THREE from 'three';
import { ShakeManager, type Shake } from './shake';

export interface CameraParams {
  distance: number;
  height: number;
  lookAhead: number;
  fovMin: number;
  fovMax: number;
  yawTau: number; // seconds for the camera heading to catch up with the car
  /** The bob up and down at speed (m; from standstill to BOB_FULL m/s), and how fast it goes then (noise steps a second). */
  bob: number;
  bobHz: number;
}

/** The speed the bob is full at (m/s, 200 km/h). */
const BOB_FULL = 55;

export const DEFAULT_CAMERA: CameraParams = {
  distance: 5.6, // close behind (was 6.8)
  height: 1.3, // low chase camera, close to the road

  lookAhead: 14,
  fovMin: 62,
  fovMax: 84,
  yawTau: 0.18,
  bob: 0.008, // slight: the body riding the road's unevenness
  bobHz: 3,
};

export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  const r = a - Math.PI;
  return r <= -Math.PI ? r + 2 * Math.PI : r;
}

/** Move `current` toward `target` by fraction k, the short way round the circle. */
export function approachAngle(current: number, target: number, k: number): number {
  return current + wrapAngle(target - current) * k;
}

/** Look backwards while reversing (with hysteresis so it doesn't flicker at 0). */
export function reverseView(current: boolean, vForward: number): boolean {
  if (!current && vForward < -1) return true;
  if (current && vForward > 1) return false;
  return current;
}

const MOTION_SPEED = 3; // m/s above which the camera follows the direction of travel

/**
 * Camera heading: the direction the car is actually moving (so it trails a
 * sliding or reversing car naturally). At walking pace, where the velocity
 * direction is meaningless, it falls back to the car's heading (flipped when
 * reversing). Blends smoothly between the two.
 */
export function cameraTargetYaw(carYaw: number, velX: number, velZ: number, reversing: boolean): number {
  const headingYaw = carYaw + (reversing ? Math.PI : 0);
  const speed = Math.hypot(velX, velZ);
  if (speed < 0.5) return headingYaw;
  const motionYaw = Math.atan2(velX, -velZ);
  const k = Math.min(1, Math.max(0, (speed - 0.5) / (MOTION_SPEED - 0.5)));
  return approachAngle(headingYaw, motionYaw, k);
}

/** Camera yaw for the look-back view: straight behind the car's nose. */
export function lookBackYaw(carYaw: number): number {
  return wrapAngle(carYaw + Math.PI);
}

/**
 * Chase camera that trails the car along its direction of travel (never
 * locked to the road / finish line). Holding the look-back key swings it to the
 * front of the car, looking straight back.
 */
export class CameraRig {
  params = { ...DEFAULT_CAMERA };
  private camYaw = 0;
  private reversing = false;
  private readonly shakes = new ShakeManager();
  private initialized = false;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  /** Shake the camera (dropped if smaller than what is left of the shake going). */
  shake(s: Shake): void {
    this.shakes.add(s);
  }

  /** A steady shake (rough ground), set every frame; 0: none. */
  rumble(swing: number, frequency: number): void {
    this.shakes.rumble(swing, frequency);
  }

  snap(): void {
    this.initialized = false;
    this.shakes.stop();
  }

  update(
    dt: number,
    carPos: THREE.Vector3,
    carYaw: number,
    vel: { x: number; z: number },
    vForward: number,
    maxSpeed: number,
    lookBack = false,
  ): void {
    const p = this.params;
    this.reversing = reverseView(this.reversing, vForward);
    const targetYaw = cameraTargetYaw(carYaw, vel.x, vel.z, this.reversing);
    if (!this.initialized) {
      this.camYaw = targetYaw;
      this.initialized = true;
    }
    this.camYaw = wrapAngle(approachAngle(this.camYaw, targetYaw, 1 - Math.exp(-dt / p.yawTau)));
    // Look-back is an instant cut (like glancing in the mirror) and back again.
    const viewYaw = lookBack ? lookBackYaw(carYaw) : this.camYaw;

    const fx = Math.sin(viewYaw);
    const fz = -Math.cos(viewYaw);
    const cam = this.camera;
    cam.position.set(carPos.x - fx * p.distance, carPos.y + p.height, carPos.z - fz * p.distance);

    // A slight bob, more and quicker the faster (it moves by `dt`: held while paused).
    const k = Math.min(1, Math.abs(vForward) / BOB_FULL);
    this.shakes.bob(p.bob * k, p.bobHz * (0.4 + 0.6 * k));
    this.shakes.update(dt);
    const o = this.shakes.offset();
    cam.position.x += o.x;
    cam.position.y += o.y;
    cam.position.z += o.z;

    cam.lookAt(carPos.x + fx * p.lookAhead, carPos.y + 0.9, carPos.z + fz * p.lookAhead);
    cam.rotateZ(this.shakes.roll()); // the shake's tilt: a sideways move alone is hardly seen

    const speed = Math.abs(vForward);
    const fov = p.fovMin + (p.fovMax - p.fovMin) * Math.min(1, speed / maxSpeed) ** 1.5;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
