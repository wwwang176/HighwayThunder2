/**
 * How hard the rivals race: how fast they go at the most, a share of their own car's top speed. Only that - their
 * rubber band (boosted far behind, waiting far ahead: RIVAL_TUNING) is the same at every level, so they stay round
 * the player whichever it is.
 */
export interface Difficulty {
  name: string;
  /** The rivals' top speed: this share of their car's own (the tuning panel's AI top speed when that is lower). */
  topShare: number;
}

/** (Their names and what each is like, for the player: src/ui/i18n's diff.N and diff.hint.) */
export const DIFFICULTIES: Difficulty[] = [
  { name: '簡單', topShare: 0.85 },
  { name: '普通', topShare: 0.9 },
  { name: '困難', topShare: 0.95 },
  { name: '極限', topShare: 1 },
];

/** A level's share of a rival car's top speed (an unknown level: normal's). The player's own AI driver (the I key) is left as it is. */
export function applyDifficulty(level: number): number {
  return (DIFFICULTIES[level] ?? DIFFICULTIES[1]).topShare;
}
