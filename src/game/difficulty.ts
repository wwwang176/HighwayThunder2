/**
 * How hard the rivals race: their top speed and the rubber band (how much
 * they are boosted when behind the player, how much they wait when ahead).
 * Normal is the game as it was before there was a choice.
 */
export interface Difficulty {
  name: string;
  /** The rivals' top speed (km/h; a car's own when lower, the tuning panel's AI top speed when that is lower). */
  speedCapKmh: number;
  /** Grip and engine boost at the most, far behind (RIVAL_TUNING.maxBoost). */
  maxBoost: number;
  /** Far ahead, it slows to this x the player's speed (RIVAL_TUNING.waitSpeed; over 1: it does not wait). */
  waitSpeed: number;
  /** What it is like, in words (no numbers), for the race setup's "?". */
  hint: string;
}

export const DIFFICULTIES: Difficulty[] = [
  { name: '簡單', speedCapKmh: 240, maxBoost: 0.1, waitSpeed: 0.8, hint: '對手開得比較慢，落後時稍微追趕，領先時會放慢等你' },
  { name: '普通', speedCapKmh: 300, maxBoost: 0.25, waitSpeed: 0.9, hint: '對手落後時會加速追趕，領先時稍微等你' },
  { name: '困難', speedCapKmh: 300, maxBoost: 0.4, waitSpeed: 1, hint: '對手落後時會強力追趕，領先時不等你' },
  { name: '極限', speedCapKmh: 300, maxBoost: 0.6, waitSpeed: 1.1, hint: '對手落後時全力追趕，領先時繼續拉開距離' },
];

/**
 * Put a level on the rivals: their rubber band (mutable, shared with the
 * rivals), and their top speed returned (km/h). The player's own AI driver
 * (the I key) and the tuning panel's AI top speed are left as they are.
 */
export function applyDifficulty(level: number, band: { maxBoost: number; waitSpeed: number }): number {
  const d = DIFFICULTIES[level] ?? DIFFICULTIES[1];
  band.maxBoost = d.maxBoost;
  band.waitSpeed = d.waitSpeed;
  return d.speedCapKmh;
}
