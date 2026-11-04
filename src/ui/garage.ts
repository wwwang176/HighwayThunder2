import {
  addRival,
  allRandom,
  allSameAsPlayer,
  CAR_CARDS,
  CarSelection,
  MAX_RIVALS,
  PICKABLE,
  removeRival,
  Weather,
} from '../game/carSelection';
import { DIFFICULTIES } from '../game/difficulty';
import { paintJobs, type PaintJob } from '../vehicles/carModels';
import { CARS } from '../vehicles/cars';
import { GarageScene } from './garageScene';
import { installTooltips } from './tooltip';

const html = String.raw;
const UI = `${import.meta.env.BASE_URL}ui/`;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const icon = (name: string, cls = '') => `<span class="icon ${cls}" style="--src:url(${UI}${name}.png)"></span>`;
const card = (id: string) => CAR_CARDS.find((c) => c.id === id) ?? CAR_CARDS[0];
/** A call to action's inside (docs/ui-design.md .cta): its offset outline, its fill, the words, Enter, the chevrons. */
const CTA = (text: string) =>
  `<span class="ghost"></span><span class="fill"></span><span class="txt">${text}<kbd>Enter</kbd><span class="chev"><b>›</b><b>›</b><b>›</b></span></span>`;
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

/**
 * The garage: the car to race in (parked on a wet lay-by at night, drawn live: garageScene.ts),
 * its measured stats, the race at a glance (rivals by car type, difficulty,
 * weather) with a pop-up to change it, and the start. No explanatory text:
 * icons, with their meaning on hover / focus (data-tip). The game opens on its title: the same scene, the car
 * on the right, the game's name and a start on the left, none of the garage's controls (enter() brings them).
 */
