import { describe, it, expect } from 'vitest';
import { bend, Centerline, straight } from '../src/road/centerline';
import { lineAt, racingLine, speedProfile } from '../src/ai/mountainLine';
import { maxAccel } from '../src/ai/planner';
import { STREET_RACER } from '../src/vehicles/cars';
import { KMH } from '../src/config';

const AI = STREET_RACER.ai;
const ROOM = 3.4;
const HAIRPIN = new Centerline([...straight(150), ...bend(18, 180, 12), ...straight(250)], { turnBack: true });

describe('racingLine', () => {
  const d = racingLine(HAIRPIN, ROOM);

  it('stays on the road (within the room either side)', () => {
    for (const x of d) expect(Math.abs(x)).toBeLessThanOrEqual(ROOM + 1e-6);
  });

  it('uses a bend widened (widen: its room more there), and bends less for it', () => {
    const widen = (s: number) => (s > 120 && s < 230 ? 1.5 : 0);
    const w = racingLine(HAIRPIN, ROOM, 2, widen);
    let most = 0;
    w.forEach((x, i) => {
      expect(Math.abs(x)).toBeLessThanOrEqual(ROOM + widen(i * 2) + 1e-6);
      most = Math.max(most, Math.abs(x));
    });
    expect(most).toBeGreaterThan(ROOM + 0.5);
    const peak = (line: Float64Array) => Math.max(...speedProfile(HAIRPIN, line, AI, 0.9, 300 * KMH).kappa.map(Math.abs));
    expect(peak(w)).toBeLessThan(peak(d));
  });

  it('bends less than the road at the hairpin', () => {
    const line = speedProfile(HAIRPIN, d, AI, 0.9, 300 * KMH);
    let peak = 0;
    for (const k of line.kappa) peak = Math.max(peak, Math.abs(k));
    expect(peak).toBeLessThan(1 / 18);
  });

  it('takes a bend wide in, the inside at its apex, wide out', () => {
    const road = new Centerline([...straight(200), ...bend(40, 90, 15), ...straight(200)], { turnBack: true });
    const line = speedProfile(road, racingLine(road, ROOM), AI, 0.9, 300 * KMH);
    expect(lineAt(line, 200 + (40 * Math.PI / 2 + 15) / 2).d).toBeGreaterThan(ROOM * 0.5); // (a right bend: its inside +d)
    expect(lineAt(line, 190).d).toBeLessThan(0);
    expect(lineAt(line, 200 + 40 * Math.PI / 2 + 15 + 10).d).toBeLessThan(0);
  });
});

