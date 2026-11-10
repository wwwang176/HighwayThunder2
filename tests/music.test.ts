import { describe, expect, it } from 'vitest';
import { easeVolume, shuffled, songsOf, songTitle } from '../src/audio/music';
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
