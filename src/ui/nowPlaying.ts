/**
 * The song playing: its title in a narrow box (one too long for it slides across and back, pausing at each end),
 * and how far into it / how long it is. Shown in each of its places at once - in the race under the place (in the
 * HUD: it shakes with it), in the garage under the controls and settings buttons - each seen with its screen.
 */
export class NowPlaying {
  private readonly slots: { el: HTMLDivElement; box: HTMLDivElement; text: HTMLSpanElement; time: HTMLSpanElement }[];
  private shown = '';

  constructor(parents: HTMLElement[]) {
    this.slots = parents.map((parent) => {
      const el = document.createElement('div');
      el.className = 'now-playing float';
      el.innerHTML = '<span class="np-note">♪</span><div class="np-box"><span class="np-text"></span></div><span class="np-time num"></span>';
      parent.appendChild(el);
      return { el, box: el.querySelector('.np-box')!, text: el.querySelector('.np-text')!, time: el.querySelector('.np-time')! };
    });
    addEventListener('resize', () => this.fitAll()); // (sized in vw: a resize changes what fits)
  }

  /** `title` playing now (null: none - hidden). */
  show(title: string | null): void {
    for (const s of this.slots) {
      s.el.classList.toggle('on', !!title);
      s.text.textContent = title ?? '';
    }
    this.shown = '';
    requestAnimationFrame(() => this.fitAll()); // (measured once laid out; a hidden one when it shows: see time())
  }

  /** How far into the song and how long it is (s; NaN: not known yet). */
  time(at: number, length: number): void {
    const text = `${clock(at)} / ${clock(length)}`;
    if (text === this.shown) return;
    this.shown = text;
    for (const s of this.slots) {
      s.time.textContent = text;
      // (a place that was out of sight when the song came on - the garage's in the race - is measured once seen)
      if (s.box.dataset.fit !== s.text.textContent && s.el.offsetParent) this.fit(s);
    }
  }

  private fitAll(): void {
    for (const s of this.slots) this.fit(s);
  }

  /** Too long for its box: slides by what does not fit (and back), from its start again. */
  private fit(s: (typeof this.slots)[number]): void {
    s.box.classList.remove('scroll');
    if (!s.el.offsetParent) return; // (out of sight: nothing to measure)
    s.box.dataset.fit = s.text.textContent ?? '';
    const over = s.text.scrollWidth - s.box.clientWidth;
    if (over <= 1) return;
    s.text.style.setProperty('--shift', `${-over}px`);
    s.text.style.animationDuration = `${NP_PAUSES + (2 * over) / NP_SPEED}s`;
    void s.text.offsetWidth; // (restart the slide from the start)
    s.box.classList.add('scroll');
  }
}

/** m:ss (-:-- not known). */
export function clock(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '-:--';
  const t = Math.floor(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/** About px/s it slides at; s it rests at its ends in all (the keyframes' 0-15 % and 50-65 %). */
const NP_SPEED = 30;
const NP_PAUSES = 3;
