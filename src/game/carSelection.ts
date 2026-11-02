import { CARS, JDM_CAR, MUSCLE_CAR, STREET_RACER } from '../vehicles/cars';

/** The cars picked before a race: the player's, and each rival's (car type ids, src/vehicles/cars). */
export interface CarSelection {
  player: string;
  rivals: string[];
}

const RIVALS = 5;
const KEY = 'ht2.cars';

/** Car types that can be picked now. */
export const PICKABLE: string[] = [STREET_RACER.id, MUSCLE_CAR.id, JDM_CAR.id];

/** What the setup page shows for each car: a line about it and four bars (0..1, relative to each other). */
export interface CarCard {
  id: string;
  name: string;
  tagline: string;
  color: number;
  stats: { accel: number; top: number; handling: number; stability: number };
  pickable: boolean;
}

export const CAR_CARDS: CarCard[] = [
  { id: STREET_RACER.id, name: STREET_RACER.name, tagline: '加速快、極速最高', color: STREET_RACER.color, stats: { accel: 0.8, top: 1, handling: 0.6, stability: 0.8 }, pickable: true },
  { id: MUSCLE_CAR.id, name: MUSCLE_CAR.name, tagline: '加速最快、懸吊軟、容易甩尾', color: MUSCLE_CAR.color, stats: { accel: 1, top: 0.7, handling: 0.4, stability: 0.4 }, pickable: true },
  { id: JDM_CAR.id, name: JDM_CAR.name, tagline: 'JDM 風格、轉彎最強、精準', color: JDM_CAR.color, stats: { accel: 0.7, top: 0.6, handling: 1, stability: 0.9 }, pickable: true },
];

/** Everyone on the supercar (the game as it was). */
export function defaultSelection(): CarSelection {
  return { player: STREET_RACER.id, rivals: Array.from({ length: RIVALS }, () => STREET_RACER.id) };
}

const pickable = (id: unknown): string => (typeof id === 'string' && PICKABLE.includes(id) && CARS[id] ? id : STREET_RACER.id);

/** A selection made safe: unknown or unpickable cars become the supercar, always five rivals. */
export function sanitize(x: unknown): CarSelection {
  if (!x || typeof x !== 'object') return defaultSelection();
  const o = x as { player?: unknown; rivals?: unknown };
  const rivals = Array.isArray(o.rivals) ? o.rivals : [];
  return { player: pickable(o.player), rivals: Array.from({ length: RIVALS }, (_, i) => pickable(rivals[i])) };
}

export function loadSelection(storage: Pick<Storage, 'getItem'>): CarSelection {
  try {
    return sanitize(JSON.parse(storage.getItem(KEY) ?? 'null'));
  } catch {
    return defaultSelection();
  }
}

export function saveSelection(storage: Pick<Storage, 'setItem'>, s: CarSelection): void {
  storage.setItem(KEY, JSON.stringify(s));
}

/** Every rival on a car drawn at random from the pickable ones. */
export function allRandom(s: CarSelection, rng: () => number): CarSelection {
  return { player: s.player, rivals: s.rivals.map(() => PICKABLE[Math.floor(rng() * PICKABLE.length) % PICKABLE.length]) };
}

/** Every rival on the player's car. */
export function allSameAsPlayer(s: CarSelection): CarSelection {
  return { player: s.player, rivals: s.rivals.map(() => s.player) };
}
