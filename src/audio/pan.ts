/**
 * Placing a mono sound by hand, not with a PannerNode: its azimuth from the ear, equal-power left/right gains, and
 * inverse distance attenuation - the Web Audio spec's own `equalpower` and `inverse` formulas, worked out here once
 * a frame and handed to two gain nodes. (A PannerNode recomputes every sample once its position moves, and every
 * one of them once the listener does: measured in grok-aircraft2, three to six times the audio thread's load, and
 * a thread that can't keep up is heard as crackling.)
 */

/** The ear: where it is, facing which way (`forward`, `up`: need not be unit vectors). */
export interface EarPose {
  px: number; py: number; pz: number;
  fx: number; fy: number; fz: number;
  ux: number; uy: number; uz: number;
}

/**
 * The source's azimuth from the ear, degrees: 0 ahead, +90 right, -90 left, ±180 behind (0 where it's on the ear
 * or straight above or below).
 */
export function azimuthDeg(sx: number, sy: number, sz: number, e: EarPose): number {
  let dx = sx - e.px, dy = sy - e.py, dz = sz - e.pz;
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 0)) return 0;
  dx /= len; dy /= len; dz /= len;
  // right = forward x up
  let rx = e.fy * e.uz - e.fz * e.uy, ry = e.fz * e.ux - e.fx * e.uz, rz = e.fx * e.uy - e.fy * e.ux;
  const rl = Math.hypot(rx, ry, rz), fl = Math.hypot(e.fx, e.fy, e.fz);
  if (!(rl > 0) || !(fl > 0)) return 0;
  rx /= rl; ry /= rl; rz /= rl;
  const fx = e.fx / fl, fy = e.fy / fl, fz = e.fz / fl;
  // the true up = right x forward (square to forward)
  const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
  const up = dx * ux + dy * uy + dz * uz;
  let px = dx - up * ux, py = dy - up * uy, pz = dz - up * uz;
  const pl = Math.hypot(px, py, pz);
  if (!(pl > 1e-9)) return 0;
  px /= pl; py /= pl; pz /= pl;
  const cos = px * rx + py * ry + pz * rz;
  let az = (180 / Math.PI) * Math.acos(cos > 1 ? 1 : cos < -1 ? -1 : cos);
  if (px * fx + py * fy + pz * fz < 0) az = 360 - az;
  return az >= 0 && az <= 270 ? 90 - az : 450 - az;
}

/** A mono source's equal-power gains at `azimuth` (behind folded onto ahead), times `gain`, into `out` [left, right]. */
export function equalPowerMono(azimuth: number, gain: number, out: Float32Array): void {
  let az = azimuth > 180 ? 180 : azimuth < -180 ? -180 : azimuth;
  if (az < -90) az = -180 - az;
  else if (az > 90) az = 180 - az;
  const x = (az + 90) / 180;
  out[0] = gain * Math.cos((x * Math.PI) / 2);
  out[1] = gain * Math.sin((x * Math.PI) / 2);
}

/**
 * The nearest of the first `count` `sources` within `range` of the ear (as many as `idx` holds): their indices into
 * `idx`, their squared distances into `d2`, nearest first. How many.
 */
export function nearestWithin(sources: readonly { pos: readonly number[] }[], count: number, ear: EarPose, range: number, idx: Int32Array, d2: Float64Array): number {
  const max = idx.length, r2 = range * range;
  let m = 0;
  for (let i = 0; i < count; i++) {
    const p = sources[i].pos;
    const dx = p[0] - ear.px, dy = p[1] - ear.py, dz = p[2] - ear.pz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > r2) continue;
    let j: number;
    if (m < max) j = m++;
    else if (d >= d2[max - 1]) continue;
    else j = max - 1;
    while (j > 0 && d2[j - 1] > d) {
      d2[j] = d2[j - 1];
      idx[j] = idx[j - 1];
      j--;
    }
    d2[j] = d;
    idx[j] = i;
  }
  return m;
}

/** Inverse distance attenuation (the spec's `inverse` model): full within `ref`; `rolloff` 0 none. */
export function inverseDistanceGain(distance: number, ref: number, rolloff: number): number {
  if (!(ref > 0)) return 1;
  const d = distance > ref ? distance : ref;
  return ref / (ref + rolloff * (d - ref));
}
