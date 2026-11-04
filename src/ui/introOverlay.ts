/**
 * What goes over the picture around a race's intro: a fade to black and back (from the garage, the race set up
 * behind it), the letterbox bars, and a hint that a key skips it.
 */
export class IntroOverlay {
  private readonly fade: HTMLDivElement;
  private readonly bars: HTMLDivElement;
  private readonly hint: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.fade = div(root, 'intro-fade');
    this.bars = div(root, 'intro-bars');
    this.bars.append(div(this.bars, 'top'), div(this.bars, 'bottom'));
    this.hint = div(root, 'intro-hint');
    this.hint.textContent = '按任意鍵跳過';
  }

  /** To black over `ms`; then `then` (on the next frame, the black drawn). */
  toBlack(ms: number, then: () => void): void {
    this.fade.style.transition = `opacity ${ms}ms ease-in`;
    this.fade.classList.add('on');
    setTimeout(() => requestAnimationFrame(then), ms);
  }

  /** Back from black over `ms`. */
  fromBlack(ms: number): void {
    this.fade.style.transition = `opacity ${ms}ms ease-out`;
    this.fade.classList.remove('on');
  }

  /** The letterbox bars and the hint in (the intro on) or out. */
  show(on: boolean): void {
    this.bars.classList.toggle('on', on);
    this.hint.classList.toggle('on', on);
  }
}

function div(parent: HTMLElement, cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  parent.append(d);
  return d;
}
