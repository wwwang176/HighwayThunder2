import { BUNDLE_RATE, unpackBundle } from './bundleCodec';

/** The crash recordings' bundle (built in the private audio repo; git-ignored, licensed: docs/sound.md). */
export const CRASH_BUNDLE_URL = 'audio/crashes.bin';

/** A crash recording: one hit, and the gain that brings it to the set's common loudness. */
export interface CrashClip {
  buffer: AudioBuffer;
  gain: number;
}

/**
 * The crash recordings, decoded. Null when there's no bundle (a checkout without the recordings built) or it can't
 * be read: the crashes are then silent.
 */
export async function loadCrashBank(ctx: BaseAudioContext): Promise<CrashClip[] | null> {
  try {
    const res = await fetch(import.meta.env.BASE_URL + CRASH_BUNDLE_URL);
    if (!res.ok) return null;
    const clips = unpackBundle(new Uint8Array(await res.arrayBuffer()));
    if (!clips?.length) return null;
    return await Promise.all(clips.map(async ({ entry, data }) => {
      const decoded = await ctx.decodeAudioData(data.slice().buffer);
      // Its own length: whatever the decoder adds at the end (Opus pads to whole frames) left off.
      const len = Math.min(Math.round(entry.n * (decoded.sampleRate / BUNDLE_RATE)), decoded.length);
      const clip = ctx.createBuffer(1, len, decoded.sampleRate);
      clip.copyToChannel(decoded.getChannelData(0).subarray(0, len), 0);
      return { buffer: clip, gain: entry.gain ?? 1 };
    }));
  } catch {
    return null;
  }
}
