import { Game } from './game/game';
import { PhysicsWorld } from './physics/physicsWorld';
import { PlannerDriver } from './ai/plannerDriver';

async function boot() {
  const physics = await PhysicsWorld.create();
  const game = new Game(document.getElementById('app')!, document.getElementById('ui')!, physics);
  (window as unknown as { __game: Game }).__game = game;
  // I hands the car to the AI: the path planner, driven by plain controllers for now
  // (a trained network is to take over the driving part).
  game.aiDriver = new PlannerDriver();
  game.start();
}

boot();
