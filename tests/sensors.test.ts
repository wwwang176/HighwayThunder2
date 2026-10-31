import { describe, it, expect } from 'vitest';
import { readSensors, SelfState, SENSOR_COUNT, TrafficBox } from '../src/ai/sensors';
import { laneCenter } from '../src/road/coords';

const self = (o: Partial<SelfState> = {}): SelfState => ({ s: 0, d: laneCenter(1), yaw: 0, vLong: 30, vLat: 0, yawRate: 0, speedCap: 83.3, ...o });
const car = (s: number, lane: number, v: number, length = 4.6): TrafficBox => ({
  s,
  dMin: laneCenter(lane) - 0.9,
  dMax: laneCenter(lane) + 0.9,
  v,
  length,
});

describe('readSensors', () => {
  it('empty road: every lane clear ahead and behind, no closing speed', () => {
    const x = readSensors(self(), []);
    expect(x.length).toBe(SENSOR_COUNT);
    expect(SENSOR_COUNT).toBe(24);
    for (let lane = 0; lane < 4; lane++) {
      expect(x[lane * 4]).toBe(1);
      expect(x[lane * 4 + 1]).toBe(0);
      expect(x[lane * 4 + 2]).toBe(1);
      expect(x[lane * 4 + 3]).toBe(0);
    }
  });

  it('a slower car 150 m ahead in lane 2', () => {
    const x = readSensors(self(), [car(150, 2, 20)]);
    expect(x[2 * 4]).toBeCloseTo((150 - 2.3 - 2.2) / 300, 5);
    expect(x[2 * 4 + 1]).toBeCloseTo(10 / 50, 5);
    expect(x[1 * 4]).toBe(1); // other lanes unaffected
  });

  it('a car behind closing in', () => {
    const x = readSensors(self(), [car(-20, 0, 40)]);
    expect(x[0 * 4 + 2]).toBeCloseTo((20 - 2.3 - 2.2) / 50, 5);
    expect(x[0 * 4 + 3]).toBeCloseTo(10 / 50, 5);
  });

  it('a car straddling lanes 1 and 2 shows up in both', () => {
    const mid = (laneCenter(1) + laneCenter(2)) / 2;
    const x = readSensors(self(), [{ s: 80, dMin: mid - 0.9, dMax: mid + 0.9, v: 25, length: 4.6 }]);
    expect(x[1 * 4]).toBeLessThan(1);
    expect(x[2 * 4]).toBeLessThan(1);
  });

  it('cars beyond the radar range are not seen', () => {
    const x = readSensors(self(), [car(400, 1, 20), car(-80, 1, 20)]);
    expect(x[1 * 4]).toBe(1);
    expect(x[1 * 4 + 2]).toBe(1);
  });

  it('own state: edge margins and speed cap', () => {
    const x = readSensors(self({ d: 9, vLong: 41.65, speedCap: 41.65 }), []);
    expect(x[16]).toBeCloseTo(0.5, 2); // vLong / 83.3
    expect(x[21]).toBeCloseTo((10 - 9.93) / 10, 5); // right margin
    expect(x[22]).toBe(1); // left margin clamps
    expect(x[23]).toBeCloseTo(0.5, 2);
  });

  it('all values stay within [-1, 1]', () => {
    const x = readSensors(self({ vLat: 50, yaw: 3, yawRate: -9, d: -30 }), [car(5, 1, 0)]);
    for (const v of x) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
