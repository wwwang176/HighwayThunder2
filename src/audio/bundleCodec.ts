/**
 * The sound bundle's file: every clip packed into one, so the site serves no loose audio files (the recordings are
 * licensed for use inside the game only; docs/sound.md). Its layout: 'HT2E', the index's length (u32, little
 * endian), the index (JSON), then each clip's encoded bytes in turn; everything after the first 8 bytes scrambled
 * (XOR with a fixed keystream: a deterrent against lifting the files whole, not encryption).
 */

/**
 * One clip in the bundle: its id, its bytes' place, and its loop: `n` samples (at RATE), after `pad` of lead-in (a
 * one-shot: `n` its length, `pad` 0). `gain`: what brings it to its set's common loudness, if it isn't there already.
 */
export interface BundleEntry {
  id: string;
  offset: number;
  bytes: number;
  n: number;
  pad: number;
  gain?: number;
}

/** The rate the clips were encoded at (their n and pad count samples at this rate). */
export const BUNDLE_RATE = 48000;
const MAGIC = [0x48, 0x54, 0x32, 0x45]; // 'HT2E'

/** XOR `data` in place with the keystream (xorshift32 from a fixed seed), from byte `from` on. */
function scramble(data: Uint8Array, from: number): void {
  let x = 0x9e3779b9;
  for (let i = from; i < data.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    data[i] ^= x & 0xff;
  }
}

/** The bundle file for these clips (each its encoded bytes, its loop length and lead-in). */
export function packBundle(clips: { id: string; data: Uint8Array; n: number; pad: number; gain?: number }[]): Uint8Array {
  const entries: BundleEntry[] = [];
  let offset = 0;
  for (const c of clips) {
    entries.push({ id: c.id, offset, bytes: c.data.length, n: c.n, pad: c.pad, ...(c.gain !== undefined && { gain: c.gain }) });
    offset += c.data.length;
  }
  const index = new TextEncoder().encode(JSON.stringify(entries));
  const out = new Uint8Array(8 + index.length + offset);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, index.length, true);
  out.set(index, 8);
  let at = 8 + index.length;
  for (const c of clips) {
    out.set(c.data, at);
    at += c.data.length;
  }
  scramble(out, 8);
  return out;
}

/** The clips in a bundle file (null: not one). Each clip's bytes a view into `file`, which is unscrambled in place. */
export function unpackBundle(file: Uint8Array): { entry: BundleEntry; data: Uint8Array }[] | null {
  if (file.length < 8 || MAGIC.some((b, i) => file[i] !== b)) return null;
  scramble(file, 8);
  const len = new DataView(file.buffer, file.byteOffset).getUint32(4, true);
  const entries = JSON.parse(new TextDecoder().decode(file.subarray(8, 8 + len))) as BundleEntry[];
  const base = 8 + len;
  return entries.map((entry) => ({ entry, data: file.subarray(base + entry.offset, base + entry.offset + entry.bytes) }));
}
