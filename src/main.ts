import { Game } from './game/game';
import { loadSelection } from './game/carSelection';
import { PhysicsWorld } from './physics/physicsWorld';
import { DRIVER_TUNING } from './ai/plannerDriver';
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
  // The course picked last in the garage (another picked there: built in place as its race is set up).
  // (?skidpad: the drift practice ground - on the mountain road's setup, its own world)
  const skidpad = new URLSearchParams(location.search).has('skidpad');
  const mountain = skidpad || loadSelection(localStorage).course === 'mountain';
  const game = new Game(document.getElementById('app')!, document.getElementById('ui')!, physics, { mountain, skidpad });
  (window as unknown as { __game: Game }).__game = game;
  await loading.next('loading.shaders', 0.85);
  await game.warmUp((share) => loading.set('loading.shaders', 0.85 + 0.13 * share)); // (the bar moving as they are made)
  game.start();
  await loading.finish('loading.ready');
}

boot();
