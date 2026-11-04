import { describe, it, expect } from 'vitest';
import { closestBehind, HUD_SHAKE, hudShake, overtook, progress, RESET_HINT, ResetHint } from '../src/ui/hudMath';

describe('hudMath', () => {
  it('the rival closest behind within range, with its colour and the side it comes up on', () => {
    const me = { s: 1000, d: 0 };
    const rivals = [
      { s: 960, d: 0, color: '#a' }, // 40 m behind (bumper to bumper: 35.6 m)
      { s: 990, d: -3.75, color: '#b' }, // closest, a lane to the left
      { s: 1010, d: 0, color: '#c' }, // ahead
      { s: 800, d: 0, color: '#d' }, // far behind
    ];
    expect(closestBehind(me, rivals, 50)).toEqual({ gap: 5.6, color: '#b', side: -1 });
    expect(closestBehind(me, [rivals[0]], 50)).toEqual({ gap: 35.6, color: '#a', side: 0 });
    expect(closestBehind(me, [rivals[2], rivals[3]], 50)).toBeNull();
  });

  it('progress along the road, from the start (0) to the finish (1), clamped', () => {
    expect(progress(0)).toBe(0);
    expect(progress(2500)).toBeCloseTo(0.5);
    expect(progress(-20)).toBe(0);
    expect(progress(6000)).toBe(1);
  });

  it('an overtake: the place got better (a smaller number), not on the first frame', () => {
    expect(overtook(3, 2)).toBe(true);
    expect(overtook(2, 3)).toBe(false);
    expect(overtook(2, 2)).toBe(false);
    expect(overtook(null, 1)).toBe(false);
  });
});

describe('ResetHint', () => {
  const step = (h: ResetHint, seconds: number, kmh: number, upY: number) => {
    let on = false;
    for (let t = 0; t < seconds - 1e-9; t += 0.1) on = h.update(0.1, kmh, upY);
    return on;
  };

  it('shows once the car has been all but stopped for the set time', () => {
    const h = new ResetHint();
    expect(step(h, RESET_HINT.stoppedSeconds - 0.2, 2, 1)).toBe(false);
    expect(step(h, 0.4, 2, 1)).toBe(true);
  });

  it('shows once the car has been on its side or roof for the set time, moving or not', () => {
    const h = new ResetHint();
    expect(step(h, RESET_HINT.flippedSeconds - 0.2, 40, 0.2)).toBe(false);
    expect(step(h, 0.4, 40, 0.2)).toBe(true);
  });

  it('goes as soon as the car drives on upright, and the timers start over', () => {
    const h = new ResetHint();
    expect(step(h, RESET_HINT.stoppedSeconds + 0.5, 0, 1)).toBe(true);
    expect(h.update(0.1, 30, 1)).toBe(false);
    expect(step(h, RESET_HINT.stoppedSeconds - 0.2, 0, 1)).toBe(false);
  });

  it('never shows while driving upright', () => {
    expect(step(new ResetHint(), 20, 80, 0.98)).toBe(false);
  });
});

describe('hudShake', () => {
  it('moves with the picture (against the camera), a share of its shake, tilted by a share of its roll', () => {
    const s = hudShake(0.04, 0.02, 0.02);
    expect(s.x).toBeCloseTo(-0.04 * HUD_SHAKE.move, 5);
    expect(s.y).toBeCloseTo(0.02 * HUD_SHAKE.move, 5); // (camera up: the picture, and the HUD, down the screen)
    expect(s.deg).toBeCloseTo((-0.02 * 180) / Math.PI * HUD_SHAKE.tilt, 5);
  });

  it('a hard hit is held to a readable shake', () => {
    const s = hudShake(0.5, -0.5, 0.2);
    expect(Math.abs(s.x)).toBe(HUD_SHAKE.maxMove);
    expect(Math.abs(s.y)).toBe(HUD_SHAKE.maxMove);
    expect(Math.abs(s.deg)).toBe(HUD_SHAKE.maxTilt);
  });

  it('none without a shake', () => {
    expect(hudShake(0, 0, 0)).toEqual({ x: 0, y: 0, deg: 0 });
  });
});
