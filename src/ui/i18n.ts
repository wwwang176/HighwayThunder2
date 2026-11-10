/**
 * The game's words in Chinese (Traditional) and English, the language picked (the settings pop-up: Garage), and the
 * settings kept between visits. Every string the player reads is here; the screens set theirs with t(), and the
 * fixed ones in their markup carry data-t / data-t-tip / data-t-aria so applyLang() can redo them in place.
 * (The English small caps over the Chinese titles are the design's, the same in both: docs/ui-design.md.)
 */
export type Lang = 'zh' | 'en';

export const STRINGS = {
  // The title and the garage.
  'title.start': { zh: '開始遊戲', en: 'Start' },
  'garage.start': { zh: '開始比賽', en: 'Start race' },
  'garage.controls': { zh: '操作說明', en: 'Controls' },
  'garage.settings': { zh: '設定', en: 'Settings' },
  'garage.randomCount': { zh: '隨機 ×{n}', en: 'Random ×{n}' },
  'garage.close': { zh: '關閉', en: 'Close' },
  'stat.accel': { zh: '加速（0–100 km/h）', en: 'Acceleration (0–100 km/h)' },
  'stat.top': { zh: '極速', en: 'Top speed' },
  'stat.grip': { zh: '過彎抓地力', en: 'Cornering grip' },
  'unit.s': { zh: '秒', en: 's' },
  'car.street-racer': { zh: '超跑', en: 'Supercar' },
  'car.muscle-car': { zh: '肌肉車', en: 'Muscle Car' },
  'car.jdm': { zh: '改裝車', en: 'Tuner' },
  // Its type over its name (English small caps): in English the name says it already.
  'tag.street-racer': { zh: 'Supercar', en: '' },
  'tag.muscle-car': { zh: 'Muscle car', en: '' },
  'tag.jdm': { zh: 'Tuner', en: '' },
  // The race setup.
  'setup.kicker': { zh: 'Race setup', en: '' },
  'setup.title': { zh: '比賽設定', en: 'Race setup' },
  'setup.close': { zh: '收起', en: 'Close' },
  'setup.keys.move': { zh: '↑ ↓　選項目', en: '↑ ↓   Choose a row' },
  'setup.keys.adjust': { zh: '← →　調整', en: '← →   Change it' },
  'setup.keys.count': { zh: '0 – 5　對手數量', en: '0 – 5   How many rivals' },
  'setup.keys.start': { zh: 'Enter　開始比賽', en: 'Enter   Start the race' },
  'setup.keys.close': { zh: 'Esc　收起', en: 'Esc   Close' },
  'setup.rivals.kicker': { zh: 'Rivals', en: '' },
  'setup.rivals': { zh: '對手', en: 'Rivals' },
  'setup.count': { zh: '數量', en: 'Count' },
  'setup.mode': { zh: '車種', en: 'Cars' },
  'mode.random': { zh: '全部隨機', en: 'All random' },
  'mode.same': { zh: '全部同我的車', en: 'All my car' },
  'mode.custom': { zh: '自由指定', en: 'Custom' },
  'mode.help.random': { zh: '全部隨機：每場比賽重新抽選對手的車種', en: "All random: the rivals' cars drawn afresh every race" },
  'mode.help.same': { zh: '全部同我的車：對手開你的車，你換車他們也跟著換', en: 'All my car: the rivals drive your car, and switch when you do' },
  'mode.help.custom': { zh: '自由指定：逐台指定對手的車種', en: "Custom: pick each rival's car" },
  'setup.difficulty.kicker': { zh: 'Difficulty', en: '' },
  'setup.difficulty': { zh: '難度', en: 'Difficulty' },
  'diff.0': { zh: '簡單', en: 'Easy' },
  'diff.1': { zh: '普通', en: 'Normal' },
  'diff.2': { zh: '困難', en: 'Hard' },
  'diff.3': { zh: '極限', en: 'Extreme' },
  // (each level's share of the rivals' top speed: game/difficulty)
  'diff.hint.0': { zh: '對手最高只開到車子極速的 {pct}%', en: "The rivals top out at {pct}% of their cars' top speed" },
  'diff.hint.1': { zh: '對手最高只開到車子極速的 {pct}%', en: "The rivals top out at {pct}% of their cars' top speed" },
  'diff.hint.2': { zh: '對手最高只開到車子極速的 {pct}%', en: "The rivals top out at {pct}% of their cars' top speed" },
  'diff.hint.3': { zh: '對手開到車子的極速', en: "The rivals go at their cars' full top speed" },
  'diff.hint.band': { zh: '每個難度都一樣：對手落後時加速追趕，領先時放慢等你', en: 'At every level: behind, the rivals speed up to catch you; ahead, they slow down for you' },
  'setup.weather.kicker': { zh: 'Weather', en: '' },
  'setup.weather': { zh: '天氣', en: 'Weather' },
  'weather.clear': { zh: '晴夜', en: 'Clear night' },
  'weather.rain': { zh: '雨夜', en: 'Rainy night' },
  'weather.fog': { zh: '霧夜', en: 'Foggy night' },
  'weather.soon': { zh: '即將推出', en: 'Coming soon' },
  // The controls pop-up.
  'keys.throttle': { zh: '油門', en: 'Throttle' },
  'keys.brake': { zh: '煞車 / 倒車', en: 'Brake / reverse' },
  'keys.steer': { zh: '轉向', en: 'Steer' },
  'keys.nitro': { zh: '氮氣', en: 'Nitro' },
  'keys.look': { zh: '看正後方', en: 'Look back' },
  'keys.view': { zh: '切換引擎蓋視角', en: 'Hood camera' },
  'keys.reset': { zh: '重置到車道上', en: 'Back on the road' },
  'keys.ai': { zh: 'AI 接手駕駛', en: 'AI takes the wheel' },
  'keys.highBeam': { zh: '遠光燈（按住）', en: 'High beam (hold)' },
  'keys.pause': { zh: '暫停', en: 'Pause' },
  'keys.mute': { zh: '靜音', en: 'Mute' },
  'keys.nextSong': { zh: '下一首音樂', en: 'Next song' },
  'keys.menus': { zh: '車庫：換車、換烤漆；選單：移動游標', en: 'Garage: car, paint · Menus: move the cursor' },
  'keys.setup': { zh: '車庫：比賽設定', en: 'Garage: race setup' },
  'keys.help': { zh: '車庫：操作說明', en: 'Garage: controls' },
  'keys.settings': { zh: '車庫：設定', en: 'Garage: settings' },
  // The settings pop-up.
  'settings.kicker': { zh: 'Settings', en: '' },
  'settings.title': { zh: '設定', en: 'Settings' },
  'settings.lang': { zh: '語言', en: 'Language' },
  'settings.quality': { zh: '畫質', en: 'Quality' },
  'quality.ultra': { zh: '極致', en: 'Ultra' },
  'quality.sharp': { zh: '清晰', en: 'Sharp' },
  'quality.balanced': { zh: '平衡', en: 'Balanced' },
  'quality.smooth': { zh: '流暢', en: 'Smooth' },
  'quality.fast': { zh: '極速', en: 'Fast' },
  'settings.ok': { zh: '確定', en: 'OK' },
  'settings.cancel': { zh: '取消', en: 'Cancel' },
  // The race.
  'hud.reset': { zh: '回到賽道', en: 'Back on track' },
  'toast.overtake': { zh: '超車！', en: 'Overtake!' },
  'toast.nearMiss': { zh: '險過！', en: 'Near miss!' },
  'toast.noAi': { zh: '沒有可用的 AI 駕駛（請先在 lab/train.html 訓練並存檔）', en: 'No AI driver yet (train and save one in lab/train.html first)' },
  'intro.skip': { zh: '按任意鍵跳過', en: 'Press any key to skip' },
  'pause.kicker': { zh: 'Paused', en: '' },
  'pause.title': { zh: '暫停', en: 'Paused' },
  'pause.resume': { zh: '繼續', en: 'Resume' },
  'pause.restart': { zh: '重新開始', en: 'Restart' },
  'pause.settings': { zh: '設定', en: 'Settings' },
  'pause.garage': { zh: '回車庫', en: 'Garage' },
  'confirm.kicker': { zh: 'Confirm', en: 'Confirm' },
  'confirm.lost': { zh: '進度將會遺失，是否確定？', en: 'This race will be lost. Are you sure?' },
  'confirm.yes': { zh: '確定', en: 'OK' },
  'confirm.no': { zh: '取消', en: 'Cancel' },
  'finish.kicker': { zh: 'Race complete', en: '' },
  'finish.title': { zh: '抵達終點！', en: 'Race complete!' },
  'finish.again': { zh: '再一場', en: 'Race again' },
} satisfies Record<string, Record<Lang, string>>;

