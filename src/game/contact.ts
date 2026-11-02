import { KMH } from '../config';

/** How hard a racer (player or rival) has to hit an NPC for it to lose control (mutable: tuning panel). */
export const CONTACT_TUNING = {
  /** Speed (m/s) the two close in at, along the direction they push on each other; below it a scrape is shrugged off. */
  npcWreckSpeed: 15 * KMH,
};

/**
 * How fast two vehicles close in along `normal` (the way they push on each
 * other at the contact): a rear-end at the full speed difference, a side swipe
 * at only the sideways speed however fast one slides past the other. Without a
 * normal, the whole relative speed.
 */
export function closingSpeed(a: { x: number; z: number }, b: { x: number; z: number }, normal: { x: number; z: number } | null): number {
  const rx = a.x - b.x;
  const rz = a.z - b.z;
  return normal ? Math.abs(rx * normal.x + rz * normal.z) : Math.hypot(rx, rz);
}

/**
 * Whether a racer moving at `racer` (world x/z velocity, taken before the hit)
 * touching an NPC moving at `npc` knocks it out of control: only a hit, not a
 * scrape (street racing - a touch is part of it).
 */
export function knocksOut(racer: { x: number; z: number }, npc: { x: number; z: number }, normal: { x: number; z: number } | null = null): boolean {
  return closingSpeed(racer, npc, normal) >= CONTACT_TUNING.npcWreckSpeed;
}
