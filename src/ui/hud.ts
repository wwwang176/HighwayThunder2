import { formatTime, GameFlow } from '../game/gameState';
import { ROAD_LENGTH } from '../config';
import { closestBehind, hudShake, overtook, progress, ResetHint } from './hudMath';
import { applyLang, onLangChange, t, tx } from './i18n';

export interface HudHandlers {
  /** After the finish: the same race again. */
  onAgain(): void;
  onResume(): void;
  /** Paused: the same race again from the start. */
  onRestart(): void;
  /** Back to the garage. */
  onTitle(): void;
  /** Paused: the settings pop-up over it. */
  onSettings(): void;
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
  /** The player's car's up axis, its world y (1 upright, 0 on its side, -1 on its roof): the R hint. */
  upY: number;
  muted: boolean;
  gear: number;
  rpm: number;
  /** The nitro tank, 0 empty .. 1 full, and whether it is burning. */
  nitro: number;
  nitroOn: boolean;
  reverse: boolean;
  /** The trained AI is driving the player's car. */
  aiDriving: boolean;
  /** The player's place among `racers` cars (no rivals: not shown). */
  place: number;
  /** Every car in the race (the player's included). */
  racers: HudRacer[];
  /** The camera's shake this frame (CameraRig.shaken): the HUD shakes with it, a little. */
  shake: { right: number; up: number; roll: number };
  /** The finish gate on the screen (0..1 from its left and top), `m` m on; none: behind the camera. */
  goal: { x: number; y: number; m: number } | null;
}

const html = String.raw;
const UI = `${import.meta.env.BASE_URL}ui/`;
const icon = (name: string, cls = '') => `<span class="icon ${cls}" style="--src:url(${UI}${name}.png)"></span>`;
/** A rival this close behind (m, bumper to bumper) shows as an arrow on the screen's bottom edge. */
const BEHIND_RANGE = 30;
/** The finish marked over its gate (how far it is to go) from this close (m), fading in over the first `GOAL_FADE` m. */
const GOAL_RANGE = 1000;
const GOAL_FADE = 100;
/** A time, its thousandths small: 0:20<small>.225</small>. */
const timeHtml = (sec: number) => formatTime(sec).replace(/\.(\d+)$/, '<small>.$1</small>');

// The tachometer: a 240-degree ring from 150 degrees, 0-8 x1000 rpm, red from 7, in a 200-unit box.
const START = 150;
const SWEEP = 240;
const MAX_K = 8;
const RED_K = 7;
const ang = (k: number) => START + (SWEEP * k) / MAX_K;
const P = (a: number, r: number): [number, number] => {
  const t = (a * Math.PI) / 180;
  return [100 + r * Math.cos(t), 100 + r * Math.sin(t)];
};
const pts = (corners: [number, number][]) => corners.map(([a, r]) => P(a, r).map((v) => v.toFixed(2)).join(' ')).join(' ');
const arcD = (a0: number, a1: number, r: number) =>
  `M${P(a0, r).map((v) => v.toFixed(2)).join(' ')} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${P(a1, r).map((v) => v.toFixed(2)).join(' ')}`;
