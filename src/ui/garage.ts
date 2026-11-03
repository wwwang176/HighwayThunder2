import * as THREE from 'three';
import {
  addRival,
  allRandom,
  allSameAsPlayer,
  CAR_CARDS,
  CarSelection,
  MAX_RIVALS,
  PICKABLE,
  removeRival,
  Weather,
} from '../game/carSelection';
import { DIFFICULTIES } from '../game/difficulty';
import { CARS } from '../vehicles/cars';
import { buildCar } from '../vehicles/models';
import { PLAYER_H, PLAYER_L, PLAYER_W } from '../vehicles/playerCar';
import { installTooltips } from './tooltip';

const html = String.raw;
const UI = `${import.meta.env.BASE_URL}ui/`;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const icon = (name: string, cls = '') => `<span class="icon ${cls}" style="--src:url(${UI}${name}.png)"></span>`;
const card = (id: string) => CAR_CARDS.find((c) => c.id === id) ?? CAR_CARDS[0];
const WEATHERS: [Weather, string, string][] = [
  ['clear', 'icon-night-clear', '晴夜'],
  ['rain', 'icon-night-rain', '雨夜'],
  ['fog', 'icon-night-fog', '霧夜'],
];
/** Keys and what they do (the controls pop-up). */
const KEYS: [string, string][] = [
  ['W / ↑', '油門'],
  ['S / ↓', '煞車 / 倒車'],
  ['A D / ← →', '轉向'],
  ['C', '看正後方'],
  ['R', '重置到車道上'],
  ['I', 'AI 接手駕駛'],
  ['Esc', '暫停'],
  ['M', '靜音'],
];

/**
 * The garage: the car to race in (a turning 3D model under a street lamp),
 * its measured stats, the race at a glance (rivals by car type, difficulty,
 * weather) with a pop-up to change it, and the start. No explanatory text:
 * icons, with their meaning on hover / focus (data-tip).
 */
