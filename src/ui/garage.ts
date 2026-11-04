import { CAR_CARDS, CarSelection, MAX_RIVALS, PICKABLE, RivalMode, setRival, setRivalCount, Weather } from '../game/carSelection';
import { DIFFICULTIES } from '../game/difficulty';
import { paintJobs, type PaintJob } from '../vehicles/carModels';
import { CARS } from '../vehicles/cars';
import { GarageScene, VIEW } from './garageScene';
import { installTooltips } from './tooltip';

const html = String.raw;
const UI = `${import.meta.env.BASE_URL}ui/`;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const icon = (name: string, cls = '') => `<span class="icon ${cls}" style="--src:url(${UI}${name}.png)"></span>`;
const card = (id: string) => CAR_CARDS.find((c) => c.id === id) ?? CAR_CARDS[0];
const two = (n: number) => String(n).padStart(2, '0');
/** A "?" in place of an explanation: its text on hover or focus (a line per row of `lines`). */
const help = (...lines: string[]) => `<span class="help cut" tabindex="0" data-tip="${lines.join('\n')}">?</span>`;
/** A call to action's inside (docs/ui-design.md .cta): its offset outline, its fill, the words, Enter, the chevrons. */
const CTA = (text: string) =>
  `<span class="ghost"></span><span class="fill"></span><span class="txt">${text}<kbd>Enter</kbd><span class="chev"><b>›</b><b>›</b><b>›</b></span></span>`;
/** How the rivals' cars are picked (the setup's second level: their cars listed only for the custom one). */
const MODES: [RivalMode, string, string][] = [
  ['random', 'icon-random', '全部隨機'],
  ['same', 'icon-same', '全部同我的車'],
  ['custom', 'icon-rivals', '自由指定'],
];
const WEATHERS: [Weather, string, string][] = [
  ['clear', 'icon-night-clear', '晴夜'],
  ['rain', 'icon-night-rain', '雨夜'],
  ['fog', 'icon-night-fog', '霧夜'],
];
/** Keys and what they do (the controls pop-up). */
const KEYS: [string, string][] = [
  ['W / ↑', '油門'],
  ['S / ↓', '煞車 / 倒車'],
  ['A D / ← →', '轉向'],
  ['Shift', '氮氣'],
  ['C', '看正後方'],
  ['R', '重置到車道上'],
  ['I', 'AI 接手駕駛'],
  ['Esc', '暫停'],
  ['M', '靜音'],
];
/** The race setup's drawer no smaller than this (its zoom, to fit a short screen); below it, its compact layout, then its scroll. */
const SETUP_MIN_ZOOM = 0.75;

/**
 * The garage: the car to race in (parked on a wet lay-by at night, drawn live: garageScene.ts), the screen around
 * it left clear (docs/ui-design.md): its name and stats floating at the top, the car types on the left (↑ ↓), its
 * paint jobs under it (← →), the race at a glance over the start at the bottom right. The race setup (rivals,
 * difficulty, weather) is a drawer from the right, the car sliding left beside it. The game opens on its title:
 * the same scene, the car on the right, the game's name and a start on the left (enter() brings the garage's own).
 */
export class Garage {
  private readonly el: HTMLElement;
  private sel!: CarSelection;
  private readonly preview: GarageScene;
  private titleOn = false;
  /** The race setup's row the keys are on (rowKeys()). */
  private row = 0;

