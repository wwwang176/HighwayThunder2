import { CAR_CARDS, CarSelection, MAX_RIVALS, PICKABLE, RivalMode, setRival, setRivalCount, Weather } from '../game/carSelection';
import { DIFFICULTIES } from '../game/difficulty';
import { paintJobs, type PaintJob } from '../vehicles/carModels';
import { CARS } from '../vehicles/cars';
import { GarageScene, VIEW } from './garageScene';
import { applyLang, onLangChange, t, tx, type Key } from './i18n';
import type { SettingsPopup } from './settings';
import { installTooltips } from './tooltip';
import { uiZoom } from './uiScale';
import { type TuneKey, type Tuning } from '../vehicles/tuning';
import { tunedStats } from '../vehicles/tuneEffects';

const html = String.raw;
const UI = `${import.meta.env.BASE_URL}ui/`;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const icon = (name: string, cls = '') => `<span class="icon ${cls}" style="--src:url(${UI}${name}.png)"></span>`;
const card = (id: string) => CAR_CARDS.find((c) => c.id === id) ?? CAR_CARDS[0];
const two = (n: number) => String(n).padStart(2, '0');
/** A "?" in place of an explanation: its text on hover or focus (a line per row of `lines`). */
const help = (...lines: string[]) => `<span class="help cut" tabindex="0" data-tip="${lines.join('\n')}">?</span>`;
/** The "?" of a race setup row: it opens by itself while the keys are on that row (Garage.drawSetup). */
const rowHelp = (row: string, ...lines: string[]) => help(...lines).replace('<span ', `<span data-row="${row}" `);
/** A call to action's inside (docs/ui-design.md .cta): its offset outline, its fill, the words, Enter, the chevrons. */
const CTA = (key: Key) =>
  `<span class="ghost"></span><span class="fill"></span><span class="txt">${tx(key)}<kbd>Enter</kbd><span class="chev"><b>›</b><b>›</b><b>›</b></span></span>`;
