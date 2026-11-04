import { CARS, JDM_CAR, MUSCLE_CAR, STREET_RACER } from '../vehicles/cars';
import { DIFFICULTIES } from './difficulty';

/** Weathers there will be; only the clear night can be picked for now. */
export type Weather = 'clear' | 'rain' | 'fog';

/** How the rivals' cars are picked: drawn at random each race, all on the player's car, or each as listed. */
export type RivalMode = 'random' | 'same' | 'custom';
const RIVAL_MODES: RivalMode[] = ['random', 'same', 'custom'];

/**
 * The race picked in the garage: the player's car, each rival's (car type ids,
 * src/vehicles/cars; 0 to MAX_RIVALS of them; their cars as listed only in the
 * custom mode, raceRivals), the difficulty (DIFFICULTIES) and the weather; and
 * the paint job picked for each car type (its file's livery name; none picked:
 * the car's own).
 */
export interface CarSelection {
  player: string;
  rivals: string[];
  rivalMode: RivalMode;
  difficulty: number;
  weather: Weather;
  paint: Record<string, string>;
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
  /** Its type in English: the garage's small caps over its name. */
  tag: string;
  /** A stat: its small-caps label, the number and its unit apart (the number big). */
  stats: { icon: string; tip: string; label: string; value: string; unit: string; bar: number }[];
  pickable: boolean;
}

const stats = (accel: string, a: number, top: string, t: number, grip: string, g: number) => [
  { icon: 'icon-accel', tip: '加速（0–100 km/h）', label: '0–100', value: accel, unit: '秒', bar: a },
  { icon: 'icon-topspeed', tip: '極速', label: 'Top speed', value: top, unit: 'km/h', bar: t },
  { icon: 'icon-handling', tip: '過彎抓地力', label: 'Grip', value: grip, unit: 'g', bar: g },
];

// training/cornering.train.ts (launch, cornering at 200 km/h).
export const CAR_CARDS: CarCard[] = [
  { id: STREET_RACER.id, name: STREET_RACER.name, accent: '#ff3b30', icon: 'icon-super', tag: 'Supercar', stats: stats('3.6', 1, '300', 1, '2.0', 0.75), pickable: true },
  { id: MUSCLE_CAR.id, name: MUSCLE_CAR.name, accent: '#ff9f1a', icon: 'icon-muscle', tag: 'Muscle car', stats: stats('4.1', 0.9, '259', 0.75, '1.4', 0.45), pickable: true },
  { id: JDM_CAR.id, name: JDM_CAR.name, accent: '#2f9bff', icon: 'icon-jdm', tag: 'Tuner', stats: stats('4.0', 0.75, '245', 0.6, '2.4', 1), pickable: true },
];

/** Everyone on the supercar, five rivals, normal, a clear night (the game as it was). */
export function defaultSelection(): CarSelection {
  return { player: STREET_RACER.id, rivals: Array.from({ length: MAX_RIVALS }, () => STREET_RACER.id), rivalMode: 'custom', difficulty: NORMAL, weather: 'clear', paint: {} };
}

const pickable = (id: unknown): string => (typeof id === 'string' && PICKABLE.includes(id) && CARS[id] ? id : STREET_RACER.id);

/**
 * A selection made safe: unknown or unpickable cars become the supercar, at
 * most MAX_RIVALS rivals (none missing: the default five), a difficulty that
 * exists, the clear night, paint jobs only for pickable cars (by name: one the
 * car's file doesn't have is its own when built). Old saves (cars only) keep
 * their cars.
 */
export function sanitize(x: unknown): CarSelection {
  if (!x || typeof x !== 'object') return defaultSelection();
  const o = x as { player?: unknown; rivals?: unknown; rivalMode?: unknown; difficulty?: unknown; paint?: unknown };
  const rivalMode = RIVAL_MODES.find((m) => m === o.rivalMode) ?? 'custom';
  const rivals = Array.isArray(o.rivals) ? o.rivals.slice(0, MAX_RIVALS).map(pickable) : defaultSelection().rivals;
  const difficulty = typeof o.difficulty === 'number' && Number.isInteger(o.difficulty) && DIFFICULTIES[o.difficulty] ? o.difficulty : NORMAL;
  const paint: Record<string, string> = {};
  if (o.paint && typeof o.paint === 'object') {
    for (const [id, name] of Object.entries(o.paint)) if (PICKABLE.includes(id) && typeof name === 'string') paint[id] = name;
  }
  return { player: pickable(o.player), rivals, rivalMode, difficulty, weather: 'clear', paint };
}

export function loadSelection(storage: Pick<Storage, 'getItem'>): CarSelection {
  try {
    return sanitize(JSON.parse(storage.getItem(KEY) ?? 'null'));
  } catch {
    return defaultSelection();
  }
}

/** Remember it for the next visit (storage full or turned off: not remembered, the race goes on). */
export function saveSelection(storage: Pick<Storage, 'setItem'>, s: CarSelection): void {
  try {
    storage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Nothing to do: the next visit starts from the default.
  }
}

/** One more rival at the end, on the player's car (none past MAX_RIVALS). */
export function addRival(s: CarSelection): CarSelection {
  return s.rivals.length >= MAX_RIVALS ? s : { ...s, rivals: [...s.rivals, s.player] };
}

/** Rival `i` gone; the ones after it move up. */
export function removeRival(s: CarSelection, i: number): CarSelection {
  return { ...s, rivals: s.rivals.filter((_, k) => k !== i) };
}

/** `n` rivals (0..MAX_RIVALS): the first ones kept as they are, any new ones on the player's car. */
export function setRivalCount(s: CarSelection, n: number): CarSelection {
  const k = Math.max(0, Math.min(MAX_RIVALS, Math.round(n)));
  return { ...s, rivals: Array.from({ length: k }, (_, i) => s.rivals[i] ?? s.player) };
}

/** Rival `i` on car `id` (an unknown rival or car: unchanged). */
export function setRival(s: CarSelection, i: number, id: string): CarSelection {
  if (i < 0 || i >= s.rivals.length || !PICKABLE.includes(id)) return s;
  return { ...s, rivals: s.rivals.map((r, k) => (k === i ? id : r)) };
}

/** The cars the rivals race in, by the mode: drawn afresh (each race), all on the player's car (whichever it is now), or as listed. */
export function raceRivals(s: CarSelection, rng: () => number): string[] {
  if (s.rivalMode === 'random') return allRandom(s, rng).rivals;
  if (s.rivalMode === 'same') return allSameAsPlayer(s).rivals;
  return [...s.rivals];
}

/** Every rival on a car drawn at random from the pickable ones (as many rivals as before). */
export function allRandom(s: CarSelection, rng: () => number): CarSelection {
  return { ...s, rivals: s.rivals.map(() => PICKABLE[Math.floor(rng() * PICKABLE.length) % PICKABLE.length]) };
}

/** Every rival on the player's car (as many rivals as before). */
export function allSameAsPlayer(s: CarSelection): CarSelection {
  return { ...s, rivals: s.rivals.map(() => s.player) };
}
