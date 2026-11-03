import type { CarParams } from '../handling';

/** The forces (and force-like stiffnesses and inertias) that go with the weight: per kilogram, they drive the same. */
const WITH_MASS = [
  'power',
  'engineTorque',
  'maxDriveForce',
  'reverseForce',
  'brakeForceMax',
  'dragK',
  'downforceK',
  'springK',
  'damperBump',
  'damperRebound',
  'antiRollFront',
  'antiRollRear',
  'wheelInertia',
  'lsd',
  'lsdMax',
  'escGain',
  'escMaxTorque',
] as const satisfies readonly (keyof CarParams)[];

/**
 * The car at `mass` kg, driving as it did: every force and stiffness scaled with the weight (the same per kilogram:
 * the same acceleration, braking, cornering, sag and lean; the body's inertia follows its mass). Speeds, grip,
 * geometry and steering stay as they were.
 */
export function withMass(p: CarParams, mass: number): CarParams {
  const k = mass / p.mass;
  const out: CarParams = { ...p, mass };
  for (const key of WITH_MASS) out[key] = p[key] * k;
  return out;
}