  constructor(
    root: HTMLElement,
    private readonly rivalColors: number[],
    private readonly onStart: (sel: CarSelection) => void,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'garage';
    this.el.style.display = 'none';
    this.el.innerHTML = html`
      <canvas class="g-car"></canvas>
      <div class="g-vignette"></div>
      <div class="g-title-shade"></div>
      <div class="g-setup-shade"></div>
      <div class="g-title">
        <div class="g-title-name">${icon('emblem')}<h1>HIGHWAY<br>THUNDER 2</h1><div class="rule"></div></div>
        <button class="cta g-start">${CTA('開始遊戲')}</button>
      </div>
      <div class="g-brand">${icon('emblem')}<div class="g-name">HIGHWAY THUNDER 2</div><div class="rule"></div></div>
      <button class="g-keys panel cut" data-tip="操作說明" data-tip-place="left">${icon('icon-keys')}</button>
      <div class="g-id float"><div class="pool"></div><div class="tagrow"><span class="lbl tag"></span><span class="lbl pos"></span></div><h1></h1><div class="bar-top"></div><div class="g-stats"></div></div>
      <div class="g-left">
        <div class="g-head"><span class="lbl float">Select class</span><span><kbd>↑</kbd><kbd>↓</kbd></span></div>
        <div class="g-classes"></div>
      </div>
      <div class="g-paint"><span class="lbl float">Paint</span><kbd>←</kbd><div class="g-paints"></div><kbd>→</kbd></div>
      <div class="g-depart">
        <button class="g-race float"></button>
        <button class="cta g-go">${CTA('開始比賽')}</button>
      </div>
      <div class="g-setup bracketed" role="dialog" aria-label="比賽設定"><span class="brk tr"></span><span class="brk bl"></span>
        <div class="g-drawer panel cut">
          <div class="s-top">
            <div><div class="lbl dash">Race setup</div><h2>比賽設定</h2></div>
            <span class="s-keys">${help('↑ ↓　選項目', '← →　調整', '0 – 5　對手數量', 'Enter　開始比賽', 'Esc　收起')}</span>
            <button class="s-back cut"><kbd>Esc</kbd><span>收起</span></button>
          </div>
          <div class="s-body"></div>
          <button class="cta s-go">${CTA('開始比賽')}</button>
        </div>
      </div>
      <div class="g-back" data-pop="keys">
        <div class="bracketed"><span class="brk tr"></span><span class="brk bl"></span>
        <div class="g-modal g-keys-list panel cut" role="dialog" aria-modal="true" aria-label="操作說明">
          <button class="g-close cut" data-tip="關閉" data-tip-place="left">✕</button>
          <div class="lbl dash">Controls</div>
          ${KEYS.map(([k, what]) => `<div class="g-key"><kbd>${k}</kbd><span>${what}</span></div>`).join('')}
        </div></div>
      </div>`;
    root.appendChild(this.el);
    installTooltips(this.el);
    this.preview = new GarageScene(this.el.querySelector('.g-car')!);
    this.q('.g-go').onclick = () => this.start();
    this.q('.s-go').onclick = () => this.start();
    this.q('.g-start').onclick = () => this.enter();
    this.q('.g-race').onclick = () => this.openSetup();
    this.q('.s-back').onclick = () => this.closePop();
    this.q('.g-keys').onclick = () => this.openKeys();
    this.q('.g-close').onclick = () => this.closePop();
    this.q('.g-back').onclick = (e) => e.target === e.currentTarget && this.closePop();
    addEventListener('resize', () => this.setupOpen && this.fitSetup());
  }

  get isOpen(): boolean {
    return this.el.style.display !== 'none';
  }

  /** The controls pop-up is open (it takes the keys: Esc closes it, the rest do nothing). */
  get keysOpen(): boolean {
    return this.q('.g-back').classList.contains('open');
  }

  /** The race setup's drawer is open (the arrows and 0-5 work it: setupMove, setupAdjust, setupCount). */
  get setupOpen(): boolean {
    return this.el.classList.contains('setup');
  }

  /** Something over the garage (Esc closes it rather than anything else). */
  get popOpen(): boolean {
    return this.keysOpen || this.setupOpen;
  }

  /** Open on `sel`: at the title (the game's name and its start on the left, the car on the right) or in it. */
  open(sel: CarSelection, title = false): void {
    this.sel = sel;
    this.closePop();
    this.el.style.display = '';
    this.titleOn = title;
    this.el.classList.toggle('title', title);
    this.preview.slide(title ? VIEW.title : VIEW.garage, false);
    this.draw();
    this.show();
    (document.activeElement as HTMLElement | null)?.blur(); // the button that opened it must not take an Enter
  }

  /** At the title (the garage's own controls not yet shown). */
  get onTitle(): boolean {
    return this.titleOn;
  }

