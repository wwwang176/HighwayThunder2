import { describe, it, expect } from 'vitest';
import { NPC_LIVE_GROUPS, PLAYER_GROUPS, RIVAL_GROUPS, STATIC_GROUPS, WRECK_GROUPS } from '../src/physics/physicsWorld';

/** Rapier's rule: two colliders interact when each one's membership is in the other's filter. */
const hit = (a: number, b: number) => ((a >>> 16) & (b & 0xffff)) !== 0 && ((b >>> 16) & (a & 0xffff)) !== 0;

describe('collision groups', () => {
  it('rivals hit the player, traffic, wrecks, the rails and each other', () => {
    expect(hit(RIVAL_GROUPS, PLAYER_GROUPS)).toBe(true);
    expect(hit(RIVAL_GROUPS, RIVAL_GROUPS)).toBe(true);
    expect(hit(RIVAL_GROUPS, NPC_LIVE_GROUPS)).toBe(true);
    expect(hit(RIVAL_GROUPS, WRECK_GROUPS)).toBe(true);
    expect(hit(RIVAL_GROUPS, STATIC_GROUPS)).toBe(true);
  });

  it('live traffic still never hits other live traffic', () => {
    expect(hit(NPC_LIVE_GROUPS, NPC_LIVE_GROUPS)).toBe(false);
    expect(hit(NPC_LIVE_GROUPS, PLAYER_GROUPS)).toBe(true);
  });
});
