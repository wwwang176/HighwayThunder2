import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Intro, INTRO_KINDS } from '../src/game/intro';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { DEFAULT_CAMERA } from '../src/render/cameraRig';
import { PlayerCar } from '../src/vehicles/playerCar';

beforeAll(async () => {
  await RAPIER.init();
});

describe('Intro', () => {
  it('every intro is 6 s long', () => {
    const car = new PlayerCar(PhysicsWorld.createSync(), null);
    for (const kind of INTRO_KINDS) {
      const intro = new Intro(kind, { camera: new THREE.PerspectiveCamera(), player: car, rivals: [], chase: DEFAULT_CAMERA });
      expect(intro.seconds, kind).toBeCloseTo(6);
    }
  });
});