  /** From the title into the garage (its start button, or Enter): the car sliding to the middle, the controls in. */
  enter(): void {
    if (!this.titleOn) return;
    this.titleOn = false;
    this.el.classList.remove('title');
    this.preview.slide(VIEW.garage, true);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  close(): void {
    this.closePop();
    this.el.style.display = 'none';
    this.preview.stop();
  }

  /** Start with what is picked (a start button, or Enter): the game closes this once its fade has covered it. */
  start(): void {
    this.onStart(this.sel);
  }

  /** Close the controls pop-up and the race setup (the car back in the middle). */
  closePop(): void {
    this.q('.g-back').classList.remove('open');
    if (this.setupOpen) {
      this.el.classList.remove('setup');
      this.preview.slide(VIEW.garage, true);
    }
  }

  /** The race setup, from the right (its card, or E): the car slides left beside it, the garage's own type fades. */
  openSetup(): void {
    if (this.titleOn || this.setupOpen) return;
    this.q('.g-back').classList.remove('open');
    this.row = 0;
    this.el.classList.add('setup');
    this.preview.slide(VIEW.setup, true);
    this.draw();
    this.fitSetup();
    (document.activeElement as HTMLElement | null)?.blur();
  }

  private openKeys(): void {
    this.closePop();
    this.q('.g-back').classList.add('open');
  }

  /** ↑ ↓ step through the cars. */
  step(d: number): void {
    const i = PICKABLE.indexOf(this.sel.player);
    this.pick(PICKABLE[(i + d + PICKABLE.length) % PICKABLE.length]);
  }

  /** ← → step through the car's paint jobs. */
  stepPaint(d: number): void {
    const jobs = paintJobs(CARS[this.sel.player].style).map((j) => j.name);
    if (!jobs.length) return;
    const i = Math.max(0, jobs.indexOf(this.paintOf(this.sel.player) ?? ''));
    this.paint(jobs[(i + d + jobs.length) % jobs.length]);
  }

  /** The race setup's rows the keys walk: how many rivals, how their cars are picked, each rival (custom only), the difficulty. */
  private rowKeys(): string[] {
    const each = this.sel.rivalMode === 'custom' ? this.sel.rivals.map((_, i) => `rival${i}`) : [];
    return ['count', 'mode', ...each, 'difficulty'];
  }

  /** ↑ ↓ in the race setup: the row above or below. */
  setupMove(d: number): void {
    const n = this.rowKeys().length;
    this.row = Math.max(0, Math.min(n - 1, this.row + d));
    this.draw();
  }

  /** ← → in the race setup: the row's value down or up (how many, the rival's car, the difficulty). */
  setupAdjust(d: number): void {
    const s = this.sel;
    const key = this.rowKeys()[this.row];
    if (key === 'count') this.change(setRivalCount(s, s.rivals.length + d));
    else if (key === 'mode') {
      const k = MODES.findIndex(([m]) => m === s.rivalMode);
      this.change({ ...s, rivalMode: MODES[Math.max(0, Math.min(MODES.length - 1, k + d))][0] });
    } else if (key === 'difficulty') this.change({ ...s, difficulty: Math.max(0, Math.min(DIFFICULTIES.length - 1, s.difficulty + d)) });
    else {
      const i = Number(key.slice(5));
      const k = PICKABLE.indexOf(s.rivals[i]);
      this.change(setRival(s, i, PICKABLE[(k + d + PICKABLE.length) % PICKABLE.length]));
    }
  }

  /** 0-5 in the race setup: that many rivals. */
  setupCount(n: number): void {
    this.change(setRivalCount(this.sel, n));
  }

  private pick(id: string): void {
    if (!PICKABLE.includes(id) || id === this.sel.player) return;
    this.sel = { ...this.sel, player: id };
    this.draw();
    this.show();
  }

  private paint(name: string): void {
    if (name === this.paintOf(this.sel.player)) return;
    this.sel = { ...this.sel, paint: { ...this.sel.paint, [this.sel.player]: name } };
    this.draw();
    this.show();
  }

  /** The paint job picked for car `id` (none picked: its own, the first). */
  private paintOf(id: string): string | undefined {
    return this.sel.paint[id] ?? paintJobs(CARS[id].style)[0]?.name;
  }

  /** The picked car in its paint, in the scene. */
  private show(): void {
    this.preview.show(this.sel.player, this.paintOf(this.sel.player));
  }

  private change(sel: CarSelection): void {
    this.sel = sel;
    this.row = Math.min(this.row, this.rowKeys().length - 1);
    this.draw();
  }

  /** The rivals at a glance: at random or on the player's car (x how many), or the custom ones by car type. */
  private lineUp(): string {
    const s = this.sel;
    const n = s.rivals.length;
    const count = (ic: string, k: number) => `<span class="count">${icon(ic, 'mini')}×${k}</span>`;
    if (!n) return `<span class="count">×0</span>`;
    if (s.rivalMode === 'random') return `<span class="count">${icon('icon-random', 'dice')}隨機 ×${n}</span>`;
    if (s.rivalMode === 'same') return count(card(s.player).icon, n);
    return PICKABLE.filter((id) => s.rivals.includes(id))
      .map((id) => count(card(id).icon, s.rivals.filter((r) => r === id).length))
      .join('');
  }

  private q(sel: string): HTMLElement {
    return this.el.querySelector<HTMLElement>(sel)!;
  }

  private draw(): void {
    const s = this.sel;
    const me = card(s.player);
    this.el.style.setProperty('--accent', me.accent);
    // Left: the car types (numbered, the picked one filled).
    this.q('.g-classes').innerHTML = CAR_CARDS.map(
      (c, i) => `<button class="opt g-cls ${c.id === s.player ? 'sel' : ''}" data-id="${c.id}"><span class="no">${two(i + 1)}</span>${icon(c.icon, 'car')}<span>${c.name}</span></button>`,
    ).join('');
    this.el.querySelectorAll<HTMLElement>('.g-cls').forEach((b) => (b.onclick = () => this.pick(b.dataset.id!)));
    // Under the car: its paint jobs (a slanted swatch each).
    const picked = this.paintOf(s.player);
    const swatch = (j: PaintJob) =>
      `<button class="g-paint-job ${j.name === picked ? 'sel' : ''}" data-paint="${j.name}" style="--p:${j.paint};--s:${j.stripe ?? j.paint}"></button>`;
    this.q('.g-paints').innerHTML = paintJobs(CARS[s.player].style).map(swatch).join('');
    this.el.querySelectorAll<HTMLElement>('.g-paint-job').forEach((b) => (b.onclick = () => this.paint(b.dataset.paint!)));
    // Top: its type and place in the list, its name, its stats.
    const seg = (bar: number) => `<div class="seg">${Array.from({ length: 20 }, (_, i) => `<i class="${i < Math.round(bar * 20) ? 'on' : ''}"></i>`).join('')}</div>`;
    this.q('.g-id .tag').textContent = me.tag;
    this.q('.g-id .pos').textContent = `${two(CAR_CARDS.indexOf(me) + 1)} / ${two(CAR_CARDS.length)}`;
    this.q('.g-id h1').textContent = me.name;
    this.q('.g-stats').innerHTML = me.stats
      .map(
        (st) =>
          `<div><div class="top"><span data-tip="${st.tip}" tabindex="0">${icon(st.icon)}</span><span class="lbl">${st.label}</span></div>` +
          `<span class="v num lean">${st.value}<small>${st.unit}</small></span>${seg(st.bar)}</div>`,
      )
      .join('');
    // Bottom right: the race at a glance (the rivals, difficulty, weather), opening the setup.
    const w = WEATHERS.find(([k]) => k === s.weather)!;
    this.q('.g-race').innerHTML = html`
      <div class="head"><span class="lbl">Race setup</span><span class="edit"><kbd>E</kbd><span class="lbl">Edit ▸</span></span></div>
      <div class="row">${icon('icon-rivals')}<span class="lbl">Rivals</span><span class="val">${this.lineUp()}</span></div>
      <div class="row">${icon('icon-difficulty')}<span class="lbl">Difficulty</span><span class="val">${DIFFICULTIES[s.difficulty].name}</span></div>
      <div class="row">${icon(w[1])}<span class="lbl">Weather</span><span class="val">${w[2]}</span></div>`;
    if (this.setupOpen) this.drawSetup();
  }

  /**
   * The race setup's drawer: how many rivals (0-5), how their cars are picked (at random each race, the player's,
   * or custom: only then each rival's car, one column per car type), the difficulty, the weather; what they mean behind a "?" each.
   */
  private drawSetup(): void {
    const s = this.sel;
    const rows = this.rowKeys();
    const focus = (key: string) => (rows[this.row] === key ? 'focus' : '');
    const head = (en: string, zh: string, aside = '') => `<div class="s-head"><span class="lbl dash">${en}</span><h3>${zh}</h3><div class="aside">${aside}</div></div>`;
    const custom = s.rivalMode === 'custom' && s.rivals.length > 0;
    const body = this.q('.s-body');
    const scrolled = body.scrollTop; // (redrawn on every change: kept where it was)
    body.innerHTML = html`
      <div class="s-sec">
        ${head('Rivals', '對手', this.lineUp())}
        <div class="s-sub ${focus('count')}"><span class="lbl">數量</span><div class="s-count">${Array.from({ length: MAX_RIVALS + 1 }, (_, n) => `<button class="s-btn ${n === s.rivals.length ? 'sel' : ''}" data-n="${n}"><span>${n}</span></button>`).join('')}</div></div>
        <div class="s-sub ${focus('mode')}"><span class="lbl">車種</span><div class="s-modes">${MODES.map(([m, ic, name]) => `<button class="s-btn ${m === s.rivalMode ? 'sel' : ''}" data-mode="${m}">${icon(ic)}<span>${name}</span></button>`).join('')}</div>${help('全部隨機：每場比賽重新抽選對手的車種', '全部同我的車：對手開你的車，你換車他們也跟著換', '自由指定：逐台指定對手的車種')}</div>
        ${custom ? `<div class="mx-head"><span></span>${PICKABLE.map((id) => `<div>${id === s.player ? '<span class="you cut">YOU</span>' : ''}<span>${card(id).name}</span></div>`).join('')}<span></span></div>` : ''}
        ${(custom ? s.rivals : [])
          .map(
            (id, i) =>
              `<div class="s-rival ${focus(`rival${i}`)}" style="--c-slot:${hex(this.rivalColors[i % this.rivalColors.length])}"><span class="s-badge cut">${i + 1}</span>` +
              PICKABLE.map((c) => `<button class="s-btn s-chip ${c === id ? 'sel' : ''}" data-i="${i}" data-car="${c}" data-tip="${card(c).name}">${icon(card(c).icon, 'car')}</button>`).join('') +
              `<span class="keys"><kbd>←</kbd><kbd>→</kbd></span></div>`,
          )
          .join('')}
      </div>
      <div class="s-sec">
        ${head('Difficulty', '難度', help(...DIFFICULTIES.map((x) => `${x.name}：對手極速 ${x.speedCapKmh} km/h，${x.behind}，${x.ahead}`)))}
        <div class="s-diff-row ${focus('difficulty')}">${DIFFICULTIES.map((x, i) => `<button class="s-btn ${i === s.difficulty ? 'sel' : ''}" data-d="${i}"><span>${x.name}</span></button>`).join('')}</div>
      </div>
      <div class="s-sec">
        ${head('Weather', '天氣')}
        <div class="s-weather">${WEATHERS.map(([k, ic, name]) =>
          k === 'clear'
            ? `<button class="s-btn ${k === s.weather ? 'sel' : ''}">${icon(ic)}<span>${name}</span></button>`
            : `<button class="s-btn soon" aria-disabled="true" data-tip="即將推出">${icon(ic)}<span>${name}</span></button>`,
        ).join('')}</div>
      </div>`;
    const all = (sel: string) => this.el.querySelectorAll<HTMLElement>(`.s-body ${sel}`);
    all('[data-n]').forEach((b) => (b.onclick = () => this.setupCount(Number(b.dataset.n))));
    all('[data-mode]').forEach((b) => (b.onclick = () => this.change({ ...this.sel, rivalMode: b.dataset.mode as RivalMode })));
    all('[data-car]').forEach((b) => (b.onclick = () => this.change(setRival(this.sel, Number(b.dataset.i), b.dataset.car!))));
    all('[data-d]').forEach((b) => (b.onclick = () => this.change({ ...this.sel, difficulty: Number(b.dataset.d) })));
    body.scrollTop = scrolled;
    body.querySelector('.focus')?.scrollIntoView({ block: 'nearest' }); // (the keys' row in view, when it scrolls)
  }

  /**
   * The drawer on any screen's height (on opening, and as the window changes), always the screen's full height,
   * its start at the bottom: zoomed down to fit (no smaller than SETUP_MIN_ZOOM), below that its compact layout
   * (tighter rows), and past that its middle scrolls. Fitted to its tallest (five custom
   * rivals listed), so changing the settings never moves nor resizes it.
   */
  private fitSetup(): void {
    const wrap = this.q('.g-setup');
    const drawer = this.q('.g-drawer');
    wrap.style.setProperty('zoom', '1');
    wrap.classList.remove('compact');
    drawer.style.height = ''; // (its own height, to measure)
    const picked = this.sel;
    this.sel = { ...picked, rivalMode: 'custom', rivals: Array.from({ length: MAX_RIVALS }, () => picked.player) };
    const tallest = () => {
      this.drawSetup();
      return drawer.offsetHeight;
    };
    const avail = innerHeight - 2 * innerWidth * 0.0125; // (its margin: 1.25vw above and below)
    let z = Math.min(1, avail / tallest());
    if (z < SETUP_MIN_ZOOM) {
      wrap.classList.add('compact');
      z = Math.max(SETUP_MIN_ZOOM, Math.min(1, avail / tallest()));
    }
    this.sel = picked;
    this.drawSetup();
    wrap.style.setProperty('zoom', String(z));
    drawer.style.height = `${Math.round(avail / z)}px`; // (rounded: a float's last digit is no reason to scroll)
  }
}
