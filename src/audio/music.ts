/**
 * The background music: songs in public/audio/music/ (licensed: never in this repository - the private audio repo,
 * copied in for the build as the sound bundles are, docs/audio.md), listed in its playlist.json - file names
 * (["a.mp3", ...]) or { "file": "a.mp3", "title": "..." } - played one after another in a shuffled order, round
 * and round. `change()` (a change of scene) fades the song out, waits and fades the next one in; `skip()` (N) the
 * same in half a second, no wait (switched there and then, a song would click). Its own <audio> element, streamed (no song decoded whole into memory) and outside the
 * sound's Web Audio graph (stopped in a pause, and in a hidden tab, by `setPaused` / `setHidden`; faded back in).
 * No playlist (or no songs): silent.
 */
export const MUSIC_URL = 'audio/music/';
/**
 * Its loudness (the element's volume) as a rule: the songs (-13 to -14 LUFS) about 4 dB under the player's engine
 * (its clips -16 LUFS, through ENGINE_VOLUME and MASTER: about -24); the player's volume (settings) on top. In the
 * countdown this share of it; how fast it gets there (s).
 */
export const MUSIC_VOLUME = 0.22;
export const MUSIC_COUNTDOWN = 0.4;
/** Past the finish line: down to this share, evenly over MUSIC_FINISH_FADE s (the sound fades away with it). */
export const MUSIC_FINISH = 0.5;
export const MUSIC_FINISH_FADE = 2.5;

/** The finish's share `dt` s on: evenly toward MUSIC_FINISH past the line, back to 1 otherwise (as fast). */
export function finishShare(now: number, finished: boolean, dt: number): number {
  const step = ((1 - MUSIC_FINISH) / MUSIC_FINISH_FADE) * dt;
  return finished ? Math.max(MUSIC_FINISH, now - step) : Math.min(1, now + step);
}
const MUSIC_FADE = 0.15; // (0.4: back up after the countdown too slowly)
/** From one song to the next: this one faded out over `out` s, `gap` s of quiet, the next faded in over `in` s. */
export interface Switch {
  out: number;
  gap: number;
  in: number;
}
/** A change of scene (into a race, the finish, back to the garage); the next song asked for (N). */
export const SCENE_SWITCH: Switch = { out: 1, gap: 2, in: 1.5 };
export const SKIP_SWITCH: Switch = { out: 0.2, gap: 0, in: 0.25 };
/** Back from a pause (or a hidden tab): faded in over this (s), as the sound is. */
const MUSIC_RESUME = 0.8;

/** A fade (0..1 on top of the volume), moving `rate` a second; a switch's step (out, the quiet, none) and its Switch. */
export interface MusicFade {
  level: number;
  rate: number;
  switching: 'out' | 'gap' | null;
  gapLeft: number;
  how: Switch;
}

/** `f` set off on a switch (`how`); from silence already (stopped): straight to the quiet. */
export function startSwitch(f: MusicFade, how: Switch, silent: boolean): void {
  f.switching = 'out';
  f.how = how;
  f.rate = -1 / how.out;
  if (silent) f.level = 0;
}

/**
 * The fade `dt` s on: what to do now - stop the song (faded out: the quiet starts), the next one (the quiet over: it
 * fades in), or nothing.
 */
export function stepFade(f: MusicFade, dt: number): 'stop' | 'next' | null {
  f.level = Math.min(1, Math.max(0, f.level + f.rate * dt));
  if (f.switching === 'out' && f.level <= 0) {
    f.switching = 'gap';
    f.gapLeft = f.how.gap;
    f.rate = 0;
    return 'stop';
  }
  if (f.switching === 'gap' && (f.gapLeft -= dt) <= 0) {
    f.switching = null;
    f.level = 0;
    f.rate = 1 / f.how.in;
    return 'next';
  }
  return null;
}

export interface Song {
  file: string;
  title?: string;
}

/** The playlist's entries as songs (anything else left out). */
export function songsOf(list: unknown): Song[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((x): Song[] => {
    if (typeof x === 'string' && x) return [{ file: x }];
    if (x && typeof x === 'object' && typeof (x as Song).file === 'string' && (x as Song).file) {
      const { file, title } = x as Song;
      return [{ file, ...(typeof title === 'string' ? { title } : {}) }];
    }
    return [];
  });
}

/** A song's title as shown: its own, else its file's name without the folder and the extension. */
export function songTitle(song: Song): string {
  return song.title ?? song.file.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
}

