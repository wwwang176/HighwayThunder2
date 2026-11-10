/**
 * The player's volumes (the settings pop-up; M the mute too): the music and the sound (everything else), each 0..1
 * in tenths on top of the game's own mix - full (1) as it comes - and the mute. Kept for the next visit.
 */
export interface Volumes {
  music: number;
  sfx: number;
  muted: boolean;
}

export const VOLUMES_KEY = 'ht2.volumes';
export const FULL_VOLUMES: Volumes = { music: 1, sfx: 1, muted: false };

/** A volume as kept: 0..1 in tenths (anything else: full). */
export function tenths(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(1, Math.max(0, v)) * 10) / 10 : 1;
}

/** The volumes saved (none, or broken: full, not muted). */
export function loadVolumes(storage: Pick<Storage, 'getItem'>): Volumes {
  try {
    const o = JSON.parse(storage.getItem(VOLUMES_KEY) ?? 'null') as Partial<Record<keyof Volumes, unknown>> | null;
    if (!o || typeof o !== 'object') return { ...FULL_VOLUMES };
    return { music: tenths(o.music), sfx: tenths(o.sfx), muted: o.muted === true };
  } catch {
    return { ...FULL_VOLUMES };
  }
}

/** Remember them (storage full or off: not remembered, the game goes on). */
export function saveVolumes(storage: Pick<Storage, 'setItem'>, v: Volumes): void {
  try {
    storage.setItem(VOLUMES_KEY, JSON.stringify(v));
  } catch {
    // Nothing to do: the next visit starts at full.
  }
}
