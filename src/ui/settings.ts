import { QUALITY_LEVELS, qualityAvailable, readQuality, saveQuality } from '../render/quality';
import { getLang, saveSettings, setLang, t, type Lang } from './i18n';

const html = String.raw;
/** The languages, each named in itself. */
const LANGS: [Lang, string][] = [
  ['zh', '中文'],
  ['en', 'English'],
];

/**
 * The settings pop-up (its language, its quality), over whatever opened it - the garage (its button, or O) or the
 * pause (its menu) - on a veil of its own. Nothing it sets counts till OK; it shows itself in the language picked
 * in it at once. ↑ ↓ the row, ← → its choice, Enter OK, Esc cancel (the game's keys: game.bindKeys).
 */
export class SettingsPopup {
  private readonly el: HTMLElement;
  private readonly box: HTMLElement;
  /** The language picked but not yet the game's (OK takes it; cancel drops it). */
  private pendingLang: Lang = 'zh';
  /** The quality picked (render/quality's pixel ratio; OK takes it), and the row the keys are on (0 language, 1 quality). */
  private pendingQuality = readQuality();
  private row = 0;
  /** The quality taken (OK): the game draws at it. */
  onQuality: (pixelRatio: number) => void = () => {};

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'settings';
    this.el.className = 'g-back';
    this.el.innerHTML = html`
      <div class="bracketed"><span class="brk tr"></span><span class="brk bl"></span>
      <div class="g-modal g-settings panel cut" role="dialog" aria-modal="true"></div></div>`;
    root.appendChild(this.el);
    this.box = this.el.querySelector('.g-settings')!;
    this.el.onclick = (e) => e.target === e.currentTarget && this.close();
    // A click leaves no focus behind: Enter is OK's, not the clicked button's again.
    this.el.addEventListener('click', (e) => e.detail && (document.activeElement as HTMLElement | null)?.blur());
  }

  get isOpen(): boolean {
    return this.el.classList.contains('open');
  }

  /** Open, in the accent of the screen under it (`over`: the garage's car's, or the race's). */
  open(over: HTMLElement): void {
    this.el.style.setProperty('--accent', getComputedStyle(over).getPropertyValue('--accent').trim());
    this.pendingLang = getLang();
    this.pendingQuality = readQuality();
    this.row = 0;
    this.draw();
    this.el.classList.add('open');
    (document.activeElement as HTMLElement | null)?.blur();
  }

  /** Cancel (Esc, its button, a click on the veil): nothing of it kept. */
  close(): void {
    this.el.classList.remove('open');
  }

  /** ↑ ↓: the keys onto the other row. */
  move(d: number): void {
    this.row = Math.max(0, Math.min(1, this.row + d));
    this.draw();
  }

  /**
   * ← →: the row's next choice - the other language (the pop-up in it at once, the game only on OK), or a finer or
   * coarser quality (← finer; none this screen can't show).
   */
  adjust(d: number): void {
    if (this.row === 0) {
      const i = LANGS.findIndex(([l]) => l === this.pendingLang);
      this.pendingLang = LANGS[Math.max(0, Math.min(LANGS.length - 1, i + d))][0];
    } else {
      const shown = QUALITY_LEVELS.filter((q) => qualityAvailable(q.pixelRatio, devicePixelRatio));
      const i = shown.findIndex((q) => q.pixelRatio === this.pendingQuality);
      this.pendingQuality = shown[Math.max(0, Math.min(shown.length - 1, (i < 0 ? 0 : i) + d))].pixelRatio;
    }
    this.draw();
  }

  /** OK (or Enter): the settings taken - the game into the language picked, and kept for the next visit. */
  confirm(): void {
    this.close();
    saveSettings(localStorage, { lang: this.pendingLang });
    if (this.pendingLang !== getLang()) setLang(this.pendingLang);
    if (this.pendingQuality !== readQuality()) {
      saveQuality(this.pendingQuality);
      this.onQuality(this.pendingQuality);
    }
  }

  /** Its language and quality rows (the keys' one lit; a quality this screen can't show greyed), OK and cancel. */
  private draw(): void {
    const l = this.pendingLang;
    const box = this.box;
    box.setAttribute('aria-label', t('settings.title', {}, l));
    box.innerHTML = html`
      <div class="lbl dash">${t('settings.kicker', {}, l)}</div><h2>${t('settings.title', {}, l)}</h2>
      <div class="s-sub ${this.row === 0 ? 'focus' : ''}"><span class="lbl">${t('settings.lang', {}, l)}</span><div class="s-langs">${LANGS.map(([k, name]) => `<button class="s-btn ${k === l ? 'sel' : ''}" data-lang="${k}"><span>${name}</span></button>`).join('')}</div><span class="keys"><kbd>←</kbd><kbd>→</kbd></span></div>
      <div class="s-sub ${this.row === 1 ? 'focus' : ''}"><span class="lbl">${t('settings.quality', {}, l)}</span><div class="s-quality">${QUALITY_LEVELS.map((q) => (qualityAvailable(q.pixelRatio, devicePixelRatio) ? `<button class="s-btn ${q.pixelRatio === this.pendingQuality ? 'sel' : ''}" data-quality="${q.pixelRatio}"><span>${t(q.label, {}, l)}</span></button>` : `<button class="s-btn soon" disabled><span>${t(q.label, {}, l)}</span></button>`)).join('')}</div><span class="keys"><kbd>←</kbd><kbd>→</kbd></span></div>
      <div class="btns"><button class="opt sel" data-act="ok"><span>${t('settings.ok', {}, l)}</span><kbd>Enter</kbd></button><button class="opt" data-act="cancel"><span>${t('settings.cancel', {}, l)}</span><kbd>Esc</kbd></button></div>`;
    box.querySelectorAll<HTMLElement>('[data-lang]').forEach((b) => (b.onclick = () => ((this.pendingLang = b.dataset.lang as Lang), (this.row = 0), this.draw())));
    box.querySelectorAll<HTMLElement>('[data-quality]').forEach((b) => (b.onclick = () => ((this.pendingQuality = Number(b.dataset.quality)), (this.row = 1), this.draw())));
    box.querySelector<HTMLElement>('[data-act="ok"]')!.onclick = () => this.confirm();
    box.querySelector<HTMLElement>('[data-act="cancel"]')!.onclick = () => this.close();
  }
}
