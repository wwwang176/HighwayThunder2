import type { IdmParams } from '../config';

export const EMERGENCY_DECEL = 9;

/**
 * Intelligent Driver Model acceleration.
 * @param gap bumper-to-bumper distance to the leader (null = free road)
 * @param dv approach rate v - vLeader (positive when closing in)
 */
export function idmAccel(v: number, gap: number | null, dv: number, p: IdmParams): number {
  const free = 1 - Math.pow(Math.max(0, v) / p.v0, 4);
  if (gap === null) return Math.max(-EMERGENCY_DECEL, Math.min(p.a, p.a * free));
  if (gap <= 0.1) return -EMERGENCY_DECEL;
  const sStar = p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(p.a * p.b)));
  const acc = p.a * (free - (sStar / gap) ** 2);
  return Math.max(-EMERGENCY_DECEL, Math.min(p.a, acc));
}
