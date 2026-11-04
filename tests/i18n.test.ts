import { describe, it, expect } from 'vitest';
import { detectLang, KICKERS, loadSettings, saveSettings, STRINGS, t, type Lang } from '../src/ui/i18n';

const memory = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('i18n', () => {
  it('every string is there in both languages (only the small-caps kickers may be empty in English)', () => {
    for (const [key, s] of Object.entries(STRINGS)) {
      expect(s.zh, key).not.toBe('');
      if (!KICKERS.includes(key as keyof typeof STRINGS)) expect(s.en, key).not.toBe('');
    }
  });

  it('a string in the language asked for, its {placeholders} filled', () => {
    expect(t('toast.overtake', {}, 'zh')).toBe('超車！');
    expect(t('toast.overtake', {}, 'en')).toBe('Overtake!');
    expect(t('garage.randomCount', { n: 5 }, 'en')).toBe('Random ×5');
  });

  it('the first visit: Chinese for a Chinese browser, English for any other', () => {
    const cases: [string, Lang][] = [['zh-TW', 'zh'], ['zh-Hant', 'zh'], ['zh-CN', 'zh'], ['zh', 'zh'], ['en-US', 'en'], ['ja-JP', 'en'], ['', 'en']];
    for (const [nav, lang] of cases) expect(detectLang(nav), nav).toBe(lang);
  });

  it('the settings are kept between visits; anything broken or unknown is the default', () => {
    const s = memory();
    expect(loadSettings(s, 'zh-TW')).toEqual({ lang: 'zh' });
    saveSettings(s, { lang: 'en' });
    expect(loadSettings(s, 'zh-TW')).toEqual({ lang: 'en' });
    expect(loadSettings(memory({ 'ht2.settings': '{"lang":"klingon"}' }), 'en-GB')).toEqual({ lang: 'en' });
    expect(loadSettings(memory({ 'ht2.settings': '{oops' }), 'zh-TW')).toEqual({ lang: 'zh' });
  });
});
