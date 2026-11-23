/**
 * The game's saved things (the cars picked, the settings, the intros' round): the page's localStorage, never
 * throwing - storage off (blocked: reading `localStorage` itself throws) or full (a write throws), kept for this visit
 * only instead. (A throw in a frame stopped the game for good: the next frame is asked for after it.)
 */
export type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** A store on `open()` (the page's storage; it throwing, or null: none), this visit's writes kept over it. */
export function safeStore(open: () => Store | null): Store {
  let real: Store | null = null;
  try {
    real = open();
  } catch {
    // (storage off: this visit's only)
  }
  const here = new Map<string, string>();
  return {
    getItem(key) {
      if (here.has(key)) return here.get(key)!;
      try {
        return real?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      here.set(key, value);
      try {
        real?.setItem(key, value);
      } catch {
        // (full or off: kept for this visit)
      }
    },
  };
}

export const store: Store = safeStore(() => (typeof window === 'undefined' ? null : window.localStorage));