export class Garage {
  private readonly el: HTMLElement;
  private sel!: CarSelection;
  private readonly preview: Preview;
  private readonly backdrop: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly rivalColors: number[],
    private readonly onStart: (sel: CarSelection) => void,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'garage';
    this.el.style.display = 'none';
    this.el.innerHTML = html`
      <div class="g-bg" style="background-image:url(${UI}garage-bg.jpg)"></div>
      <canvas class="g-car"></canvas>
      <div class="g-vignette"></div>
      <div class="g-brand">${icon('emblem')}<div class="g-name">HIGHWAY THUNDER 2</div></div>
      <button class="g-keys" data-tip="操作說明" data-tip-place="left">${icon('icon-keys')}</button>
      <div class="g-classes"></div>
      <div class="g-spec"></div>
      <div class="g-bottom">
        <button class="g-race" data-tip="修改比賽設定"></button>
        <button class="g-go">開始比賽</button>
      </div>
      <div class="g-back" data-pop="race">
        <div class="g-modal" role="dialog" aria-modal="true" aria-label="比賽設定">
          <button class="g-close" data-tip="關閉" data-tip-place="left">✕</button>
          <div class="g-row">${icon('icon-rivals')}<div class="g-rival-row">
            <div class="g-tools">
              <button class="g-tool" data-act="random" data-tip="對手全部隨機">${icon('icon-random')}</button>
              <button class="g-tool" data-act="same" data-tip="對手全部和我同車種" data-tip-place="bottom">${icon('icon-same')}</button>
            </div>
            <div class="g-slots"></div>
          </div></div>
          <div class="g-row">${icon('icon-difficulty')}<div class="g-seg" data-seg="difficulty"></div></div>
          <div class="g-row">${icon('icon-night-clear')}<div class="g-seg" data-seg="weather"></div></div>
          <button class="g-done">完成</button>
        </div>
      </div>
      <div class="g-back" data-pop="keys">
        <div class="g-modal g-keys-list" role="dialog" aria-modal="true" aria-label="操作說明">
          <button class="g-close" data-tip="關閉" data-tip-place="left">✕</button>
          ${KEYS.map(([k, what]) => `<div class="g-key"><kbd>${k}</kbd><span>${what}</span></div>`).join('')}
        </div>
      </div>`;
    root.appendChild(this.el);
    this.backdrop = this.el;
    // The section icons of the race pop-up say what they are on hover.
    const rows = this.el.querySelectorAll<HTMLElement>('.g-row > .icon');
    ['對手', '難易度', '天氣'].forEach((tip, i) => {
      rows[i].dataset.tip = tip;
      rows[i].tabIndex = 0;
    });
    installTooltips(this.el);
    this.preview = new Preview(this.el.querySelector('.g-car')!);
    this.q('.g-go').onclick = () => this.start();
    this.q('.g-race').onclick = () => this.openPop('race');
    this.q('.g-keys').onclick = () => this.openPop('keys');
    this.el.querySelectorAll<HTMLElement>('.g-close, .g-done').forEach((b) => (b.onclick = () => this.closePop()));
    this.el.querySelectorAll<HTMLElement>('.g-back').forEach((b) => (b.onclick = (e) => e.target === b && this.closePop()));
    this.q('[data-act="random"]').onclick = () => this.change(allRandom(this.sel, Math.random));
    this.q('[data-act="same"]').onclick = () => this.change(allSameAsPlayer(this.sel));
  }

  get isOpen(): boolean {
    return this.el.style.display !== 'none';
  }

  /** A pop-up is open (Esc closes it rather than anything else). */
  get popOpen(): boolean {
    return !!this.el.querySelector('.g-back.open');
  }

  open(sel: CarSelection): void {
    this.sel = sel;
    this.closePop();
    this.el.style.display = '';
    this.draw();
    this.preview.show(this.sel.player);
    (document.activeElement as HTMLElement | null)?.blur(); // the button that opened it must not take an Enter
  }

  close(): void {
    this.closePop();
    this.el.style.display = 'none';
    this.preview.stop();
  }

  /** Start with what is picked (the start button, or Enter). */
  start(): void {
    const sel = this.sel;
    this.close();
    this.onStart(sel);
  }

  closePop(): void {
    this.el.querySelectorAll('.g-back.open').forEach((b) => b.classList.remove('open'));
  }

  /** ← → step through the cars. */
  step(d: number): void {
    const i = PICKABLE.indexOf(this.sel.player);
    this.pick(PICKABLE[(i + d + PICKABLE.length) % PICKABLE.length]);
  }

  private pick(id: string): void {
    if (!PICKABLE.includes(id) || id === this.sel.player) return;
    this.sel = { ...this.sel, player: id };
    this.draw();
    this.preview.show(id);
  }

  private change(sel: CarSelection): void {
    this.sel = sel;
    this.draw();
  }

  private openPop(which: string): void {
    this.closePop();
    this.q(`[data-pop="${which}"]`).classList.add('open');
  }

  private q(sel: string): HTMLElement {
    return this.el.querySelector<HTMLElement>(sel)!;
  }

  private draw(): void {
    const s = this.sel;
    const me = card(s.player);
    this.backdrop.style.setProperty('--accent', me.accent);
    this.q('.g-classes').innerHTML = CAR_CARDS.map(
      (c) => `<button class="g-cls ${c.id === s.player ? 'sel' : ''}" data-id="${c.id}">${icon(c.icon, 'car')}<span class="t">${c.name}</span></button>`,
    ).join('');
    this.el.querySelectorAll<HTMLElement>('.g-cls').forEach((b) => (b.onclick = () => this.pick(b.dataset.id!)));
    this.q('.g-spec').innerHTML =
      `<h1>${me.name}</h1>` +
      me.stats
        .map((st) => `<div class="g-stat"><span data-tip="${st.tip}" data-tip-place="left" tabindex="0">${icon(st.icon)}</span><span class="v">${st.value}</span><div class="bar"><i style="width:${st.bar * 100}%"></i></div></div>`)
        .join('');
    // The race at a glance: the rivals by car type (silhouette x how many), difficulty, weather.
    const lineUp = PICKABLE.filter((id) => s.rivals.includes(id))
      .map((id) => `<span class="count" data-tip="${CARS[id].name}">${icon(card(id).icon, 'mini')}×${s.rivals.filter((r) => r === id).length}</span>`)
      .join('');
    const w = WEATHERS.find(([k]) => k === s.weather)!;
    this.q('.g-race').innerHTML = html`
      <span class="item ${lineUp ? '' : 'none'}">${icon('icon-rivals')}${lineUp || '<span class="count">×0</span>'}</span>
      <span class="sep"></span>
      <span class="item">${icon('icon-difficulty')}${DIFFICULTIES[s.difficulty].name}</span>
      <span class="sep"></span>
      <span class="item">${icon(w[1])}${w[2]}</span>
      <span class="edit">✎</span>`;
    // The race pop-up: rivals from the left (number and colour by place), one + while there is room.
    this.q('.g-slots').innerHTML =
      s.rivals
        .map(
          (id, i) =>
            `<div class="g-slot" style="--c:${hex(this.rivalColors[i % this.rivalColors.length])}"><span class="no">${i + 1}</span>` +
            `<button class="remove" data-i="${i}" data-tip="移除對手">✕</button><button class="arrow" data-i="${i}" data-d="-1">◀</button>` +
            `<div class="mid">${icon(card(id).icon, 'car')}<div class="name">${CARS[id].name}</div></div><button class="arrow" data-i="${i}" data-d="1">▶</button></div>`,
        )
        .join('') + (s.rivals.length < MAX_RIVALS ? `<button class="g-slot empty" data-tip="加入對手">＋</button>` : '');
    this.el.querySelectorAll<HTMLElement>('.g-slot .arrow').forEach(
      (a) =>
        (a.onclick = () => {
          const i = Number(a.dataset.i);
          const k = PICKABLE.indexOf(s.rivals[i]);
          const rivals = [...s.rivals];
          rivals[i] = PICKABLE[(k + Number(a.dataset.d) + PICKABLE.length) % PICKABLE.length];
          this.change({ ...s, rivals });
        }),
    );
    this.el.querySelectorAll<HTMLElement>('.g-slot .remove').forEach((b) => (b.onclick = () => this.change(removeRival(s, Number(b.dataset.i)))));
    this.el.querySelectorAll<HTMLElement>('.g-slot.empty').forEach((b) => (b.onclick = () => this.change(addRival(s))));
    this.q('[data-seg="difficulty"]').innerHTML = DIFFICULTIES.map((d, i) => `<button class="${i === s.difficulty ? 'sel' : ''}" data-i="${i}">${d.name}</button>`).join('');
    this.el.querySelectorAll<HTMLElement>('[data-seg="difficulty"] button').forEach((b) => (b.onclick = () => this.change({ ...s, difficulty: Number(b.dataset.i) })));
    // Only the clear night for now. aria-disabled, not disabled: a disabled button gets no mouse events, so its tip would never show.
    this.q('[data-seg="weather"]').innerHTML = WEATHERS.map(
      ([k, ic, name]) => `<button class="${k === s.weather ? 'sel' : ''}" ${k === 'clear' ? '' : 'aria-disabled="true" data-tip="即將推出"'}>${icon(ic)}${name}</button>`,
    ).join('');
  }
}

