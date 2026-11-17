import { Centerline } from './centerline';

/**
 * The drift practice ground (?skidpad): flat tarmac, `length` m along the road and `half` m either side of it, walls
 * along its sides; the car set down at `start` (s) in the middle. Lines on it every `minor` m, bold every `major` m
 * (numbered from the start), and rings of `rings` m round `ringAt` m ahead - a hairpin's sizes (R 15-25).
 */
export const SKIDPAD = {
  length: 1200,
  half: 200,
  start: 600,
  minor: 5,
  major: 25,
  rings: [15, 25],
  ringAt: 60,
};

/**
 * Its road: flat, the practice ground laid along it - straight to the eye, bent by a hair (R 1e9 m): a straight road is
 * the highway's to the physics (its rails at its own 10 m, pinning the car there), any other has the rails it is given.
 */
export function skidpadRoad(): Centerline {
  return new Centerline([{ len: SKIDPAD.length, k: 1e-9 }]);
}