/** The rpm blocks: 32 slanted ones from the inner radius out, longer toward the redline; the lit one in front longer still. */
const BLOCKS = 32;
const B_IN = 78;
const B_SLANT = 3.6;
const blockPts = (i: number, lead: boolean) => {
  const a0 = ang((i * MAX_K) / BLOCKS) + (i % 4 === 0 ? 1.4 : 0.6); // (a wider gap at every 1000)
  const a1 = ang(((i + 1) * MAX_K) / BLOCKS) - 0.6;
  const h = 8 + (7 * i) / (BLOCKS - 1) + (lead ? 5 : 0);
  return pts([[a0, B_IN], [a0 + B_SLANT, B_IN + h], [a1 + B_SLANT, B_IN + h], [a1, B_IN]]);
};
const blockRed = (i: number) => (i * MAX_K) / BLOCKS >= RED_K;
/** How a block looks: lit (the one in front white), unlit (all but clear, outlined); red past the redline. */
const BLOCK_LOOK = {
  lead: { fill: '#fff', stroke: 'rgba(255,255,255,0.4)', 'stroke-width': '2.5' },
  lit: { fill: '#c9d3e3', stroke: 'none', 'stroke-width': '0' },
  litRed: { fill: '#ff3b30', stroke: 'rgba(255,59,48,0.5)', 'stroke-width': '2.5' },
  off: { fill: 'rgba(255,255,255,0.05)', stroke: 'rgba(255,255,255,0.2)', 'stroke-width': '0.5' },
  offRed: { fill: 'rgba(255,59,48,0.16)', stroke: 'rgba(255,59,48,0.42)', 'stroke-width': '0.5' },
};
/** The nitro: 10 cyan blocks outside the ring's 0-2.5 part, filling upward from its foot. */
const N_BLOCKS = 10;
const N_FROM = 152;
const N_TO = 214;
const nitroPts = (i: number) => {
  const b0 = N_FROM + (i * (N_TO - N_FROM)) / N_BLOCKS + 0.8;
  const b1 = N_FROM + ((i + 1) * (N_TO - N_FROM)) / N_BLOCKS - 0.8;
  return pts([[b0, 100], [b0 + 1.6, 107], [b1 + 1.6, 107], [b1, 100]]);
};
const NITRO_LOOK = {
  on: { fill: '#2fd6ff', stroke: 'none' },
  burn: { fill: '#8fe4ff', stroke: 'rgba(143,228,255,0.5)' },
  off: { fill: 'rgba(47,214,255,0.1)', stroke: 'rgba(47,214,255,0.35)' },
};