describe('speedProfile', () => {
  const budget = 0.9;

  it('at the tightest point, as fast as the grip lets it (within 5 %)', () => {
    const line = speedProfile(HAIRPIN, racingLine(HAIRPIN, ROOM), AI, budget, 300 * KMH);
    let i = 0;
    line.kappa.forEach((k, j) => {
      if (Math.abs(k) > Math.abs(line.kappa[i])) i = j;
    });
    const v = line.v[i];
    const limit = Math.sqrt((budget * maxAccel(v, AI.latAccel)) / Math.abs(line.kappa[i]));
    expect(v / limit).toBeGreaterThan(0.95);
    expect(v / limit).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('never slows faster than its brakes (and the grade) allow', () => {
    const line = speedProfile(HAIRPIN, racingLine(HAIRPIN, ROOM), AI, budget, 300 * KMH);
    const most = Math.max(...AI.brake.map(([, a]) => a)) * budget;
    for (let i = 0; i + 1 < line.v.length; i++) {
      const drop = line.v[i] ** 2 - line.v[i + 1] ** 2;
      expect(drop).toBeLessThanOrEqual(2 * line.step * 1.05 * most + 1e-6);
    }
  });

  it('starts braking for a bend earlier going downhill than uphill', () => {
    const plan = [...straight(600), ...bend(40, 90, 20), ...straight(200)];
    const down = new Centerline(plan, { turnBack: true, grades: [{ len: 1, g: -0.08 }, { len: 1000, g: -0.08 }] });
    const up = new Centerline(plan, { turnBack: true, grades: [{ len: 1, g: 0.08 }, { len: 1000, g: 0.08 }] });
    const brakeFrom = (road: Centerline) => {
      const line = speedProfile(road, racingLine(road, ROOM), AI, budget, 300 * KMH);
      let i = Math.floor(600 / line.step);
      while (i > 0 && line.v[i - 1] > line.v[i] + 1e-9) i--;
      return i * line.step;
    };
    expect(brakeFrom(down)).toBeLessThan(brakeFrom(up));
  });

  it('takes a banked hairpin faster: the bank carries g x its slope of the turn (on the grip\'s budget)', () => {
    const plan = [...straight(150), ...bend(18, 180, 12), ...straight(250)];
    const flat = new Centerline(plan, { turnBack: true });
    const banked = new Centerline(plan, { turnBack: true, bank: { max: (8 * Math.PI) / 180, full: 1 / 40 } });
    const apex = (road: Centerline) => {
      const line = speedProfile(road, racingLine(road, ROOM), AI, budget, 300 * KMH);
      return Math.min(...line.v.slice(Math.floor(160 / line.step), Math.floor(200 / line.step)));
    };
    const vf = apex(flat);
    const vb = apex(banked);
    expect(vb).toBeGreaterThan(vf * 1.03);
    expect(vb).toBeLessThan(vf * 1.15);
  });

  it('starts from a standstill and stays under its top speed', () => {
    const line = speedProfile(HAIRPIN, racingLine(HAIRPIN, ROOM), AI, budget, 200 * KMH);
    expect(line.v[0]).toBe(0);
    for (const v of line.v) expect(v).toBeLessThanOrEqual(200 * KMH + 1e-9);
  });
});

describe('speedProfile, over a crest and through an S (opts)', () => {
  const budget = 1;
  // (a long right bend, over a crest at its middle: up 8 %, down 8 % - or a dip, the other way round)
  const plan = [...straight(300), ...bend(120, 90, 20), ...straight(300)];
  const mid = 300 + (120 * Math.PI) / 2 / 2 + 10;
  const over = (g: number) => new Centerline(plan, { turnBack: true, grades: [{ len: 1, g }, { len: mid - 60, g }, { len: 120, g: -g }, { len: 400, g: -g }] });
  const at = (line: ReturnType<typeof speedProfile>, s: number) => line.v[Math.round(s / line.step)];

  it("over a crest slower by its tyres' load (1 + v² x its rise's curvature / g), as fast as on the flat in a dip", () => {
    const crest = over(0.08);
    const without = speedProfile(crest, racingLine(crest, ROOM), AI, budget, 300 * KMH);
    const with_ = speedProfile(crest, racingLine(crest, ROOM), AI, budget, 300 * KMH, 2, { crest: true });
    const v = at(with_, mid), v0 = at(without, mid);
    expect(v).toBeLessThan(v0 * 0.97);
    const rise = (crest.grade(mid + 1) - crest.grade(mid - 1)) / 2;
    const k = Math.abs(with_.kappa[Math.round(mid / 2)]);
    const bank = 0; // (no bank on this road)
    expect(v * v * k).toBeCloseTo(budget * maxAccel(v, AI.latAccel) * (1 + (v * v * rise) / 9.81) + bank, 0);
    const dip = over(-0.08);
    expect(at(speedProfile(dip, racingLine(dip, ROOM), AI, budget, 300 * KMH, 2, { crest: true }), mid)).toBeCloseTo(at(speedProfile(dip, racingLine(dip, ROOM), AI, budget, 300 * KMH), mid), 6);
  });

  it("its sideways acceleration changing no faster than `jerk` (v³ x its curvature's change), where it would", () => {
    const s = new Centerline([...straight(200), ...bend(80, 60, 15), ...bend(80, -60, 15), ...straight(300)], { turnBack: true });
    const d = racingLine(s, ROOM);
    const free = speedProfile(s, d, AI, budget, 300 * KMH);
    const held = speedProfile(s, d, AI, budget, 300 * KMH, 2, { jerk: 15 });
    let worst = 0, slower = 0;
    for (let i = 2; i + 2 < held.v.length; i++) {
      const dk = Math.abs(held.kappa[i + 2] - held.kappa[i - 2]) / (4 * held.step);
      worst = Math.max(worst, held.v[i] ** 3 * dk);
      if (held.v[i] < free.v[i] - 1e-6) slower++;
    }
    expect(worst).toBeLessThanOrEqual(15 * 1.001);
    expect(slower).toBeGreaterThan(0);
  });
});
