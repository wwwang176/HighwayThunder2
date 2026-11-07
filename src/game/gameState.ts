import { BEST_TIME_KEY, COUNTDOWN_SECONDS, RESET_COOLDOWN, ROAD_LENGTH } from '../config';

/** `intro`: the cars on the grid, the camera showing them round (game/intro), before the countdown. */
export type Phase = 'title' | 'intro' | 'countdown' | 'racing' | 'paused' | 'finished';

type KV = Pick<Storage, 'getItem' | 'setItem'>;

export class GameFlow {
  phase: Phase = 'title';
  countdown = COUNTDOWN_SECONDS;
  raceTime = 0;
  finishTime: number | null = null;
  nearMisses = 0;
  /** The race's top speed so far (km/h: noteSpeed). */
  topSpeed = 0;
  resetCooldown = 0;
  best: number | null;
  isBest = false;
  private pausedFrom: Phase = 'racing';

  constructor(private storage: KV) {
    const raw = Number(storage.getItem(BEST_TIME_KEY));
    this.best = Number.isFinite(raw) && raw > 0 ? raw : null;
  }

  /** Start (or restart) a race: its intro first (beginCountdown ends it). Valid from title, finished or paused. */
  start(): void {
    if (this.phase !== 'title' && this.phase !== 'finished' && this.phase !== 'paused') return; // (paused: started again)
    this.phase = 'intro';
    this.countdown = COUNTDOWN_SECONDS;
    this.raceTime = 0;
    this.finishTime = null;
    this.nearMisses = 0;
    this.topSpeed = 0;
    this.resetCooldown = 0;
    this.isBest = false;
  }

  /** The intro over (or skipped): the countdown starts. Only from the intro. */
  beginCountdown(): void {
    if (this.phase !== 'intro') return;
    this.phase = 'countdown';
    this.countdown = COUNTDOWN_SECONDS;
  }

  toTitle(): void {
    this.phase = 'title';
  }

  update(dt: number, playerS: number): void {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = 'racing';
        this.raceTime = -this.countdown;
        this.countdown = 0;
      }
      return;
    }
    if (this.phase !== 'racing') return;
    this.raceTime += dt;
    this.resetCooldown = Math.max(0, this.resetCooldown - dt);
    if (playerS >= ROAD_LENGTH) this.finish();
  }

  private finish(): void {
    this.phase = 'finished';
    this.finishTime = this.raceTime;
    if (this.best === null || this.raceTime < this.best) {
      this.best = this.raceTime;
      this.isBest = true;
      this.storage.setItem(BEST_TIME_KEY, String(this.raceTime));
    }
  }

  togglePause(): void {
    if (this.phase === 'racing' || this.phase === 'countdown') {
      this.pausedFrom = this.phase;
      this.phase = 'paused';
    } else if (this.phase === 'paused') {
      this.phase = this.pausedFrom;
    }
  }

  canReset(): boolean {
    return this.phase === 'racing' && this.resetCooldown <= 0;
  }

  markReset(): void {
    this.resetCooldown = RESET_COOLDOWN;
  }

  /** The player's speed this frame (km/h): the top speed, while racing. */
  noteSpeed(kmh: number): void {
    if (this.phase === 'racing') this.topSpeed = Math.max(this.topSpeed, kmh);
  }

  addNearMiss(): void {
    if (this.phase === 'racing') this.nearMisses++;
  }
}

/** Whether cars can be picked (the setup page, a race started on them): only before a race - at the title or after the finish. */
export function picksCars(phase: Phase): boolean {
  return phase === 'title' || phase === 'finished';
}

export function formatTime(sec: number): string {
  const ms = Math.floor(sec * 1000 + 1e-6);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}
