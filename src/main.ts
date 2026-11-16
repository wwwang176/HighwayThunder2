import { AUTOSTART, Game } from './game/game';
import { loadSelection } from './game/carSelection';
import { PhysicsWorld } from './physics/physicsWorld';
import { DRIVER_TUNING, PlannerDriver } from './ai/plannerDriver';
import { WorkerPlanSource } from './ai/workerPlanSource';
import { MountainPlannerDriver } from './ai/mountainPlannerDriver';
import { loadCarModels } from './vehicles/carModels';
import { applyUiZoom } from './ui/uiScale';
import { loadSettings, setLang } from './ui/i18n';
import { LoadingScreen, shareDone } from './ui/loading';

/**
 * The game started under the loading screen (index.html's, there from the first paint): the physics and the car
 * files (the bar by files in), then the scene built and its shaders compiled - each step drawn before it holds the
 * page - then the screen faded off the garage's title.
 */
async function boot() {
  // The AI plans by direction of travel, and across the road follows those plans plainly (the debug panel's switch;
  // off for training and benchmarks).
  DRIVER_TUNING.coursePlanner = true;
  applyUiZoom(document.getElementById('ui')!);
  setLang(loadSettings(localStorage, navigator.language).lang); // (the loading screen's words in it too)
  const loading = new LoadingScreen();
  loading.set('loading.physics', 0);
  await loading.hold();
  let physicsIn = 0, carsIn = 0;
  const fetched = () => 0.65 * (0.25 * physicsIn + 0.75 * carsIn); // (the downloads: the first 65 %)
  const [physics] = await Promise.all([
    PhysicsWorld.create().then((p) => {
      physicsIn = 1;
      loading.set('loading.cars', fetched());
      return p;
    }),
    loadCarModels((done, total) => {
      carsIn = shareDone(done, total);
      loading.set('loading.cars', fetched());
    }),
  ]);
  await loading.next('loading.scene', 0.7);
  // The road bends (?straight: the straight road as ever, its own record); the mountain road when picked in the
  // garage (?mountain / ?highway: that one whatever was picked).
  const params = new URLSearchParams(location.search);
  const curved = !params.has('straight');
  // (?skidpad: the drift practice ground - on the mountain road's setup, its own world)
  const skidpad = params.has('skidpad');
  const mountain = skidpad || params.has('mountain') || (!params.has('highway') && !params.has('straight') && loadSelection(localStorage).course === 'mountain');
  const game = new Game(document.getElementById('app')!, document.getElementById('ui')!, physics, { curved, mountain, skidpad });
  (window as unknown as { __game: Game }).__game = game;
  // I hands the car to the AI: the path planner, driven by plain controllers for now
  // (a trained network is to take over the driving part). Plans are worked out in a worker.
  // (the mountain road: its racing-line driver, as the rivals', its line worked out with each race's road)
  game.aiDriver = mountain ? new MountainPlannerDriver() : new PlannerDriver(new WorkerPlanSource());
  await loading.next('loading.shaders', 0.85);
  game.warmUp();
  game.start();
  await loading.finish('loading.ready');
  // Loaded again on another course (picked in the garage, its start pressed): its race straight away.
  let autostart = false;
  try {
    autostart = sessionStorage.getItem(AUTOSTART) === '1';
    sessionStorage.removeItem(AUTOSTART);
  } catch {
    // (no session storage: the garage)
  }
  if (autostart) game.startRace(loadSelection(localStorage), true);
}

boot();
