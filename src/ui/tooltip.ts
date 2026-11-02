import { autoUpdate, computePosition, flip, offset, shift, type Placement } from '@floating-ui/dom';

/**
 * Hover / keyboard-focus tips for every element with `data-tip="text"` under
 * `root` (icons standing in for text). One tip element, placed by Floating UI:
 * on the side `data-tip-place` asks for (default top), flipped and shifted to
 * stay on screen. The text is also the element's accessible name (icon-only
 * elements) or description (elements with their own text).
 * Returns a function that takes it all away again.
 */
export function installTooltips(root: HTMLElement = document.body): () => void {
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  let target: HTMLElement | null = null;
  let stopFollowing: (() => void) | null = null;

  // The tip names an icon-only element; one with its own text keeps that name and gets the tip as its description.
  const label = () =>
    root.querySelectorAll<HTMLElement>('[data-tip]').forEach((e) => {
      const attr = /[\p{L}\p{N}]/u.test(e.textContent!) ? 'aria-description' : 'aria-label'; // only symbols (✕, ＋): icon-only too
      if (e.getAttribute(attr) !== e.dataset.tip) e.setAttribute(attr, e.dataset.tip!);
    });
  const observer = new MutationObserver(label);
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-tip'] });
  label();

  const show = (el: HTMLElement) => {
    if (el === target) return;
    hide();
    target = el;
    tip.textContent = el.dataset.tip!;
    tip.classList.add('on');
    stopFollowing = autoUpdate(el, tip, () => {
      void computePosition(el, tip, {
        placement: (el.dataset.tipPlace as Placement | undefined) ?? 'top',
        middleware: [offset(8), flip(), shift({ padding: 8 })],
      }).then(({ x, y }) => Object.assign(tip.style, { left: `${x}px`, top: `${y}px` }));
    });
  };
  const hide = () => {
    stopFollowing?.();
    stopFollowing = null;
    target = null;
    tip.classList.remove('on');
  };
  const over = (e: Event) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-tip]');
    if (el && root.contains(el)) show(el);
    else hide();
  };
  root.addEventListener('pointerover', over);
  root.addEventListener('focusin', over);
  root.addEventListener('pointerleave', hide);
  root.addEventListener('focusout', hide);
  return () => {
    hide();
    observer.disconnect();
    root.removeEventListener('pointerover', over);
    root.removeEventListener('focusin', over);
    root.removeEventListener('pointerleave', hide);
    root.removeEventListener('focusout', hide);
    tip.remove();
  };
}
