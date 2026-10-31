import { Game } from './game/game';
import { PhysicsWorld } from './physics/physicsWorld';

async function boot() {
  const physics = await PhysicsWorld.create();
  const game = new Game(document.getElementById('app')!, physics);
  (window as unknown as { __game: Game }).__game = game;
  game.start();
}

boot();
