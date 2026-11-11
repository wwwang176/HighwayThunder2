import { ONCOMING_X } from '../config';
import { Centerline, STRAIGHT_ROAD } from './centerline';

/**
 * A carriageway's road coordinates (s along its direction of travel, d to its right) mapped to world space,
 * along the road's centre line (`line`; straight: our carriageway x = d, z = -s). The oncoming carriageway runs
 * the other way, centred ONCOMING_X to our left: its s is our -s, its d our ONCOMING_X - d.
 *
 * A yaw in a frame is against the road where it is (0 along its way), so the world's heading at frame s is the
 * road's there (`heading`) plus it.
 */
export class RoadFrame {
  /** The road's centre line (the game's this race: useRoad). */
  line: Centerline = STRAIGHT_ROAD;

  constructor(readonly dir: 1 | -1, readonly xCenter: number) {}

  /** Our s of frame s. */
  ourS(s: number): number {
    return this.dir * s;
  }

  /** Frame s of our s. */
  sOf(ourS: number): number {
    return this.dir * ourS;
  }

  /** The road's heading in the world at frame s (rad; the frame's own way: ours + PI for the oncoming one, left out). */
  heading(s: number): number {
    return this.line.straight ? 0 : this.line.heading(this.dir * s);
  }

  /** The road's curvature along the frame's way at frame s (1/m, > 0 bending toward its +d). */
  curvature(s: number): number {
    return this.line.straight ? 0 : this.dir * this.line.curvature(this.dir * s);
  }

  toWorld(s: number, d: number): { x: number; z: number } {
    if (this.line.straight) return { x: this.xCenter + this.dir * d, z: s === 0 ? 0 : -this.dir * s };
    return this.line.toWorld(this.dir * s, this.xCenter + this.dir * d);
  }

  /** `hint`: a frame s near the answer (a thing's last), else found afresh. */
  fromWorld(x: number, z: number, hint?: number): { s: number; d: number } {
    if (this.line.straight) return { s: z === 0 ? 0 : -this.dir * z, d: this.dir * (x - this.xCenter) };
    const p = this.line.project(x, z, hint === undefined ? undefined : this.dir * hint);
    return { s: this.dir * p.s, d: this.dir * (p.d - this.xCenter) };
  }

  /** World-space unit forward for a frame-relative yaw at frame s. */
  forwardWorld(yaw: number, s: number): { x: number; z: number } {
    const a = yaw + this.heading(s);
    return { x: this.dir * Math.sin(a), z: -this.dir * Math.cos(a) };
  }

  /** Frame-relative yaw of a world-space forward vector at frame s. */
  yawFromWorldForward(fx: number, fz: number, s: number): number {
    const a = Math.atan2(this.dir * fx, -this.dir * fz);
    if (this.line.straight) return a;
    const r = a - this.heading(s);
    return Math.atan2(Math.sin(r), Math.cos(r));
  }

  /** Three.js rotation.y for a model whose nose points to -Z, at a frame-relative yaw at frame s. */
  rotationY(yaw: number, s: number): number {
    const a = yaw + this.heading(s);
    return this.dir === 1 ? -a : Math.PI - a;
  }

  /** Speed along the frame's direction of travel at frame s from a world velocity. */
  speedAlong(vx: number, vz: number, s: number): number {
    if (this.line.straight) return -this.dir * vz;
    const th = this.heading(s);
    return this.dir * (vx * Math.sin(th) - vz * Math.cos(th));
  }
}

export const OUR_FRAME = new RoadFrame(1, 0);
export const ONCOMING_FRAME = new RoadFrame(-1, ONCOMING_X);

/** The road both carriageways run along (the game's, each race; training's: straight, as by default). */
export function useRoad(line: Centerline): void {
  OUR_FRAME.line = line;
  ONCOMING_FRAME.line = line;
}

/** A world-space oriented box (vehicle part) expressed as an AI obstacle in `frame` (`hint`: a frame s near it). */
export function boxToFrame(
  frame: RoadFrame,
  b: { x: number; z: number; fx: number; fz: number; w: number; l: number; vx: number; vz: number },
  hint?: number,
): { s: number; dMin: number; dMax: number; length: number; v: number } {
  const c = frame.fromWorld(b.x, b.z, hint);
  const yaw = frame.yawFromWorldForward(b.fx, b.fz, c.s);
  const cs = Math.abs(Math.cos(yaw));
  const sn = Math.abs(Math.sin(yaw));
  const halfD = (b.w / 2) * cs + (b.l / 2) * sn;
  const halfS = (b.l / 2) * cs + (b.w / 2) * sn;
  return { s: c.s, dMin: c.d - halfD, dMax: c.d + halfD, length: halfS * 2, v: frame.speedAlong(b.vx, b.vz, c.s) };
}