export class Garage {
  private readonly el: HTMLElement;
  private sel!: CarSelection;
  private readonly preview: GarageScene;
  private readonly backdrop: HTMLElement;
  private titleOn = false;

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
      <div class="g-title">
        <div class="g-title-name">${icon('emblem')}<h1>HIGHWAY<br>THUNDER 2</h1><div class="rule"></div></div>
        <button class="cta g-start">${CTA('開始遊戲')}</button>
      </div>
      <div class="g-brand">${icon('emblem')}<div class="g-name">HIGHWAY THUNDER 2</div><div class="rule"></div></div>
      <button class="g-keys panel cut" data-tip="操作說明" data-tip-place="left">${icon('icon-keys')}</button>
      <div class="g-left">
        <div class="g-head"><span class="lbl">Select class</span><span><kbd>↑</kbd><kbd>↓</kbd></span></div>
        <div class="g-classes"></div>
        <div class="g-head"><span class="lbl">Paint</span><span><kbd>←</kbd><kbd>→</kbd></span></div>
        <div class="g-paints"></div>
      </div>
      <div class="g-spec-wrap bracketed"><span class="brk tr"></span><span class="brk bl"></span><div class="g-spec panel cut"></div></div>
      <div class="g-depart">
        <button class="g-race panel cut" data-tip="修改比賽設定" data-tip-place="left"></button>
        <button class="cta g-go">${CTA('開始比賽')}</button>
      </div>
      <div class="g-back" data-pop="race">
        <div class="bracketed"><span class="brk tr"></span><span class="brk bl"></span>
        <div class="g-modal panel cut" role="dialog" aria-modal="true" aria-label="比賽設定">
          <button class="g-close cut" data-tip="關閉" data-tip-place="left">✕</button>
          <div class="lbl dash">Race setup</div>
          <div class="g-row">${icon('icon-rivals')}<div class="g-rival-row">
            <div class="g-tools">
              <button class="g-tool cut" data-act="random" data-tip="對手全部隨機">${icon('icon-random')}</button>
              <button class="g-tool cut" data-act="same" data-tip="對手全部和我同車種" data-tip-place="bottom">${icon('icon-same')}</button>
            </div>
            <div class="g-slots"></div>
          </div></div>
          <div class="g-row">${icon('icon-difficulty')}<div class="g-seg" data-seg="difficulty"></div></div>
          <div class="g-row">${icon('icon-night-clear')}<div class="g-seg" data-seg="weather"></div></div>
          <button class="g-done"><span>完成</span></button>
        </div></div>
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
    this.backdrop = this.el;
    // The section icons of the race pop-up say what they are on hover.
    const rows = this.el.querySelectorAll<HTMLElement>('.g-row > .icon');
    ['對手', '難易度', '天氣'].forEach((tip, i) => {
      rows[i].dataset.tip = tip;
      rows[i].tabIndex = 0;
    });
    installTooltips(this.el);
    this.preview = new GarageScene(this.el.querySelector('.g-car')!);
    this.q('.g-go').onclick = () => this.start();
    this.q('.g-start').onclick = () => this.enter();
    this.q('.g-race').onclick = () => this.openPop('race');
    this.q('.g-keys').onclick = () => this.openPop('keys');
    this.el.querySelectorAll<HTMLElement>('.g-close, .g-done').forEach((b) => (b.onclick = () => this.closePop()));
    this.el.querySelectorAll<HTMLElement>('.g-back').forEach((b) => (b.onclick = (e) => e.target === b && this.closePop()));
    this.q('[data-act="random"]').onclick = () => this.change(allRandom(this.sel, Math.random));
    this.q('[data-act="same"]').onclick = () => this.change(allSameAsPlayer(this.sel));
  }

  get isOpen(): boolean {
    return this.el.style.display !== 'none';
  }

  /** A pop-up is open (Esc closes it rather than anything else). */
  get popOpen(): boolean {
    return !!this.el.querySelector('.g-back.open');
  }

  /** Open on `sel`: at the title (the game's name and its start on the left, the car on the right) or in it. */
  open(sel: CarSelection, title = false): void {
    this.sel = sel;
    this.closePop();
    this.el.style.display = '';
    this.titleOn = title;
    this.el.classList.toggle('title', title);
    this.preview.slide(title, false);
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
    this.preview.slide(false, true);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  close(): void {
    this.closePop();
    this.el.style.display = 'none';
    this.preview.stop();
  }

  /** Start with what is picked (the start button, or Enter): the game closes this once its fade has covered it. */
  start(): void {
    this.closePop();
    this.onStart(this.sel);
  }

  closePop(): void {
    this.el.querySelectorAll('.g-back.open').forEach((b) => b.classList.remove('open'));
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
    this.draw();
  }

  private openPop(which: string): void {
    this.closePop();
    this.q(`[data-pop="${which}"]`).classList.add('open');
  }

  private q(sel: string): HTMLElement {
    return this.el.querySelector<HTMLElement>(sel)!;
  }

  private draw(): void {
    const s = this.sel;
    const me = card(s.player);
    this.backdrop.style.setProperty('--accent', me.accent);
    // Left, what to change: the car types (numbered, the picked one filled), its paint jobs (a slanted swatch each).
    this.q('.g-classes').innerHTML = CAR_CARDS.map(
      (c, i) =>
        `<button class="opt g-cls ${c.id === s.player ? 'sel' : ''}" data-id="${c.id}"><span class="no">${String(i + 1).padStart(2, '0')}</span>` +
        `${icon(c.icon, 'car')}<span>${c.name}</span></button>`,
    ).join('');
    this.el.querySelectorAll<HTMLElement>('.g-cls').forEach((b) => (b.onclick = () => this.pick(b.dataset.id!)));
    const picked = this.paintOf(s.player);
    const swatch = (j: PaintJob) =>
      `<button class="g-paint ${j.name === picked ? 'sel' : ''}" data-paint="${j.name}" ` +
      `style="--p:${j.paint};--s:${j.stripe ?? j.paint}"></button>`;
    this.q('.g-paints').innerHTML = paintJobs(CARS[s.player].style).map(swatch).join('');
    this.el.querySelectorAll<HTMLElement>('.g-paint').forEach((b) => (b.onclick = () => this.paint(b.dataset.paint!)));
    // Right, what to read: its type and place in the list, its name big, its stats on segmented bars.
    const seg = (bar: number) => `<div class="seg">${Array.from({ length: 20 }, (_, i) => `<i class="${i < Math.round(bar * 20) ? 'on' : ''}"></i>`).join('')}</div>`;
    const at = CAR_CARDS.indexOf(me) + 1;
    this.q('.g-spec').innerHTML =
      `<div class="head"><span class="lbl">${me.tag}</span><span class="lbl pos">${String(at).padStart(2, '0')} / ${String(CAR_CARDS.length).padStart(2, '0')}</span></div>` +
      `<h1>${me.name}</h1><div class="bar-top"></div>` +
      me.stats
        .map(
          (st) =>
            `<div class="g-stat"><span data-tip="${st.tip}" data-tip-place="left" tabindex="0">${icon(st.icon)}</span><div>` +
            `<div class="row"><span class="lbl">${st.label}</span><span class="v num">${st.value}<small>${st.unit}</small></span></div>${seg(st.bar)}</div></div>`,
        )
        .join('');
    // The race at a glance: the rivals by car type (silhouette x how many), difficulty, weather.
    const lineUp = PICKABLE.filter((id) => s.rivals.includes(id))
      .map((id) => `<span class="count" data-tip="${CARS[id].name}">${icon(card(id).icon, 'mini')}×${s.rivals.filter((r) => r === id).length}</span>`)
      .join('');
    const w = WEATHERS.find(([k]) => k === s.weather)!;
    this.q('.g-race').innerHTML = html`
      <div class="head"><span class="lbl">Race setup</span><span class="lbl edit">Edit ▸</span></div>
      <div class="row ${lineUp ? '' : 'none'}">${icon('icon-rivals')}<span class="lbl">Rivals</span><span class="val">${lineUp || '<span class="count">×0</span>'}</span></div>
      <div class="row">${icon('icon-difficulty')}<span class="lbl">Difficulty</span><span class="val">${DIFFICULTIES[s.difficulty].name}</span></div>
      <div class="row">${icon(w[1])}<span class="lbl">Weather</span><span class="val">${w[2]}</span></div>`;
    // The race pop-up: rivals from the left (number and colour by place), one + while there is room.
    this.q('.g-slots').innerHTML =
      s.rivals
        .map(
          (id, i) =>
            `<div class="g-slot cut" style="--c-slot:${hex(this.rivalColors[i % this.rivalColors.length])}"><span class="no">${i + 1}</span>` +
            `<button class="remove cut" data-i="${i}" data-tip="移除對手">✕</button><button class="arrow" data-i="${i}" data-d="-1">◀</button>` +
            `<div class="mid">${icon(card(id).icon, 'car')}<div class="name">${CARS[id].name}</div></div><button class="arrow" data-i="${i}" data-d="1">▶</button></div>`,
        )
        .join('') + (s.rivals.length < MAX_RIVALS ? `<button class="g-slot empty" data-tip="加入對手">＋</button>` : '');
    this.el.querySelectorAll<HTMLElement>('.g-slot .arrow').forEach(
      (a) =>
        (a.onclick = () => {
          const i = Number(a.dataset.i);
          const k = PICKABLE.indexOf(s.rivals[i]);
          const rivals = [...s.rivals];
          rivals[i] = PICKABLE[(k + Number(a.dataset.d) + PICKABLE.length) % PICKABLE.length];
          this.change({ ...s, rivals });
        }),
    );
    this.el.querySelectorAll<HTMLElement>('.g-slot .remove').forEach((b) => (b.onclick = () => this.change(removeRival(s, Number(b.dataset.i)))));
    this.el.querySelectorAll<HTMLElement>('.g-slot.empty').forEach((b) => (b.onclick = () => this.change(addRival(s))));
    this.q('[data-seg="difficulty"]').innerHTML = DIFFICULTIES.map((d, i) => `<button class="${i === s.difficulty ? 'sel' : ''}" data-i="${i}"><span>${d.name}</span></button>`).join('');
    this.el.querySelectorAll<HTMLElement>('[data-seg="difficulty"] button').forEach((b) => (b.onclick = () => this.change({ ...s, difficulty: Number(b.dataset.i) })));
    // Only the clear night for now. aria-disabled, not disabled: a disabled button gets no mouse events, so its tip would never show.
    this.q('[data-seg="weather"]').innerHTML = WEATHERS.map(
      ([k, ic, name]) => `<button class="${k === s.weather ? 'sel' : ''}" ${k === 'clear' ? '' : 'aria-disabled="true" data-tip="即將推出"'}>${icon(ic)}<span>${name}</span></button>`,
    ).join('');
  }
}
