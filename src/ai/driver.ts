import type { HandlingInput } from '../vehicles/handling';
import type { PlayerCar } from '../vehicles/playerCar';
import { Brain, forward } from './brain';
import { readSensors, SelfState, SENSOR_COUNT, TrafficBox } from './sensors';

/** The AI car's state as the sensors expect it. */
export function selfStateOf(car: PlayerCar, speedCap: number): SelfState {
  return { s: car.s, d: car.d, yaw: car.yaw, vLong: car.vLong, vLat: car.vLat, yawRate: car.yawRate, speedCap };
}

/**
 * Turns a trained network into driving input: sensors in, steer / throttle /
 * brake out. Used by the trainer's ghost cars and by the game alike.
 */
export class AiDriver {
  private readonly sensors = new Float32Array(SENSOR_COUNT);
  private readonly out = new Float32Array(3);

  constructor(readonly brain: Brain) {}

  drive(self: SelfState, traffic: TrafficBox[]): HandlingInput {
    readSensors(self, traffic, this.sensors);
    const o = forward(this.brain, this.sensors, this.out);
    const brake = Math.max(0, o[2]);
    // Hard braking lifts off the throttle, so it cannot learn to do both at once.
    const throttle = brake > 0.5 ? 0 : (o[1] + 1) / 2;
    return { steer: o[0], throttle, brake };
  }
}
