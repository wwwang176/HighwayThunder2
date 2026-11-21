import { describe, it, expect } from 'vitest';
import { lineUp, planCity, type CityPlanParams, type PlanRoad } from '../src/world/cityPlan';
import { mulberry32 } from '../src/ai/rng';

const P: CityPlanParams = {
  period: 800,
  deck: { left: -33.45, right: 10.45, mid: -11.5 },
  alongClear: 22,
  bands: [
    { near: [-25, 30], far: 320 },
    { near: [330, 360], far: 620 },
  ],
  gap: { odds: 0.25, size: [30, 120] },
  yaw: (30 * Math.PI) / 180,
  lots: [2, 3],
  blocksAcross: [2, 4],
  blocksAlong: [1, 3],
  lot: 26,
  size: [13, 22],
  empty: 0.15,
  apart: 6,
  maxAlong: 190,
  top: [6, 130],
  clear: 40,
  minor: { asphalt: 7, walk: 2, lampEvery: 40 },
  major: { asphalt: 14, walk: 3, lampEvery: 36 },
  led: 0.35,
};
const half = (r: PlanRoad) => (r.major ? P.major : P.minor).asphalt / 2 + (r.major ? P.major : P.minor).walk;
const same = (a: { s: number; d: number }, b: { s: number; d: number }) => a.s === b.s && a.d === b.d;

describe('cityPlan', () => {
  it('lines a district up: blocks of lots, a major road round each block, minor ones between its lots', () => {
    const L = lineUp(2, 3, P);
    expect(L.roads.map((r) => r.major)).toEqual([true, false, false, true, false, false, true]);
    expect(L.lots.length).toBe(6);
    expect(L.length).toBeCloseTo(2 * (3 * 26 + 2 * 11) + 3 * 20);
    expect(L.roads[0].at - 10).toBeCloseTo(-L.length / 2);
  });

  for (const seed of [1, 42, 7]) {
    const plan = planCity(P, mulberry32(seed));
    it(`seed ${seed}: buildings on their lots - none on a street, none near the deck`, () => {
      expect(plan.buildings.length).toBeGreaterThan(100);
      for (const b of plan.buildings) {
        const side = b.d > P.deck.mid ? 1 : -1;
        const edge = side > 0 ? P.deck.right : P.deck.left;
        const across = b.d + b.u * b.cy + b.v * b.sy;
        expect(side * (across - edge) - ((b.w / 2) * b.cy + (b.l / 2) * Math.abs(b.sy))).toBeGreaterThanOrEqual(P.clear);
        for (const r of plan.roads.filter((r) => same(r, b))) {
          // (the road's axis: along it, from - to; across it, half its width either side of `at`)
          const [along, off, a, l] = r.alongU ? [b.u, b.v, b.w, b.l] : [b.v, b.u, b.l, b.w];
          const overlaps = along + a / 2 > r.from && along - a / 2 < r.to && Math.abs(off - r.at) < l / 2 + half(r);
          expect(overlaps).toBe(false);
        }
      }
    });
    it(`seed ${seed}: streets across the deck end at its middle, none along it under it`, () => {
      for (const r of plan.roads) {
        const side = r.d > P.deck.mid ? 1 : -1;
        for (const t of [r.from, r.to]) {
          const across = r.alongU ? r.d + t * r.cy + r.at * r.sy : r.d + r.at * r.cy + t * r.sy;
          if (r.alongU) expect(side * (across - P.deck.mid)).toBeGreaterThanOrEqual(-1e-6);
          else expect(across > P.deck.right + P.alongClear || across < P.deck.left - P.alongClear).toBe(true);
        }
      }
    });
  }
});
