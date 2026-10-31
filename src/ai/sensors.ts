import { LANE_COUNT, RAIL_D } from '../config';
import { lanesOccupied } from '../road/coords';
import { LEFT_LIMIT, RIGHT_LIMIT } from './fitness';

/** The AI car's own state, in our carriageway's road coordinates. */
export interface SelfState {
  s: number;
  d: number;
  yaw: number;
  vLong: number;
  vLat: number;
  yawRate: number;
  /** Top speed the car is limited to (m/s); the network knows its own limit. */
  speedCap: number;
}

/** A vehicle (or wreck) on our carriageway as an axis-aligned box in road coordinates. */
export interface TrafficBox {
  s: number;
  dMin: number;
  dMax: number;
  v: number;
  length: number;
}

/** Bump when the inputs below change: trained driver files record it. */
export const SENSOR_LAYOUT = 'lane-radar-v2'; // v2: left edge = 2 m onto the median grass
export const SENSOR_COUNT = LANE_COUNT * 4 + 8;

const RADAR_AHEAD = 300;
const RADAR_BEHIND = 50;
const CLOSING_SCALE = 50;
const SPEED_SCALE = 83.3;
const HALF_LENGTH = 2.2; // the AI car (same body as the player's)
const HALF_WIDTH = 0.93;

const clamp = (x: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, x));
const aheadGap = new Float32Array(LANE_COUNT);
const aheadV = new Float32Array(LANE_COUNT);
const behindGap = new Float32Array(LANE_COUNT);
const behindV = new Float32Array(LANE_COUNT);

/**
 * What the AI "sees" (it is allowed to cheat: exact positions and speeds).
 * Per lane: nearest vehicle ahead / behind (gap and closing speed), then its own state:
 *  [lane*4+0] gap ahead / 300 m (1 = clear)   [lane*4+1] closing speed on it / 50 m/s
 *  [lane*4+2] gap behind / 50 m (1 = clear)   [lane*4+3] its closing speed on us / 50 m/s
 *  [16] vLong  [17] vLat  [18] yaw  [19] yaw rate  [20] d / rail
 *  [21] room to the right limit  [22] room to the left limit (2 m onto the grass)  [23] speed cap
 */
export function readSensors(self: SelfState, traffic: TrafficBox[], out = new Float32Array(SENSOR_COUNT)): Float32Array {
  aheadGap.fill(Infinity);
  behindGap.fill(Infinity);
  for (const t of traffic) {
    const ahead = t.s > self.s;
    const gap = ahead ? t.s - t.length / 2 - (self.s + HALF_LENGTH) : self.s - HALF_LENGTH - (t.s + t.length / 2);
    if (gap > (ahead ? RADAR_AHEAD : RADAR_BEHIND)) continue;
    for (const lane of lanesOccupied(t.dMin, t.dMax)) {
      if (ahead) {
        if (gap < aheadGap[lane]) {
          aheadGap[lane] = gap;
          aheadV[lane] = t.v;
        }
      } else if (gap < behindGap[lane]) {
        behindGap[lane] = gap;
        behindV[lane] = t.v;
      }
    }
  }
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    const a = aheadGap[lane];
    const b = behindGap[lane];
    out[lane * 4] = a === Infinity ? 1 : clamp(a / RADAR_AHEAD, 0, 1);
    out[lane * 4 + 1] = a === Infinity ? 0 : clamp((self.vLong - aheadV[lane]) / CLOSING_SCALE);
    out[lane * 4 + 2] = b === Infinity ? 1 : clamp(b / RADAR_BEHIND, 0, 1);
    out[lane * 4 + 3] = b === Infinity ? 0 : clamp((behindV[lane] - self.vLong) / CLOSING_SCALE);
  }
  const o = LANE_COUNT * 4;
  out[o] = clamp(self.vLong / SPEED_SCALE);
  out[o + 1] = clamp(self.vLat / 10);
  out[o + 2] = clamp(self.yaw / 0.5);
  out[o + 3] = clamp(self.yawRate / 2);
  out[o + 4] = clamp(self.d / RAIL_D);
  out[o + 5] = clamp((RIGHT_LIMIT - (self.d + HALF_WIDTH)) / 10);
  out[o + 6] = clamp((self.d - HALF_WIDTH - LEFT_LIMIT) / 10);
  out[o + 7] = clamp(self.speedCap / SPEED_SCALE);
  return out;
}
