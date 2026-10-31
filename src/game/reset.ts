import { LANE_COUNT } from '../config';
import { laneAt, lanesOccupied } from '../road/coords';

export interface Blocker {
  s: number;
  dMin: number;
  dMax: number;
  length: number;
}

const CLEARANCE = 12;
const STEP = 5;
const MAX_BACK = 300;

function isClear(s: number, lane: number, blockers: Blocker[]): boolean {
  for (const b of blockers) {
    if (Math.abs(b.s - s) >= CLEARANCE + b.length / 2) continue;
    if (lanesOccupied(b.dMin, b.dMax).includes(lane)) return false;
  }
  return true;
}

/**
 * Where to put the player after pressing R: nearest lane, at the current s or
 * further back (never forward), clear of any vehicle or wreck.
 */
export function computeResetSpot(playerS: number, playerD: number, blockers: Blocker[]): { s: number; lane: number } {
  const start = Math.max(0, playerS);
  const preferred = laneAt(playerD);
  const lanes = Array.from({ length: LANE_COUNT }, (_, i) => i).sort(
    (a, b) => Math.abs(a - preferred) - Math.abs(b - preferred),
  );
  for (const lane of lanes) {
    for (let back = 0; back <= MAX_BACK; back += STEP) {
      const s = start - back;
      if (s < 0) break;
      if (isClear(s, lane, blockers)) return { s, lane };
    }
  }
  return { s: start, lane: preferred };
}
