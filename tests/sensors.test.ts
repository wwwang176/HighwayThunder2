import { describe, it, expect } from 'vitest';
import { readSensors, SelfState, SENSOR_COUNT, TrafficBox } from '../src/ai/sensors';
import { LEFT_LIMIT } from '../src/ai/fitness';
import { laneCenter } from '../src/road/coords';

const self = (o: Partial<SelfState> = {}): SelfState => ({ s: 0, d: laneCenter(1), yaw: 0, vLong: 30, vLat: 0, yawRate: 0, speedCap: 83.3, ...o });
const car = (s: number, lane: number, v: number, length = 4.6): TrafficBox => ({
  s,
  dMin: laneCenter(lane) - 0.9,
  dMax: laneCenter(lane) + 0.9,
  v,
  length,
});
// Radar slots are relative to the car's own lane: slot 0 = two lanes left ... 2 = own lane ... 4 = two lanes right.
const slot = (rel: number) => (rel + 2) * 4;

describe('readSensors (radar relative to the own lane)', () => {
  it('empty road: lanes that exist are clear, lanes that do not are blocked', () => {
    const x = readSensors(self(), []); // own lane = 1
    expect(x.length).toBe(SENSOR_COUNT);
    expect(SENSOR_COUNT).toBe(29);
    for (const rel of [-1, 0, 1, 2]) {
      expect(x[slot(rel)]).toBe(1);
      expect(x[slot(rel) + 1]).toBe(0);
      expect(x[slot(rel) + 2]).toBe(1);
      expect(x[slot(rel) + 3]).toBe(0);
    }
    // Two lanes to the left of lane 1 there is no lane: reads as blocked right here.
    expect(x[slot(-2)]).toBe(0);
    expect(x[slot(-2) + 2]).toBe(0);
  });

  it('a slower car 150 m ahead one lane to the right', () => {
    const x = readSensors(self(), [car(150, 2, 20)]);
    expect(x[slot(1)]).toBeCloseTo((150 - 2.3 - 2.2) / 300, 5);
    expect(x[slot(1) + 1]).toBeCloseTo(10 / 50, 5);
    expect(x[slot(0)]).toBe(1); // own lane still clear
  });

  it('the radar follows the car when it changes lanes', () => {
    const traffic = [car(100, 3, 20)];
    expect(readSensors(self({ d: laneCenter(1) }), traffic)[slot(2)]).toBeLessThan(1);
    expect(readSensors(self({ d: laneCenter(3) }), traffic)[slot(0)]).toBeLessThan(1);
  });

  it('a car behind closing in', () => {
    const x = readSensors(self(), [car(-20, 0, 40)]);
    expect(x[slot(-1) + 2]).toBeCloseTo((20 - 2.3 - 2.2) / 50, 5);
    expect(x[slot(-1) + 3]).toBeCloseTo(10 / 50, 5);
  });

  it('a car straddling lanes 1 and 2 shows up in both', () => {
    const mid = (laneCenter(1) + laneCenter(2)) / 2;
    const x = readSensors(self(), [{ s: 80, dMin: mid - 0.9, dMax: mid + 0.9, v: 25, length: 4.6 }]);
    expect(x[slot(0)]).toBeLessThan(1);
    expect(x[slot(1)]).toBeLessThan(1);
  });

  it('wrecks on the shoulder or the median grass show up in the nearest edge lane', () => {
    const x = readSensors(self(), [
      { s: 60, dMin: 8.4, dMax: 9.9, v: 0, length: 4.6 }, // right shoulder -> lane 3 = rel +2
      { s: 90, dMin: -11.5, dMax: -10.2, v: 0, length: 4.6 }, // median grass -> lane 0 = rel -1
    ]);
    expect(x[slot(2)]).toBeLessThan(1);
    expect(x[slot(-1)]).toBeLessThan(1);
    expect(x[slot(0)]).toBe(1);
    expect(x[slot(1)]).toBe(1);
    expect(readSensors(self(), [{ s: 60, dMin: -18, dMax: -16, v: 0, length: 4.6 }])[slot(-1)]).toBe(1);
  });

  it('cars beyond the radar range are not seen', () => {
    const x = readSensors(self(), [car(400, 1, 20), car(-80, 1, 20)]);
    expect(x[slot(0)]).toBe(1);
    expect(x[slot(0) + 2]).toBe(1);
  });

  it('own state: position in the lane, edge margins and speed cap', () => {
    const x = readSensors(self({ d: laneCenter(1) + 0.9375, vLong: 41.65, speedCap: 41.65 }), []);
    expect(x[20]).toBeCloseTo(0.5, 2); // vLong / 83.3
    expect(x[24]).toBeCloseTo(0.5, 5); // a quarter lane right of the lane centre
    expect(x[27]).toBeCloseTo(0.5, 2); // speed cap
    const edge = readSensors(self({ d: 9 }), []);
    expect(edge[25]).toBeCloseTo((10 - 9.93) / 10, 5); // right margin
    expect(readSensors(self({ d: -10 }), [])[26]).toBeCloseTo((-10.93 - LEFT_LIMIT) / 10, 5); // left margin on the grass
  });

  it('all values stay within [-1, 1]', () => {
    const x = readSensors(self({ vLat: 50, yaw: 3, yawRate: -9, d: -30 }), [car(5, 1, 0)]);
    for (const v of x) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
