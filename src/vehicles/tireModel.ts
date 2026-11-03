/**
 * Tyre + wheel model for the player car.
 *
 * Each step the wheel first tries to stay in grip: we compute the longitudinal
 * force that keeps the tyre rolling at ground speed (given drive/brake torque) and
 * the cornering force from the slip-angle curve. If their combination fits inside
 * the friction circle (muPeak * Fz) the tyre grips. Otherwise it slides: the
 * requested force is scaled down to the smaller sliding friction circle
 * (muSlide * Fz) and the wheel spins up or locks according to the torque balance.
 * That gives wheelspin on launch, lock-up under hard braking, and the loss of
 * cornering grip that turns either into a slide or a tail-out oversteer.
 */

export interface TireParams {
  muPeak: number; // static / peak friction coefficient
  muSlide: number; // kinetic friction once sliding
  slipAnglePeak: number; // rad, cornering force peaks here
  rollingResistance: number; // fraction of Fz
  regripSpeed: number; // m/s of slip below which a sliding tyre grips again
  slipFalloff?: number; // m/s: how fast sliding friction drops from peak towards muSlide
}

export const DEFAULT_TIRE: TireParams = {
  muPeak: 1.15,
  muSlide: 0.85,
  slipAnglePeak: 0.12,
  rollingResistance: 0.012,
  regripSpeed: 0.6,
};

export interface WheelIn {
  vx: number; // contact patch velocity along the wheel's heading (m/s)
  vy: number; // contact patch velocity sideways, + = to the wheel's right
  omega: number; // wheel angular velocity (rad/s), + = rolling forward
  Fz: number; // normal load (N)
  driveTorque: number; // N·m, + = forward
  brakeTorque: number; // N·m magnitude (always opposes rotation)
  R: number;
  I: number; // wheel + driveline inertia (kg·m²)
  dt: number;
  mEff: number; // mass this wheel carries (for the lateral no-overshoot cap)
  tire: TireParams;
  muScale?: number; // surface grip multiplier (grass < 1)
  /**
   * Braking and cornering each get the whole grip, not one friction circle (an arcade front tyre: under a
   * hard brake it still steers, even locked and skidding).
   */
  brakeApart?: boolean;
}

export interface WheelOut {
  Fx: number; // + = forward
  Fy: number; // + = to the wheel's right
  omega: number;
  sliding: boolean;
  slip: number; // slip speed at the contact patch (m/s), for sound / marks
}

const DEFAULT_SLIP_FALLOFF = 8;

/**
 * Sliding friction vs. slip speed: a tyre sliding slowly keeps nearly peak grip,
 * a tyre spinning or skidding fast drops to muSlide. That is what keeps a burnout
 * going until the car catches up with its wheels.
 */
export function kineticMu(slipSpeed: number, t: TireParams): number {
  const v0 = t.slipFalloff ?? DEFAULT_SLIP_FALLOFF;
  return t.muSlide + (t.muPeak - t.muSlide) * Math.exp(-Math.abs(slipSpeed) / v0);
}

/**
 * Cornering friction coefficient vs |slip angle|: linear up to the peak, then a
 * gentle fall (real tyres keep ~90% of peak grip well past the peak slip angle)
 * down to the sliding level only at large angles.
 */
export function lateralCurve(alpha: number, t: TireParams): number {
  const a = Math.abs(alpha);
  if (a <= t.slipAnglePeak) return (t.muPeak * a) / t.slipAnglePeak;
  const plateau = Math.max(t.muSlide, t.muPeak * 0.9);
  const k = (a - t.slipAnglePeak) / t.slipAnglePeak;
  if (k <= 2) return t.muPeak + (plateau - t.muPeak) * (k / 2);
  return plateau + (t.muSlide - plateau) * Math.min(1, (k - 2) / 4);
}

/** Apply brake torque to a spinning wheel: it slows towards zero but never reverses. */
function applyBrake(omega: number, brakeTorque: number, I: number, dt: number): number {
  const d = (brakeTorque / I) * dt;
  if (Math.abs(omega) <= d) return 0;
  return omega - Math.sign(omega) * d;
}

export function solveWheel(w: WheelIn): WheelOut {
  const { R, I, dt, tire: t } = w;
  const mu = w.muScale ?? 1;

  if (w.Fz <= 0) {
    const free = applyBrake(w.omega + (w.driveTorque / I) * dt, w.brakeTorque, I, dt);
    return { Fx: 0, Fy: 0, omega: free, sliding: false, slip: 0 };
  }

  // --- grip attempt -------------------------------------------------------
  const omegaRoll = w.vx / R;
  // Torque the ground must supply to hold the wheel at rolling speed this step.
  const inertial = (I * (omegaRoll - w.omega)) / dt;
  let x = w.driveTorque - inertial; // torque to be reacted by the tyre and brake
  if (Math.abs(omegaRoll) < 0.5) {
    // Nearly stopped: the brake can hold either way.
    x = Math.sign(x) * Math.max(0, Math.abs(x) - w.brakeTorque);
  } else {
    x -= Math.sign(omegaRoll) * w.brakeTorque;
  }
  let FxReq = x / R;
  FxReq -= Math.sign(w.vx) * t.rollingResistance * w.Fz;

  const alpha = Math.atan2(w.vy, Math.max(Math.abs(w.vx), 0.5));
  const FyCurve = -Math.sign(w.vy) * lateralCurve(alpha, t) * mu * w.Fz;
  const FyStop = (-w.mEff * w.vy) / dt; // what would cancel the side motion this step
  const FyReq = Math.abs(FyCurve) < Math.abs(FyStop) ? FyCurve : FyStop;

  // Friction falls with LONGITUDINAL slip speed (wheelspin / lock-up). Sideways
  // overload is handled by the slip-angle curve, which falls off gently; using the
  // sideways speed here would make grip collapse the moment a fast corner hits
  // the limit, and the car would fishtail.
  const longSlip = Math.abs(w.omega * R - w.vx);
  const wasSliding = longSlip > t.regripSpeed;
  const limit = (wasSliding ? kineticMu(longSlip, t) : t.muPeak) * mu * w.Fz;
  // Braking apart: only the braking (or drive) force against the limit; the cornering force stays as the
  // slip-angle curve gives it (never above the peak grip).
  const req = w.brakeApart ? Math.abs(FxReq) : Math.hypot(FxReq, FyReq);

  if (req <= limit) {
    return { Fx: FxReq, Fy: FyReq, omega: omegaRoll, sliding: false, slip: Math.abs(w.vy) };
  }

  // --- sliding --------------------------------------------------------------
  const kinetic = kineticMu(longSlip, t) * mu * w.Fz;
  const scale = Math.min(1, kinetic / req);
  const Fx = FxReq * scale;
  const Fy = w.brakeApart ? FyReq : FyReq * scale;
  let omega = w.omega + ((w.driveTorque - Fx * R) / I) * dt;
  omega = applyBrake(omega, w.brakeTorque, I, dt);
  // A spinning or locked wheel that comes back to rolling speed must not
  // overshoot past it in one step; grip returns next step.
  const before = w.omega - omegaRoll;
  const after = omega - omegaRoll;
  if (Math.abs(before) * R > t.regripSpeed && Math.sign(before) !== Math.sign(after)) omega = omegaRoll;
  return { Fx, Fy, omega, sliding: true, slip: Math.hypot(omega * R - w.vx, w.vy) };
}
