import * as THREE from 'three';

export interface CameraParams {
  distance: number;
  height: number;
  lookAhead: number;
  fovMin: number;
  fovMax: number;
  lateralTau: number; // seconds
  yawFollow: number; // share of car yaw the camera follows
}

export const DEFAULT_CAMERA: CameraParams = {
  distance: 8,
  height: 3.0,
  lookAhead: 14,
  fovMin: 62,
  fovMax: 84,
  lateralTau: 0.08,
  yawFollow: 0.45,
};

/**
 * Chase camera. Follows the car directly along the road (no lag along s, so gap
 * judgement stays exact) and only smooths sideways motion and heading.
 */
export class CameraRig {
  params = { ...DEFAULT_CAMERA };
  private camX = 0;
  private camYaw = 0;
  private shakeAmount = 0;
  private initialized = false;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  shake(amount: number): void {
    this.shakeAmount = Math.min(0.6, Math.max(this.shakeAmount, amount));
  }

  snap(): void {
    this.initialized = false;
  }

  update(dt: number, carPos: THREE.Vector3, carYaw: number, speed: number, maxSpeed: number): void {
    const p = this.params;
    const targetYaw = carYaw * p.yawFollow;
    if (!this.initialized) {
      this.camX = carPos.x;
      this.camYaw = targetYaw;
      this.initialized = true;
    }
    const k = 1 - Math.exp(-dt / p.lateralTau);
    this.camX += (carPos.x - this.camX) * k;
    this.camYaw += (targetYaw - this.camYaw) * (1 - Math.exp(-dt / 0.15));

    const fx = Math.sin(this.camYaw);
    const fz = -Math.cos(this.camYaw);
    const cam = this.camera;
    cam.position.set(this.camX - fx * p.distance, carPos.y + p.height, carPos.z - fz * p.distance);

    if (this.shakeAmount > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shakeAmount;
      cam.position.y += (Math.random() - 0.5) * this.shakeAmount * 0.6;
      this.shakeAmount *= Math.exp(-dt * 8);
    }

    cam.lookAt(this.camX + fx * p.lookAhead, carPos.y + 0.9, carPos.z + fz * p.lookAhead);

    const fov = p.fovMin + (p.fovMax - p.fovMin) * Math.min(1, Math.max(0, speed / maxSpeed)) ** 1.5;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
