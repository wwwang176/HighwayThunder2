/**
 * Which traffic is simulated in full (awake: dynamic bodies, springs, tyres; asleep: kinematic, moved by its planner,
 * its colliders off - nothing touches it): every car round the player within their reach on our carriageway (what is
 * seen up close), and any car another one would touch within `ahead` s - closing in on it along the road to within
 * `along` m, and across to within `across` m (moving over to it: its sideways speed on) - checked every step, by
 * the player (the oncoming too: only flying the median) and by the rivals and the police within `seen` m of the
 * player (the user's call, 2026-11-26: further off they go through it unseen - their plans keep them round it anyway,
 * and touch nothing; before, each woke all the traffic within 60 m of it, the oncoming too: a police car 240 m behind
 * the player, out of sight, kept a dozen cars in full). Awake, a car sleeps again `keep` s after none would touch it,
 * out of the player's reach.
 */
export const WAKE = { ahead: 0.3, along: 2, across: 1, seen: 300, keep: 2 };

/** A car that may hit the traffic, in our carriageway's coordinates: where (s, d), how fast along and across (m/s), half its size. */
export interface Mover {
  s: number;
  d: number;
  vS: number;
  vD: number;
  halfLength: number;
  halfWidth: number;
}

/** A vehicle of the traffic, as onCourse sees it (our carriageway's coordinates). */
export interface Wakeable {
  s: number;
  d: number;
  vS: number;
  halfLength: number;
  halfWidth: number;
}

/** `m` would touch `b` within WAKE.ahead s (see WAKE). */
export function onCourse(m: Mover, b: Wakeable): boolean {
  const ds = b.s - m.s, dd = b.d - m.d;
  const along = Math.abs(ds) - m.halfLength - b.halfLength;
  const closing = ds >= 0 ? m.vS - b.vS : b.vS - m.vS;
  if (along > Math.max(0, closing) * WAKE.ahead + WAKE.along) return false;
  const across = Math.abs(dd) - m.halfWidth - b.halfWidth;
  const toward = dd * m.vD > 0 ? Math.abs(m.vD) : 0;
  return across <= toward * WAKE.ahead + WAKE.across;
}

/** A car as it moves (PlayerCar: its nose `yaw` off the road's heading, its sideways speed `vLat` off its nose). */
export interface MovingCar {
  s: number;
  d: number;
  vLong: number;
  vLat: number;
  yaw: number;
  length: number;
  width: number;
}

export function moverOf(c: MovingCar): Mover {
  const cos = Math.cos(c.yaw), sin = Math.sin(c.yaw);
  return { s: c.s, d: c.d, vS: c.vLong * cos - c.vLat * sin, vD: c.vLong * sin + c.vLat * cos, halfLength: c.length / 2, halfWidth: c.width / 2 };
}

/** Round the player by reach (`awake` m, our carriageway); the player and `others` (the rivals, the police out) within WAKE.seen m of them by their course. */
export function wakers(player: MovingCar, others: readonly MovingCar[], awake: number): { rousers: { s: number; reach: number; oursOnly: boolean }[]; movers: Mover[] } {
  const movers = [moverOf(player)];
  for (const c of others) if (Math.abs(c.s - player.s) <= WAKE.seen) movers.push(moverOf(c));
  return { rousers: [{ s: player.s, reach: awake, oursOnly: true }], movers };
}
