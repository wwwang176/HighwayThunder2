import { Game } from './game/game';
import { PhysicsWorld } from './physics/physicsWorld';
import { PlannerDriver } from './ai/plannerDriver';
import { WorkerPlanSource } from './ai/workerPlanSource';

async function boot() {
  const physics = await PhysicsWorld.create();
  const game = new Game(document.getElementById('app')!, document.getElementById('ui')!, physics);
  (window as unknown as { __game: Game }).__game = game;
  // I hands the car to the AI: the path planner, driven by plain controllers for now
  // (a trained network is to take over the driving part). Plans are worked out in a worker.
  game.aiDriver = new PlannerDriver(new WorkerPlanSource());
  game.start();
}

boot();
