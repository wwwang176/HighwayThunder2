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
  'keys.handbrake': { zh: '手煞車（鎖後輪，甩尾）', en: 'Handbrake (rear wheels lock: the tail slides)' },
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
  'settings.music': { zh: '音樂', en: 'Music' },
  'settings.sfx': { zh: '音效', en: 'Sound' },
  'settings.mute': { zh: '靜音', en: 'Mute' },
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
  // The tuning panel (garage, T): its knobs, each end's trade-off.
  'garage.tune': { zh: '調校', en: 'Tuning' },
  'keys.tune': { zh: '車庫：調校', en: 'Garage: tuning' },
  'tune.kicker': { zh: 'Tuning', en: '' },
  'tune.title': { zh: '調校', en: 'Tuning' },
  'tune.reset': { zh: '恢復原廠', en: 'Stock' },
  'tune.done': { zh: '完成', en: 'Done' },
  'tune.resetAsk': { zh: '這台車的調校全部恢復原廠？', en: 'All of this car’s tuning back to stock?' },
  'tune.stock': { zh: '原廠', en: 'Stock' },
  // The loading screen's steps (src/ui/loading.ts): the game starting, a race being set up.
  'loading.preparing': { zh: '準備中', en: 'Getting ready' },
  'loading.physics': { zh: '啟動物理引擎', en: 'Starting the physics' },
  'loading.cars': { zh: '載入車輛', en: 'Loading the cars' },
  'loading.scene': { zh: '建立場景', en: 'Building the scene' },
  'loading.shaders': { zh: '準備畫面', en: 'Warming up the graphics' },
  'loading.ready': { zh: '完成', en: 'Ready' },
  'loading.grid': { zh: '車輛進場', en: 'Cars to the grid' },
  'loading.road': { zh: '布置賽道', en: 'Setting the road' },
  'loading.settle': { zh: '車輛就位', en: 'Settling on the grid' },
  'loading.go': { zh: '準備出發', en: 'Ready to go' },
  // The tuning's details (beside the car): what it does, measure by measure.
  'tune.d.accel': { zh: '加速', en: 'Acceleration' },
  'tune.d.braking': { zh: '煞車', en: 'Braking' },
  'tune.d.cornering': { zh: '過彎', en: 'Cornering' },
  'tune.d.nitro': { zh: '氮氣', en: 'Nitro' },
  'tune.d.feel': { zh: '手感', en: 'Feel' },
  'tune.d.t100': { zh: '0-100 km/h', en: '0-100 km/h' },
  'tune.d.t100_200': { zh: '100-200 km/h', en: '100-200 km/h' },
  'tune.d.vTop': { zh: '極速', en: 'Top speed' },
  'tune.d.brake200': { zh: '200→0 煞車距離', en: '200→0 stopping distance' },
  'tune.d.lat150': { zh: '中速抓地（150 km/h）', en: 'Grip at 150 km/h' },
  'tune.d.lat250': { zh: '高速抓地（250 km/h）', en: 'Grip at 250 km/h' },
  'tune.d.nitro3': { zh: '3 秒加速', en: 'Gained in 3 s' },
  'tune.d.nitroSecs': { zh: '可噴時間', en: 'Lasts' },
  'tune.d.roll': { zh: '車身側傾', en: 'Body lean' },
  'tune.d.roll.l': { zh: '平穩', en: 'Flat' },
  'tune.d.roll.r': { zh: '傾斜', en: 'Leans' },
  'tune.d.pitch': { zh: '煞車點頭', en: 'Nose dive' },
  'tune.d.pitch.l': { zh: '小', en: 'Little' },
  'tune.d.pitch.r': { zh: '大', en: 'Lots' },
  'tune.d.flick': { zh: '轉向反應', en: 'Steering' },
  'tune.d.flick.l': { zh: '慢', en: 'Slow' },
  'tune.d.flick.r': { zh: '快', en: 'Quick' },
  'tune.d.slide': { zh: '甩尾傾向', en: 'Tail' },
  'tune.d.slide.l': { zh: '穩', en: 'Planted' },
  'tune.d.slide.r': { zh: '滑', en: 'Loose' },
  'tune.group.power': { zh: '動力', en: 'Power' },
  'tune.group.tyres': { zh: '輪胎', en: 'Tyres' },
  'tune.group.aero': { zh: '空力', en: 'Aero' },
  'tune.group.chassis': { zh: '懸吊', en: 'Suspension' },
  'tune.group.control': { zh: '煞車與轉向', en: 'Brakes & steering' },
  'tune.finalDrive': { zh: '最終齒比', en: 'Final drive' },
  'tune.finalDrive.l': { zh: '短：加速快、極速低', en: 'Short: quicker, lower top speed' },
  'tune.finalDrive.r': { zh: '長：極速高、加速慢', en: 'Long: higher top speed, slower' },
  'tune.nitro': { zh: '氮氣噴嘴', en: 'Nitro jets' },
  'tune.nitro.l': { zh: '大：推力強、時間短', en: 'Big: a harder push, sooner gone' },
  'tune.nitro.r': { zh: '小：推力溫和、時間長', en: 'Small: gentler, lasts longer' },
  'tune.pressure': { zh: '胎壓', en: 'Tyre pressure' },
  'tune.pressure.l': { zh: '低：中低速過彎抓、高速飄', en: 'Low: grips slow, floats fast' },
  'tune.pressure.r': { zh: '高：高速過彎穩、中低速滑', en: 'High: steady fast, slides slow' },
  'tune.width': { zh: '輪胎寬度', en: 'Tyre width' },
  'tune.width.l': { zh: '窄：高速段快、抓地少', en: 'Narrow: quick at the top end, less grip' },
  'tune.width.r': { zh: '寬：抓地多、起步煞車好、高速段慢', en: 'Wide: grip, launch and braking; slower at the top end' },
  'tune.camber': { zh: '外傾角', en: 'Camber' },
  'tune.camber.l': { zh: '少：起步、煞車抓地好', en: 'Little: grips launching and braking' },
  'tune.camber.r': { zh: '多：過彎抓地好', en: 'More: grips cornering' },
  'tune.wing': { zh: '尾翼角度', en: 'Wing' },
  'tune.wing.l': { zh: '低：高速段快、高速抓地少', en: 'Low: quick at the top end, light at speed' },
  'tune.wing.r': { zh: '高：高速抓地、煞車短、高速段慢', en: 'High: planted at speed, brakes shorter; slower at the top end' },
  'tune.springs': { zh: '彈簧', en: 'Springs' },
  'tune.springs.l': { zh: '軟：側傾、點頭大', en: 'Soft: leans and dives' },
  'tune.springs.r': { zh: '硬：車身平穩俐落', en: 'Stiff: flat and sharp' },
  'tune.dampers': { zh: '阻尼', en: 'Dampers' },
  'tune.dampers.l': { zh: '軟：車身晃得久', en: 'Soft: floats' },
  'tune.dampers.r': { zh: '硬：車身馬上穩', en: 'Firm: settles at once' },
  'tune.antiRoll': { zh: '防傾桿', en: 'Anti-roll bars' },
  'tune.antiRoll.l': { zh: '軟：側傾大', en: 'Soft: leans more' },
  'tune.antiRoll.r': { zh: '硬：側傾小', en: 'Stiff: stays flat' },
  'tune.steering': { zh: '轉向比', en: 'Steering ratio' },
  'tune.steering.l': { zh: '慢：高速穩定', en: 'Slow: calm at speed' },
  'tune.steering.r': { zh: '快：反應快、容易過頭', en: 'Quick: darts, easy to overdo' },
  'tune.esc': { zh: '循跡系統', en: 'Stability control' },
  'tune.esc.l': { zh: '強：不易打滑', en: 'Strong: holds it straight' },
  'tune.esc.r': { zh: '弱：容易甩尾、自己控車', en: 'Light: slides, yours to hold' },
  'tune.brakeBias': { zh: '煞車平衡', en: 'Brake balance' },
  'tune.brakeBias.l': { zh: '偏前：煞車中車尾穩', en: 'Forward: steady braking turning' },
  'tune.brakeBias.r': { zh: '偏後：煞車中車尾易滑', en: 'Rearward: the tail steps out braking turning' },
} satisfies Record<string, Record<Lang, string>>;

export type Key = keyof typeof STRINGS;

/** The small caps over a title in Chinese: the title itself in English, so left empty there (the dash stays). */
export const KICKERS: Key[] = [
  'tag.street-racer', 'tag.muscle-car', 'tag.jdm', 'setup.kicker', 'setup.rivals.kicker', 'setup.difficulty.kicker',
  'setup.weather.kicker', 'settings.kicker', 'pause.kicker', 'finish.kicker', 'tune.kicker',
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
