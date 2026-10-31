import { ROAD_LENGTH } from '../config';
import { formatTime, GameFlow } from '../game/gameState';

export interface HudHandlers {
  onStart(): void;
  onResume(): void;
  onTitle(): void;
}

export interface HudFrame {
  speedKmh: number;
  playerS: number;
  resetCooldown: number;
  muted: boolean;
  gear: number;
  rpm: number;
}

export const TACHO_MAX = 8000;
export const TACHO_RED = 7000;
const START_DEG = 135;
const SWEEP_DEG = 270;

/** Needle angle (degrees, SVG convention) for an rpm value. */
export function tachoAngle(rpm: number): number {
  const t = Math.min(1, Math.max(0, rpm / TACHO_MAX));
  return START_DEG + SWEEP_DEG * t;
}

function polar(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [100 + r * Math.cos(a), 100 + r * Math.sin(a)];
}

function tachoTicksSvg(): string {
  let out = '';
  // Red zone.
  const [x0, y0] = polar(84, tachoAngle(TACHO_RED));
  const [x1, y1] = polar(84, tachoAngle(TACHO_MAX));
  out += `<path d="M ${x0} ${y0} A 84 84 0 0 1 ${x1} ${y1}" stroke="#ff3b30" stroke-width="10" fill="none" opacity="0.85"/>`;
  for (let rpm = 0; rpm <= TACHO_MAX; rpm += 500) {
    const major = rpm % 1000 === 0;
    const a = tachoAngle(rpm);
    const [ax, ay] = polar(major ? 74 : 80, a);
    const [bx, by] = polar(89, a);
    out += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#fff" stroke-width="${major ? 3 : 1.5}" opacity="0.9"/>`;
    if (major) {
      const [tx, ty] = polar(62, a);
      out += `<text x="${tx}" y="${ty}" fill="#fff" font-size="13" font-weight="700" text-anchor="middle" dominant-baseline="middle">${rpm / 1000}</text>`;
    }
  }
  out += `<text x="100" y="70" fill="#bbb" font-size="9" text-anchor="middle">x1000 rpm</text>`;
  return out;
}

const html = String.raw;

export class Hud {
  private el: Record<string, HTMLElement> = {};
  private lastPhase = '';
  private toastTimer = 0;

  constructor(root: HTMLElement, private flow: GameFlow, handlers: HudHandlers) {
    root.innerHTML = html`
      <div id="title" class="panel center">
        <div class="logo">HIGHWAY<span>THUNDER 2</span></div>
        <div class="subtitle">高速公路穿梭賽 · 10 公里直線衝刺</div>
        <table class="keys">
          <tr><td><kbd>W</kbd> / <kbd>↑</kbd></td><td>油門</td></tr>
          <tr><td><kbd>S</kbd> / <kbd>↓</kbd></td><td>煞車 / 倒車</td></tr>
          <tr><td><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd></td><td>轉向</td></tr>
          <tr><td><kbd>R</kbd></td><td>重置到車道上（冷卻 3 秒）</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>暫停</td></tr>
          <tr><td><kbd>M</kbd></td><td>靜音</td></tr>
        </table>
        <div class="best" data-id="titleBest"></div>
        <button data-id="startBtn">開始比賽 <small>Enter</small></button>
        <div class="hint">貼著車身擦過可獲得「險過」· 撞到的車會失控，小心連環車禍</div>
      </div>
      <div id="countdown" class="countdown"></div>
      <div id="hud">
        <div class="hud-tl"><div class="label">時間</div><div class="value" data-id="time">0:00.000</div></div>
        <div class="hud-tr"><div class="label">剩餘距離</div><div class="value" data-id="remain">10.00 km</div></div>
        <div class="progress"><div class="bar" data-id="bar"></div><div class="flag">🏁</div></div>
        <div class="hud-bl">
          <div class="label">險過</div><div class="value" data-id="nm">0</div>
          <div class="reset" data-id="reset"></div>
        </div>
        <div class="hud-br">
          <div class="tacho">
            <svg viewBox="0 0 200 200" data-id="tachoSvg">
              <circle cx="100" cy="100" r="96" fill="rgba(10,14,24,0.55)" stroke="rgba(255,255,255,0.25)" stroke-width="2" />
              <g data-id="tachoTicks"></g>
              <line data-id="needle" x1="100" y1="100" x2="178" y2="100" stroke="#ff3b30" stroke-width="4" stroke-linecap="round" />
              <circle cx="100" cy="100" r="7" fill="#ff3b30" />
            </svg>
            <div class="tacho-center">
              <div class="speed" data-id="speed">0</div>
              <div class="unit">km/h</div>
              <div class="gear-box"><span class="gear" data-id="gear">1</span><span class="rpm" data-id="rpm">900</span></div>
            </div>
          </div>
        </div>
        <div class="mute" data-id="mute">🔇 靜音</div>
      </div>
      <div id="toast" class="toast" data-id="toast">險過！</div>
      <div id="pause" class="panel center">
        <h2>暫停</h2>
        <button data-id="resumeBtn">繼續 <small>Esc</small></button>
        <button data-id="pauseTitleBtn" class="secondary">回標題</button>
      </div>
      <div id="finish" class="panel center">
        <h2>抵達終點！</h2>
        <div class="big" data-id="finishTime"></div>
        <div class="record" data-id="record">新紀錄！</div>
        <div class="stats" data-id="finishStats"></div>
        <button data-id="againBtn">再玩一次 <small>Enter</small></button>
        <button data-id="finishTitleBtn" class="secondary">回標題</button>
      </div>`;
    for (const id of ['title', 'countdown', 'hud', 'pause', 'finish']) this.el[id] = root.querySelector(`#${id}`)!;
    root.querySelectorAll<HTMLElement>('[data-id]').forEach((e) => (this.el[e.dataset.id!] = e));
    this.el.tachoTicks.innerHTML = tachoTicksSvg();
    this.el.startBtn.onclick = () => handlers.onStart();
    this.el.againBtn.onclick = () => handlers.onStart();
    this.el.resumeBtn.onclick = () => handlers.onResume();
    this.el.pauseTitleBtn.onclick = () => handlers.onTitle();
    this.el.finishTitleBtn.onclick = () => handlers.onTitle();
  }