export type Key = keyof typeof STRINGS;

/** The small caps over a title in Chinese: the title itself in English, so left empty there (the dash stays). */
export const KICKERS: Key[] = [
  'tag.street-racer', 'tag.muscle-car', 'tag.jdm', 'setup.kicker', 'setup.rivals.kicker', 'setup.difficulty.kicker',
  'setup.weather.kicker', 'settings.kicker', 'pause.kicker', 'finish.kicker',
];

/** The language every screen is in now (setLang). */
let current: Lang = 'zh';
const listeners: (() => void)[] = [];

export function getLang(): Lang {
  return current;
}

/** Every screen into `lang`: the page's lang, then each screen's redraw (onLangChange). */
export function setLang(lang: Lang): void {
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
  for (const fn of listeners) fn();
}

export function onLangChange(fn: () => void): void {
  listeners.push(fn);
}

/** `key` in `lang` (the current one by default), its {placeholders} filled from `vars`. */
export function t(key: Key, vars: Record<string, string | number> = {}, lang: Lang = current): string {
  return STRINGS[key][lang].replace(/\{(\w+)\}/g, (_, v: string) => String(vars[v] ?? ''));
}

/** The fixed words under `root` (data-t: text, data-t-tip: its tip, data-t-aria: its label) in `lang`. */
export function applyLang(root: ParentNode, lang: Lang = current): void {
  root.querySelectorAll<HTMLElement>('[data-t]').forEach((e) => (e.textContent = t(e.dataset.t as Key, {}, lang)));
  root.querySelectorAll<HTMLElement>('[data-t-tip]').forEach((e) => (e.dataset.tip = t(e.dataset.tTip as Key, {}, lang)));
  root.querySelectorAll<HTMLElement>('[data-t-aria]').forEach((e) => e.setAttribute('aria-label', t(e.dataset.tAria as Key, {}, lang)));
}

