/**
 * The background music: songs in public/audio/music/ (licensed: never in this repository - the private audio repo,
 * copied in for the build as the sound bundles are, docs/audio.md), listed in its playlist.json - file names
 * (["a.mp3", ...]) or { "file": "a.mp3", "title": "..." } - played one after another in a shuffled order, round
 * and round; `next()` skips to the following one. Its own <audio> element, streamed (no song decoded whole into
 * memory) and outside the sound's Web Audio graph (stopped in a pause, and in a hidden tab, by `setPaused` /
 * `setHidden`). No playlist (or no songs): silent.
 */
export const MUSIC_URL = 'audio/music/';
/** Its loudness (the element's volume) as a rule; in the countdown this share of it; how fast it gets there (s). */
export const MUSIC_VOLUME = 0.35;
export const MUSIC_COUNTDOWN = 0.4;
const MUSIC_FADE = 0.4;

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
  muted = false;
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

  /** Each frame (real time, `dt` s): `countdown` the countdown on (quieter), else as a rule. */
  update(dt: number, countdown: boolean): void {
    this.target = this.muted ? 0 : MUSIC_VOLUME * (countdown ? MUSIC_COUNTDOWN : 1);
    this.volume = easeVolume(this.volume, this.target, dt);
    this.el.volume = Math.min(1, Math.max(0, this.volume));
  }

  /** The tab hidden: stopped till it is back (a page in the background playing on is not wanted). */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) this.el.pause();
    else this.play();
  }

  /** The game paused: stopped where it is, on from there once it goes on (each frame: acts on a change only). */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) this.el.pause();
    else this.play();
  }

  private play(): void {
    if (this.hidden || this.paused || this.at < 0) return;
    void this.el.play().catch(() => {}); // (refused - no click or key yet: start() is called from one)
  }
}
