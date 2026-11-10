/**
 * The song playing, top right (garage and race alike): its title in a narrow box; one too long for it slides
 * across and back, pausing at each end, round and round.
 */
export class NowPlaying {
  private readonly el: HTMLDivElement;
  private readonly box: HTMLDivElement;
  private readonly text: HTMLSpanElement;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'now-playing';
    this.el.innerHTML = '<span class="np-note">♪</span><div class="np-box"><span class="np-text"></span></div>';
    this.box = this.el.querySelector('.np-box')!;
    this.text = this.el.querySelector('.np-text')!;
    root.appendChild(this.el);
    addEventListener('resize', () => this.fit()); // (sized in vw: a resize changes what fits)
  }

  /** `title` playing now (null: none - hidden). */
  show(title: string | null): void {
    this.el.classList.toggle('on', !!title);
    this.text.textContent = title ?? '';
    requestAnimationFrame(() => this.fit()); // (measured once laid out)
  }

  /** Too long for its box: slides by what does not fit, at NP_SPEED px/s (and back), from its start again. */
  private fit(): void {
    const over = this.text.scrollWidth - this.box.clientWidth;
    this.box.classList.remove('scroll');
    if (over <= 1) return;
    this.text.style.setProperty('--shift', `${-over}px`);
    this.text.style.animationDuration = `${NP_PAUSES + (2 * over) / NP_SPEED}s`;
    void this.text.offsetWidth; // (restart the slide from the start)
    this.box.classList.add('scroll');
  }
}

/** px/s it slides at; s it rests at its ends in all (the keyframes' 0-15 % and 50-65 %: about 30 % of the run). */
const NP_SPEED = 30;
const NP_PAUSES = 3;