/** A fixed word in markup: its text now, redone by applyLang. */
export const tx = (key: Key, tag = 'span', cls = '') => `<${tag} ${cls ? `class="${cls}" ` : ''}data-t="${key}">${t(key)}</${tag}>`;

/** The first visit's language: Chinese for a Chinese browser, English for any other. */
export function detectLang(navigatorLanguage: string): Lang {
  return /^zh\b/i.test(navigatorLanguage) ? 'zh' : 'en';
}

/** What the settings pop-up sets (only the language so far). */
export interface Settings {
  lang: Lang;
}

const SETTINGS_KEY = 'ht2.settings';

/** The settings saved (anything broken or unknown: the browser's language). */
export function loadSettings(storage: Pick<Storage, 'getItem'>, navigatorLanguage: string): Settings {
  const fallback: Settings = { lang: detectLang(navigatorLanguage) };
  try {
    const o = JSON.parse(storage.getItem(SETTINGS_KEY) ?? 'null') as { lang?: unknown } | null;
    return o && (o.lang === 'zh' || o.lang === 'en') ? { lang: o.lang } : fallback;
  } catch {
    return fallback;
  }
}

/** Remember them for the next visit (storage full or off: not remembered, the game goes on). */
export function saveSettings(storage: Pick<Storage, 'setItem'>, s: Settings): void {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Nothing to do: the next visit starts from the browser's language.
  }
}
