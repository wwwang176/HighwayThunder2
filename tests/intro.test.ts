import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Intro, INTRO_KINDS, nextIntro, type IntroBag, type IntroKind } from '../src/game/intro';
import { PHYSICS_DT } from '../src/config';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { DEFAULT_CAMERA } from '../src/render/cameraRig';
import { PlayerCar } from '../src/vehicles/playerCar';

beforeAll(async () => {
  await RAPIER.init();
});

describe('a car held on the grid, put under a braking load (the intro\'s arrival)', () => {
  it('dives on its own springs while loaded, and comes back level when let go', () => {
    const physics = PhysicsWorld.createSync();
    physics.timestep = PHYSICS_DT;
    const car = new PlayerCar(physics, null);
    car.resetTo(0, 1, 0);
    car.holdInPlace(true);
    const HOLD = { throttle: 0, brake: 0, steer: 0, handbrake: true };
    const nose = () => {
      const q = car.body.rotation();
      return new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)).y; // > 0 up
    };
    const run = (s: number, decel: number) => {
      for (let i = 0; i < Math.round(s / PHYSICS_DT); i++) {
        car.prePhysics(HOLD, PHYSICS_DT);
        car.brakeLoad(decel, PHYSICS_DT);
        physics.step(() => {});
        car.postPhysics();
      }
    };
    run(1.5, 0); // settled
    const level = nose();
    run(1.0, 10); // ~1 g of braking
    const dived = nose();
    expect(level - dived).toBeGreaterThan(0.005); // nose down (> 0.3 degrees)
    expect(level - dived).toBeLessThan(0.1); // not tipping over
    run(2.5, 0);
    expect(Math.abs(nose() - level)).toBeLessThan(0.002); // back level
    physics.free();
  });
});

describe('nextIntro', () => {
  it('all three in a shuffled round before any again, never the same twice running, round after round', () => {
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let bag: IntroBag = { left: [], last: null };
    const picks: string[] = [];
    for (let i = 0; i < 60; i++) {
      const next = nextIntro(bag, rng);
      picks.push(next.kind);
      bag = next.bag;
    }
    for (let i = 0; i < 60; i += 3) expect(new Set(picks.slice(i, i + 3)).size).toBe(3); // each round all three
    for (let i = 1; i < 60; i++) expect(picks[i]).not.toBe(picks[i - 1]); // across rounds too
    expect(new Set(picks.slice(0, 30).map((_, i) => picks.slice(i * 3, i * 3 + 3).join())).size).toBeGreaterThan(1); // shuffled
  });

  it('a bag read back with junk in it starts a fresh round', () => {
    const next = nextIntro({ left: ['nope' as IntroKind], last: 'grid' }, () => 0.5);
    expect(INTRO_KINDS).toContain(next.kind);
    expect(next.kind).not.toBe('grid');
  });
});

describe('Intro', () => {
  it('every intro: the countdown at 5 s, 0.5 s into its last shot (2 s), the camera settled at 6.5', () => {
    const car = new PlayerCar(PhysicsWorld.createSync(), null);
    for (const kind of INTRO_KINDS) {
      const intro = new Intro(kind, { camera: new THREE.PerspectiveCamera(), player: car, rivals: [], chase: DEFAULT_CAMERA });
      expect(intro.seconds, kind).toBeCloseTo(6.5);
      expect(intro.countdownAt, kind).toBeCloseTo(5);
      let due = 0;
      for (let t = 0; t < 7 && !intro.countdownDue; t += 0.01) {
        intro.step(0.01);
        due = t + 0.01;
      }
      expect(due, kind).toBeCloseTo(5, 1);
    }
  });
});
