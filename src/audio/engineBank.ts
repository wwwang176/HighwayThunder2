import { BUNDLE_RATE, unpackBundle } from './bundleCodec';
import { ENGINE_BUNDLE_URL } from './engineCatalog';

/** The tyre squeal's, the nitro's and the cues' bundle (built in the private audio repo; git-ignored: docs/sound.md). */
export const EFFECTS_BUNDLE_URL = 'audio/effects.bin';

/**
 * The engine clips, decoded: each one lap of its loop, as an AudioBuffer by clip id. Null when there's no bundle
 * (a checkout without the built sounds: docs/sound.md) or it can't be read: the engines then
 * stay silent.
 */
export function loadEngineBank(ctx: BaseAudioContext): Promise<Map<string, AudioBuffer> | null> {
  return loadSoundBank(ctx, ENGINE_BUNDLE_URL);
}

/**
 * A bundle's clips (at `url`, under the site's base), decoded: a loop one lap of it, a one-shot (no lead-in) all of
 * it, as an AudioBuffer by clip id. Null when there's no bundle or it can't be read.
 */
export async function loadSoundBank(ctx: BaseAudioContext, url: string): Promise<Map<string, AudioBuffer> | null> {
  try {
    const res = await fetch(import.meta.env.BASE_URL + url);
    if (!res.ok) return null;
    const clips = unpackBundle(new Uint8Array(await res.arrayBuffer()));
    if (!clips) return null;
    const bank = new Map<string, AudioBuffer>();
    await Promise.all(clips.map(async ({ entry, data }) => {
      // (decodeAudioData takes the buffer over: a copy of the clip's bytes)
      const decoded = await ctx.decodeAudioData(data.slice().buffer);
      // One lap, from the middle: past the lead-in (the loop's own end, encoded before its start), whatever the
      // decoder trims or keeps at the file's very start - any lap-long stretch of a seamless loop is one.
      const k = decoded.sampleRate / BUNDLE_RATE;
      const start = Math.round(entry.pad * k), len = Math.min(Math.round(entry.n * k), decoded.length - start);
      const lap = ctx.createBuffer(1, len, decoded.sampleRate);
      lap.copyToChannel(decoded.getChannelData(0).subarray(start, start + len), 0);
      bank.set(entry.id, lap);
    }));
    return bank;
  } catch {
    return null;
  }
}