/** A car type's name, in the language now. */
const carName = (id: string) => t(`car.${id}` as Key);
/** How the rivals' cars are picked (the setup's second level: their cars listed only for the custom one). */
const MODES: [RivalMode, string][] = [
  ['random', 'icon-random'],
  ['same', 'icon-same'],
  ['custom', 'icon-rivals'],
];
const WEATHERS: [Weather, string][] = [
  ['clear', 'icon-night-clear'],
  ['rain', 'icon-night-rain'],
  ['fog', 'icon-night-fog'],
];
/** The weathers out so far (the rest shown, "coming soon"). */
const OPEN_WEATHERS: Weather[] = ['clear'];
/** A car stat's tip, by its icon. */
const STAT_TIPS: Record<string, Key> = { 'icon-accel': 'stat.accel', 'icon-topspeed': 'stat.top', 'icon-handling': 'stat.grip' };
/** The tuning panel's knobs, in their groups (src/vehicles/tuning). */
const TUNE_GROUPS: [Key, TuneKey[]][] = [
  ['tune.group.power', ['finalDrive', 'nitro']],
  ['tune.group.tyres', ['pressure', 'width', 'camber']],
  ['tune.group.aero', ['wing']],
  ['tune.group.chassis', ['springs', 'dampers', 'antiRoll']],
  ['tune.group.control', ['brakeBias', 'steering', 'esc']],
];
const TUNE_KEYS: TuneKey[] = TUNE_GROUPS.flatMap(([, keys]) => keys);
/** Keys and what they do (the controls pop-up). */
const KEYS: [string, Key][] = [
  ['W / ↑', 'keys.throttle'],
  ['S / ↓', 'keys.brake'],
  ['A D / ← →', 'keys.steer'],
  ['Shift', 'keys.nitro'],
  ['C', 'keys.look'],
  ['V', 'keys.view'],
  ['R', 'keys.reset'],
  ['I', 'keys.ai'],
  ['X', 'keys.highBeam'],
  ['Esc', 'keys.pause'],
  ['M', 'keys.mute'],
  ['N', 'keys.nextSong'],
  ['↑ ↓  ← →', 'keys.menus'],
  ['E', 'keys.setup'],
  ['T', 'keys.tune'],
  ['H', 'keys.help'],
  ['O', 'keys.settings'],
];

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
  /** The tuning panel's knob the keys are on (TUNE_KEYS). */
  private tuneRow = 0;
  /** The tuning's knob under the pointer (null: none): its ends told beside the panel instead of the keys' knob's. */
  private tuneHover: TuneKey | null = null;
  /** The race setup worked by the keys (last): the row's "?" opens by itself; by the pointer, only on hover. */
  private keyed = false;

  constructor(
    root: HTMLElement,
    private readonly rivalColors: number[],
    private readonly onStart: (sel: CarSelection) => void,
    private readonly settings: SettingsPopup,
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
        <button class="cta g-start">${CTA('title.start')}</button>
      </div>
      <div class="g-brand">${icon('emblem')}<div class="g-name">HIGHWAY THUNDER 2</div><div class="rule"></div></div>
      <div class="g-corner">
        <button class="g-keys"><kbd>H</kbd>${tx('garage.controls', 'span', 'float')}</button>
        <button class="g-opts"><kbd>O</kbd>${tx('garage.settings', 'span', 'float')}</button>
      </div>
      <div class="g-id float"><div class="pool"></div><div class="tagrow"><span class="lbl tag"></span><span class="lbl pos"></span></div><h1></h1><div class="bar-top"></div><div class="g-stats"></div></div>
      <div class="g-left">
        <div class="g-head"><span class="lbl float">Select class</span><span><kbd>↑</kbd><kbd>↓</kbd></span></div>
        <div class="g-classes"></div>
      </div>
      <div class="g-paint"><span class="lbl float">Paint</span><kbd>←</kbd><div class="g-paints"></div><kbd>→</kbd>
        <button class="g-tune-open cut"><kbd>T</kbd>${tx('garage.tune')}</button></div>
      <div class="g-tune-shade"></div>
      <div class="g-tune bracketed" role="dialog" data-t-aria="tune.title"><span class="brk tr"></span><span class="brk bl"></span>
        <div class="g-tune-panel panel cut">
          <div class="t-top">
            <div>${tx('tune.kicker', 'div', 'lbl dash')}<h2>${tx('tune.title')}</h2></div>
            <span class="t-keys"><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd></span>
          </div>
          <div class="t-body"></div>
          <div class="t-foot">
            <button class="t-reset cut"><kbd>R</kbd>${tx('tune.reset')}</button>
            <button class="t-done cut"><kbd>Esc</kbd>${tx('tune.done')}</button>
          </div>
        </div>
        <div class="t-tip-at"><div class="t-tip panel cut"><div></div><div></div></div></div>
      </div>
      <div class="t-stats float"></div>
      <div class="g-back" data-pop="tune-reset">
        <div class="bracketed"><span class="brk tr"></span><span class="brk bl"></span>
        <div class="g-modal t-confirm panel cut" role="alertdialog" aria-modal="true">
          ${tx('tune.kicker', 'div', 'lbl dash')}
          ${tx('tune.resetAsk', 'p', 'msg')}
          <div class="btns">
            <button class="opt t-yes">${tx('tune.reset')}</button>
            <button class="opt t-no">${tx('settings.cancel')}<kbd>Esc</kbd></button>
          </div>
        </div></div>
      </div>
      <div class="g-depart">
        <button class="g-race float"></button>
        <button class="cta g-go">${CTA('garage.start')}</button>
      </div>
      <div class="g-setup bracketed" role="dialog" data-t-aria="setup.title"><span class="brk tr"></span><span class="brk bl"></span>
        <div class="g-drawer panel cut">
          <div class="s-top">
            <div>${tx('setup.kicker', 'div', 'lbl dash')}${tx('setup.title', 'h2')}</div>
            <span class="s-keys"></span>
            <button class="s-back cut"><kbd>Esc</kbd>${tx('setup.close')}</button>
          </div>
          <div class="s-body"></div>
          <button class="cta s-go">${CTA('garage.start')}</button>
        </div>
      </div>
      <div class="g-back" data-pop="keys">
        <div class="bracketed"><span class="brk tr"></span><span class="brk bl"></span>
        <div class="g-modal g-keys-list panel cut" role="dialog" aria-modal="true" data-t-aria="garage.controls">
          <button class="g-close cut" data-t-tip="garage.close" data-tip-place="left">✕</button>
          <div class="lbl dash">Controls</div>
          ${KEYS.map(([k, what]) => `<div class="g-key"><kbd>${k}</kbd>${tx(what)}</div>`).join('')}
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
    this.q('.g-opts').onclick = () => this.openSettings();
    this.q('.g-close').onclick = () => this.closePop();
    this.q('.g-tune-open').onclick = () => this.openTune();
    this.q('.t-reset').onclick = () => this.tuneReset();
    this.q('.t-yes').onclick = () => this.confirmReset();
    this.q('.t-no').onclick = () => this.cancelReset();
    // As the pause's confirm: the pointer moves its cursor too.
    this.resetOpts().forEach((b, i) => b.addEventListener('pointerenter', () => this.resetPoint(i)));
    this.q('.t-done').onclick = () => this.closePop();
    // The tuning's ends beside the panel follow its row as it scrolls; the pointer gone, back to the keys' knob.
    this.q('.t-body').addEventListener('scroll', () => this.placeTip());
    this.q('.t-body').addEventListener('pointerleave', () => {
      this.tuneHover = null;
      this.placeTip();
    });
    this.el.querySelectorAll<HTMLElement>('.g-back').forEach(
      (b) => (b.onclick = (e) => e.target === e.currentTarget && (b.dataset.pop === 'tune-reset' ? this.cancelReset() : this.closePop())),
    );
    this.drawSetupKeys();
    // Another language (the settings' OK): the fixed words redone, the rest redrawn.
    onLangChange(() => {
      applyLang(this.el);
      this.drawSetupKeys();
      if (this.sel) this.draw();
    });
    addEventListener('resize', () => {
      if (this.setupOpen) this.fitSetup();
      if (this.tuneOpen) this.fitTune();
    });
    this.q('.g-setup').addEventListener('pointerdown', () => (this.keyed = false));
    // A click leaves no focus behind: Enter is the garage's (start), not the clicked button's again.
    this.el.addEventListener('click', (e) => e.detail && (document.activeElement as HTMLElement | null)?.blur());
  }

  get isOpen(): boolean {
    return this.el.style.display !== 'none';
  }

  /** The controls pop-up is open (it takes the keys: Esc closes it, the rest do nothing). */
  get keysOpen(): boolean {
    return this.q('[data-pop="keys"]').classList.contains('open');
  }

  /** The settings pop-up is open (over the garage: its keys the pop-up's, game.bindKeys). */
  get settingsOpen(): boolean {
    return this.settings.isOpen;
  }

  /** The race setup's drawer is open (the arrows and 0-5 work it: setupMove, setupAdjust, setupCount). */
  get setupOpen(): boolean {
    return this.el.classList.contains('setup');
  }

  /** The tuning panel is open (the arrows work it: tuneMove, tuneAdjust; R its stock). */
  get tuneOpen(): boolean {
    return this.el.classList.contains('tune');
  }

  /** Something over the garage (Esc closes it rather than anything else). */
  get popOpen(): boolean {
    return this.keysOpen || this.settingsOpen || this.setupOpen || this.tuneOpen;
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

  /** Close the pop-ups (the settings: cancelled, nothing of them kept) and the race setup (the car back in the middle). */
  closePop(): void {
    this.el.querySelectorAll('.g-back').forEach((b) => b.classList.remove('open'));
    this.settings.close();
    if (this.setupOpen) {
      if (this.q('.g-setup').contains(document.activeElement)) (document.activeElement as HTMLElement).blur(); // (its tip with it)
      this.el.classList.remove('setup');
      this.preview.slide(VIEW.garage, true);
    }
    if (this.tuneOpen) {
      this.el.classList.remove('tune');
      this.preview.slide(VIEW.garage, true);
    }
  }

  /** The tuning panel, on the left (its button by the paint, or T): the car slides right, the garage's own type fades. */
  openTune(): void {
    if (this.titleOn || this.tuneOpen) return;
    this.closePop();
    this.tuneRow = 0;
    this.tuneHover = null;
    this.el.classList.add('tune');
    this.preview.slide(VIEW.title, true);
    this.draw();
    this.fitTune();
    (document.activeElement as HTMLElement | null)?.blur();
  }

  /** The screen's full height, at every panel's zoom (uiZoom); its knobs scroll past that. */
  private fitTune(): void {
    const panel = this.q('.g-tune-panel');
    const z = uiZoom();
    panel.style.height = `${Math.floor((innerHeight - 2 * innerWidth * 0.0125 * z) / z)}px`; // (in its own px; its margin: 1.25vw above and below)
    this.q('.t-body .focus')?.scrollIntoView({ block: 'nearest' });
    this.placeTip();
  }

  /** The stock confirm is open (Enter: back to stock; Esc: not). */
  get resetAsking(): boolean {
    return this.q('[data-pop="tune-reset"]').classList.contains('open');
  }

  /** Esc in the garage: the stock confirm cancelled, else what is open closed. */
  back(): void {
    if (this.resetAsking) this.cancelReset();
    else this.closePop();
  }

  /** T in the garage: the tuning panel, or closed again. */
  toggleTune(): void {
    if (this.tuneOpen) this.closePop();
    else this.openTune();
  }

  /** ↑ ↓ in the tuning panel: the knob above or below. */
  tuneMove(d: number): void {
    this.tuneHover = null; // (the keys' knob told, not the one the pointer was left on)
    this.tuneRow = Math.max(0, Math.min(TUNE_KEYS.length - 1, this.tuneRow + d));
    this.draw();
  }

  /** ← → in the tuning panel: the knob a step toward its left or its right end. */
  tuneAdjust(d: number): void {
    const key = TUNE_KEYS[this.tuneRow];
    this.tuneHover = null;
    this.setKnob(key, (this.tuning()[key] ?? 0) + d);
  }

  /** R in the tuning panel (or its button): asked first - the car as built (nothing to ask when it is); as the pause's confirm, the cursor on Cancel. */
  tuneReset(): void {
    if (!this.tuneOpen || this.resetAsking || !Object.keys(this.tuning()).length) return;
    this.q('[data-pop="tune-reset"]').classList.add('open');
    this.resetPoint(1);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  /** The stock confirm's options (OK, Cancel); the cursor on one: filled (.sel). */
  private resetOpts(): HTMLElement[] {
    return [this.q('.t-yes'), this.q('.t-no')];
  }

  private resetCursor = 1;

  private resetPoint(i: number): void {
    this.resetCursor = i;
    this.resetOpts().forEach((b, k) => b.classList.toggle('sel', k === i));
  }

  /** The arrows in the stock confirm: the cursor to the other option. */
  resetMove(d: number): void {
    this.resetPoint((this.resetCursor + d + 2) % 2);
  }

  /** Enter in the stock confirm: the option under the cursor. */
  resetPick(): void {
    this.resetOpts()[this.resetCursor].click();
  }

  /** The stock confirm's OK: every knob of the car back to stock. */
  confirmReset(): void {
    this.cancelReset();
    this.sel = { ...this.sel, tuning: { ...this.sel.tuning, [this.sel.player]: {} } };
    this.draw();
  }

  cancelReset(): void {
    this.q('[data-pop="tune-reset"]').classList.remove('open');
  }

  /** The picked car's tuning. */
  private tuning(): Tuning {
    return this.sel.tuning[this.sel.player] ?? {};
  }

  private setKnob(key: TuneKey, level: number): void {
    const v = Math.max(-2, Math.min(2, level));
    const knobs: Tuning = { ...this.tuning() };
    if (v === 0) delete knobs[key];
    else knobs[key] = v;
    this.sel = { ...this.sel, tuning: { ...this.sel.tuning, [this.sel.player]: knobs } };
    this.draw();
  }

  /** The race setup, from the right (its card, or E): the car slides left beside it, the garage's own type fades. */
  openSetup(): void {
    if (this.titleOn || this.setupOpen) return;
    this.closePop();
    this.row = 0;
    this.el.classList.add('setup');
    this.preview.slide(VIEW.setup, true);
    this.draw();
    this.fitSetup();
    (document.activeElement as HTMLElement | null)?.blur();
  }

  private openKeys(): void {
    this.closePop();
    this.q('[data-pop="keys"]').classList.add('open');
  }

  /** The settings pop-up (its button, or O): over the garage, nothing it sets counting till OK. */
  openSettings(): void {
    if (this.titleOn) return;
    this.closePop();
    this.settings.open(this.el);
  }

  /** O in the garage: the settings, or cancelled again. */
  toggleSettings(): void {
    if (this.settingsOpen) this.closePop();
    else this.openSettings();
  }

  /** The race setup's "?" of its keys, in the language now. */
  private drawSetupKeys(): void {
    this.q('.s-keys').innerHTML = help(t('setup.keys.move'), t('setup.keys.adjust'), t('setup.keys.count'), t('setup.keys.start'), t('setup.keys.close'));
  }

  /** H in the garage: the controls pop-up, or closed again. */
  toggleKeys(): void {
    if (this.titleOn) return;
    if (this.keysOpen) this.closePop();
    else this.openKeys();
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

  /** The race setup's rows the keys walk: how many rivals, how their cars are picked, each rival (custom only), the difficulty, the weather. */
  private rowKeys(): string[] {
    const each = this.sel.rivalMode === 'custom' ? this.sel.rivals.map((_, i) => `rival${i}`) : [];
    return ['count', 'mode', ...each, 'difficulty', 'weather'];
  }

  /** ↑ ↓ in the race setup: the row above or below. */
  setupMove(d: number): void {
    const n = this.rowKeys().length;
    this.keyed = true;
    this.row = Math.max(0, Math.min(n - 1, this.row + d));
    this.draw();
  }

  /** ← → in the race setup: the row's value down or up (how many, the mode, the rival's car, the difficulty, the weather). */
  setupAdjust(d: number): void {
    const s = this.sel;
    const key = this.rowKeys()[this.row];
    this.keyed = true;
    if (key === 'weather') {
      const open = WEATHERS.filter(([k]) => OPEN_WEATHERS.includes(k)).map(([k]) => k); // (the ones out so far)
      const k = open.indexOf(s.weather);
      this.change({ ...s, weather: open[Math.max(0, Math.min(open.length - 1, k + d))] });
    } else if (key === 'count') this.change(setRivalCount(s, s.rivals.length + d));
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
    this.keyed = true;
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
    if (s.rivalMode === 'random') return `<span class="count">${icon('icon-random', 'dice')}${t('garage.randomCount', { n })}</span>`;
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
      (c, i) => `<button class="opt g-cls ${c.id === s.player ? 'sel' : ''}" data-id="${c.id}"><span class="no">${two(i + 1)}</span>${icon(c.icon, 'car')}<span>${carName(c.id)}</span></button>`,
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
    this.q('.g-id .tag').textContent = t(`tag.${me.id}` as Key);
    this.q('.g-id .pos').textContent = `${two(CAR_CARDS.indexOf(me) + 1)} / ${two(CAR_CARDS.length)}`;
    this.q('.g-id h1').textContent = carName(me.id);
    this.q('.g-stats').innerHTML = me.stats
      .map(
        (st) =>
          `<div><div class="top"><span data-tip="${t(STAT_TIPS[st.icon])}" tabindex="0">${icon(st.icon)}</span><span class="lbl">${st.label}</span></div>` +
          `<span class="v num lean">${st.value}<small>${st.unit === 's' ? t('unit.s') : st.unit}</small></span>${seg(st.bar)}</div>`,
      )
      .join('');
    // Bottom right: the race at a glance (the rivals, difficulty, weather), opening the setup.
    const w = WEATHERS.find(([k]) => k === s.weather)!;
    this.q('.g-race').innerHTML = html`
      <div class="head"><span class="lbl">Race setup</span><span class="edit"><kbd>E</kbd><span class="lbl">Edit ▸</span></span></div>
      <div class="row">${icon('icon-rivals')}<span class="lbl">Rivals</span><span class="val">${this.lineUp()}</span></div>
      <div class="row">${icon('icon-difficulty')}<span class="lbl">Difficulty</span><span class="val">${t(`diff.${s.difficulty}` as Key)}</span></div>
      <div class="row">${icon(w[1])}<span class="lbl">Weather</span><span class="val">${t(`weather.${w[0]}` as Key)}</span></div>`;
    if (this.setupOpen) this.drawSetup();
    if (this.tuneOpen) this.drawTune();
  }

  /**
   * The tuning panel: the car's stats as tuned (its three, each with what the tuning changes), then its knobs in
   * their groups - five steps each, stock in the middle; the keys' knob shows what its two ends do.
   */
  private drawTune(): void {
    const s = this.sel;
    const me = card(s.player);
    const knobs = this.tuning();
    // Stats: as built and the tuning's change (0-100 s, top speed km/h, grip g).
    const d = tunedStats(s.player, knobs);
    const change = [d.t100, d.vTop, d.grip];
    const better = [d.t100 < 0, d.vTop > 0, d.grip > 0];
    const digits = [2, 0, 2];
    this.q('.t-stats').innerHTML =
      '<div class="pool"></div>' +
      me.stats
        .map((st, i) => {
          const v = Number(st.value) + change[i];
          const moved = Math.abs(change[i]) >= (i === 1 ? 0.5 : 0.005);
          const ch = `<span class="ch ${moved ? (better[i] ? 'up' : 'down') : ''}">${moved ? `${change[i] > 0 ? '+' : '−'}${Math.abs(change[i]).toFixed(digits[i])}` : ''}</span>`;
          return `<div class="t-stat"><div class="top">${icon(st.icon)}<span class="lbl">${st.label}</span></div><span class="v num lean">${v.toFixed(digits[i])}<small>${st.unit === 's' ? t('unit.s') : st.unit}</small></span>${ch}</div>`;
        })
        .join('');
    // The knobs.
    const row = TUNE_KEYS[this.tuneRow];
    this.q('.t-body').innerHTML = TUNE_GROUPS.map(
      ([group, keys]) =>
        `<div class="t-group"><div class="lbl dash">${t(group)}</div>` +
        keys
          .map((key) => {
            const level = knobs[key] ?? 0;
            const pips = [-2, -1, 0, 1, 2]
              .map((n) => `<button class="t-pip ${n === 0 ? 'mid' : ''} ${n === level ? 'sel' : ''} ${n !== 0 && Math.sign(n) === Math.sign(level) && Math.abs(n) <= Math.abs(level) ? 'on' : ''}" data-key="${key}" data-level="${n}"></button>`)
              .join('');
            return `<div class="t-row ${key === row ? 'focus' : ''}" data-row="${key}"><span class="t-name">${t(`tune.${key}` as Key)}</span><div class="t-pips">${pips}</div><span class="t-val num">${level === 0 ? t('tune.stock') : (level > 0 ? '+' : '−') + Math.abs(level)}</span><div class="t-space"></div></div>`;
          })
          .join('') +
        '</div>',
    ).join('');
    this.el.querySelectorAll<HTMLElement>('.t-pip').forEach(
      (b) =>
        (b.onclick = () => {
          this.tuneRow = TUNE_KEYS.indexOf(b.dataset.key as TuneKey);
          this.setKnob(b.dataset.key as TuneKey, Number(b.dataset.level));
        }),
    );
    this.el.querySelectorAll<HTMLElement>('.t-row').forEach((r) => {
      r.addEventListener('pointerdown', () => {
        const i = TUNE_KEYS.indexOf(r.dataset.row as TuneKey);
        if (i !== this.tuneRow) {
          this.tuneRow = i;
          this.draw();
        }
      });
      r.addEventListener('pointerenter', () => {
        this.tuneHover = r.dataset.row as TuneKey;
        this.placeTip();
      });
    });
    this.q('.t-body .focus')?.scrollIntoView({ block: 'nearest' });
    this.placeTip();
  }

  /**
   * The knob's two ends told beside the panel, level with its row: the one under the pointer, else the keys' one
   * (hidden while that row is scrolled out of the panel's view).
   */
  private placeTip(): void {
    const at = this.q('.t-tip-at');
    const key = this.tuneHover ?? TUNE_KEYS[this.tuneRow];
    const row = this.q(`.t-row[data-row="${key}"]`);
    if (!this.tuneOpen || !row) return void at.classList.remove('on');
    const [l, r] = at.querySelectorAll<HTMLElement>('.t-tip > div');
    l.textContent = `◀ ${t(`tune.${key}.l` as Key)}`;
    r.textContent = `▶ ${t(`tune.${key}.r` as Key)}`;
    const box = row.getBoundingClientRect();
    const view = this.q('.t-body').getBoundingClientRect();
    const mid = box.top + box.height / 2;
    at.style.top = `${(mid - this.q('.g-tune').getBoundingClientRect().top) / uiZoom()}px`; // (in the panel's own px)
    at.classList.toggle('on', mid >= view.top && mid <= view.bottom);
  }

  /**
   * The race setup's drawer: how many rivals (0-5), how their cars are picked (at random each race, the player's,
   * or custom: only then each rival's car, one column per car type), the difficulty, the weather; what they mean behind a "?" each.
   */
  private drawSetup(): void {
    const s = this.sel;
    const rows = this.rowKeys();
    const focus = (key: string) => (rows[this.row] === key ? 'focus' : '');
    const head = (kicker: Key, title: Key, aside = '') => `<div class="s-head"><span class="lbl dash">${t(kicker)}</span><h3>${t(title)}</h3><div class="aside">${aside}</div></div>`;
    const custom = s.rivalMode === 'custom' && s.rivals.length > 0;
    const body = this.q('.s-body');
    const scrolled = body.scrollTop; // (redrawn on every change: kept where it was)
    body.innerHTML = html`
      <div class="s-sec">
        ${head('setup.rivals.kicker', 'setup.rivals', this.lineUp())}
        <div class="s-sub ${focus('count')}"><span class="lbl">${t('setup.count')}</span><div class="s-count">${Array.from({ length: MAX_RIVALS + 1 }, (_, n) => `<button class="s-btn ${n === s.rivals.length ? 'sel' : ''}" data-n="${n}"><span>${n}</span></button>`).join('')}</div></div>
        <div class="s-sub ${focus('mode')}"><span class="lbl">${t('setup.mode')}</span><div class="s-modes">${MODES.map(([m, ic]) => `<button class="s-btn ${m === s.rivalMode ? 'sel' : ''}" data-mode="${m}">${icon(ic)}<span>${t(`mode.${m}`)}</span></button>`).join('')}</div>${rowHelp('mode', ...MODES.map(([m]) => t(`mode.help.${m}`)))}</div>
        ${custom ? `<div class="mx-head"><span></span>${PICKABLE.map((id) => `<div>${id === s.player ? '<span class="you cut">YOU</span>' : ''}<span>${carName(id)}</span></div>`).join('')}<span></span></div>` : ''}
        ${(custom ? s.rivals : [])
          .map(
            (id, i) =>
              `<div class="s-rival ${focus(`rival${i}`)}" style="--c-slot:${hex(this.rivalColors[i % this.rivalColors.length])}"><span class="s-badge cut">${i + 1}</span>` +
              PICKABLE.map((c) => `<button class="s-btn s-chip ${c === id ? 'sel' : ''}" data-i="${i}" data-car="${c}" data-tip="${carName(c)}">${icon(card(c).icon, 'car')}</button>`).join('') +
              `<span class="keys"><kbd>←</kbd><kbd>→</kbd></span></div>`,
          )
          .join('')}
      </div>
      <div class="s-sec">
        ${head('setup.difficulty.kicker', 'setup.difficulty', rowHelp('difficulty', ...DIFFICULTIES.map((d, i) => `${t(`diff.${i}` as Key)}：${t(`diff.hint.${i}` as Key, { pct: Math.round(d.topShare * 100) })}`), t('diff.hint.band')))}
        <div class="s-diff-row ${focus('difficulty')}">${DIFFICULTIES.map((_, i) => `<button class="s-btn ${i === s.difficulty ? 'sel' : ''}" data-d="${i}"><span>${t(`diff.${i}` as Key)}</span></button>`).join('')}</div>
      </div>
      <div class="s-sec">
        ${head('setup.weather.kicker', 'setup.weather')}
        <div class="s-weather ${focus('weather')}">${WEATHERS.map(([k, ic]) =>
          OPEN_WEATHERS.includes(k)
            ? `<button class="s-btn ${k === s.weather ? 'sel' : ''}" data-w="${k}">${icon(ic)}<span>${t(`weather.${k}`)}</span></button>`
            : `<button class="s-btn soon" aria-disabled="true" data-tip="${t('weather.soon')}">${icon(ic)}<span>${t(`weather.${k}`)}</span></button>`,
        ).join('')}</div>
      </div>`;
    const all = (sel: string) => this.el.querySelectorAll<HTMLElement>(`.s-body ${sel}`);
    all('[data-n]').forEach((b) => (b.onclick = () => this.setupCount(Number(b.dataset.n))));
    all('[data-mode]').forEach((b) => (b.onclick = () => this.change({ ...this.sel, rivalMode: b.dataset.mode as RivalMode })));
    all('[data-car]').forEach((b) => (b.onclick = () => this.change(setRival(this.sel, Number(b.dataset.i), b.dataset.car!))));
    all('[data-d]').forEach((b) => (b.onclick = () => this.change({ ...this.sel, difficulty: Number(b.dataset.d) })));
    all('[data-w]').forEach((b) => (b.onclick = () => this.change({ ...this.sel, weather: b.dataset.w as Weather })));
    body.scrollTop = scrolled;
    // Worked by the keys: the row's "?" open (focused: its tip shows), any other let go.
    const rowTip = this.keyed ? body.querySelector<HTMLElement>(`.help[data-row="${rows[this.row]}"]`) : null;
    if (rowTip) rowTip.focus({ preventScroll: true });
    else if ((document.activeElement as HTMLElement | null)?.classList.contains('help')) (document.activeElement as HTMLElement).blur();
    body.querySelector('.focus')?.scrollIntoView({ block: 'nearest' }); // (the keys' row in view, when it scrolls)
  }

  /**
   * The drawer on any screen's height (on opening, and as the window changes), always the screen's full height,
   * its start at the bottom, at every panel's zoom (uiZoom): if its tallest (five custom rivals listed) does not
   * fit, its compact layout (tighter rows), and past that its middle scrolls. Fitted to its tallest, so changing
   * the settings never moves nor resizes it.
   */
  private fitSetup(): void {
    const wrap = this.q('.g-setup');
    const drawer = this.q('.g-drawer');
    wrap.classList.remove('compact');
    drawer.style.height = ''; // (its own height, to measure)
    const picked = this.sel;
    this.sel = { ...picked, rivalMode: 'custom', rivals: Array.from({ length: MAX_RIVALS }, () => picked.player) };
    this.drawSetup();
    const z = uiZoom();
    const avail = (innerHeight - 2 * innerWidth * 0.0125 * z) / z; // (in its own px; its margin: 1.25vw above and below)
    if (drawer.offsetHeight > avail) wrap.classList.add('compact');
    this.sel = picked;
    this.drawSetup();
    drawer.style.height = `${Math.floor(avail)}px`; // (rounded down: a float's last digit is no reason to scroll)
  }
}
