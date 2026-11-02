/**
 * How hard the rivals race: their top speed and the rubber band (how much
 * they are boosted when behind the player, how much they wait when ahead).
 * Normal is the game as it was before there was a choice.
 */
export interface Difficulty {
  name: string;
  /** The AI's top speed (km/h; a car's own when lower). */
  speedCapKmh: number;
  /** Grip and engine boost at the most, far behind (RIVAL_TUNING.maxBoost). */
  maxBoost: number;
  /** Far ahead, it slows to this x the player's speed (RIVAL_TUNING.waitSpeed; over 1: it does not wait). */
  waitSpeed: number;
}

export const DIFFICULTIES: Difficulty[] = [
  { name: '簡單', speedCapKmh: 240, maxBoost: 0.1, waitSpeed: 0.8 },
  { name: '普通', speedCapKmh: 300, maxBoost: 0.25, waitSpeed: 0.9 },
  { name: '困難', speedCapKmh: 300, maxBoost: 0.4, waitSpeed: 1 },
  { name: '極限', speedCapKmh: 300, maxBoost: 0.6, waitSpeed: 1.1 },
];

/** Put a level on the AI settings and the rivals' rubber band (both mutable: the tuning panel shares them). */
export function applyDifficulty(level: number, ai: { speedCapKmh: number }, band: { maxBoost: number; waitSpeed: number }): void {
  const d = DIFFICULTIES[level] ?? DIFFICULTIES[1];
  ai.speedCapKmh = d.speedCapKmh;
  band.maxBoost = d.maxBoost;
  band.waitSpeed = d.waitSpeed;
}
