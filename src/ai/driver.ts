import { IdmParams, KMH, LANE_WIDTH, PHYSICS_DT } from '../config';
import { idmAccel } from '../traffic/idm';
import { laneCenter } from '../road/coords';
import { CarParams, DEFAULT_CAR, HandlingInput } from '../vehicles/handling';
import type { PlayerCar } from '../vehicles/playerCar';
import { Brain, forward } from './brain';
import { LaneController } from './laneController';
import { readSensors, SelfState, SENSOR_COUNT, TrafficBox } from './sensors';

/**
 * Top of the target-speed output's range. Absolute, not a fraction of the
 * car's cap: as a fraction the same network drove twice as fast at a 300 km/h
 * cap as at 150 and crashed there. The cap only limits it.
 */
const MAX_TARGET_SPEED = 300 * KMH;
/** m/s under the target where the throttle eases off (full throttle below that). */
const THROTTLE_RAMP = 3;
/** m/s over the target the car just coasts: any brake at all cuts the engine (driveCommand). */
const COAST_BAND = 1;
/** m/s further over the target to full brake. */
const BRAKE_RAMP = 5;
/**
 * The lane output has to pass this to ask for a lane change. Low on purpose:
 * fresh networks' outputs rarely reach ±0.3, and at 0.5 only 7 of 80 ever
 * tried a lane change - evolution had nothing to select from.
 */
const LANE_DEADZONE = 0.15;

/** The AI car's state as the sensors expect it. */
export function selfStateOf(car: PlayerCar, speedCap: number): SelfState {
  return { s: car.s, d: car.d, yaw: car.yaw, vLong: car.vLong, vLat: car.vLat, yawRate: car.yawRate, speedCap };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Pedals that bring the car from `v` to `target` (m/s). */
export function speedPedals(target: number, v: number): { throttle: number; brake: number } {
  return { throttle: clamp01((target - v) / THROTTLE_RAMP), brake: clamp01((v - target - COAST_BAND) / BRAKE_RAMP) };
}

/** Adaptive cruise: the traffic's car-following model, a little sportier (shorter headway, harder accel / braking). */
const CRUISE: Omit<IdmParams, 'v0'> = { T: 1, s0: 2.5, a: 4, b: 4 };
/** m/s² of slowing the car gets without the brake (coasting); braking covers the rest up to this much more. */
const COAST_DECEL = 1;
const FULL_BRAKE_DECEL = 9;
const HALF_LENGTH = 2.2;
const HALF_WIDTH = 0.93;

/**
 * `speedPedals`, but never into what is ahead between `dLo` and `dHi` (the
 * lane it is in, or the path of a lane change): the car follows like the
 * traffic does (IDM), so the only way past a slower car is another lane.
 */
export function cruisePedals(target: number, self: SelfState, traffic: TrafficBox[], dLo: number, dHi: number): { throttle: number; brake: number } {
  let gap: number | null = null;
  let vLead = 0;
  for (const t of traffic) {
    if (t.s <= self.s || t.dMax < dLo || t.dMin > dHi) continue;
    const g = t.s - t.length / 2 - (self.s + HALF_LENGTH);
    if (gap === null || g < gap) {
      gap = g;
      vLead = t.v;
    }
  }
  const pedals = speedPedals(target, self.vLong);
  if (gap === null) return pedals;
  const accel = idmAccel(self.vLong, Math.max(0, gap), self.vLong - vLead, { ...CRUISE, v0: Math.max(target, 0.1) });
  if (accel >= 0) return { throttle: Math.min(pedals.throttle, accel / (CRUISE.a / 2)), brake: pedals.brake };
  return { throttle: 0, brake: Math.max(pedals.brake, clamp01((-accel - COAST_DECEL) / FULL_BRAKE_DECEL)) };
}

/**
 * Turns a trained network into driving input. The network decides; simple
 * controllers drive: outputs are lane (left / keep / right) and target speed
 * (0 .. 300 km/h, never over the car's cap). A lane controller steers and
 * `cruisePedals` works the pedals, keeping a safe distance to what is ahead.
 * With throttle and brake as outputs, fresh networks almost never braked only
 * when something was ahead; with the target speed alone, they learned to be
 * slow everywhere rather than to slow down behind a car - and stayed behind it.
 * Now the way to go faster is the network's own: pick a lane that is free.
 * Used by the trainer's ghost cars and by the game alike, once per physics step.
 */
export class AiDriver {
  private readonly sensors = new Float32Array(SENSOR_COUNT);
  private readonly out = new Float32Array(2);
  private lanes: LaneController | null = null;

  constructor(readonly brain: Brain) {}

  /** The lane it is in or moving to. */
  get targetLane(): number {
    return this.lanes?.targetLane ?? -1;
  }

  get changingLanes(): boolean {
    return this.lanes?.changing ?? false;
  }

  /** The lane it is leaving while changing; the lane it holds otherwise. */
  get fromLane(): number {
    return this.lanes?.fromLane ?? -1;
  }

  /** Forget any lane change and hold the lane at `d` (the car was moved, or the AI just took over). */
  reset(d: number): void {
    this.lanes ??= new LaneController(0);
    this.lanes.sync(d);
  }

  drive(self: SelfState, traffic: TrafficBox[], p: CarParams = DEFAULT_CAR): HandlingInput {
    if (!this.lanes) this.reset(self.d);
    const lanes = this.lanes!;
    // Far from the lane it holds: it was put somewhere else (reset, respawn), not steered there.
    if (!lanes.changing && Math.abs(self.d - laneCenter(lanes.targetLane)) > LANE_WIDTH / 2) lanes.sync(self.d);

    readSensors(self, traffic, this.sensors, lanes.targetLane);
    const o = forward(this.brain, this.sensors, this.out);
    if (!lanes.changing) {
      if (o[0] > LANE_DEADZONE) lanes.start(lanes.targetLane + 1, self.d);
      else if (o[0] < -LANE_DEADZONE) lanes.start(lanes.targetLane - 1, self.d);
    }
    lanes.update(PHYSICS_DT);
    const steer = lanes.steer(self.d, self.yaw, self.vLong, self.vLat, p);
    const target = Math.min(self.speedCap, (MAX_TARGET_SPEED * (o[1] + 1)) / 2);
    // Watch ahead across where the car is and where it is going (the whole lane change path).
    const goal = laneCenter(lanes.targetLane);
    const { throttle, brake } = cruisePedals(target, self, traffic, Math.min(self.d, goal) - HALF_WIDTH, Math.max(self.d, goal) + HALF_WIDTH);
    return { steer, throttle, brake };
  }
}
