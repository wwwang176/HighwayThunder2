import { describe, it, expect } from 'vitest';
import { detectNearMiss } from '../src/game/nearMiss';

describe('detectNearMiss', () => {
  it('passing close at speed', () => expect(detectNearMiss(0.5, -0.3, 0.6, 50)).toBe(true));
  it('too far laterally', () => expect(detectNearMiss(0.5, -0.3, 1.5, 50)).toBe(false));
  it('too slow', () => expect(detectNearMiss(0.5, -0.3, 0.6, 80 / 3.6)).toBe(false));
  it('not crossing', () => expect(detectNearMiss(5, 4, 0.6, 50)).toBe(false));
  it('already behind', () => expect(detectNearMiss(-1, -2, 0.6, 50)).toBe(false));
});