/** The picked car, turning slowly under the lamp: the game's own model in its own small renderer (only while the garage is open). */
class Preview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(22, 1, 0.1, 100);
  private readonly shadow: THREE.Mesh;
  private car: THREE.Object3D | null = null;
  private running = false;
  private angle = 2.3; // nose (-z) toward the camera, three-quarter

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.camera.position.set(0, 1.6, 17.5);
    this.camera.lookAt(0, 0.55, 0);
    this.scene.add(new THREE.HemisphereLight(0x6f86c8, 0x1a1208, 0.6));
    const lamp = new THREE.SpotLight(0xffb36b, 120, 30, 0.7, 0.6, 1.6);
    lamp.position.set(2.5, 7, 1);
    this.scene.add(lamp, lamp.target);
    const rim = new THREE.DirectionalLight(0x6fa8ff, 1.4);
    rim.position.set(-6, 3, -6);
    this.scene.add(rim);
    // A soft contact shadow under the car (a child of it: it turns with it).
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 5.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = -PLAYER_H / 2 + 0.01;
    addEventListener('resize', () => this.resize());
  }

  show(id: string): void {
    if (this.car) this.scene.remove(this.car);
    const spec = CARS[id];
    this.car = buildCar(PLAYER_W, PLAYER_H, PLAYER_L, spec.color, spec.style, true, false).root;
    this.car.position.y = PLAYER_H / 2; // on the floor
    this.car.add(this.shadow);
    this.scene.add(this.car);
    this.resize();
    if (!this.running) {
      this.running = true;
      let last = performance.now();
      const loop = (now: number) => {
        if (!this.running) return;
        this.angle += ((now - last) / 1000) * 0.25;
        last = now;
        this.car!.rotation.y = this.angle;
        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  }

  stop(): void {
    this.running = false;
  }

  private resize(): void {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    // The car sits low in the middle, on the empty parking spot of the backdrop.
    this.camera.setViewOffset(innerWidth, innerHeight, 0, -innerHeight * 0.12, innerWidth, innerHeight);
  }
}
