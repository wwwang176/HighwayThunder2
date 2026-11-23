import { clamp01 } from '../math';
import type { CarParams, DriveInput } from '../vehicles/handling';
import type { PlayerCar } from '../vehicles/playerCar';
import type { SelfState, TrafficBox } from './sensors';

/** m/s under the target where the throttle eases off (full throttle below that). */
const THROTTLE_RAMP = 3;
/** m/s over the target the car just coasts: any brake at all cuts the engine (driveCommand). */
const COAST_BAND = 1;
/** m/s further over the target to full brake. */
const BRAKE_RAMP = 5;

/** Something that drives an AI car: the planner with its network steering, the mountain driver. */
export interface Driver {
  /** Driving input for one physics step. */
  drive(self: SelfState, traffic: TrafficBox[], p?: CarParams): DriveInput;
  /** The car was put somewhere (start, reset, respawn) or the AI just took over at `d`. */
  reset(d: number): void;
}

/** A rival's driver: the rubber band scales its engine (`accelScale`) and, where it heeds it, pushes it on (`push`, 0..1). */
export interface RivalDriver extends Driver {
  accelScale: number;
  push?: number;
  dispose(): void;
}

/** The AI car's state as the drivers expect it. */
export function selfStateOf(car: PlayerCar, speedCap: number): SelfState {
  return {
    s: car.s,
    d: car.d,
    yaw: car.yaw,
    vLong: car.vLong,
    vLat: car.vLat,
    yawRate: car.yawRate,
    speedCap,
    wheel: car.wheel,
    rearSpin: ((car.wheels[2].omega + car.wheels[3].omega) / 2) * car.params.wheelRadius - car.vLong,
    halfWidth: car.width / 2,
    halfLength: car.length / 2,
    aLong: car.aLong,
    aLat: car.aLat,
    rollRate: car.rollRate,
    pitchRate: car.pitchRate,
  };
}

/**
 * Pedals that bring the car from `v` to `target` (m/s): full throttle `ramp` m/s under it, full brake `brakeRamp` m/s
 * past COAST_BAND over it (THROTTLE_RAMP, BRAKE_RAMP: the highway's).
 */
export function speedPedals(target: number, v: number, ramp = THROTTLE_RAMP, brakeRamp = BRAKE_RAMP): { throttle: number; brake: number } {
  return { throttle: clamp01((target - v) / ramp), brake: clamp01((v - target - COAST_BAND) / brakeRamp) };
}
