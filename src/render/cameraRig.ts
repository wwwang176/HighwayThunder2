import * as THREE from 'three';
import { ShakeManager, type Shake } from './shake';

export interface CameraParams {
  distance: number;
  height: number;
  lookAhead: number;
  fovMin: number;
  fovMax: number;
  yawTau: number; // seconds for the camera heading to catch up with the car
  /**
   * The road's shake up and down (m): none up to `bobFrom` of the car's top speed, rising evenly to all of it at
   * `bobFull`; how quick (noise steps a second) at 0 km/h, its rise per km/h, its most.
   */
  bob: number;
  bobFrom: number;
  bobFull: number;
  bobHz: number;
  bobHzPerKmh: number;
  bobHzMax: number;
}

export const DEFAULT_CAMERA: CameraParams = {
  distance: 5.6, // close behind (was 6.8)
  height: 1.3, // low chase camera, close to the road

  lookAhead: 14,
  fovMin: 62,
  fovMax: 84,
  yawTau: 0.18,
  // The road's small unevenness: half the grass's shake (2.16 cm, Game.grassRumble), as quick.
  bob: 0.0108,
  bobFrom: 1 / 5,
  bobFull: 2 / 3,
  bobHz: 4,
  bobHzPerKmh: 0.12,
  bobHzMax: 25,
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

/** Where the held look keys turn the view: ahead (none), back (C), or to the car's left / right (Q / E). */
export type Look = 'ahead' | 'back' | 'left' | 'right';

/** Camera yaw for a look to the side: square to the car's nose, to its left (- yaw) or right. */
export function lookSideYaw(carYaw: number, side: 'left' | 'right'): number {
  return wrapAngle(carYaw + (side === 'right' ? 1 : -1) * (Math.PI / 2));
}

/**
 * Chase camera that trails the car along its direction of travel (never
 * locked to the road / finish line). Holding the look-back key swings it to the
 * front of the car, looking straight back; the look-left / look-right keys, across it, looking out to that side.
 */
export class CameraRig {
  params = { ...DEFAULT_CAMERA };
  private camYaw = 0;
  private reversing = false;
  private readonly shakes = new ShakeManager();
  private initialized = false;
  /** The camera's shake this frame in the view's terms (m across and up, its tilt in rad): the HUD shakes with it. */
  shaken = { right: 0, up: 0, roll: 0 };

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
    this.shaken = { right: 0, up: 0, roll: 0 };
  }

  update(
    dt: number,
    carPos: THREE.Vector3,
    carYaw: number,
    vel: { x: number; z: number },
    vForward: number,
    maxSpeed: number,
    look: Look = 'ahead',
  ): void {
    const p = this.params;
    this.reversing = reverseView(this.reversing, vForward);
    const targetYaw = cameraTargetYaw(carYaw, vel.x, vel.z, this.reversing);
    if (!this.initialized) {
      this.camYaw = targetYaw;
      this.initialized = true;
    }
    this.camYaw = wrapAngle(approachAngle(this.camYaw, targetYaw, 1 - Math.exp(-dt / p.yawTau)));
    // Looking back or to a side is an instant cut (like glancing in the mirror, or over a shoulder) and back again:
    // the camera across the car from where it looks, the car in the near side of the view.
    const viewYaw = look === 'back' ? lookBackYaw(carYaw) : look === 'ahead' ? this.camYaw : lookSideYaw(carYaw, look);

    const fx = Math.sin(viewYaw);
    const fz = -Math.cos(viewYaw);
    const cam = this.camera;
    cam.position.set(carPos.x - fx * p.distance, carPos.y + p.height, carPos.z - fz * p.distance);

    // The road's shake up and down, by the share of the car's top speed (it moves by `dt`: held while paused).
    const kmh = Math.abs(vForward) * 3.6;
    const share = Math.abs(vForward) / maxSpeed;
    const k = THREE.MathUtils.clamp((share - p.bobFrom) / (p.bobFull - p.bobFrom), 0, 1);
    this.shakes.bob(p.bob * k, Math.min(p.bobHzMax, p.bobHz + kmh * p.bobHzPerKmh));
    this.shakes.update(dt);
    const o = this.shakes.offset();
    cam.position.x += o.x;
    cam.position.y += o.y;
    cam.position.z += o.z;

    cam.lookAt(carPos.x + fx * p.lookAhead, carPos.y + 0.9, carPos.z + fz * p.lookAhead);
    const roll = this.shakes.roll();
    cam.rotateZ(roll); // the shake's tilt: a sideways move alone is hardly seen
    // The shake in the view's terms, for the HUD (across: along the view's right, (-fz, 0, fx)).
    this.shaken = { right: o.x * -fz + o.z * fx, up: o.y, roll };

    this.widen(vForward, maxSpeed);
  }

  /**
   * The hood camera: fixed on the car (`car`, drawn where it is), at `eye` in its own terms, looking ahead along it
   * (HOOD_PITCH down), turning, pitching and rolling with it; its view widening with speed as the chase camera's.
   */
  updateHood(car: THREE.Object3D, eye: THREE.Vector3, vForward: number, maxSpeed: number): void {
    const cam = this.camera;
    car.updateMatrixWorld();
    cam.position.copy(eye).applyMatrix4(car.matrixWorld);
    cam.quaternion.copy(car.quaternion).multiply(HOOD_TILT);
    this.shaken = { right: 0, up: 0, roll: 0 };
    this.initialized = false; // (back to the chase camera: it starts behind the car, not swinging round)
    this.widen(vForward, maxSpeed);
  }

  /** The view wider with speed: fovMin standing, fovMax at top speed. */
  private widen(vForward: number, maxSpeed: number): void {
    const p = this.params, cam = this.camera;
    const speed = Math.abs(vForward);
    const fov = p.fovMin + (p.fovMax - p.fovMin) * Math.min(1, speed / maxSpeed) ** 1.5;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}

/** The hood camera looks this far down from the car's own level (rad). */
const HOOD_PITCH = THREE.MathUtils.degToRad(3);
const HOOD_TILT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -HOOD_PITCH);
