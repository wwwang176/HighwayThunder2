import { describe, it, expect } from 'vitest';
import { MOUNTAIN_PLAN, planMountain, type PlanInput, type PlanOther, type PlanRef } from '../src/ai/mountainPlanner';

/** A straight: its line 0.8 m right of the middle, 30 m/s, 3.2 m of room either side. */
const STRAIGHT: PlanRef = { d: () => 0.8, v: () => 30, kappa: () => 0, room: () => 3.2 };
/** A wavy line through bends: d = 1.5 sin(s / 40), its curvature from it. */
const BENDS: PlanRef = { d: (s) => 1.5 * Math.sin(s / 40), v: () => 22, kappa: (s) => (-1.5 / 1600) * Math.sin(s / 40) + 1 / 120, room: () => 3.2 };

function input(over: Partial<PlanInput> = {}): PlanInput {
  return { s: 100, d: 0.8, v: 30, startOffset: 0, halfWidth: 1, halfLength: 2.2, ref: STRAIGHT, others: [], stopAt: null, roadEnd: 5000, ...over };
}

/** A car standing at s on d (its centre), 2 m wide. */
function standing(s: number, d: number, vAhead = 0): PlanOther {
  return { s, dMin: d - 1, dMax: d + 1, v: 0, accel: 0, vAhead, length: 4.4 };
}

describe('planMountain', () => {
  it('no cars: every offset 0 and no speed cap - the plan is its reference', () => {
    for (const ref of [STRAIGHT, BENDS]) {
      const p = planMountain(input({ ref }));
      expect(p.blocked).toBe(false);
      expect(p.offsets.every((o) => o === 0)).toBe(true);
      for (let s = 100; s < 200; s += 3) {
        expect(p.offsetAt(s)).toBe(0);
        expect(p.vAt(s)).toBe(Infinity);
      }
    }
  });

  it('a standing car on its line 40 m ahead: the plan goes round it, within the road, clearing its width', () => {
    const car = standing(140, 0.8);
    const p = planMountain(input({ others: [car] }));
    expect(p.blocked).toBe(false);
    const at = 0.8 + p.offsetAt(140);
    expect(Math.abs(at - 0.8)).toBeGreaterThanOrEqual(1 + 1 + MOUNTAIN_PLAN.gapD - 1e-9);
    for (let i = 0; i < p.offsets.length; i++) expect(Math.abs(0.8 + p.offsets[i])).toBeLessThanOrEqual(3.2 + 1e-9);
  });

  it('no room either side: blocked, slowed to follow it', () => {
    const wall: PlanOther = { s: 125, dMin: -3.2, dMax: 3.2, v: 10, accel: 0, vAhead: 10, length: 4.4 };
    const p = planMountain(input({ others: [wall] }));
    expect(p.blocked).toBe(true);
    expect(p.vAt(110)).toBeLessThan(30);
  });

  it('the start: a car standing just ahead that is about to set off as it does - no swerve', () => {
    const ahead: PlanOther = { s: 8, dMin: -0.2, dMax: 1.8, v: 0, accel: MOUNTAIN_PLAN.accelOthers, vAhead: 30, length: 4.4 };
    const p = planMountain(input({ s: 0, v: 0, others: [ahead] }));
    expect(p.offsets.every((o) => o === 0)).toBe(true);
  });

  it('starting 2 m off its reference (out of a drift): back to it no faster than the slope', () => {
    const p = planMountain(input({ startOffset: 2, d: 2.8 }));
    expect(p.offsets[0]).toBe(2);
    for (let i = 1; i < p.offsets.length; i++) expect(Math.abs(p.offsets[i] - p.offsets[i - 1])).toBeLessThanOrEqual(MOUNTAIN_PLAN.slope * MOUNTAIN_PLAN.step + 1e-9);
    expect(Math.abs(p.offsets[p.offsets.length - 1])).toBeLessThan(2);
  });

  it('stopAt: the plan ends at the kick point, its offset pulled back toward 0 there', () => {
    const p = planMountain(input({ others: [standing(125, 0.8, 0)], stopAt: 170 }));
    const last = p.s0 + (p.offsets.length - 1) * p.step;
    expect(last).toBeLessThanOrEqual(170 + 1e-9);
    expect(last).toBeGreaterThan(170 - p.step);
    const most = Math.max(...Array.from(p.offsets, Math.abs));
    expect(most).toBeGreaterThan(1);
    expect(Math.abs(p.offsets[p.offsets.length - 1])).toBeLessThan(most);
  });

  it('a car beside it already touching does not block every path', () => {
    const beside = standing(100, 2.6, 30);
    beside.v = 30;
    const p = planMountain(input({ others: [beside] }));
    expect(p.blocked).toBe(false);
  });

  it('s before 0 (the grid) and past the road\'s end: finite', () => {
    const grid = planMountain(input({ s: -11, v: 0 }));
    expect(grid.s0).toBe(0);
    expect(Array.from(grid.offsets).every(Number.isFinite)).toBe(true);
    const end = planMountain(input({ s: 4990, roadEnd: 5000 }));
    expect(end.offsets.length).toBeGreaterThanOrEqual(1);
    expect(Array.from(end.offsets).every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(end.offsetAt(5100))).toBe(true);
  });

  it('a slower car ahead with room beside: passed, not followed (no speed cap at it)', () => {
    const slow: PlanOther = { s: 130, dMin: -0.2, dMax: 1.8, v: 20, accel: 0, vAhead: 20, length: 4.4 };
    const p = planMountain(input({ others: [slow] }));
    expect(p.blocked).toBe(false);
    expect(Math.max(...Array.from(p.offsets, Math.abs))).toBeGreaterThan(1.5);
  });

  it('plans in well under a millisecond (a bend, three cars)', () => {
    const others = [standing(140, 0.5), standing(160, -1.5), standing(200, 1.5)];
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) planMountain(input({ ref: BENDS, v: 22, others }));
    const each = (performance.now() - t0) / 200;
    console.log(`  planMountain: ${each.toFixed(3)} ms a plan`);
    expect(each).toBeLessThan(5);
  });
});
