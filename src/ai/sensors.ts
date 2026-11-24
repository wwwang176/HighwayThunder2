/** The AI car's own state, in our carriageway's road coordinates. */
export interface SelfState {
  s: number;
  d: number;
  yaw: number;
  vLong: number;
  vLat: number;
  yawRate: number;
  /** Top speed the car is limited to (m/s): its plans keep under it. */
  speedCap: number;
  /** Where the steering is now (-1..1, PlayerCar.wheel). */
  wheel?: number;
  /** m/s the driven (rear) wheels' surface turns faster than the car goes: wheelspin. */
  rearSpin?: number;
  /** Half its body's width and length (m; default the street racer's, 0.93 x 2.2). */
  halfWidth?: number;
  halfLength?: number;
  /** What the seat feels: acceleration (m/s²) along its nose and toward its right; roll (+ onto its right side) and pitch (+ nose up) rates, rad/s. */
  aLong?: number;
  aLat?: number;
  rollRate?: number;
  pitchRate?: number;
}

/** A vehicle (or wreck) on our carriageway as an axis-aligned box in road coordinates. */
export interface TrafficBox {
  /** Which vehicle (or wreck part) it is: the same from one step to the next. */
  id?: number;
  s: number;
  dMin: number;
  dMax: number;
  v: number;
  length: number;
  /**
   * The lane a vehicle is about to move into: kept clear of like the vehicle itself, but touching it is not a
   * crash.
   */
  phantom?: boolean;
}
