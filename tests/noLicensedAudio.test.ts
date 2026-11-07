import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * The engine sounds are a licensed pack (docs/audio.md): no audio file, nor the built bundle, may ever be in the
 * repository (it's to be public). Fails on any tracked file that is one.
 */
describe('the repository', () => {
  it('holds no audio', () => {
    const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n');
    const audio = files.filter((f) => /\.(wav|ogg|opus|oga|mp3|flac|m4a|aac|webm|aif|aiff|caf)$/i.test(f) || /^public\/audio\//.test(f));
    expect(audio, 'audio in git: remove it (git rm --cached) and keep it out - see docs/audio.md').toEqual([]);
  });
});
