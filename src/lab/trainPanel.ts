import { ROAD_LENGTH } from '../config';
import { FITNESS } from '../ai/fitness';
import type { Trainer } from '../ai/trainer';

export interface PanelActions {
  onToggleRun(): void;
  onSpeed(x: number): void;
  onReset(): void;
  onSave(): void;
}

export interface PanelInfo {
  running: boolean;
  speed: number;
  /** Simulated seconds per real second over the last moments. */
  actualSpeed: number;
  message: string;
}

const CSS = `
#train-panel { position: fixed; top: 16px; right: 16px; width: 300px; padding: 14px 16px; background: rgba(8,10,16,0.82);
  color: #dfe6f0; font: 13px/1.5 "Microsoft JhengHei", "Noto Sans TC", sans-serif; border: 1px solid #2a3140; border-radius: 8px; z-index: 10; }
#train-panel h1 { font-size: 15px; margin: 0 0 8px; color: #fff; }
#train-panel .row { display: flex; justify-content: space-between; }
#train-panel .row b { color: #fff; font-weight: 600; }
#train-panel canvas { width: 100%; height: 120px; margin: 8px 0; background: #0c1018; border-radius: 4px; }
#train-panel .btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
#train-panel button { flex: 1 1 auto; padding: 5px 8px; background: #1b2230; color: #dfe6f0; border: 1px solid #344055; border-radius: 4px; cursor: pointer; font: inherit; }
#train-panel button.on { background: #2f6fd6; border-color: #2f6fd6; color: #fff; }
#train-panel .msg { margin-top: 8px; min-height: 1.5em; color: #9fd0ff; }
#train-panel .dim { color: #8a94a6; font-size: 12px; }
`;

/** The training page's side panel: progress numbers, a chart of each generation's best, and controls. */
export class TrainPanel {
  private readonly root: HTMLDivElement;
  private readonly stats: HTMLDivElement;
  private readonly chart: HTMLCanvasElement;
  private readonly runBtn: HTMLButtonElement;
  private readonly speedBtns: HTMLButtonElement[] = [];
  private readonly msg: HTMLDivElement;
  private chartLen = -1;

  constructor(actions: PanelActions) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'train-panel';
    this.root.innerHTML = `<h1>AI 訓練（神經演化）</h1><div class="stats"></div><canvas width="600" height="240"></canvas>
      <div class="dim">分數 ≈ 前進公尺數（撞車扣 ${FITNESS.crashPenalty}，完賽 ${ROAD_LENGTH} 起跳、越早越高）<br>藍線：每代最佳　黃點：驗證平均（沒看過的車流）</div>
      <div class="btns"><button data-a="run"></button><button data-s="1">1×</button><button data-s="4">4×</button><button data-s="10">10×</button></div>
      <div class="btns"><button data-a="reset">從頭訓練</button><button data-a="save">存檔</button></div><div class="msg"></div>`;
    document.body.appendChild(this.root);
    this.stats = this.root.querySelector('.stats')!;
    this.chart = this.root.querySelector('canvas')!;
    this.msg = this.root.querySelector('.msg')!;
    this.runBtn = this.root.querySelector('[data-a="run"]')!;
    this.runBtn.onclick = () => actions.onToggleRun();
    this.root.querySelector<HTMLButtonElement>('[data-a="reset"]')!.onclick = () => actions.onReset();
    this.root.querySelector<HTMLButtonElement>('[data-a="save"]')!.onclick = () => actions.onSave();
    this.root.querySelectorAll<HTMLButtonElement>('[data-s]').forEach((b) => {
      this.speedBtns.push(b);
      b.onclick = () => actions.onSpeed(Number(b.dataset.s));
    });
  }

  update(t: Trainer, info: PanelInfo): void {
    const sim = t.sim;
    const leader = sim.leader();
    const best = t.best;
    const last = t.history[t.history.length - 1];
    const row = (k: string, v: string) => `<div class="row"><span>${k}</span><b>${v}</b></div>`;
    this.stats.innerHTML =
      row('第幾代', `${t.generation}`) +
      row('存活', `${sim.aliveCount} / ${sim.ghosts.length}`) +
      row('本代時間', `${sim.time.toFixed(0)} / ${sim.timeLimit} 秒`) +
      row('本代領先距離', `${((leader?.result.distance ?? 0) / 1000).toFixed(2)} km`) +
      row('本代最高時速上限', `${t.speedCapKmh} km/h`) +
      row('上一代最佳', last ? `${Math.round(last.best)} 分（完賽 ${last.finishes}）` : '—') +
      row('歷代最佳（驗證）', best ? `${Math.round(best.score)} 分，完賽 ${best.finishes}/${best.runs}（第 ${best.gen} 代）` : '—') +
      row('驗證中', t.validating ? '是' : '否') +
      row('速度', `${info.speed}×（實際 ${info.actualSpeed.toFixed(1)}×）`) +
      `<div class="dim">族群 ${t.evo.population}・菁英 ${t.evo.elite}・突變幅度 ${t.evo.sigma}・突變比例 ${t.evo.rate}</div>`;
    this.runBtn.textContent = info.running ? '暫停' : '開始';
    this.runBtn.classList.toggle('on', info.running);
    for (const b of this.speedBtns) b.classList.toggle('on', Number(b.dataset.s) === info.speed);
    this.msg.textContent = info.message;
    const sig = t.history.length * 10 + t.history.filter((h) => h.validated).length;
    if (sig !== this.chartLen) {
      this.chartLen = sig;
      this.drawChart(t);
    }
  }

  private drawChart(t: Trainer): void {
    const c = this.chart;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    const maxY = ROAD_LENGTH + FITNESS.finishBonus;
    const minY = -FITNESS.crashPenalty;
    const h = t.history;
    const n = Math.max(2, h.length);
    const x = (i: number) => 10 + (i / (n - 1)) * (c.width - 20);
    const y = (v: number) => c.height - 10 - ((v - minY) / (maxY - minY)) * (c.height - 20);
    g.strokeStyle = '#2a3140';
    g.lineWidth = 1;
    for (const v of [0, ROAD_LENGTH]) {
      g.beginPath();
      g.moveTo(0, y(v));
      g.lineTo(c.width, y(v));
      g.stroke();
    }
    g.fillStyle = '#5a6578';
    g.font = '18px sans-serif';
    g.fillText('完賽', 14, y(ROAD_LENGTH) - 6);
    g.strokeStyle = '#4cc3ff';
    g.lineWidth = 3;
    g.beginPath();
    h.forEach((e, i) => (i ? g.lineTo(x(i), y(e.best)) : g.moveTo(x(i), y(e.best))));
    g.stroke();
    g.fillStyle = '#ffd400';
    h.forEach((e, i) => {
      if (!e.validated) return;
      g.beginPath();
      g.arc(x(i), y(e.validated.mean), 5, 0, Math.PI * 2);
      g.fill();
    });
  }
}