  nearMiss(): void {
    const t = this.el.toast;
    t.classList.remove('show');
    void t.offsetWidth; // restart animation
    t.classList.add('show');
    this.toastTimer = 1;
  }

  private show(id: string, on: boolean): void {
    this.el[id].style.display = on ? '' : 'none';
  }

  update(dt: number, f: HudFrame): void {
    const flow = this.flow;
    const phase = flow.phase;
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      this.show('title', phase === 'title');
      this.show('hud', phase !== 'title');
      this.show('pause', phase === 'paused');
      this.show('finish', phase === 'finished');
      if (phase === 'title') {
        this.el.titleBest.textContent = flow.best !== null ? `最佳成績 ${formatTime(flow.best)}` : '尚無紀錄';
      }
      if (phase === 'finished') {
        this.el.finishTime.textContent = formatTime(flow.finishTime ?? 0);
        this.el.record.style.display = flow.isBest ? '' : 'none';
        this.el.finishStats.textContent = `最佳成績 ${flow.best !== null ? formatTime(flow.best) : '-'} · 險過 ${flow.nearMisses} 次`;
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

    this.el.time.textContent = formatTime(phase === 'finished' ? flow.finishTime ?? 0 : flow.raceTime);
    const remain = Math.max(0, ROAD_LENGTH - f.playerS) / 1000;
    this.el.remain.textContent = `${remain.toFixed(2)} km`;
    this.el.bar.style.width = `${Math.min(100, Math.max(0, (f.playerS / ROAD_LENGTH) * 100))}%`;
    this.el.speed.textContent = String(Math.max(0, Math.round(f.speedKmh)));
    this.el.nm.textContent = String(flow.nearMisses);
    this.el.gear.textContent = f.speedKmh < -1 ? 'R' : String(f.gear);
    this.el.rpm.textContent = String(Math.round(f.rpm / 50) * 50);
    this.el.needle.setAttribute('transform', `rotate(${tachoAngle(f.rpm).toFixed(1)} 100 100)`);
    this.el.rpm.classList.toggle('red', f.rpm >= TACHO_RED);
    this.el.reset.textContent =
      phase === 'racing' ? (f.resetCooldown > 0 ? `R 重置 ${f.resetCooldown.toFixed(1)}s` : 'R 重置 可用') : '';
    this.el.reset.classList.toggle('ready', phase === 'racing' && f.resetCooldown <= 0);
    this.el.mute.style.display = f.muted ? '' : 'none';

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.classList.remove('show');
    }
  }
}
