const MAX_GAP = 1.0;
const MIN_SPEED = 100 / 3.6;

/**
 * A near-miss happens when an NPC goes from ahead of the player to alongside/behind
 * (relS = npcS - playerS crosses zero) while the side-to-side gap is tiny at speed.
 */
export function detectNearMiss(prevRelS: number, relS: number, lateralGap: number, playerSpeed: number): boolean {
  return prevRelS > 0 && relS <= 0 && lateralGap < MAX_GAP && playerSpeed > MIN_SPEED;
}
