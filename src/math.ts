/** Small helpers more than one part of the game uses. */

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** A network input kept to ±3 (NaN or infinite: 0). */
export const clamp3 = (x: number) => (Number.isFinite(x) ? Math.max(-3, Math.min(3, x)) : 0);

/** Cubic ease-out: fast away, settling in (0..1 to 0..1). */
export const easeOut = (t: number) => 1 - (1 - t) ** 3;
