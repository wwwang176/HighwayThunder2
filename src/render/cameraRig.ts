import * as THREE from 'three';

export interface CameraParams {
  distance: number;
  height: number;
  lookAhead: number;
  fovMin: number;
  fovMax: number;
  yawTau: number; // seconds for the camera heading to catch up with the car
}

export const DEFAULT_CAMERA: CameraParams = {
  distance: 6.8,
  height: 1.7, // low chase camera, close to the road

  lookAhead: 14,
  fovMin: 62,
  fovMax: 84,
  yawTau: 0.18,
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
  private shakeAmount = 0;
  private initialized = false;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  shake(amount: number): void {
    this.shakeAmount = Math.min(0.6, Math.max(this.shakeAmount, amount));
  }

  snap(): void {
    this.initialized = false;
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

    if (this.shakeAmount > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shakeAmount;
      cam.position.y += (Math.random() - 0.5) * this.shakeAmount * 0.6;
      this.shakeAmount *= Math.exp(-dt * 8);
    }

    cam.lookAt(carPos.x + fx * p.lookAhead, carPos.y + 0.9, carPos.z + fz * p.lookAhead);

    const speed = Math.abs(vForward);
    const fov = p.fovMin + (p.fovMax - p.fovMin) * Math.min(1, speed / maxSpeed) ** 1.5;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
