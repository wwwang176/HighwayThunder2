import { Game } from './game/game';
import { PhysicsWorld } from './physics/physicsWorld';
import { AiDriver } from './ai/driver';
import { parseDriver } from './ai/driverFile';

async function boot() {
  const physics = await PhysicsWorld.create();
  const game = new Game(document.getElementById('app')!, document.getElementById('ui')!, physics);
  (window as unknown as { __game: Game }).__game = game;
  game.start();
  loadAiDriver(game);
}

/** The trained AI (public/ai/driver.json). Without it the game plays the same; I just says there is none. */
async function loadAiDriver(game: Game) {
  try {
    const res = await fetch('/ai/driver.json', { cache: 'no-cache' });
    if (!res.ok) return;
    game.aiDriver = new AiDriver(parseDriver(await res.json()));
  } catch (e) {
    console.warn('AI 駕駛檔無法載入：', e instanceof Error ? e.message : e);
  }
}

boot();
