import { LANE_COUNT, LANE_WIDTH, RAIL_D } from '../config';
import { laneAt, laneCenter, lanesOccupied } from '../road/coords';
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
  /**
   * The lane a vehicle is about to move into: the sensors treat it as taken
   * (so the AI keeps clear), but touching it is not a crash.
   */
  phantom?: boolean;
}

/**
 * Bump when the inputs below change: trained driver files record it.
 * v2: left edge = 2 m onto the median grass. v3: shoulder / grass objects count in the edge lanes.
 * v4: radar relative to the own lane (much easier for a small network to learn than absolute lanes).
 */
export const SENSOR_LAYOUT = 'ego-radar-v4';
/** Radar lanes, relative to the car's own lane: two to the left, own, two to the right. */
const REL_LANES = [-2, -1, 0, 1, 2];
export const SENSOR_COUNT = REL_LANES.length * 4 + 9;

const RADAR_AHEAD = 300;
const RADAR_BEHIND = 50;
const CLOSING_SCALE = 50;
const SPEED_SCALE = 83.3;
const HALF_LENGTH = 2.2; // the AI car (same body as the player's)
const HALF_WIDTH = 0.93;

const clamp = (x: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, x));
const LEFT_LANE = [0];
const RIGHT_LANE = [LANE_COUNT - 1];
const NONE: number[] = [];

/**
 * Lanes an object counts in. Something on the shoulder or the median grass
 * (where the car may also drive) counts in the nearest edge lane; anything
 * beyond where the car may go is ignored.
 */
function lanesSeen(t: TrafficBox): number[] {
  const lanes = lanesOccupied(t.dMin, t.dMax);
  if (lanes.length > 0) return lanes;
  if (t.dMax < LEFT_LIMIT || t.dMin > RIGHT_LIMIT) return NONE;
  return t.dMax < 0 ? LEFT_LANE : RIGHT_LANE;
}
const aheadGap = new Float32Array(LANE_COUNT);
const aheadV = new Float32Array(LANE_COUNT);
const behindGap = new Float32Array(LANE_COUNT);
const behindV = new Float32Array(LANE_COUNT);

/**
 * What the AI "sees" (it is allowed to cheat: exact positions and speeds).
 * Radar per lane relative to its own (slot k = lane offset k - 2: two left ... own ... two right),
 * nearest vehicle ahead / behind; a lane that does not exist reads as blocked right here:
 *  [k*4+0] gap ahead / 300 m (1 = clear)   [k*4+1] closing speed on it / 50 m/s
 *  [k*4+2] gap behind / 50 m (1 = clear)   [k*4+3] its closing speed on us / 50 m/s
 * Then its own state:
 *  [20] vLong  [21] vLat  [22] yaw  [23] yaw rate  [24] offset from the own lane's centre (±half lane)
 *  [25] room to the right limit  [26] room to the left limit (2 m onto the grass)  [27] speed cap  [28] d / rail
 */
export function readSensors(self: SelfState, traffic: TrafficBox[], out = new Float32Array(SENSOR_COUNT)): Float32Array {
  aheadGap.fill(Infinity);
  behindGap.fill(Infinity);
  for (const t of traffic) {
    const ahead = t.s > self.s;
    const gap = ahead ? t.s - t.length / 2 - (self.s + HALF_LENGTH) : self.s - HALF_LENGTH - (t.s + t.length / 2);
    if (gap > (ahead ? RADAR_AHEAD : RADAR_BEHIND)) continue;
    for (const lane of lanesSeen(t)) {
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
  const own = laneAt(self.d);
  REL_LANES.forEach((rel, k) => {
    const lane = own + rel;
    const i = k * 4;
    if (lane < 0 || lane >= LANE_COUNT) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
      return;
    }
    const a = aheadGap[lane];
    const b = behindGap[lane];
    out[i] = a === Infinity ? 1 : clamp(a / RADAR_AHEAD, 0, 1);
    out[i + 1] = a === Infinity ? 0 : clamp((self.vLong - aheadV[lane]) / CLOSING_SCALE);
    out[i + 2] = b === Infinity ? 1 : clamp(b / RADAR_BEHIND, 0, 1);
    out[i + 3] = b === Infinity ? 0 : clamp((behindV[lane] - self.vLong) / CLOSING_SCALE);
  });
  const o = REL_LANES.length * 4;
  out[o] = clamp(self.vLong / SPEED_SCALE);
  out[o + 1] = clamp(self.vLat / 10);
  out[o + 2] = clamp(self.yaw / 0.5);
  out[o + 3] = clamp(self.yawRate / 2);
  out[o + 4] = clamp((self.d - laneCenter(own)) / (LANE_WIDTH / 2));
  out[o + 5] = clamp((RIGHT_LIMIT - (self.d + HALF_WIDTH)) / 10);
  out[o + 6] = clamp((self.d - HALF_WIDTH - LEFT_LIMIT) / 10);
  out[o + 7] = clamp(self.speedCap / SPEED_SCALE);
  out[o + 8] = clamp(self.d / RAIL_D);
  return out;
}
