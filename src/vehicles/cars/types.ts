import type { CarParams } from '../handling';

/**
 * One car type: what it is, how it drives, and what the AI needs to know to
 * drive it. Adding a car = a new file in this folder, registered in `index.ts`;
 * its `ai` numbers come from `training/measureCar.train.ts`.
 *
 * Its size (`params.width`, `length`) is its collider's and what the AI keeps
 * clear with (SelfState / PlanEgo halfWidth, halfLength).
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
  /**
   * Its collision shape as convex pieces, each a flat list of points (x, y, z: body space, m; the nose
   * toward -z, the ground 0.55 m below; from its model, src/vehicles/cars/<car>Collider.ts). None: a box
   * of `params.width` x `length`.
   */
  collider?: number[][];
  ai: CarPerformance;
}

/** Body shapes: a low supercar wedge, a long-hooded muscle car, a tuned JDM coupe. */
export type CarStyle = 'super' | 'muscle' | 'jdm';

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
  /**
   * Weights of a second network of the same layout, trained for driving off after a crash: it drives instead of
   * `tracker` standing across the road (ACROSS_YAW), so racing stays the tracker's alone. None: the tracker there too.
   */
  recovery?: number[];
}
