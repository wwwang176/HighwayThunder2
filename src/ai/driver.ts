import { LANE_WIDTH, PHYSICS_DT } from '../config';
import { laneCenter } from '../road/coords';
import { CarParams, DEFAULT_CAR, HandlingInput } from '../vehicles/handling';
import type { PlayerCar } from '../vehicles/playerCar';
import { Brain, forward } from './brain';
import { LaneController } from './laneController';
import { readSensors, SelfState, SENSOR_COUNT, TrafficBox } from './sensors';

const BRAKE_DEADZONE = 0.25;
/** The lane output has to pass this to ask for a lane change (so "keep the lane" is easy to say). */
const LANE_DEADZONE = 0.5;

/** The AI car's state as the sensors expect it. */
export function selfStateOf(car: PlayerCar, speedCap: number): SelfState {
  return { s: car.s, d: car.d, yaw: car.yaw, vLong: car.vLong, vLat: car.vLat, yawRate: car.yawRate, speedCap };
}

/**
 * Turns a trained network into driving input. The network chooses lanes and
 * works the pedals: outputs are lane (left / keep / right), throttle and brake;
 * a lane controller does the steering. Used by the trainer's ghost cars and by
 * the game alike, once per physics step.
 */
export class AiDriver {
  private readonly sensors = new Float32Array(SENSOR_COUNT);
  private readonly out = new Float32Array(3);
  private lanes: LaneController | null = null;

  constructor(readonly brain: Brain) {}

  /** The lane it is in or moving to. */
  get targetLane(): number {
    return this.lanes?.targetLane ?? -1;
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
    // Brake only above a dead zone: any brake at all cuts the engine (driveCommand),
    // so without it about half of all random networks could never accelerate.
    const brake = Math.max(0, (o[2] - BRAKE_DEADZONE) / (1 - BRAKE_DEADZONE));
    const throttle = brake > 0 ? 0 : (o[1] + 1) / 2;
    return { steer, throttle, brake };
  }
}
