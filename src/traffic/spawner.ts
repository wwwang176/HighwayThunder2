import { LANE_COUNT, VEHICLE_SPECS, VehicleKind } from '../config';

export interface SpawnRequest {
  kind: VehicleKind;
  s: number;
  lane: number;
}

export interface Occupant {
  s: number;
  lane: number;
  length: number;
}

export const MIN_CLEAR_GAP = 25;
export const DEFAULT_SPACING = 85; // mean distance between vehicles in one lane (m)
const AHEAD_MIN = 60;
const AHEAD_MAX = 700;
const FAR_EDGE = 600;
const REAR_MIN = -220;
const REAR_MAX = -180;
const REAR_WINDOW: [number, number] = [-260, -60];
const REAR_SPACING = 120;
const REAR_START_TIME = 5;
const REAR_MAX_PLAYER_V = 25;

export function pickKind(rng: () => number): VehicleKind {
  const r = rng();
  if (r < 0.7) return 'car';
  if (r < 0.88) return 'truck';
  return 'container';
}

/** Heavy vehicles only use the right two lanes, so they are concentrated there. */
export function pickKindForLane(lane: number, rng: () => number): VehicleKind {
  if (!VEHICLE_SPECS.truck.allowedLanes.includes(lane)) return 'car';
  const r = rng();
  if (r < 0.45) return 'car';
  if (r < 0.75) return 'truck';
  return 'container';
}

export function shouldDespawn(agentS: number, playerS: number): boolean {
  return agentS < playerS - 260 || agentS > playerS + 900;
}

function canPlace(s: number, lane: number, len: number, occ: Occupant[]): boolean {
  for (const o of occ) {
    if (o.lane !== lane) continue;
    if (Math.abs(o.s - s) - (o.length + len) / 2 < MIN_CLEAR_GAP) return false;
  }
  return true;
}

function fill(
  out: SpawnRequest[],
  occ: Occupant[],
  rng: () => number,
  countWindow: [number, number],
  placeWindow: [number, number],
  spacing: number,
): void {
  const target = (countWindow[1] - countWindow[0]) / spacing;
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    let count = occ.filter((o) => o.lane === lane && o.s >= countWindow[0] && o.s <= countWindow[1]).length;
    let attempts = 0;
    while (count < target && attempts < 40) {
      attempts++;
      const kind = pickKindForLane(lane, rng);
      const len = VEHICLE_SPECS[kind].length;
      const lo = placeWindow[0] + len / 2;
      const hi = placeWindow[1] - len / 2;
      if (hi <= lo) continue;
      const s = lo + rng() * (hi - lo);
      if (!canPlace(s, lane, len, occ)) continue;
      const req = { kind, s, lane };
      out.push(req);
      occ.push({ s, lane, length: len });
      count++;
    }
  }
}

/**
 * Decide which vehicles to add. Initial fill populates the whole stretch ahead
 * (never closer than 60 m, never behind); afterwards new traffic appears only at
 * the far edge, and behind the player only once they are slow after 5 s of racing.
 */
export function planSpawns(o: {
  playerS: number;
  playerV: number;
  raceTime: number;
  occupied: Occupant[];
  rng: () => number;
  initial: boolean;
  spacing?: number;
}): SpawnRequest[] {
  const out: SpawnRequest[] = [];
  const occ = o.occupied.slice();
  const spacing = o.spacing ?? DEFAULT_SPACING;
  const ahead: [number, number] = [o.playerS + AHEAD_MIN, o.playerS + AHEAD_MAX];
  fill(out, occ, o.rng, ahead, o.initial ? ahead : [o.playerS + FAR_EDGE, o.playerS + AHEAD_MAX], spacing);
  if (!o.initial && o.raceTime >= REAR_START_TIME && o.playerV < REAR_MAX_PLAYER_V) {
    fill(
      out,
      occ,
      o.rng,
      [o.playerS + REAR_WINDOW[0], o.playerS + REAR_WINDOW[1]],
      [o.playerS + REAR_MIN, o.playerS + REAR_MAX],
      REAR_SPACING,
    );
  }
  return out;
}
