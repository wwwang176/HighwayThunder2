import { describe, it, expect } from 'vitest';
import { CONTACT_TUNING, knocksOut } from '../src/game/contact';
import { KMH } from '../src/config';

describe('knocksOut', () => {
  it('a scrape at nearly the same speed: the NPC drives on', () => {
    expect(knocksOut({ x: 0.5, z: -40 }, { x: 0, z: -38 })).toBe(false); // ~2 m/s
  });

  it('a real hit: it loses control', () => {
    expect(knocksOut({ x: 0, z: -50 }, { x: 0, z: -30 })).toBe(true); // 72 km/h faster
    expect(knocksOut({ x: 5, z: -40 }, { x: 0, z: -40 })).toBe(true); // 18 km/h sideways
  });

  it('with the contact normal only the speed into each other counts', () => {
    const side = { x: 1, z: 0 }; // pushing sideways
    expect(knocksOut({ x: 1, z: -50 }, { x: 0, z: -30 }, side)).toBe(false); // passing 72 km/h faster, brushing at 3.6
    expect(knocksOut({ x: 5, z: -50 }, { x: 0, z: -30 }, side)).toBe(true); // swiped at 18 km/h
    expect(knocksOut({ x: 0, z: -50 }, { x: 0, z: -30 }, { x: 0, z: -1 })).toBe(true); // rear-end
  });

  it('the threshold is the tuning setting', () => {
    const before = CONTACT_TUNING.npcWreckSpeed;
    CONTACT_TUNING.npcWreckSpeed = 30 * KMH;
    expect(knocksOut({ x: 0, z: -40 }, { x: 0, z: -33 })).toBe(false); // ~25 km/h
    CONTACT_TUNING.npcWreckSpeed = before;
  });
});
