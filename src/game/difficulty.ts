/**
 * How hard the rivals race: how fast they go at the most, a share of their own car's top speed - and on the mountain
 * road (where they seldom reach it) the share of their grip and brakes their line is planned to. Only that - their
 * rubber band (pushed far behind, up to their car's own top speed and all its grip; waiting far ahead: RIVAL_TUNING)
 * is the same at every level, so they stay round the player whichever it is.
 */
export interface Difficulty {
  name: string;
  /** The rivals' top speed: this share of their car's own (the tuning panel's AI top speed when that is lower). */
  topShare: number;
  /**
   * The mountain road's rivals: their line planned to this share of their car's grip and brakes (MountainDriver's
   * budget), by car (an unknown car: the street racer's) - each car's to about the same time lost (30 solo roads,
   * 2026-11-20: 0.9 / 0.8 / 0.7 / 0.6 lost the street racer 0.9 / 2.5 / 5.5 / 10.5 %, the muscle car 2.5 / 5.9 / 10.4
   * / 16.1 %, the jdm 0.7 / 2.4 / 6.1 / 10.5 %).
   */
  mountainBudget: Record<string, number>;
}

/** (Their names and what each is like, for the player: src/ui/i18n's diff.N and diff.hint.) */
export const DIFFICULTIES: Difficulty[] = [
  { name: '簡單', topShare: 0.85, mountainBudget: { 'street-racer': 0.6, 'muscle-car': 0.7, jdm: 0.6 } },
  { name: '普通', topShare: 0.9, mountainBudget: { 'street-racer': 0.7, 'muscle-car': 0.8, jdm: 0.7 } },
  { name: '困難', topShare: 0.95, mountainBudget: { 'street-racer': 0.8, 'muscle-car': 0.9, jdm: 0.8 } },
  { name: '極限', topShare: 1, mountainBudget: { 'street-racer': 1, 'muscle-car': 1, jdm: 1 } },
];

/** A level's share of a rival car's top speed (an unknown level: normal's). The player's own AI driver (the I key) is left as it is. */
export function applyDifficulty(level: number): number {
  return (DIFFICULTIES[level] ?? DIFFICULTIES[1]).topShare;
}

/** A level's share of a mountain rival's grip its line is planned to, for its car (an unknown level: normal's). */
export function mountainBudget(level: number, carId: string): number {
  const b = (DIFFICULTIES[level] ?? DIFFICULTIES[1]).mountainBudget;
  return b[carId] ?? b['street-racer'];
}
