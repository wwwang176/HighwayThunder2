/**
 * How NPC "drivers" turn the traffic planner's intent (lateral path + IDM accel)
 * into pedal and steering commands for a physically simulated vehicle.
 */

const G = 9.81;
const COMFORT_LAT_ACCEL = 6; // m/s^2
const MAX_STEER = 0.5;
const STANLEY_K = 1.2;
const YAW_DAMP = 0.12;

export interface DriverState {
  d: number; // lateral position of the vehicle's center
  yaw: number; // heading, + = right
  v: number; // forward speed
  yawRate: number; // + = turning right
}

/**
 * Stanley path tracking (cross-track error measured at the front axle) with the
 * planned lateral velocity fed forward. Returns the front wheel angle, + = right.
 * On a bend (`curvature`, 1/m, + bending right; d, yaw and yawRate against the road)
 * the wheel angle that follows it (wheelbase x curvature) is fed forward too, the
 * corrections' comfort limit around it.
 */
export function stanleySteer(st: DriverState, dPlan: number, dPlanRate: number, wheelbase: number, curvature = 0): number {
  const v = Math.max(st.v, 1);
  const dFront = st.d + Math.sin(st.yaw) * (wheelbase / 2);
  const headingDesired = Math.atan2(dPlanRate, v);
  const e = dPlan - dFront;
  let delta = headingDesired - st.yaw + Math.atan2(STANLEY_K * e, v + 2) - YAW_DAMP * st.yawRate;
  const limit = Math.min(MAX_STEER, Math.atan((COMFORT_LAT_ACCEL * wheelbase) / (v * v)));
  delta = Math.max(-limit, Math.min(limit, delta));
  return curvature === 0 ? delta : delta + Math.atan(wheelbase * curvature);
}

/** Engine force (N, total) or per-wheel brake impulse to realise a commanded accel. */
export function npcDriveForces(accel: number, v: number, mass: number, dt: number, wheelCount = 4): { engineForce: number; brakeImpulse: number } {
  if (accel >= 0 && v > -0.5) return { engineForce: mass * accel, brakeImpulse: 0 };
  if (v <= 0.3) return { engineForce: 0, brakeImpulse: (2 * mass * dt) / wheelCount };
  return { engineForce: 0, brakeImpulse: (-accel * mass * dt) / wheelCount };
}

/**
 * Static load (N) on ONE wheel of each axle, for a body with its center of mass at
 * z = comZ. The front support is the first axle, or a kingpin at `frontSupportZ`
 * (trailers); the remaining axles share the rear load equally. An extra point load
 * (e.g. a trailer on the fifth wheel) can be added.
 */
export function wheelLoads(
  mass: number,
  axleZ: number[],
  extra?: { load: number; z: number },
  frontSupportZ?: number,
  comZ = 0,
): number[] {
  const W = mass * G;
  const rear = frontSupportZ === undefined ? axleZ.slice(1) : axleZ;
  const zf = frontSupportZ ?? axleZ[0];
  const zr = rear.reduce((a, b) => a + b, 0) / rear.length;
  const span = zr - zf;
  // Moments about the front support.
  let rearLoad = (W * (comZ - zf)) / span;
  let frontLoad = W - rearLoad;
  if (extra) {
    const r = (extra.load * (extra.z - zf)) / span;
    rearLoad += r;
    frontLoad += extra.load - r;
  }
  const perRearWheel = rearLoad / rear.length / 2;
  if (frontSupportZ !== undefined) return axleZ.map(() => perRearWheel);
  return [frontLoad / 2, ...rear.map(() => perRearWheel)];
}
