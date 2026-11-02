import { formatTime, GameFlow } from '../game/gameState';
import { ROAD_LENGTH } from '../config';
import { closestBehind, overtook, progress, shiftLights } from './hudMath';

export interface HudHandlers {
  /** After the finish: the same race again. */
  onAgain(): void;
  onResume(): void;
  /** Back to the garage. */
  onTitle(): void;
}

/** A car on the race line (the player's or a rival's). */
export interface HudRacer {
  s: number;
  d: number;
  color: string;
  me: boolean;
}

export interface HudFrame {
  speedKmh: number;
  playerS: number;
  resetCooldown: number;
  muted: boolean;
  gear: number;
  rpm: number;
  reverse: boolean;
  /** The trained AI is driving the player's car. */
  aiDriving: boolean;
  /** The player's place among `racers` cars (no rivals: not shown). */
  place: number;
  /** Every car in the race (the player's included). */
  racers: HudRacer[];
}

const html = String.raw;
const UI = `${import.meta.env.BASE_URL}ui/`;
const icon = (name: string, cls = '') => `<span class="icon ${cls}" style="--src:url(${UI}${name}.png)"></span>`;
/** A rival this close behind (m, bumper to bumper) shows as an arrow on the screen's bottom edge. */
const BEHIND_RANGE = 30;