function tachoSvg(): string {
  let s = `<path d="${arcD(ang(0) - 3, ang(MAX_K) + 3, 85.5)}" stroke="rgba(0,0,0,0.62)" stroke-width="24" fill="none"/>`; // (the ring's dark band)
  for (let i = 0; i < BLOCKS; i++) s += `<polygon data-block="${i}" points="${blockPts(i, false)}"/>`;
  for (let k = 0; k <= MAX_K; k++) {
    const [x, y] = P(ang(k) + 1, 67);
    s += `<text x="${x.toFixed(1)}" y="${(y + 4.6).toFixed(1)}" text-anchor="middle" font-family="Bahnschrift, Segoe UI, sans-serif" font-style="italic" font-size="12" font-weight="600" fill="${k >= RED_K ? '#ff3b30' : 'rgba(255,255,255,0.8)'}" stroke="rgba(0,0,0,0.6)" stroke-width="2.4" paint-order="stroke">${k}</text>`;
  }
  s += `<path d="${arcD(N_FROM - 2, N_TO + 2, 103.5)}" stroke="rgba(0,0,0,0.55)" stroke-width="10" fill="none"/>`;
  for (let i = 0; i < N_BLOCKS; i++) s += `<polygon data-nitro="${i}" points="${nitroPts(i)}" stroke-width="0.5"/>`;
  for (const e of [ang(0) - 3, ang(MAX_K) + 3]) {
    const [x0, y0] = P(e, 74);
    const [x1, y1] = P(e, 99);
    s += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="rgba(255,255,255,0.35)" stroke-width="0.8"/>`;
  }
  return s;
}

const setAttrs = (e: Element, attrs: Record<string, string>) => Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));

/**
 * The race HUD, no panels, the numbers floating on the view (docs/ui-design.md): time (top left), the race on one
 * line (every car on it, the distance left under its end), the place in a hexagon (top right), the tachometer -
 * a ring of rpm blocks, the speed in it, the gear, the nitro (bottom right) - a rival coming up behind (an arrow
 * on the bottom edge), R when the car is stuck or rolled over, and moments (overtake, near miss) in the middle.
 * Then the pause and the finish, over the race as it stands (no veil: the race seen whole behind them).
 */
export class Hud {
  private el: Record<string, HTMLElement> = {};
  private lastPhase = '';
  private toastTimer = 0;
  private lastPlace: number | null = null;
  private dots: HTMLElement[] = [];
  private readonly blocks: SVGPolygonElement[];
  private readonly nitroBlocks: SVGPolygonElement[];
  /** What the tachometer shows (redrawn only when it changes). */
  private shown = { lead: -2, over: false, nitro: -1, burn: false };
  private readonly resetHint = new ResetHint();

  constructor(private root: HTMLElement, private flow: GameFlow, handlers: HudHandlers) {
    root.innerHTML = html`
      <div id="countdown" class="countdown"></div>
      <div id="hud">
        <div class="h-time float"><div class="lbl dash">Time</div><div class="num lean v" data-id="time">0:00<small>.000</small></div></div>
        <div class="h-track float"><div class="line" data-id="line"><div class="done" data-id="done"></div>${[1, 2, 3, 4]
          .map((k) => `<i class="tick" style="left:${k * 20}%"></i>`)
          .join('')}${icon('icon-flag', 'flag')}</div><div class="remain num"><span data-id="remain">5.00</span><small>KM</small></div></div>
        <div class="h-place float" data-id="placeBox">
          <div class="hexo hex"><div class="hexi hex"><span class="p num" data-id="place">1</span></div></div>
          <div><span class="of num" data-id="of">/6</span><span class="lbl">Position</span></div>
        </div>
        <div class="h-tacho" data-id="tacho">
          <div class="pool"></div>
          <svg viewBox="0 0 200 200">${tachoSvg()}</svg>
          <div class="mid float"><div class="num lean speed" data-id="speed">0</div><span class="unit lbl">km/h</span></div>
          <div class="gear hex"><b class="hex" data-id="gear">1</b></div>
          <span class="n2o lbl">N2O</span>
        </div>
        <div class="h-goal float" data-id="goal">${icon('icon-flag', 'flag')}<div class="num"><span data-id="goalM"></span><small>m</small></div></div>
        <div class="h-behind float" data-id="behind"><div class="d num" data-id="behindGap"></div><div class="chev"></div></div>
        <div class="h-reset" data-id="reset"><kbd>R</kbd>${tx('hud.reset', 'span', 'float')}</div>
        <div class="h-badges"><span data-id="ai" class="h-ai cut">AI</span><span data-id="mute" class="h-mute">🔇</span></div>
      </div>
      <div id="toast" class="toast" data-id="toast"></div>
      <div id="pause" class="center bracketed">
        <span class="brk tr"></span><span class="brk bl"></span>
        <div class="menu panel cut">
          ${tx('pause.kicker', 'div', 'lbl dash')}
          ${tx('pause.title', 'h2')}
          <div class="status">
            <div><span class="lbl">Time</span><b class="num" data-id="pTime"></b></div>
            <div data-id="pPlaceBox"><span class="lbl">Position</span><b class="num" data-id="pPlace"></b></div>
            <div><span class="lbl">To go</span><b class="num" data-id="pRemain"></b></div>
          </div>
          <button class="opt" data-id="resumeBtn"><span class="no">01</span>${tx('pause.resume')}<kbd>Esc</kbd></button>
          <button class="opt" data-id="restartBtn"><span class="no">02</span>${tx('pause.restart')}</button>
          <button class="opt" data-id="settingsBtn"><span class="no">03</span>${tx('pause.settings')}</button>
          <button class="opt" data-id="pauseTitleBtn"><span class="no">04</span>${tx('pause.garage')}</button>
          <div class="confirm">
            ${tx('confirm.kicker', 'div', 'lbl dash')}
            ${tx('confirm.lost', 'p', 'msg')}
            <div class="btns">
              <button class="opt" data-id="confirmYes">${tx('confirm.yes')}</button>
              <button class="opt" data-id="confirmNo">${tx('confirm.no')}<kbd>Esc</kbd></button>
            </div>
          </div>
        </div>
      </div>
      <div id="finish" class="center bracketed">
        <span class="brk tr"></span><span class="brk bl"></span>
        <div class="result panel cut">
          ${tx('finish.kicker', 'div', 'lbl dash')}
          ${tx('finish.title', 'h2')}
          <div class="main" data-id="fMain">
            <div class="place" data-id="fPlaceBox"><div class="hexo hex"><div class="hexi hex"><span class="p num" data-id="fPlace"></span></div></div><span class="lbl">Position</span></div>
            <div class="time">
              <span class="lbl">Finish time</span><span class="lbl best" data-id="fBest">New best</span>
              <div class="num lean v" data-id="finishTime"></div>
              <div class="rows">
                <div><span class="lbl">Near miss</span><b class="num" data-id="fNear"></b></div>
                <div><span class="lbl">Top speed</span><b class="num" data-id="fTop"></b></div>
                <div><span class="lbl">Distance</span><b class="num">${(ROAD_LENGTH / 1000).toFixed(2)}<small>km</small></b></div>
              </div>
            </div>
          </div>
          <div class="btns">
            <button class="opt" data-id="againBtn">${tx('finish.again')}</button>
            <button class="opt" data-id="finishTitleBtn">${tx('pause.garage')}<kbd>Esc</kbd></button>
          </div>
        </div>
      </div>`;
    for (const id of ['countdown', 'hud', 'pause', 'finish']) this.el[id] = root.querySelector(`#${id}`)!;
    root.querySelectorAll<HTMLElement>('[data-id]').forEach((e) => (this.el[e.dataset.id!] = e));
    this.blocks = [...root.querySelectorAll<SVGPolygonElement>('[data-block]')];
    this.nitroBlocks = [...root.querySelectorAll<SVGPolygonElement>('[data-nitro]')];
    this.el.againBtn.onclick = () => handlers.onAgain();
    this.el.resumeBtn.onclick = () => handlers.onResume();
    // Restart and the garage throw the race away: each asks first (OK / Cancel).
    this.el.restartBtn.onclick = () => this.ask(() => handlers.onRestart());
    this.el.pauseTitleBtn.onclick = () => this.ask(() => handlers.onTitle());
    this.el.settingsBtn.onclick = () => handlers.onSettings();
    this.el.confirmYes.onclick = () => {
      const then = this.confirmThen;
      this.closeConfirm();
      then?.();
    };
    this.el.confirmNo.onclick = () => this.cancelConfirm();
    this.el.finishTitleBtn.onclick = () => handlers.onTitle();
    // The pointer moves the menus' cursor too; a click leaves no focus behind (Enter is the cursor's, not a clicked button's).
    for (const id of ['resumeBtn', 'restartBtn', 'settingsBtn', 'pauseTitleBtn', 'againBtn', 'finishTitleBtn', 'confirmYes', 'confirmNo'])
      this.el[id].addEventListener('pointerenter', () => this.menu.includes(this.el[id]) && this.point(this.menu.indexOf(this.el[id])));
    root.addEventListener('click', (e) => e.detail && (document.activeElement as HTMLElement | null)?.blur());
    onLangChange(() => applyLang(root)); // (another language: the fixed words redone; the rest are set as they show)
    this.hide();
  }

  /** The open menu's options (the pause's or the finish's; none: no menu), the cursor on one: filled (.sel). */
  private menu: HTMLElement[] = [];
  private cursor = 0;

  /** The pause's confirm open: what its OK does (null: not open); where the cursor was on the menu under it. */
  private confirmThen: (() => void) | null = null;
  private confirmFrom = 0;

  /** Whether the pause's confirm is open (Esc then cancels it, not the pause). */
  get confirming(): boolean {
    return this.confirmThen !== null;
  }

  /** The pause's confirm (the race thrown away - sure?): `then` on OK; the cursor on Cancel. */
  private ask(then: () => void): void {
    this.confirmFrom = this.cursor;
    this.confirmThen = then;
    this.el.pause.classList.add('confirming');
    this.openMenu([this.el.confirmYes, this.el.confirmNo]);
    this.point(1);
  }

  private closeConfirm(): void {
    this.confirmThen = null;
    this.el.pause.classList.remove('confirming');
  }

  /** Cancel (Esc too): back to the pause's menu, its cursor where it was. */
  cancelConfirm(): void {
    if (!this.confirming) return;
    this.closeConfirm();
    this.openMenu(this.pauseMenu());
    this.point(this.confirmFrom);
  }

  /** The pause's options: resume, restart, the settings, the garage. */
  private pauseMenu(): HTMLElement[] {
    return [this.el.resumeBtn, this.el.restartBtn, this.el.settingsBtn, this.el.pauseTitleBtn];
  }

  private openMenu(options: HTMLElement[]): void {
    for (const b of this.menu) b.classList.remove('sel'); // (the one it replaces: none of it left lit)
    this.menu = options;
    this.point(0);
  }

  private point(i: number): void {
    this.cursor = i;
    this.menu.forEach((b, k) => b.classList.toggle('sel', k === i));
  }

  /** The arrows on the pause or the finish: the cursor to the next option (round). */
  menuMove(d: number): void {
    const n = this.menu.length;
    if (n) this.point((this.cursor + d + n) % n);
  }

  /** Enter on the pause or the finish: the option under the cursor. */
  menuPick(): void {
    this.menu[this.cursor]?.click();
  }

  /** Whether the finish's panel is in (revealFinish: its show over). */
  finishShown = false;

  /** The finish's panel in, its menu open (the finish's show over: game/finishShow). */
  revealFinish(): void {
    if (this.flow.phase !== 'finished' || this.finishShown) return;
    this.finishShown = true;
    this.show('finish', true);
    this.openMenu([this.el.againBtn, this.el.finishTitleBtn]);
  }

  /** Nothing of the race on screen (the garage is open: update() is not called until the next race). */
  hide(): void {
    this.lastPhase = '';
    for (const id of ['countdown', 'hud', 'pause', 'finish']) this.show(id, false);
    this.el.toast.classList.remove('show');
    this.toastTimer = 0;
  }

  /** The player's car's accent colour (the garage's): the HUD's, the countdown's and the pause and finish panels' highlights. */
  setAccent(color: string): void {
    this.root.style.setProperty('--accent', color);
  }

  nearMiss(): void {
    this.message(t('toast.nearMiss'), 1);
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
    const many = f.racers.length > 1;
    if (phase !== this.lastPhase) {
      const from = this.lastPhase;
      this.lastPhase = phase;
      this.show('hud', phase !== 'title' && phase !== 'intro' && phase !== 'finished'); // (not over the intro's shots, nor the finish's panel)
      this.show('pause', phase === 'paused');
      this.show('finish', false); // (in after the finish's show: revealFinish)
      this.finishShown = false;
      if (phase === 'countdown') this.lastPlace = null;
      if (phase === 'countdown' && from === 'intro') {
        // Coming in as the intro hands over (the class again: the animation from its start).
        this.el.hud.classList.remove('enter');
        void this.el.hud.offsetWidth;
        this.el.hud.classList.add('enter');
      }
      this.menu = [];
      this.closeConfirm();
      if (phase === 'paused') this.openMenu(this.pauseMenu());
      if (phase === 'paused') {
        this.el.pTime.innerHTML = timeHtml(flow.raceTime);
        this.el.pPlaceBox.style.display = many ? '' : 'none';
        this.el.pPlace.innerHTML = `${f.place}<small>/${f.racers.length}</small>`;
        this.el.pRemain.innerHTML = `${(Math.max(0, ROAD_LENGTH - f.playerS) / 1000).toFixed(2)}<small>km</small>`;
      }
      if (phase === 'finished') {
        this.el.finishTime.innerHTML = timeHtml(flow.finishTime ?? 0);
        this.el.fBest.style.display = flow.isBest ? '' : 'none';
        this.el.fPlaceBox.style.display = many ? '' : 'none';
        this.el.fMain.classList.toggle('solo', !many);
        this.el.fPlace.innerHTML = `${f.place}<small>/${f.racers.length}</small>`;
        this.el.fNear.textContent = `×${flow.nearMisses}`;
        this.el.fTop.innerHTML = `${Math.round(flow.topSpeed)}<small>km/h</small>`;
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

    this.el.time.innerHTML = timeHtml(phase === 'finished' ? (flow.finishTime ?? 0) : flow.raceTime);
    this.el.remain.textContent = (Math.max(0, ROAD_LENGTH - f.playerS) / 1000).toFixed(2);
    // Place, and an overtake (racing only: the grid shuffles at the start).
    this.el.placeBox.style.display = many ? '' : 'none';
    this.el.place.textContent = String(f.place);
    this.el.of.textContent = `/${f.racers.length}`;
    if (phase === 'racing' && many) {
      if (overtook(this.lastPlace, f.place) && flow.raceTime > 1) this.message(t('toast.overtake'), 1.2);
      this.lastPlace = f.place;
    }
    this.drawTrack(f);
    this.drawTacho(f);
    // Shaking with the camera (a share of it: its road, its rough ground, a gear, a hit).
    const sh = hudShake(f.shake.right, f.shake.up, f.shake.roll);
    this.el.hud.style.transform = `translate(${sh.x.toFixed(3)}vw, ${sh.y.toFixed(3)}vw) rotate(${sh.deg.toFixed(3)}deg)`;
    // A rival coming up behind.
    const me = f.racers.find((r) => r.me);
    const behind = me && phase === 'racing' ? closestBehind(me, f.racers.filter((r) => !r.me), BEHIND_RANGE) : null;
    this.el.behind.style.display = behind ? '' : 'none';
    if (behind) {
      this.el.behind.style.setProperty('--c', behind.color);
      this.el.behind.style.left = `${50 + behind.side * 12}%`;
      this.el.behindGap.textContent = `${Math.round(behind.gap)} m`;
    }
    // The finish, marked over its gate as it nears.
    const goal = phase === 'racing' && f.goal && f.goal.m <= GOAL_RANGE ? f.goal : null;
    this.el.goal.style.display = goal ? '' : 'none';
    if (goal) {
      const g = this.el.goal.style;
      g.left = `${(goal.x * 100).toFixed(2)}%`;
      g.top = `${(goal.y * 100).toFixed(2)}%`;
      g.opacity = Math.min(1, (GOAL_RANGE - goal.m) / GOAL_FADE).toFixed(2);
      this.el.goalM.textContent = String(Math.ceil(goal.m));
    }
    // R: only once the car is stuck or rolled over (dt is the race's step: paused, the timers hold).
    const hint = phase === 'racing' && this.resetHint.update(dt, f.speedKmh, f.upY);
    if (phase !== 'racing' && phase !== 'paused') this.resetHint.clear();
    this.el.reset.classList.toggle('on', hint);
    this.el.reset.classList.toggle('ready', f.resetCooldown <= 0);
    this.el.mute.style.display = f.muted ? '' : 'none';
    this.el.ai.style.display = f.aiDriving ? '' : 'none';

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.classList.remove('show');
    }
  }

  /** The speed and gear every frame; the rpm ring and the nitro only when what they show changes. */
  private drawTacho(f: HudFrame): void {
    this.el.speed.textContent = String(Math.max(0, Math.round(f.speedKmh)));
    this.el.gear.textContent = f.reverse ? 'R' : String(f.gear);
    const k = Math.max(0, Math.min(MAX_K, f.rpm / 1000));
    const lead = Math.min(BLOCKS, Math.ceil((k * BLOCKS) / MAX_K)) - 1; // (the block the engine is in now; -1: none)
    const over = k >= RED_K;
    const s = this.shown;
    if (lead !== s.lead) {
      const was = s.lead;
      this.blocks.forEach((b, i) => {
        const red = blockRed(i);
        const look = i === lead ? (red ? BLOCK_LOOK.litRed : BLOCK_LOOK.lead) : i < lead ? (red ? BLOCK_LOOK.litRed : BLOCK_LOOK.lit) : red ? BLOCK_LOOK.offRed : BLOCK_LOOK.off;
        setAttrs(b, look);
        if (i === lead || i === was) b.setAttribute('points', blockPts(i, i === lead));
      });
      s.lead = lead;
    }
    if (over !== s.over) {
      this.el.tacho.classList.toggle('over', over);
      s.over = over;
    }
    const n = Math.round(Math.max(0, Math.min(1, f.nitro)) * N_BLOCKS);
    if (n !== s.nitro || f.nitroOn !== s.burn) {
      this.nitroBlocks.forEach((b, i) => setAttrs(b, i < n ? (f.nitroOn ? NITRO_LOOK.burn : NITRO_LOOK.on) : NITRO_LOOK.off));
      s.nitro = n;
      s.burn = f.nitroOn;
    }
  }

  /** Every car on the race line (a diamond in its colour; the player the white mark above), the player's part filled. */
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
