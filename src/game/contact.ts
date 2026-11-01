import { KMH } from '../config';

/** How hard a racer (player or rival) has to hit an NPC for it to lose control (mutable: tuning panel). */
export const CONTACT_TUNING = {
  /** Relative speed (m/s) at the moment of contact; below it a scrape is shrugged off. */
  npcWreckSpeed: 15 * KMH,
};

/**
 * Whether a racer moving at `racer` (world x/z velocity, taken before the hit)
 * touching an NPC moving at `npc` knocks it out of control: only a hit, not a
 * scrape (street racing - a touch is part of it).
 */
export function knocksOut(racer: { x: number; z: number }, npc: { x: number; z: number }): boolean {
  return Math.hypot(racer.x - npc.x, racer.z - npc.z) >= CONTACT_TUNING.npcWreckSpeed;
}
