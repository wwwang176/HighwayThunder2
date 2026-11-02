import { CARS, JDM_CAR, MUSCLE_CAR, STREET_RACER } from '../vehicles/cars';
import { DIFFICULTIES } from './difficulty';

/** Weathers there will be; only the clear night can be picked for now. */
export type Weather = 'clear' | 'rain' | 'fog';

/**
 * The race picked in the garage: the player's car, each rival's (car type ids,
 * src/vehicles/cars; 0 to MAX_RIVALS of them), the difficulty (DIFFICULTIES)
 * and the weather.
 */
export interface CarSelection {
  player: string;
  rivals: string[];
  difficulty: number;
  weather: Weather;
}

export const MAX_RIVALS = 5;
const KEY = 'ht2.cars';
const NORMAL = 1;

/** Car types that can be picked now. */
export const PICKABLE: string[] = [STREET_RACER.id, MUSCLE_CAR.id, JDM_CAR.id];

/** What the garage shows for a car: its accent colour and three measured stats (value shown, bar 0..1 relative to the others). */
export interface CarCard {
  id: string;
  name: string;
  /** Accent of the garage while this car is picked. */
  accent: string;
  /** Silhouette icon (public/ui/<icon>.png). */
  icon: string;
  stats: { icon: string; tip: string; value: string; bar: number }[];
  pickable: boolean;
}

const stats = (accel: string, a: number, top: string, t: number, grip: string, g: number) => [
  { icon: 'icon-accel', tip: '加速（0–100 km/h）', value: accel, bar: a },
  { icon: 'icon-topspeed', tip: '極速', value: top, bar: t },
  { icon: 'icon-handling', tip: '過彎抓地力', value: grip, bar: g },
];

// training/cornering.train.ts (launch, cornering at 200 km/h).
export const CAR_CARDS: CarCard[] = [
  { id: STREET_RACER.id, name: STREET_RACER.name, accent: '#ff3b30', icon: 'icon-super', stats: stats('0–100 4.2 秒', 0.8, '300 km/h', 1, '2.1 g', 0.75), pickable: true },
  { id: MUSCLE_CAR.id, name: MUSCLE_CAR.name, accent: '#ff9f1a', icon: 'icon-muscle', stats: stats('0–100 4.0 秒', 1, '259 km/h', 0.75, '1.4 g', 0.45), pickable: true },
  { id: JDM_CAR.id, name: JDM_CAR.name, accent: '#2f9bff', icon: 'icon-jdm', stats: stats('0–100 4.0 秒', 0.75, '245 km/h', 0.6, '2.4 g', 1), pickable: true },
];

/** Everyone on the supercar, five rivals, normal, a clear night (the game as it was). */
export function defaultSelection(): CarSelection {
  return { player: STREET_RACER.id, rivals: Array.from({ length: MAX_RIVALS }, () => STREET_RACER.id), difficulty: NORMAL, weather: 'clear' };
}

const pickable = (id: unknown): string => (typeof id === 'string' && PICKABLE.includes(id) && CARS[id] ? id : STREET_RACER.id);

/**
 * A selection made safe: unknown or unpickable cars become the supercar, at
 * most MAX_RIVALS rivals (none missing: the default five), a difficulty that
 * exists, the clear night. Old saves (cars only) keep their cars.
 */
export function sanitize(x: unknown): CarSelection {
  if (!x || typeof x !== 'object') return defaultSelection();
  const o = x as { player?: unknown; rivals?: unknown; difficulty?: unknown };
  const rivals = Array.isArray(o.rivals) ? o.rivals.slice(0, MAX_RIVALS).map(pickable) : defaultSelection().rivals;
  const difficulty = typeof o.difficulty === 'number' && Number.isInteger(o.difficulty) && DIFFICULTIES[o.difficulty] ? o.difficulty : NORMAL;
  return { player: pickable(o.player), rivals, difficulty, weather: 'clear' };
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

/** One more rival at the end, on the player's car (none past MAX_RIVALS). */
export function addRival(s: CarSelection): CarSelection {
  return s.rivals.length >= MAX_RIVALS ? s : { ...s, rivals: [...s.rivals, s.player] };
}

/** Rival `i` gone; the ones after it move up. */
export function removeRival(s: CarSelection, i: number): CarSelection {
  return { ...s, rivals: s.rivals.filter((_, k) => k !== i) };
}

/** Every rival on a car drawn at random from the pickable ones (as many rivals as before). */
export function allRandom(s: CarSelection, rng: () => number): CarSelection {
  return { ...s, rivals: s.rivals.map(() => PICKABLE[Math.floor(rng() * PICKABLE.length) % PICKABLE.length]) };
}

/** Every rival on the player's car (as many rivals as before). */
export function allSameAsPlayer(s: CarSelection): CarSelection {
  return { ...s, rivals: s.rivals.map(() => s.player) };
}