// The tachometer: a 240-degree arc, 0-8 x1000 rpm, red from 7.
const R = 88;
const START = 150;
const SWEEP = 240;
const MAX_K = 8;
const RED_K = 7;
const at = (k: number, r = R): [number, number] => {
  const a = ((START + (SWEEP * Math.min(MAX_K, Math.max(0, k))) / MAX_K) * Math.PI) / 180;
  return [100 + r * Math.cos(a), 100 + r * Math.sin(a)];
};
const arc = (from: number, to: number, r = R) => {
  const [x0, y0] = at(from, r);
  const [x1, y1] = at(to, r);
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${(SWEEP * (to - from)) / MAX_K > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
};

function dialSvg(): string {
  let svg = `<circle cx="100" cy="100" r="96" fill="rgba(6,10,20,0.55)" stroke="rgba(255,255,255,0.12)"/>`;
  svg += `<path d="${arc(0, MAX_K)}" stroke="rgba(255,255,255,0.12)" stroke-width="7" fill="none" stroke-linecap="round"/>`;
  svg += `<path data-id="rpmArc" d="${arc(0, 0.01)}" stroke="var(--accent)" stroke-width="7" fill="none" stroke-linecap="round" class="glow"/>`;
  svg += `<path d="${arc(RED_K, MAX_K)}" stroke="#ff3b30" stroke-width="7" fill="none"/>`;
  for (let k = 0; k <= MAX_K; k++) {
    const [x0, y0] = at(k, 76);
    const [x1, y1] = at(k, 70);
    const [tx, ty] = at(k, 60);
    svg += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="#cfd8e8" stroke-width="2"/>`;
    svg += `<text x="${tx}" y="${ty + 4}" fill="#9fb0cc" font-size="11" text-anchor="middle" font-style="italic">${k}</text>`;
  }
  // The needle: a short pointer across the ring, clear of the speed in the middle.
  svg += `<line data-id="needle" x1="0" y1="0" x2="0" y2="0" stroke="#fff" stroke-width="4" stroke-linecap="round" class="glow"/>`;
  return svg;
}

/**
 * The race HUD: time (top left), the race on one line (every car a dot,
 * top), place and the distance left (top right), near misses (bottom left),
 * the tachometer with shift lights, speed and gear (bottom right), a rival
 * coming up behind (an arrow on the bottom edge), and moments (overtake, near
 * miss) in the middle. Numbers and icons, no labels. Then the pause and the finish.
 */
export class Hud {
  private el: Record<string, HTMLElement> = {};
  private lastPhase = '';
  private toastTimer = 0;
  private lastPlace: number | null = null;
  private dots: HTMLElement[] = [];

  constructor(private root: HTMLElement, private flow: GameFlow, handlers: HudHandlers) {
    root.innerHTML = html`
      <div id="countdown" class="countdown"></div>
      <div id="hud">
        <div class="h-time h-glass"><span class="num" data-id="time">0:00.000</span></div>
        <div class="h-track h-glass"><div class="line" data-id="line"><div class="done" data-id="done"></div>${[0, 1, 2, 3, 4, 5]
          .map((k) => `<div class="tick" style="left:${k * 20}%"></div>`)
          .join('')}${icon('icon-flag', 'flag')}</div></div>
        <div class="h-place h-glass">
          <div class="num pos" data-id="placeBox"><span data-id="place">1</span><small data-id="of">/6</small></div>
          <div class="remain">${icon('icon-flag')}<span class="num" data-id="remain">5.00</span> km</div>
        </div>
        <div class="h-combo h-glass">${icon('icon-nearmiss')}<span class="num" data-id="nm">×0</span></div>
        <div class="h-tacho">
          <div class="shift" data-id="shift">${['g', 'g', 'a', 'a', 'r'].map((c) => `<i class="${c}"></i>`).join('')}</div>
          <svg viewBox="0 0 200 200">${dialSvg()}</svg>
          <div class="mid"><div class="num speed" data-id="speed">0</div><div class="unit">KM/H</div><div class="num gear" data-id="gear">1</div></div>
        </div>
        <div class="h-behind" data-id="behind"><div class="d num" data-id="behindGap"></div><div class="chev"></div></div>
        <div class="h-reset" data-id="reset"><kbd>R</kbd></div>
        <div class="h-badges"><span data-id="ai" class="h-ai">AI</span><span data-id="mute" class="h-mute">🔇</span></div>
      </div>
      <div id="toast" class="toast" data-id="toast"></div>
      <div id="pause" class="panel center">
        <h2>暫停</h2>
        <button data-id="resumeBtn">繼續 <small>Esc</small></button>
        <button data-id="pauseTitleBtn" class="secondary">回車庫</button>
      </div>
      <div id="finish" class="panel center">
        <h2>抵達終點！</h2>
        <div class="big" data-id="finishTime"></div>
        <div class="stats" data-id="finishStats"></div>
        <button data-id="againBtn">再一場 <small>Enter</small></button>
        <button data-id="finishTitleBtn" class="secondary">回車庫</button>
      </div>`;
    for (const id of ['countdown', 'hud', 'pause', 'finish']) this.el[id] = root.querySelector(`#${id}`)!;
    root.querySelectorAll<HTMLElement>('[data-id]').forEach((e) => (this.el[e.dataset.id!] = e));
    this.el.againBtn.onclick = () => handlers.onAgain();
    this.el.resumeBtn.onclick = () => handlers.onResume();
    this.el.pauseTitleBtn.onclick = () => handlers.onTitle();
    this.el.finishTitleBtn.onclick = () => handlers.onTitle();
  }

  /** The player's car's accent colour (the garage's): the HUD's, the countdown's and the pause and finish panels' highlights. */
  setAccent(color: string): void {
    this.root.style.setProperty('--accent', color);
  }

  nearMiss(): void {
    this.message('險過！', 1);
  }

  /** Flash a short message in the middle of the screen. */
  message(text: string, seconds = 2.5): void {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.toggle('long', text.length > 8);
    t.classList.remove('show');
    void t.offsetWidth; // restart animation
    t.classList.add('show');
    this.toastTimer = seconds;
  }

  private show(id: string, on: boolean): void {
    this.el[id].style.display = on ? '' : 'none';
  }

  update(dt: number, f: HudFrame): void {
    const flow = this.flow;
    const phase = flow.phase;
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      this.show('hud', phase !== 'title');
      this.show('pause', phase === 'paused');
      this.show('finish', phase === 'finished');
      if (phase === 'countdown') this.lastPlace = null;
      if (phase === 'finished') {
        this.el.finishTime.textContent = formatTime(flow.finishTime ?? 0);
        const place = f.racers.length > 1 ? `第 ${f.place} 名（共 ${f.racers.length} 台） · ` : '';
        this.el.finishStats.textContent = `${place}險過 ${flow.nearMisses} 次`;
      }
    }

    const cd = this.el.countdown;
    if (phase === 'countdown' || (phase === 'racing' && flow.raceTime < 0.8)) {
      cd.style.display = '';
      cd.textContent = phase === 'countdown' ? String(Math.ceil(flow.countdown)) : 'GO!';
      cd.classList.toggle('go', phase === 'racing');
    } else {
      cd.style.display = 'none';
    }

    this.el.time.textContent = formatTime(phase === 'finished' ? (flow.finishTime ?? 0) : flow.raceTime);
    this.el.remain.textContent = (Math.max(0, ROAD_LENGTH - f.playerS) / 1000).toFixed(2);
    // Place, and an overtake (racing only: the grid shuffles at the start).
    const many = f.racers.length > 1;
    this.el.placeBox.style.display = many ? '' : 'none';
    this.el.place.textContent = String(f.place);
    this.el.of.textContent = `/${f.racers.length}`;
    if (phase === 'racing' && many) {
      if (overtook(this.lastPlace, f.place) && flow.raceTime > 1) this.message('超車！', 1.2);
      this.lastPlace = f.place;
    }
    this.drawTrack(f);
    this.el.nm.textContent = `×${flow.nearMisses}`;
    // The tachometer.
    this.el.speed.textContent = String(Math.max(0, Math.round(f.speedKmh)));
    this.el.gear.textContent = f.reverse ? 'R' : String(f.gear);
    const k = f.rpm / 1000;
    this.el.rpmArc.setAttribute('d', arc(0, Math.max(0.01, Math.min(MAX_K, k))));
    const [x0, y0] = at(k, 66);
    const [x1, y1] = at(k, 96);
    Object.entries({ x1: x0, y1: y0, x2: x1, y2: y1 }).forEach(([a, v]) => this.el.needle.setAttribute(a, v.toFixed(1)));
    const lit = shiftLights(f.rpm);
    [...this.el.shift.children].forEach((led, i) => led.classList.toggle('on', i < lit));
    // A rival coming up behind.
    const me = f.racers.find((r) => r.me);
    const behind = me && phase === 'racing' ? closestBehind(me, f.racers.filter((r) => !r.me), BEHIND_RANGE) : null;
    this.el.behind.style.display = behind ? '' : 'none';
    if (behind) {
      this.el.behind.style.setProperty('--c', behind.color);
      this.el.behind.style.left = `${50 + behind.side * 12}%`;
      this.el.behindGap.textContent = `${Math.round(behind.gap)} m`;
    }
    this.el.reset.style.display = phase === 'racing' ? '' : 'none';
    this.el.reset.classList.toggle('ready', f.resetCooldown <= 0);
    this.el.mute.style.display = f.muted ? '' : 'none';
    this.el.ai.style.display = f.aiDriving ? '' : 'none';

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.classList.remove('show');
    }
  }

  /** Every car a dot on the race line (the player's the big white one), the player's part of it filled. */
  private drawTrack(f: HudFrame): void {
    while (this.dots.length < f.racers.length) {
      const d = document.createElement('div');
      this.el.line.appendChild(d);
      this.dots.push(d);
    }
    this.dots.forEach((d, i) => {
      const r = f.racers[i];
      d.style.display = r ? '' : 'none';
      if (!r) return;
      d.className = `car-dot${r.me ? ' me' : ''}`;
      d.style.left = `${progress(r.s) * 100}%`;
      d.style.setProperty('--c', r.color);
    });
    this.el.done.style.width = `${progress(f.playerS) * 100}%`;
  }
}
