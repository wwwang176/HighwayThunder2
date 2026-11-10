import { describe, expect, it } from 'vitest';
import { easeVolume, type MusicFade, SCENE_SWITCH, shuffled, SKIP_SWITCH, songsOf, songTitle, startSwitch, stepFade, type Switch } from '../src/audio/music';
import { mulberry32 } from '../src/ai/rng';
import { clock } from '../src/ui/nowPlaying';

describe('music', () => {
  it('reads a playlist of file names or { file, title }, leaving anything else out', () => {
    expect(songsOf(['a.mp3', { file: 'b.ogg', title: 'B' }, { title: 'no file' }, 3, '', null])).toEqual([{ file: 'a.mp3' }, { file: 'b.ogg', title: 'B' }]);
    expect(songsOf({ songs: ['a.mp3'] })).toEqual([]);
  });

  it('shuffles every song in once', () => {
    const order = shuffled(7, mulberry32(1));
    expect([...order].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(shuffled(0)).toEqual([]);
  });

  it('eases the volume toward its target, never past it', () => {
    let v = 0;
    for (let i = 0; i < 60; i++) v = easeVolume(v, 0.35, 1 / 60);
    expect(v).toBeGreaterThan(0.3);
    expect(v).toBeLessThanOrEqual(0.35);
    expect(easeVolume(0.35, 0.14, 10)).toBe(0.14); // (a long frame: there at once)
  });
});

describe('songTitle', () => {
  it('is the title, else the file name without folder and extension', () => {
    expect(songTitle({ file: 'x.mp3', title: 'Night Drive' })).toBe('Night Drive');
    expect(songTitle({ file: 'album/01 Night Drive.mp3' })).toBe('01 Night Drive');
    expect(songTitle({ file: 'no-ext' })).toBe('no-ext');
  });
});

describe('clock', () => {
  it('shows m:ss, and -:-- before the length is known', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(227.9)).toBe('3:47');
    expect(clock(NaN)).toBe('-:--');
    expect(clock(Infinity)).toBe('-:--');
  });
});

describe('from one song to the next', () => {
  const run = (how: Switch) => {
    const f: MusicFade = { level: 1, rate: 0, switching: null, gapLeft: 0, how };
    startSwitch(f, how, false);
    const dt = 1 / 120;
    let t = 0, stopAt = NaN, nextAt = NaN, fullAt = NaN;
    while (t < how.out + how.gap + how.in + 0.5) {
      const step = stepFade(f, dt);
      t += dt;
      if (step === 'stop') stopAt = t;
      if (step === 'next') nextAt = t;
      if (!Number.isNaN(nextAt) && Number.isNaN(fullAt) && f.level >= 1) fullAt = t;
      if (t > stopAt && Number.isNaN(nextAt)) expect(f.level).toBe(0); // (quiet)
    }
    return { stopAt, nextAt, fullAt, f };
  };

  it('a change of scene: out, quiet SCENE_SWITCH.gap s, the next one faded in', () => {
    const r = run(SCENE_SWITCH);
    expect(r.stopAt).toBeCloseTo(SCENE_SWITCH.out, 1);
    expect(r.nextAt - r.stopAt).toBeCloseTo(SCENE_SWITCH.gap, 1);
    expect(r.f.switching).toBeNull();
  });

  it('N: out and in again within half a second', () => {
    const r = run(SKIP_SWITCH);
    expect(r.fullAt).toBeLessThanOrEqual(0.5);
    expect(r.nextAt).toBeGreaterThan(0.15); // (faded out first: no click)
  });
});
