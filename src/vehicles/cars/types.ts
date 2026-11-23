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
  /** Its name shown to the player: src/ui/i18n's, by this. */
  id: string;
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
  /** Full-brake deceleration (m/s²) at speeds (km/h), ascending: what the AI plans its braking with. */
  brake: [kmh: number, decel: number][];
  /** Sideways acceleration (m/s²) it holds at full steering, at speeds (km/h), ascending. */
  latAccel: [kmh: number, accel: number][];
  /**
   * As set up for the mountain road (src/vehicles/mountainSetup, as built): the sideways acceleration it holds at
   * each speed before it slides, its full brake, its full throttle every 10 km/h from a standstill (its gear changes'
   * dips where they are) (training/mountainGrip.train.ts) - its mountain AI's tables, in place of the highway's scaled
   * (mountainAi). (The highway's x aiLat 1.25 and x longGrip 1.25 were 13-19 % under it; its accel table, every
   * 50 km/h, spread the muscle car's 1-2 shift over 50-150 km/h - a third under what it pulls out of a hairpin.)
   */
  mountain?: { latAccel: [kmh: number, accel: number][]; brake: [kmh: number, decel: number][]; accel?: [kmh: number, accel: number][] };
  /** Weights of its trained steering network (src/ai/netTracker.ts, training/tracker.train.ts); none: the plain tracker. */
  tracker?: number[];
  /**
   * Weights of a second network of the same layout, trained for driving off after a crash: it drives instead of
   * `tracker` standing across the road (ACROSS_YAW), so racing stays the tracker's alone. None: the tracker there too.
   */
  recovery?: number[];
  /**
   * Weights of its mountain road driving network (src/ai/mountainNet.ts, training/mountainNet.train.ts): residual, on
   * the mountain driver's own control along its plan. None: that control alone.
   */
  mountainTracker?: number[];
  /**
   * Weights of its mountain road drift network (src/ai/mountainDriftNet.ts, training/mountainNet.train.ts NET=drift):
   * round a hairpin after the kick, on top of the mountain driver's own drift. None: that drift alone.
   */
  mountainDrift?: number[];
}
