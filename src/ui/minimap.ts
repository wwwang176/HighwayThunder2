import type { Centerline } from '../road/centerline';

/** The map: how far it shows round the car (m, its edge), the road's line every this many m, how thick (m, at least px). */
const MAP = { reach: 220, step: 4, roadWidth: 10, roadMinPx: 3 };

/**
 * A point (dx, dz from the car, world) on the car's map, the car heading up it: how far ahead of the car, how far to
 * its right (m). `heading`: the car's heading in the world (0 along -z, + turning toward +x: PlayerCar.worldYaw).
 */
export function toMap(dx: number, dz: number, heading: number): { ahead: number; right: number } {
  const fx = Math.sin(heading);
  const fz = -Math.cos(heading);
  return { ahead: dx * fx + dz * fz, right: dx * Math.cos(heading) + dz * Math.sin(heading) };
}

/** A car on the map: where it is (world), its colour (CSS). */
export interface MapCar {
  x: number;
  z: number;
  color: string;
}

/**
 * The round map in the race HUD's bottom left (the mountain road's): the road round the car, the car in the middle
 * heading up, the others as dots in their colours, the finish's flag once it is near.
 */
export class Minimap {
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private xs = new Float32Array(0);
  private zs = new Float32Array(0);
  private finish: { x: number; z: number } | null = null;

  constructor(parent: HTMLElement) {
    const box = document.createElement('div');
    box.className = 'h-map';
    box.innerHTML = '<div class="pool"></div>';
    box.appendChild(this.canvas);
    parent.appendChild(box);
    parent.classList.add('has-map');
    this.g = this.canvas.getContext('2d')!;
  }

  /** The road to draw (a new race's), and where it ends (its finish). */
  setRoad(road: Centerline, length: number): void {
    const n = Math.floor((length + 300) / MAP.step) + 1;
    this.xs = new Float32Array(n);
    this.zs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = road.toWorld(i * MAP.step - 100, 0);
      this.xs[i] = p.x;
      this.zs[i] = p.z;
    }
    this.finish = road.toWorld(length, 0);
  }

  /** Drawn for the car at (x, z) heading `heading` (world), the others `cars`; `accent`: the car's colour. */
  update(x: number, z: number, heading: number, cars: MapCar[], accent: string): void {
    const c = this.canvas;
    const px = Math.round(c.clientWidth * devicePixelRatio);
    if (px <= 0) return;
    if (c.width !== px) c.width = c.height = px;
    const g = this.g;
    const r = px / 2;
    const k = r / MAP.reach; // (px a metre)
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, px, px);
    g.save();
    g.beginPath();
    g.arc(r, r, r - 1, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = 'rgba(6, 10, 18, 0.55)';
    g.fillRect(0, 0, px, px);
    // The road: its line round the car (a little past the edge: no gap where it leaves).
    const far2 = (MAP.reach * 1.5) ** 2;
    g.strokeStyle = 'rgba(225, 230, 240, 0.85)';
    g.lineWidth = Math.max(MAP.roadMinPx * devicePixelRatio, MAP.roadWidth * k);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    let pen = false;
    for (let i = 0; i < this.xs.length; i++) {
      const dx = this.xs[i] - x;
      const dz = this.zs[i] - z;
      if (dx * dx + dz * dz > far2) {
        pen = false;
        continue;
      }
      const m = toMap(dx, dz, heading);
      const sx = r + m.right * k;
      const sy = r - m.ahead * k;
      if (pen) g.lineTo(sx, sy);
      else g.moveTo(sx, sy);
      pen = true;
    }
    g.stroke();
    // The finish: a chequered square.
    if (this.finish) {
      const m = toMap(this.finish.x - x, this.finish.z - z, heading);
      if (Math.hypot(m.ahead, m.right) < MAP.reach) {
        const s = 4 * devicePixelRatio;
        const fx = r + m.right * k;
        const fy = r - m.ahead * k;
        for (let a = 0; a < 2; a++)
          for (let b = 0; b < 2; b++) {
            g.fillStyle = (a + b) % 2 ? '#111' : '#fff';
            g.fillRect(fx - s + a * s, fy - s + b * s, s, s);
          }
      }
    }
    // The others, as dots.
    for (const o of cars) {
      const m = toMap(o.x - x, o.z - z, heading);
      g.fillStyle = o.color;
      g.beginPath();
      g.arc(r + m.right * k, r - m.ahead * k, 4.5 * devicePixelRatio, 0, Math.PI * 2);
      g.fill();
    }
    // The car: an arrow up the middle.
    const a = 9 * devicePixelRatio;
    g.fillStyle = accent;
    g.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    g.lineWidth = 1.5 * devicePixelRatio;
    g.beginPath();
    g.moveTo(r, r - a);
    g.lineTo(r + a * 0.65, r + a * 0.7);
    g.lineTo(r, r + a * 0.35);
    g.lineTo(r - a * 0.65, r + a * 0.7);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    // Its rim.
    g.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    g.lineWidth = 1.5 * devicePixelRatio;
    g.beginPath();
    g.arc(r, r, r - devicePixelRatio, 0, Math.PI * 2);
    g.stroke();
  }
}
