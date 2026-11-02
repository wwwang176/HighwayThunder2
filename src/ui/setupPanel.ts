import { allRandom, allSameAsPlayer, CAR_CARDS, CarSelection, PICKABLE } from '../game/carSelection';
import { CARS } from '../vehicles/cars';

const html = String.raw;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const STAT_NAMES: [keyof (typeof CAR_CARDS)[number]['stats'], string][] = [
  ['accel', '加速'],
  ['top', '極速'],
  ['handling', '操控'],
  ['stability', '穩定'],
];

/**
 * The setup page before a race (simple for now - the UI is to be reworked):
 * the player's car from the cards, each rival's from a list, then start.
 */
export class SetupPanel {
  private readonly el: HTMLElement;
  private sel: CarSelection = { player: PICKABLE[0], rivals: [] };

  constructor(
    root: HTMLElement,
    private readonly rivalColors: number[],
    private readonly onStart: (sel: CarSelection) => void,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'setup';
    this.el.style.display = 'none';
    root.appendChild(this.el);
  }

  get isOpen(): boolean {
    return this.el.style.display !== 'none';
  }

  open(sel: CarSelection): void {
    this.sel = { player: sel.player, rivals: [...sel.rivals] };
    this.el.style.display = '';
    this.draw();
  }

  close(): void {
    this.el.style.display = 'none';
  }

  /** Start with what is picked (the start button, or Enter). */
  start(): void {
    this.close();
    this.onStart({ player: this.sel.player, rivals: [...this.sel.rivals] });
  }

  private draw(): void {
    const cards = CAR_CARDS.map(
      (c) => html`
        <div class="car-card ${c.id === this.sel.player ? 'sel' : ''} ${c.pickable ? '' : 'off'}" data-car="${c.id}">
          <div class="swatch" style="background:${hex(c.color)}">${c.name}</div>
          <div class="name">${c.name}${c.pickable ? '' : '（即將推出）'}</div>
          <div class="tag">${c.tagline}</div>
          ${STAT_NAMES.map(([k, label]) => html`<div class="stat">${label}<div class="bar"><i style="width:${c.stats[k] * 100}%"></i></div></div>`).join('')}
        </div>`,
    ).join('');
    const options = (picked: string) => PICKABLE.map((id) => `<option value="${id}" ${id === picked ? 'selected' : ''}>${CARS[id].name}</option>`).join('');
    const rivals = this.sel.rivals
      .map(
        (id, i) => html`
          <div class="rival-pick">
            <div class="who"><span class="dot" style="background:${hex(this.rivalColors[i % this.rivalColors.length])}"></span>對手 ${i + 1}</div>
            <select data-rival="${i}">${options(id)}</select>
          </div>`,
      )
      .join('');
    this.el.innerHTML = html`
      <div class="setup-wrap">
        <h1>賽前設定</h1>
        <div class="sub">選好車種後開始比賽</div>
        <h3>你的車</h3>
        <div class="car-cards">${cards}</div>
        <h3>電腦對手</h3>
        <div class="rival-picks">${rivals}</div>
        <div class="setup-row">
          <div>
            <button class="secondary" data-act="random">對手全部隨機</button>
            <button class="secondary" data-act="same">對手全部同我</button>
          </div>
          <button data-act="start">開始比賽 <small>Enter</small></button>
        </div>
      </div>`;
    this.el.querySelectorAll<HTMLElement>('.car-card').forEach((card) => {
      card.onclick = () => {
        const id = card.dataset.car!;
        if (!PICKABLE.includes(id)) return;
        this.sel.player = id;
        this.draw();
      };
    });
    this.el.querySelectorAll<HTMLSelectElement>('select[data-rival]').forEach((s) => {
      s.onchange = () => (this.sel.rivals[Number(s.dataset.rival)] = s.value);
    });
    this.el.querySelector<HTMLElement>('[data-act="random"]')!.onclick = () => {
      this.sel = allRandom(this.sel, Math.random);
      this.draw();
    };
    this.el.querySelector<HTMLElement>('[data-act="same"]')!.onclick = () => {
      this.sel = allSameAsPlayer(this.sel);
      this.draw();
    };
    this.el.querySelector<HTMLElement>('[data-act="start"]')!.onclick = () => this.start();
  }
}
