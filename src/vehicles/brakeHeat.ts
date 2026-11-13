/**
 * The brake discs' heat: what the brakes take out of a turning wheel (brake torque x its turning speed; one held
 * still, nothing - PlayerCar has a full brake's locked wheels turn with the road, as ABS would keep them) goes into
 * the disc, which cools to the air - the faster the car, the quicker - and glows dull red from BRAKE_HEAT.glowFrom up
 * to orange at glowFull. Exaggerated (gain 2): full braking 250 -> 150 km/h ~530-740 °C at the front (a dull red),
 * 300 -> 0 the most; 150 -> 0 ~400-540 (training/brakeHeat; the heavy muscle car the hottest).
 */
export const BRAKE_HEAT = {
  /** A disc's heat capacity (J/K): about 9 kg of cast iron. */
  capacity: 4200,
  /** The heat put in, times this (real: 1). */
  gain: 2,
  /** The air (°C), where a disc starts and cools to. */
  ambient: 25,
  /** Its cooling (1/s of how far above the air): standing, and more per m/s of the car's speed. */
  cool: 0.03,
  coolPerSpeed: 0.003,
  /** The glow's start (°C: just seen, dull red) and full (bright orange); the most it heats to. */
  glowFrom: 420,
  glowFull: 900,
  most: 1000,
};

/** A disc's temperature (°C) `dt` s on: braking `brakeTorque` (N·m) on a wheel turning at `omega` (rad/s), the car at `speed` (m/s). */
export function discHeatStep(temp: number, brakeTorque: number, omega: number, speed: number, dt: number): number {
  const h = BRAKE_HEAT;
  const heat = (h.gain * brakeTorque * Math.abs(omega) * dt) / h.capacity;
  // (cooled exactly over the step: never past the air, however long)
  const cooled = h.ambient + (temp - h.ambient) * Math.exp(-(h.cool + h.coolPerSpeed * Math.abs(speed)) * dt);
  return Math.min(h.most, cooled + heat);
}

/** How much a disc at `temp` °C glows: 0 (not at all) to 1 (full). */
export function discGlow(temp: number): number {
  const h = BRAKE_HEAT;
  return Math.min(1, Math.max(0, (temp - h.glowFrom) / (h.glowFull - h.glowFrom)));
}
