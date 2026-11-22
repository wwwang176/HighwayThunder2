/**
 * The sound bundles' bytes, each fetched once (under the site's base): started early (prefetchSoundBundles, as the
 * game opens - a download needs no click, only the sound does), decoded when the sound wakes. Null: no bundle (a
 * checkout without the built sounds: docs/sound.md) or it can't be had.
 */
const fetched = new Map<string, Promise<ArrayBuffer | null>>();

/** A bundle's bytes - each call its own copy (reading one unscrambles it in place). */
export async function fetchBundle(url: string): Promise<ArrayBuffer | null> {
  let bytes = fetched.get(url);
  if (!bytes) {
    bytes = fetch(import.meta.env.BASE_URL + url)
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .catch(() => null);
    fetched.set(url, bytes);
  }
  const b = await bytes;
  return b && b.slice(0);
}