/** 0..n-1 in a random order. */
export function shuffled(n: number, rng: () => number = Math.random): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The volume this frame: `now` eased toward `target` over MUSIC_FADE s. */
export function easeVolume(now: number, target: number, dt: number): number {
  return now + (target - now) * Math.min(1, dt / MUSIC_FADE);
}

export class Music {
  private readonly el: HTMLAudioElement;
  private songs: Song[] = [];
  private order: number[] = [];
  private at = -1;
  private started = false;
  private loading: Promise<void> | null = null;
  /** Songs that failed to play in a row (all of them: give up rather than go round for ever). */
  private failed = 0;
  private volume = 0;
  private target = MUSIC_VOLUME;
  private hidden = false;
  private paused = false;
  private readonly fade: MusicFade = { level: 1, rate: 0, switching: null, gapLeft: 0, how: SCENE_SWITCH };
  muted = false;
  /** Its share past the finish line (finishShare). */
  private finish = 1;
  /** The player's volume for it (settings: 0..1 on top of MUSIC_VOLUME). */
  userVolume = 1;
  /** Called with each song as it comes on (its title shown: ui/nowPlaying). */
  onSong: ((song: Song) => void) | null = null;

  constructor(private readonly base: string = import.meta.env.BASE_URL) {
    this.el = new Audio();
    this.el.preload = 'auto';
    this.el.volume = 0;
    this.el.addEventListener('ended', () => this.next());
    this.el.addEventListener('playing', () => (this.failed = 0));
    this.el.addEventListener('error', () => {
      if (++this.failed < this.songs.length) this.next();
    });
  }

  /** The song playing (null: none). */
  get song(): Song | null {
    return this.at >= 0 ? this.songs[this.order[this.at]] : null;
  }

  /** Start playing (from a click or a key: the browser lets it start only then); once is enough. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.loading ??= fetch(this.base + MUSIC_URL + 'playlist.json')
      .then((res) => (res.ok ? res.json() : []))
      .catch(() => [])
      .then((list) => {
        this.songs = songsOf(list);
        this.order = shuffled(this.songs.length);
        if (this.songs.length) this.next();
      });
  }

  /** The next song (the first after the last one round again). */
  next(): void {
    if (!this.songs.length) return;
    this.at = (this.at + 1) % this.order.length;
    const song = this.songs[this.order[this.at]];
    this.el.src = this.base + MUSIC_URL + encodeURI(song.file);
    this.play();
    this.onSong?.(song);
  }

  /** The next song, asked for (N): SKIP_SWITCH - quickly out and the next in, a change of scene under way cut short. */
  skip(): void {
    if (this.at < 0) return;
    startSwitch(this.fade, SKIP_SWITCH, this.el.paused || this.fade.switching === 'gap');
  }

  /** A change of scene: SCENE_SWITCH (out, a moment's quiet, the next in). */
  change(): void {
    if (this.at < 0 || this.fade.switching) return; // (none yet - start() brings the first in - or changing already)
    startSwitch(this.fade, SCENE_SWITCH, this.el.paused);
  }

  /** Each frame (real time, `dt` s): `countdown` the countdown on (quieter), `finished` past the line (down to half). */
  update(dt: number, countdown: boolean, finished = false): void {
    this.finish = finishShare(this.finish, finished, dt);
    this.target = this.muted ? 0 : MUSIC_VOLUME * this.userVolume * (countdown ? MUSIC_COUNTDOWN : 1) * this.finish;
    this.volume = easeVolume(this.volume, this.target, dt);
    const step = stepFade(this.fade, dt);
    if (step === 'stop') this.el.pause();
    else if (step === 'next') this.next();
    this.el.volume = Math.min(1, Math.max(0, this.volume * this.fade.level));
  }

  /** s into the song playing; how long it is (NaN: not known yet). */
  get time(): number {
    return this.el.currentTime;
  }
  get length(): number {
    return this.el.duration;
  }

  /** The tab hidden: stopped till it is back (a page in the background playing on is not wanted), faded back in. */
  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (hidden) this.el.pause();
    else this.resume();
  }

  /**
   * The game paused: stopped where it is, on from there once it goes on - faded back in from silence, as the sound
   * is after a pause (each frame: acts on a change only).
   */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) this.el.pause();
    else this.resume();
  }

  private resume(): void {
    if (this.fade.switching) return; // (a change of scene under way brings the next song in itself)
    this.fade.level = 0;
    this.fade.rate = 1 / MUSIC_RESUME;
    this.el.volume = 0;
    this.play();
  }

  private play(): void {
    if (this.hidden || this.paused || this.fade.switching || this.at < 0) return;
    void this.el.play().catch(() => {}); // (refused - no click or key yet: start() is called from one)
  }
}
