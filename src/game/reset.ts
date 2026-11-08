import { LANE_COUNT } from '../config';
import { laneAt, lanesOccupied } from '../road/coords';

export interface Blocker {
  s: number;
  dMin: number;
  dMax: number;
  length: number;
  v?: number; // speed along the road (m/s); wrecks / unknown = 0
}

const CLEARANCE = 12;
const STEP = 5;
const MAX_BACK = 300;
const BRAKE = 6; // m/s^2 assumed for whoever has to slow down
const PLAYER_HALF_LEN = 2.2;

/** Space needed between the reset car and a blocker, given their speeds. */
function needed(b: Blocker, s: number, resetSpeed: number): number {
  const v = b.v ?? 0;
  if (b.s < s) {
    // Behind us: a faster car must be able to brake down to our speed.
    const dv = Math.max(0, v - resetSpeed);
    return Math.max(CLEARANCE, (dv * dv) / (2 * BRAKE) + 10);
  }
  // Ahead: we must be able to brake down to its speed.
  const dv = Math.max(0, resetSpeed - v);
  return Math.max(CLEARANCE, (dv * dv) / (2 * BRAKE) + 8);
}

function isClear(s: number, lane: number, blockers: Blocker[], resetSpeed: number): boolean {
  for (const b of blockers) {
    if (!lanesOccupied(b.dMin, b.dMax).includes(lane)) continue;
    const gap = Math.abs(b.s - s) - b.length / 2 - PLAYER_HALF_LEN;
    if (gap < needed(b, s, resetSpeed)) return false;
  }
  return true;
}

/**
 * Where to put the player after pressing R: at the current s or further back
 * (never forward), preferring the nearest lane, with room to brake for traffic
 * ahead and for faster traffic coming from behind. No room anywhere back to the
 * start: where it is (the player is put back whatever).
 */
export function computeResetSpot(
  playerS: number,
  playerD: number,
  blockers: Blocker[],
  resetSpeed = 0,
): { s: number; lane: number } {
  return clearSpot(playerS, playerD, blockers, resetSpeed, false) ?? { s: Math.max(0, playerS), lane: laneAt(playerD) };
}

/**
 * A clear spot only (a rival put back): as computeResetSpot, and failing that forward as far; none either way (the
 * road packed, or the start just behind): null - not put back yet. Dropped where it was anyway, two rivals came down
 * on one another: the physics blew up, its NaN spreading through the traffic.
 */
export function clearResetSpot(s: number, d: number, blockers: Blocker[], resetSpeed = 0): { s: number; lane: number } | null {
  return clearSpot(s, d, blockers, resetSpeed, true);
}

function clearSpot(s0: number, d: number, blockers: Blocker[], resetSpeed: number, forwardToo: boolean): { s: number; lane: number } | null {
  const start = Math.max(0, s0);
  const preferred = laneAt(d);
  const lanes = Array.from({ length: LANE_COUNT }, (_, i) => i).sort(
    (a, b) => Math.abs(a - preferred) - Math.abs(b - preferred),
  );
  for (let back = 0; back <= MAX_BACK; back += STEP) {
    const s = start - back;
    if (s < 0) break;
    for (const lane of lanes) if (isClear(s, lane, blockers, resetSpeed)) return { s, lane };
  }
  if (forwardToo) {
    for (let on = STEP; on <= MAX_BACK; on += STEP) {
      for (const lane of lanes) if (isClear(start + on, lane, blockers, resetSpeed)) return { s: start + on, lane };
    }
  }
  return null;
}
