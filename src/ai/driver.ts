import { KMH, LANE_WIDTH, PHYSICS_DT } from '../config';
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

/** Pedals that bring the car from `v` to `target` (m/s). */
export function speedPedals(target: number, v: number): { throttle: number; brake: number } {
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
  return { throttle: clamp01((target - v) / THROTTLE_RAMP), brake: clamp01((v - target - COAST_BAND) / BRAKE_RAMP) };
}

/**
 * Turns a trained network into driving input. The network decides; simple
 * controllers drive: outputs are lane (left / keep / right) and target speed
 * (0 .. 300 km/h, never over the car's cap). A lane controller steers and `speedPedals` works
 * the pedals - with throttle and brake as outputs, fresh networks almost never
 * braked only when something was ahead, and could not learn to. Used by the
 * trainer's ghost cars and by the game alike, once per physics step.
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
    const { throttle, brake } = speedPedals(Math.min(self.speedCap, (MAX_TARGET_SPEED * (o[1] + 1)) / 2), self.vLong);
    return { steer, throttle, brake };
  }
}
