import { it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { selfStateOf } from '../src/ai/driver';
import { planAt } from '../src/ai/planner';
import { PlannerDriver } from '../src/ai/plannerDriver';
import { KMH, PHYSICS_DT } from '../src/config';
import { PhysicsWorld } from '../src/physics/physicsWorld';
import { laneCenter } from '../src/road/coords';
import { PlayerCar } from '../src/vehicles/playerCar';

/** Coming up fast on a wall of slower cars: where does it start braking, and how hard? */
it('brake trace', async () => {
  await RAPIER.init();
  const physics = PhysicsWorld.createSync();
  physics.timestep = PHYSICS_DT;
  const car = new PlayerCar(physics, null);
  car.params.maxSpeed = 300 * KMH;
  car.resetTo(0, 1, 180 * KMH);
  const ai = new PlannerDriver();
  const boxes = [0, 1, 2, 3].map((lane) => ({ id: lane, s: 150, dMin: laneCenter(lane) - 0.925, dMax: laneCenter(lane) + 0.925, v: 100 * KMH, length: 4.5 }));
  const out: string[] = [];
  for (let i = 0; i < 6 / PHYSICS_DT; i++) {
    const inp = ai.drive(selfStateOf(car, 300 * KMH), boxes, car.params);
    car.prePhysics(inp, PHYSICS_DT);
    physics.step(() => {});
    car.postPhysics();
    for (const b of boxes) b.s += b.v * PHYSICS_DT;
    if (i % 30 === 0) out.push(`t=${(i * PHYSICS_DT).toFixed(2)} gap=${(boxes[1].s - car.s - 4.45).toFixed(1)} v=${Math.round(car.speed / KMH)} thr=${inp.throttle.toFixed(2)} brk=${inp.brake.toFixed(2)} planV+0.5=${Math.round(planAt(ai.plan!, ai.planAge + 0.5).v / KMH)}`);
  }
  process.stdout.write(out.join('\n') + '\n');
});
