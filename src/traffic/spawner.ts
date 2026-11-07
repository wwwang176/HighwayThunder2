import { LANE_COUNT, VEHICLE_SPECS, VehicleKind } from '../config';

export interface SpawnRequest {
  kind: VehicleKind;
  s: number;
  lane: number;
  /** Highest initial speed from which it can still stop behind whatever is ahead. */
  vMax: number;
}

export interface Occupant {
  s: number;
  lane: number;
  length: number;
  v?: number;
}

const SPAWN_BRAKE = 3; // m/s^2 assumed when choosing a safe initial speed

export const MIN_CLEAR_GAP = 25;
export const DEFAULT_SPACING = 100; // mean distance between vehicles in one lane (m)
const AHEAD_MIN = 60;
const AHEAD_MAX = 700;
const FAR_EDGE = 600;
const REAR_MIN = -220;
const REAR_MAX = -180;
const REAR_WINDOW: [number, number] = [-260, -60];
const REAR_SPACING = 120;
const REAR_START_TIME = 5;
const REAR_MAX_PLAYER_V = 25;
/** Gone this far behind the last racer (the plain rule), and ahead of the first (both ways: behind the last too). */
export const BEHIND_DESPAWN = 260;
export const FAR_DESPAWN = 900;

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

/**
 * @param facing +1 when the traffic travels the player's way, -1 for oncoming
 * traffic (whose s runs the other way, so "behind the player" is larger s).
 */
export function shouldDespawn(agentS: number, playerS: number, facing: 1 | -1 = 1): boolean {
  return shouldDespawnRange(agentS, playerS, playerS, facing);
}

/**
 * Same rule for a spread-out group of drivers (AI training): gone once far
 * behind the last one (`tailS`) or far ahead of the first one (`leadS`).
 */
export function shouldDespawnRange(agentS: number, tailS: number, leadS: number, facing: 1 | -1 = 1, behind = BEHIND_DESPAWN): boolean {
  return (agentS - tailS) * facing < -behind || (agentS - leadS) * facing > FAR_DESPAWN;
}

function canPlace(s: number, lane: number, len: number, occ: Occupant[]): boolean {
  for (const o of occ) {
    if (o.lane !== lane) continue;
    if (Math.abs(o.s - s) - (o.length + len) / 2 < MIN_CLEAR_GAP) return false;
  }
  return true;
}

function safeSpeed(s: number, lane: number, len: number, occ: Occupant[]): number {
  let best = Infinity;
  for (const o of occ) {
    if (o.lane !== lane || o.s <= s) continue;
    const gap = o.s - o.length / 2 - (s + len / 2);
    best = Math.min(best, (o.v ?? Infinity) + Math.sqrt(2 * SPAWN_BRAKE * Math.max(0, gap)));
  }
  return best;
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
  // Never pack the placement band denser than the target spacing, even when the
  // rest of the window is empty (e.g. the player is stopped and traffic drove off).
  const bandCap = Math.max(1, Math.ceil((placeWindow[1] - placeWindow[0]) / spacing));
  const inRange = (o: Occupant, lane: number, w: [number, number]) => o.lane === lane && o.s >= w[0] && o.s <= w[1];
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    let count = occ.filter((o) => inRange(o, lane, countWindow)).length;
    let band = occ.filter((o) => inRange(o, lane, placeWindow)).length;
    let attempts = 0;
    while (count < target && band < bandCap && attempts < 40) {
      attempts++;
      const kind = pickKindForLane(lane, rng);
      const len = VEHICLE_SPECS[kind].length;
      const lo = placeWindow[0] + len / 2;
      const hi = placeWindow[1] - len / 2;
      if (hi <= lo) continue;
      const s = lo + rng() * (hi - lo);
      if (!canPlace(s, lane, len, occ)) continue;
      const vMax = safeSpeed(s, lane, len, occ);
      out.push({ kind, s, lane, vMax });
      occ.push({ s, lane, length: len, v: Math.min(vMax, VEHICLE_SPECS[kind].speedRange[1]) });
      count++;
      band++;
    }
  }
}

/**
 * Decide which vehicles to add. Initial fill populates the whole stretch ahead
 * (never closer than 60 m, never behind); afterwards new traffic appears only at
 * the far edge, and behind the player only once they are slow after 5 s of racing.
 * `bothWays` (the game): behind the last racer (`tailS`) as ahead of the first - the whole stretch filled at
 * first, then new traffic only at its far edge, in the fog as ahead - whichever way the player goes (backing up,
 * turned round), traffic comes out of the fog, never out of nowhere (and goes past FAR_DESPAWN both ways).
 */
export function planSpawns(o: {
  playerS: number;
  playerV: number;
  raceTime: number;
  occupied: Occupant[];
  rng: () => number;
  initial: boolean;
  spacing?: number;
  /** +1: traffic goes the player's way. -1: oncoming (spawn ahead of the player in world terms, i.e. at smaller s). */
  facing?: 1 | -1;
  /** Traffic kept behind the last racer (`tailS`; `playerS` the first) as ahead of the first. */
  bothWays?: boolean;
  tailS?: number;
}): SpawnRequest[] {
  const out: SpawnRequest[] = [];
  const occ = o.occupied.slice();
  const spacing = o.spacing ?? DEFAULT_SPACING;
  const f = o.facing ?? 1;
  const win = (a: number, b: number): [number, number] => {
    const x = o.playerS + f * a;
    const y = o.playerS + f * b;
    return [Math.min(x, y), Math.max(x, y)];
  };
  const ahead = win(AHEAD_MIN, AHEAD_MAX);
  fill(out, occ, o.rng, ahead, o.initial ? ahead : win(FAR_EDGE, AHEAD_MAX), spacing);
  if (o.bothWays) {
    const t = o.tailS ?? o.playerS;
    const back = (a: number, b: number): [number, number] => {
      const x = t - f * a;
      const y = t - f * b;
      return [Math.min(x, y), Math.max(x, y)];
    };
    const behind = back(AHEAD_MIN, AHEAD_MAX);
    fill(out, occ, o.rng, behind, o.initial ? behind : back(FAR_EDGE, AHEAD_MAX), spacing);
  } else if (f === 1 && !o.initial && o.raceTime >= REAR_START_TIME && o.playerV < REAR_MAX_PLAYER_V) {
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
