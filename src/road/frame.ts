import { ONCOMING_X } from '../config';

/**
 * A carriageway's road coordinates (s along its direction of travel, d to its
 * right) mapped to world space. Our carriageway: x = d, z = -s. The oncoming
 * carriageway runs the other way, centred at ONCOMING_X.
 */
export class RoadFrame {
  constructor(readonly dir: 1 | -1, readonly xCenter: number) {}

  toWorld(s: number, d: number): { x: number; z: number } {
    return { x: this.xCenter + this.dir * d, z: s === 0 ? 0 : -this.dir * s };
  }

  fromWorld(x: number, z: number): { s: number; d: number } {
    return { s: z === 0 ? 0 : -this.dir * z, d: this.dir * (x - this.xCenter) };
  }

  /** World-space unit forward for a frame-relative yaw. */
  forwardWorld(yaw: number): { x: number; z: number } {
    return { x: this.dir * Math.sin(yaw), z: -this.dir * Math.cos(yaw) };
  }

  /** Frame-relative yaw of a world-space forward vector. */
  yawFromWorldForward(fx: number, fz: number): number {
    return Math.atan2(this.dir * fx, -this.dir * fz);
  }

  /** Three.js rotation.y for a model whose nose points to -Z. */
  rotationY(yaw: number): number {
    return this.dir === 1 ? -yaw : Math.PI - yaw;
  }

  /** Speed along the frame's direction of travel from a world velocity. */
  speedAlong(vz: number): number {
    return -this.dir * vz;
  }
}

export const OUR_FRAME = new RoadFrame(1, 0);
export const ONCOMING_FRAME = new RoadFrame(-1, ONCOMING_X);

/** A world-space oriented box (vehicle part) expressed as an AI obstacle in `frame`. */
export function boxToFrame(
  frame: RoadFrame,
  b: { x: number; z: number; fx: number; fz: number; w: number; l: number; vx: number; vz: number },
): { s: number; dMin: number; dMax: number; length: number; v: number } {
  const c = frame.fromWorld(b.x, b.z);
  const yaw = frame.yawFromWorldForward(b.fx, b.fz);
  const cs = Math.abs(Math.cos(yaw));
  const sn = Math.abs(Math.sin(yaw));
  const halfD = (b.w / 2) * cs + (b.l / 2) * sn;
  const halfS = (b.l / 2) * cs + (b.w / 2) * sn;
  return { s: c.s, dMin: c.d - halfD, dMax: c.d + halfD, length: halfS * 2, v: frame.speedAlong(b.vz) };
}
