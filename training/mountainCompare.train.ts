import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { selfStateOf } from '../src/ai/driver';
import { MountainDriver } from '../src/ai/mountainDriver';
import { MountainPlannerDriver } from '../src/ai/mountainPlannerDriver';
import { mulberry32 } from '../src/ai/rng';
import { PHYSICS_DT } from '../src/config';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { MOUNTAIN, roadEdges, mountainRoad } from '../src/road/mountain';
import { surfaceMesh } from '../src/road/surface';
import { STREET_RACER } from '../src/vehicles/cars';
import { PlayerCar } from '../src/vehicles/playerCar';
import { mountainAi, mountainSetup, mountainSetupOf } from '../src/vehicles/mountainSetup';

/**
 * Old and new mountain drivers fed the same car (driven by the old, started on its line, seed 1, alone): the first
 * steps their inputs part, if any - alone, the planner driver must drive exactly as the mountain driver.
 *   npx vitest run --config training/vitest.config.ts training/mountainCompare.train.ts
 */
it('compare', async () => {
  await RAPIER.init();
  const road = mountainRoad(mulberry32(1));
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  const e = roadEdges(road);
  physics.setRoad(road, { rails: { left: (s) => -e.at(s, -1), right: (s) => e.at(s, 1) }, ground: surfaceMesh(road, -MOUNTAIN.before, MOUNTAIN.length + MOUNTAIN.after, (s) => [-e.at(s, -1) - 1.5, e.at(s, 1) + 1.5]) });
  const car = new PlayerCar(physics, null, { spec: STREET_RACER, entity: { type: 'player' } });
  car.road = road;
  Object.assign(car.params, mountainSetup(car.params, mountainSetupOf(STREET_RACER.id)));

  const ai = mountainAi(STREET_RACER.ai, mountainSetupOf(STREET_RACER.id));
  const old = new MountainDriver();
  old.budget = 0.9;
  old.setRoad(road, ai);
  const neu = new MountainPlannerDriver();
  neu.budget = 0.9;
  neu.setRoad(road, ai);
  car.resetAt(-3, old.refAt(0), 0);
  let shown = 0;
  for (let t = 0; t < 130 && shown < 8; t += PHYSICS_DT) {
    const self = selfStateOf(car, car.params.maxSpeed);
    const a = old.drive(self, [], car.params);
    const b = neu.drive(self, [], car.params);
    if (a.steer !== b.steer || a.throttle !== b.throttle || a.brake !== b.brake || !!a.handbrake !== !!b.handbrake) {
      shown++;
      process.stdout.write(`t ${t.toFixed(3)} s ${self.s.toFixed(1)} d ${self.d.toFixed(2)} old ${old.mode} st ${a.steer.toFixed(4)} th ${a.throttle.toFixed(3)} br ${a.brake.toFixed(3)} | new ${neu.mode} st ${b.steer.toFixed(4)} th ${b.throttle.toFixed(3)} br ${b.brake.toFixed(3)} off ${neu.mplan?.offsetAt(self.s).toFixed(3)} vAt ${neu.mplan?.vAt(self.s + 5).toFixed(2)} blocked ${neu.mplan?.blocked} pathRef ${neu.inner.pathRefAt(self.s).toFixed(2)} ref ${neu.inner.refAt(self.s).toFixed(2)} room ${neu.inner.roomAt(self.s).toFixed(2)} s0 ${neu.mplan?.s0.toFixed(1)} vAtLead ${neu.mplan?.vAt(self.s + 8.5).toFixed(2)}
`);
    }
    car.prePhysics(a, PHYSICS_DT);
    physics.step(() => {});
    car.postPhysics();
  }
  process.stdout.write(`end s ${car.s.toFixed(0)} v ${car.speed.toFixed(1)} shown ${shown}
`);
  physics.free();
});
