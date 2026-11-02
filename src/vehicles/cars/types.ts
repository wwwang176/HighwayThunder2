import type { CarParams } from '../handling';

/**
 * One car type: what it is, how it drives, and what the AI needs to know to
 * drive it. Adding a car = a new file in this folder, registered in `index.ts`;
 * its `ai` numbers come from `training/measureCar.train.ts`.
 *
 * The AI's room-keeping assumes a car about this size (1.86 x 4.4 m): a much
 * bigger or smaller one needs those constants revisited.
 */
export interface CarSpec {
  id: string;
  /** Shown to the player. */
  name: string;
  /** Body colour. */
  color: number;
  /** Body shape (src/vehicles/models.ts buildCar). */
  style: CarStyle;
  params: CarParams;
  ai: CarPerformance;
}

/** Body shapes: a low supercar wedge, a long-hooded muscle car. */
export type CarStyle = 'super' | 'muscle';

/** Measured on the car itself (training/measureCar.train.ts). */
export interface CarPerformance {
  /** Full-throttle acceleration (m/s²) at speeds (km/h), ascending. */
  accel: [kmh: number, accel: number][];
  /** Full-brake deceleration (m/s²), the lowest measured. */
  brake: number;
  /** Sideways acceleration (m/s²) it holds at full steering, at speeds (km/h), ascending. */
  latAccel: [kmh: number, accel: number][];
  /** Weights of its trained steering network (src/ai/netTracker.ts, training/tracker.train.ts); none: the plain tracker. */
  tracker?: number[];
}
