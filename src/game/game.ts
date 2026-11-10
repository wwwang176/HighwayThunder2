import * as THREE from 'three';
import Stats from 'stats.js';
import { LightFlares, updateFlareScale } from '../render/lightFlares';
import { NpcBeams } from '../render/npcBeams';
import { PlanPath } from '../render/planPath';
import { POST, PostFx } from '../render/postFx';
import { blurAmount, motionCenter } from '../render/speedBlur';
import { flameTextures } from '../render/exhaustFlames';
import { HEADLIGHTS } from '../vehicles/headlight';
import { BodyInstances } from '../render/bodyInstances';
import type { Plan } from '../ai/planner';
import type GUI from 'lil-gui';
import { MAX_FRAME_DT, MAX_SUBSTEPS, PHYSICS_DT, RESET_SPEED, ROAD_LENGTH, type VehicleKind } from '../config';
import { boxToFrame, OUR_FRAME, RoadFrame } from '../road/frame';
import { Sound, type SkidSource } from '../audio/sound';
import { Music, songTitle } from '../audio/music';
import { NowPlaying } from '../ui/nowPlaying';
import { tuned } from '../vehicles/tuning';
import { TUNE_CAL } from '../vehicles/tuneCalibration';
import { loadVolumes, saveVolumes, type Volumes } from '../audio/volumes';
import type { RollSource } from '../audio/rolling';
import type { LoopSource } from '../audio/placedLoops';
import { createTuningPanel } from '../debug/tuning';
import { Keyboard } from '../input/keyboard';
import { EntityRef, PhysicsWorld } from '../physics/physicsWorld';
import { CameraRig } from '../render/cameraRig';
import { TrafficSim } from '../traffic/trafficAI';
import { DEFAULT_SPACING, Occupant } from '../traffic/spawner';
import { TrafficFocus, TrafficWorld } from '../sim/trafficWorld';
import { pixelRatioFor, readQuality } from '../render/quality';
import { Driver, selfStateOf } from '../ai/driver';
import type { TrafficBox } from '../ai/sensors';
import { laneCenter, lanesOccupied, surfaceGrip } from '../road/coords';
import { Hud } from '../ui/hud';
import { HandlingInput } from '../vehicles/handling';
import { allTrafficModels, NpcVehicle } from '../vehicles/npcVehicle';
import { BRAKE_DIM, BRAKE_ON, type VehicleLights } from '../vehicles/models';
import { NitroAi } from '../vehicles/nitro';
import { PlayerCar } from '../vehicles/playerCar';
import { CARS, CarSpec, STREET_RACER } from '../vehicles/cars';
import { PlannerDriver } from '../ai/plannerDriver';
import { trackerFrom } from '../ai/netTracker';
import { aiTopSpeed } from '../ai/aiTopSpeed';
import { CAR_CARDS, CarSelection, defaultSelection, loadSelection, MAX_RIVALS, raceRivals, saveSelection } from './carSelection';
import { applyDifficulty } from './difficulty';
import { Garage } from '../ui/garage';
import { SettingsPopup } from '../ui/settings';
import { IntroOverlay } from '../ui/introOverlay';
import { loadSettings, setLang, t } from '../ui/i18n';
import { Intro, nextIntro, type IntroBag } from './intro';
import { FinishShow } from './finishShow';

/** A car type by id (the supercar for an id no longer known). */
const specOf = (id: string): CarSpec => CARS[id] ?? STREET_RACER;
import { FinishGate, type SparkEmitter } from '../world/finishGate';
import { RoadScene } from '../world/roadScene';
import { SkidMarks } from '../world/skidMarks';
import { Sparks } from '../world/sparks';
import { smokeLightFromSpot, TireSmoke } from '../world/tireSmoke';
import { GameFlow, picksCars, type Phase } from './gameState';
import { FINISHED_SPEED, RaceView, RIVAL_COLORS, Rivals } from './rivals';
import { type LitCar, RivalLightPool } from './rivalLights';
import { BeamFlasher, wantsToFlash } from './flashing';
import { closingSpeed, knocksOut } from './contact';
import { WorkerPlanSource } from '../ai/workerPlanSource';
import { detectNearMiss } from './nearMiss';
import { Blocker, computeResetSpot } from './reset';
import type { EngineSource } from '../audio/otherEngines';
import type { EarPose } from '../audio/pan';
import type { EngineKind } from '../audio/engineCatalog';
import { trafficEngine, type TrafficGearing } from '../audio/spatial';

/** The rivals' colours, for the HUD. */
const RIVAL_CSS = RIVAL_COLORS.map((c) => `#${c.toString(16).padStart(6, '0')}`);

/** Where new traffic appears, ahead of the first racer and behind the last (m out): in the fog. */
const TRAFFIC_EDGE: [number, number] = [500, 580];
/** Traffic gone this far out (m), either way: just past where it appears (none kept out in the fog unseen). */
const TRAFFIC_GONE = 600;
/**
 * The traffic farther than this from the player (m), and RIVAL_AWAKE from every rival, moved by its planner alone,
 * its bodies kinematic (NpcVehicle asleep): nobody near to touch it (an oncoming car closing at 95 m/s: over a
 * second to settle on its springs), its springs' play under a pixel that far (its wheels drawn rolling on still).
 * Simulated in full it was over half the physics' time.
 */
const TRAFFIC_AWAKE = 120;
/**
 * A rival wakes only the traffic this near (m): what it may hit next (closing at 45 m/s, a second and more to
 * settle on its springs). What is seen is woken by the player's TRAFFIC_AWAKE; around rivals spread down the road,
 * 200 m each kept some 46 cars in full.
 */
const RIVAL_AWAKE = 60;
/** The traffic planned every this many physics steps (60 Hz: its drivers' choices; the bodies driven at 120). */
const TRAFFIC_PLAN_EVERY = 2;
/** Another car's tyres smoke only this near the player (m). */
const SMOKE_RANGE = 100;
const HOLD: HandlingInput = { throttle: 0, brake: 0, steer: 0, handbrake: true };
const ROLL_OUT: HandlingInput = { throttle: 0, brake: 0.35, steer: 0 };
/** Every lamp state a traffic vehicle shows (brake lights dim and on, indicators off and on): for prewarm. */
const PREWARM_LAMPS: VehicleLights[] = [
  { left: [], right: [], brake: [new THREE.Mesh(undefined, BRAKE_DIM)], third: [] },
  { left: [new THREE.Object3D()], right: [new THREE.Object3D()], brake: [new THREE.Mesh(undefined, BRAKE_ON)], third: [] },
];
const PLAYER_OBSTACLE_ID = -1;
const BLUR_V = new THREE.Vector3();
const RESIZE_V = new THREE.Vector2();
const EAR_FWD = new THREE.Vector3();
const EAR_UP = new THREE.Vector3();
/**
 * The traffic's tyres rolling, against a car's (rolling.ts): how loud, and their pitch (bigger tyres turning slower:
 * lower). A container truck's heard twice - its cab, and its trailer at its rear axles (TRAILER_ROLL).
 */
const TRAFFIC_ROLL: Record<VehicleKind, { gain: number; pitch: number }> = {
  car: { gain: 0.8, pitch: 1 }, // (at its 110 km/h ~6 LU over its engine cruising: a car's heard by its tyres)
  truck: { gain: 0.8, pitch: 0.8 }, // (a truck's by its diesel: ~2 LU under it cruising, ~6 pulling)
  container: { gain: 0.8, pitch: 0.8 },
};
const TRAILER_ROLL = { gain: 0.8, pitch: 0.75 };
const ROLL_AT = new THREE.Vector3();
/** The traffic's engines: each kind's sound, its gearing (for its rpm by its speed), how loud against a rival's. */
const TRAFFIC_ENGINE: Record<VehicleKind, { kind: EngineKind; gearing: TrafficGearing; gain: number }> = {
  car: { kind: 'sedan', gearing: { gears: 5, top: 55 }, gain: 0.6 },
  truck: { kind: 'truck', gearing: { gears: 6, top: 35 }, gain: 1.1 },
  container: { kind: 'container', gearing: { gears: 8, top: 32 }, gain: 1.25 },
};
const STILL = { x: 0, y: 0, z: 0 };
/** The finish gate's mark, on the screen (render: the HUD's goal). */
const GOAL = new THREE.Vector3();
/** How fast the race's time runs, by phase (frame()): stopped in a pause (past the finish line: its show's, finishTimeScale). */
const TIME_SCALE: Partial<Record<Phase, number>> = { paused: 0 };
/** A race's start: the garage faded to black, then the race faded in on its intro (ms). */
const START_FADE_OUT = 350;
const START_FADE_IN = 700;
/** The race's world run this long (s) behind the black before its intro: the cars settled on their springs. */
const SETTLE_SECONDS = 0.6;
/** The same thing touched again within this (s of race time) isn't heard again (game.contactSound). */
const CONTACT_SOUND_GAP = 0.3;
/** The intros' round left (game/intro IntroBag), kept between visits. */
const INTRO_BAG_KEY = 'ht2.introBag';

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  /** The picture's quality (render/quality: the settings' pixel ratio). */
  private quality = readQuality();
  private readonly post: PostFx;
  private flares!: LightFlares;
  readonly npcBeams = new NpcBeams();
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 3000);
  readonly keyboard = new Keyboard();
  readonly rig = new CameraRig(this.camera);
  readonly road: RoadScene;
  /** The player's car (rebuilt when another car type is picked: applyCars). */
  player: PlayerCar;
  /** The race picked (the cars on the grid now: the player's, and the rivals' as `rivalCars`). */
  private cars: CarSelection = defaultSelection();
  /** The rivals' cars on the grid now (their mode's pick: raceRivals). */
  private rivalCars: string[] = [...this.cars.rivals];
  /** The rivals' real headlights (a pool handed out each frame: lightRivals) and those of them casting shadows now. */
  private rivalLights!: RivalLightPool;
  private rivalShadows: THREE.SpotLight[] = [];
  /** Each rival's high-beam flashing (game/flashing). */
  private readonly flashers = new WeakMap<object, BeamFlasher>();
  readonly flow = new GameFlow(localStorage);
  readonly sound = new Sound();
  /** The background music (audio/music): from the first click or key in the garage on. */
  readonly music = new Music();
  private readonly nowPlaying: NowPlaying;
  /** The engines heard from outside, this frame's (heardEngines; reused). */
  private readonly engineSources: EngineSource[] = [];
  /** The rivals' tyres as heard this frame (its entries reused). */
  private readonly skidSources: SkidSource[] = [];
  private readonly rollSources: RollSource[] = [];
  private readonly windSources: LoopSource[] = [];
  private readonly earPose: EarPose = { px: 0, py: 0, pz: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 };
  readonly hud: Hud;
  /** The garage: the title screen, where the car and the race are picked. */
  readonly garage: Garage;
  /** The settings pop-up: over the garage or the pause. */
  private readonly settings: SettingsPopup;
  readonly trafficSettings = { spacing: DEFAULT_SPACING };
  readonly trafficWorld: TrafficWorld;
  /** Trained driver from public/ai/driver.json (null when none could be loaded). */
  aiDriver: Driver | null = null;
  /** The AI drives the player's car (toggled with I). */
  aiActive = false;
  /** AI strength: its top speed. */
  readonly aiSettings = { speedCapKmh: 300 };
  /** The rivals' top speed at the race's difficulty: this share of their car's own (the tuning panel's AI top speed when that is lower). */
  private rivalTopShare = 1;
  private humanMaxSpeed = 0;
  /** Draw the AI's planned path on the road (P). */
  showPlan = true;
  private planPath!: PlanPath;
  /** The rival racers (RIVAL_TUNING.count of them). */
  rivals!: Rivals;
  private rivalTraffic: TrafficBox[] = [];
  private rivalBoxes: TrafficBox[] = [];
  /** Velocities (world x/z) of the player [0] and the rivals [1..] going into the physics step. */
  private racerVelBefore: { x: number; z: number }[] = [];
  private aiTraffic: TrafficBox[] = [];
  /** The traffic's bodies, drawn instanced. */
  private bodies!: BodyInstances;
  private skids!: SkidMarks;
  private smoke!: TireSmoke;
  private sparks!: Sparks;
  readonly stats = new Stats();
  private gui: GUI;
  private accumulator = 0;
  private lastTime = 0;
  private simTime = 0;
  private prevRelS = new Map<number, number>();
  private touched = new Set<number>();
  /** When each thing the player touched was last heard (race time, s): contactSound. */
  private contactSoundAt = new Map<string, number>();
  private lastInput: HandlingInput = HOLD;
  /** The AI driving the player's car (I) uses the nitro as the rivals do. */
  private readonly playerNitroAi = new NitroAi();
  /** The player's gear last frame (a gear going in shakes the camera). */
  private lastGear = 1;
  /** An upshift under way, from this gear (its shake comes as the new one takes up). */
  private shiftingFrom: number | null = null;
  /** The speed blur as last set (held while paused), and the camera's heading last frame (its turning). */
  private readonly blurCenter = new THREE.Vector2(0.5, 0.5);
  private readonly blurSweep = new THREE.Vector2();
  private blurAmount = 0;
  private camYaw: number | null = null;
  /** The race's intro, whether it is on; a race starting (the fade). */
  private intro: Intro | null = null;
  private introOn = false;
  /** The hood camera instead of the chase camera (V). */
  private hoodCam = false;
  /** The finish's show (past the line, till the next race), and the gate it is at. */
  private finishShow: FinishShow | null = null;
  private readonly gate: FinishGate;
  private readonly emitSpark: SparkEmitter = (x, y, z, vx, vy, vz, life) => this.sparks.emit(x, y, z, vx, vy, vz, life);
  private starting = false;
  /** Fading out of the race, to the garage (toTitle). */
  private leaving = false;
  private overlay!: IntroOverlay;
  /** Overrides keyboard input when set (used by automated checks). */
  inputOverride: HandlingInput | null = null;
  /** Debug: stop the real-time loop from advancing the simulation. */
  freeze = false;

  constructor(container: HTMLElement, uiRoot: HTMLElement, readonly physics: PhysicsWorld) {
    physics.timestep = PHYSICS_DT;
    // (No antialiasing of its own: the picture's edges are smoothed in render/postFx.)
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(pixelRatioFor(this.quality, devicePixelRatio));
    // Night: lights glow through flare sprites (steady however far), and through a gentle
    // bloom over them (render/postFx: only what is brighter than white). Only the player's
    // headlights cast shadows (needed for their low-beam cookie).
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    container.appendChild(this.renderer.domElement);
    this.post = new PostFx(this.renderer, this.scene, this.camera);
    this.flares = new LightFlares(this.post.flares.scene, 2000, this.post.flares.depth); // (faded by how hidden, not cut)
    this.road = new RoadScene(this.scene, this.renderer);
    this.gate = new FinishGate(this.scene);
    for (const m of this.road.groundMaterials) this.npcBeams.patch(m);
    this.player = new PlayerCar(physics, this.scene);
    this.player.surfaceGrip = surfaceGrip;
    this.bodies = new BodyInstances(this.scene);
    this.planPath = new PlanPath(this.scene);
    this.rivals = new Rivals(physics, this.scene, () => new WorkerPlanSource(), this.rivalCars.map(specOf));
    this.rivalLights = new RivalLightPool(this.scene);
    this.trafficWorld = new TrafficWorld(physics, Math.random, { oncoming: true, bothWays: true, edge: TRAFFIC_EDGE, gone: TRAFFIC_GONE, planEvery: TRAFFIC_PLAN_EVERY }); // (any way the player goes)
    this.skids = new SkidMarks(this.scene);
    this.smoke = new TireSmoke(this.post.unbloomed); // (lit, however brightly: no glow)
    this.sparks = new Sparks(this.scene);
    this.stats.dom.style.cssText = 'position:fixed;left:3.1vw;top:8.4vw;z-index:20;opacity:0.85;cursor:pointer'; // (under the HUD's time)
    document.body.appendChild(this.stats.dom);
    setLang(loadSettings(localStorage, navigator.language).lang); // (the screens below are built in it)
    this.hud = new Hud(uiRoot, this.flow, {
      onAgain: () => this.startRace(this.cars),
      onResume: () => this.togglePause(),
      onRestart: () => this.startRace(),
      onTitle: () => this.toTitle(),
      onSettings: () => this.settings.open(uiRoot),
    });
    this.settings = new SettingsPopup(uiRoot);
    this.settings.onQuality = (pr) => this.setQuality(pr);
    this.settings.onVolumes = (v) => this.setVolumes(v);
    this.setVolumes(loadVolumes(localStorage));
    this.garage = new Garage(uiRoot, RIVAL_COLORS, (cars) => {
      saveSelection(localStorage, cars);
      this.startRace(cars, true);
    }, this.settings);
    this.overlay = new IntroOverlay(uiRoot); // (over the garage: its fade covers it)
    // The song playing: in the race under the place (in the HUD, shaking with it), in the garage under its buttons.
    this.nowPlaying = new NowPlaying([uiRoot.querySelector<HTMLElement>('#hud')!, uiRoot.querySelector<HTMLElement>('#garage .g-corner')!]);
    this.music.onSong = (song) => this.nowPlaying.show(songTitle(song));
    this.gui = createTuningPanel(this.player.params, this.rig.params, this.trafficSettings, this.aiSettings);
    this.bindKeys();
    // Any key or click skips the intro, and the finish's show (its panel in on the next frame: the same key not
    // also picking from it).
    addEventListener('keydown', () => this.skipShows());
    addEventListener('pointerdown', () => this.skipShows());
    this.resize();
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      this.music.setHidden(document.hidden);
      if (document.hidden && (this.flow.phase === 'racing' || this.flow.phase === 'countdown')) this.togglePause();
    });
    this.resetWorld();
    this.openGarage(true); // (the game opens on its title)
    // The sound woken at the first click or key (the browser lets it start only then), so its clips load in the
    // garage, ready for the race's start; the music starts there too.
    const wake = (): void => {
      this.sound.init();
      this.music.start();
    };
    addEventListener('pointerdown', wake, { once: true });
    addEventListener('keydown', wake, { once: true });
    this.prewarm();
  }

  /**
   * Draw everything once: every traffic model (in both lamp states) ahead in the headlights, the racers, every
   * effect (all made visible for this one frame), through the shadows, bloom and FXAA; every flame picture sent.
   * Their shaders are compiled and their textures sent now: drawn first mid-race, each held its frame up 40-80
   * ms (the race's first, ~500 ms). At the start (behind the garage) and as a race is set up (its cars new, the
   * pictures loaded since). A plain frame drawn after it.
   */
  private prewarm(): void {
    for (const t of flameTextures()) this.renderer.initTexture(t);
    this.render(0, 1); // (everything placed: the camera, the cars)
    const ahead = new THREE.Matrix4().makeTranslation(0, 0, -15).premultiply(this.player.mesh.matrix);
    this.bodies.begin(this.camera, this.shadowLights());
    for (const m of allTrafficModels()) for (const lamps of PREWARM_LAMPS) this.bodies.add(m.key, m.template, ahead, lamps);
    this.player.addWheels(this.bodies);
    for (const r of this.rivals.list) r.car.addWheels(this.bodies);
    this.bodies.end();
    // Hidden things shown, and nothing culled (by the camera or the headlights): what is behind the camera or out
    // of the beams now (the rails' posts, the trees) is drawn, and casts its shadow, later.
    const hidden: THREE.Object3D[] = [];
    const culled: THREE.Object3D[] = [];
    for (const root of [this.scene, this.post.unbloomed]) {
      root.traverse((o) => {
        if (!o.visible && !(o as THREE.Light).isLight) hidden.push(o); // (lights: their number is in every shader)
        if (o.frustumCulled) culled.push(o);
      });
    }
    for (const o of hidden) o.visible = true;
    for (const o of culled) o.frustumCulled = false;
    this.post.motion(new THREE.Vector2(0.5, 0.5), 0.01, new THREE.Vector2()); // (the speed blur's shader too: off till 120 km/h)
    this.post.render();
    for (const o of hidden) o.visible = false;
    for (const o of culled) o.frustumCulled = true;
    this.render(0, 1);
  }

  private bindKeys(): void {
    const k = this.keyboard;
    const g = this.garage;
    const set = this.settings;
    // Every screen works from the keyboard alone (docs/ui-design.md). Enter: at the title, into the garage; in the
    // garage (the race setup open or not), into the race (not while the controls pop-up is open); on the pause and
    // the finish, the option under the menu's cursor; the settings open (over the garage or the pause), their OK.
    // A button the Tab key is on takes the Enter itself.
    const menu = () => !g.isOpen && (this.flow.phase === 'paused' || (this.flow.phase === 'finished' && this.hud.finishShown));
    const enter = () => {
      if (document.activeElement instanceof HTMLButtonElement) return;
      if (set.isOpen) return set.confirm();
      if (g.isOpen) {
        if (g.keysOpen) return;
        if (g.onTitle) g.enter();
        else g.start();
      } else if (menu()) this.hud.menuPick();
    };
    k.onPress('Enter', enter);
    k.onPress('NumpadEnter', enter);
    // Esc: cancels the settings; closes what is over the garage; races, pauses and resumes; after the finish, back
    // to the garage.
    k.onPress('Escape', () => {
      if (set.isOpen) return set.close();
      if (g.isOpen) return g.popOpen && g.closePop();
      if (this.flow.phase === 'finished') return this.hud.finishShown && this.toTitle(); // (in its show: skips it)
      if (this.hud.confirming) return this.hud.cancelConfirm(); // (the pause's confirm open: back to its menu)
      this.togglePause();
    });
    // ↑ ↓ the car, ← → its paint, E the race setup, H the controls, O the settings: in the garage (not at the title:
    // its picks are not shown there). The setup open, the arrows walk its rows and change them, 0-5 set how many
    // rivals; the settings open (here or over the pause), the same (language, quality). On the pause and the finish,
    // the arrows move the menu's cursor.
    const picking = () => g.isOpen && !g.popOpen && !g.onTitle;
    const setup = () => g.isOpen && g.setupOpen;
    const arrow = (dy: number, dx: number) => {
      if (set.isOpen) return dy ? set.move(dy) : set.adjust(dx);
      if (setup()) return dy ? g.setupMove(dy) : g.setupAdjust(dx);
      if (g.isOpen && g.tuneOpen) return dy ? g.tuneMove(dy) : g.tuneAdjust(dx);
      if (picking()) return dy ? g.step(dy) : g.stepPaint(dx);
      if (menu()) this.hud.menuMove(dy || dx);
    };
    const corner = () => g.isOpen && !g.onTitle && !g.setupOpen;
    k.onPress('KeyH', () => corner() && !set.isOpen && g.toggleKeys());
    k.onPress('KeyO', () => corner() && !g.keysOpen && g.toggleSettings());
    // T: the tuning panel (the car's knobs), or closed again; R in it, the car as built.
    k.onPress('KeyT', () => corner() && !set.isOpen && !g.keysOpen && g.toggleTune());
    k.onPress('ArrowUp', () => arrow(-1, 0));
    k.onPress('ArrowDown', () => arrow(1, 0));
    k.onPress('ArrowLeft', () => arrow(0, -1));
    k.onPress('ArrowRight', () => arrow(0, 1));
    k.onPress('KeyE', () => picking() && g.openSetup());
    for (let n = 0; n <= MAX_RIVALS; n++) {
      k.onPress(`Digit${n}`, () => setup() && g.setupCount(n));
      k.onPress(`Numpad${n}`, () => setup() && g.setupCount(n));
    }
    // Race keys do nothing in the garage.
    k.onPress('KeyR', () => {
      if (g.isOpen) return g.tuneOpen && !set.isOpen && g.tuneReset();
      this.tryReset();
    });
    k.onPress('KeyM', () => {
      const v = { ...loadVolumes(localStorage), muted: !this.sound.muted };
      saveVolumes(localStorage, v);
      this.setVolumes(v);
    });
    k.onPress('KeyN', () => this.music.skip());
    k.onPress('KeyV', () => !g.isOpen && (this.hoodCam = !this.hoodCam));
    k.onPress('KeyI', () => !g.isOpen && this.toggleAi());
    k.onPress('KeyP', () => !g.isOpen && (this.showPlan = !this.showPlan));
    k.onPress('Backquote', () => (this.gui._hidden ? this.gui.show() : this.gui.hide()));
  }

  /** The player's volumes (settings, M) heard: the music's, the rest's, the mute. */
  private setVolumes(v: Volumes): void {
    this.sound.setVolume(v.sfx);
    this.sound.setMuted(v.muted);
    this.music.userVolume = v.music;
    this.music.muted = v.muted;
  }

  /** The picture's quality (render/quality: the settings' pixel ratio), kept; drawn at it from now on. */
  setQuality(pixelRatio: number): void {
    this.quality = pixelRatio;
    this.resize();
  }

  private resize(): void {
    // (Its screen's ratio too: moved onto another screen, a level it can't show there is drawn as its finest.)
    this.renderer.setPixelRatio(pixelRatioFor(this.quality, devicePixelRatio));
    this.renderer.setSize(innerWidth, innerHeight);
    this.post.setSize(innerWidth, innerHeight);
    this.smoke.setView(this.renderer.getDrawingBufferSize(RESIZE_V).y);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  // --- flow -----------------------------------------------------------------

  /** The garage, with the race picked last time (only before a race: at the title or after the finish); `title`: on the game's title. */
  openGarage(title = false): void {
    if (!picksCars(this.flow.phase)) return;
    // The world (and its render, which drives the engine and tyre sounds) stops: no engine left running in the garage.
    this.sound.silenceEngine();
    this.sound.setSkid(0);
    this.sound.setOtherSkids(this.skidSources, this.ear(), false);
    this.sound.setNitro(false);
    this.hud.hide();
    this.garage.open(loadSelection(localStorage), title);
  }

  /**
   * Start a race as picked (`cars`: the cars, difficulty and weather), else on the grid as it is. Only from the
   * title or the finish. A fade to black (the race set up behind it, prewarm's stall unseen), then back on its
   * intro.
   */
  /**
   * A race with `cars` (none: the same as last), from the garage (`fromGarage`: the car started up, heard as it heads
   * for the grid), after the finish, or paused (the same race again: the engine already running, no start-up).
   */
  startRace(cars?: CarSelection, fromGarage = false): void {
    if (!(picksCars(this.flow.phase) || this.flow.phase === 'paused') || this.starting) return;
    this.starting = true;
    this.sound.init(); // (in the click or key itself: the browser lets the sound start only there)
    if (fromGarage) this.sound.startup(specOf((cars ?? this.cars).player).style);
    this.music.change(); // (a new scene: the song faded out, a moment's quiet, the next one in)
    this.overlay.toBlack(START_FADE_OUT, () => {
      this.starting = false;
      this.garage.close();
      // Restarted while paused: the pause's menu shut, the sound back on (and an intro still running ended).
      if (this.introOn) {
        this.introOn = false;
        this.intro?.end();
      }
      this.sound.suspend(false);
      this.sound.bringBack();
      // Every race starts with the player driving (I hands the car to the AI again), on the car's own limiter.
      if (this.aiActive) {
        this.aiActive = false;
        this.player.params.maxSpeed = this.humanMaxSpeed;
      }
      if (cars) {
        this.applyCars(cars);
        this.rivalTopShare = applyDifficulty(cars.difficulty);
      }
      // The player's car as tuned (src/vehicles/tuning; as built where it isn't).
      const spec = specOf(this.cars.player);
      Object.assign(this.player.params, tuned(spec.params, this.cars.tuning?.[spec.id] ?? {}, TUNE_CAL[spec.id]));
      this.hud.setAccent(CAR_CARDS.find((c) => c.id === this.cars.player)?.accent ?? '#ff3b30');
      this.resetWorld();
      this.flow.start(); // (the intro's phase: the cars held on the grid - after a race the rivals would drive off)
      // The cars settled on their springs, unseen (put on the grid a little high, they bounced ~5 cm in the
      // intro's first shot).
      this.simulate(SETTLE_SECONDS, undefined, false);
      this.prewarm();
      this.beginIntro();
      this.overlay.fromBlack(START_FADE_IN);
    });
  }

  /** The race's intro: the next of its shuffled round (none twice in a row, every one once in each round). */
  private beginIntro(): void {
    // From the shuffled round kept between visits (game/intro nextIntro: every one once in each round).
    let bag: IntroBag = { left: [], last: null };
    try {
      bag = { ...bag, ...JSON.parse(localStorage.getItem(INTRO_BAG_KEY) ?? '{}') };
    } catch {
      // (unreadable: a fresh round)
    }
    const next = nextIntro(bag);
    localStorage.setItem(INTRO_BAG_KEY, JSON.stringify(next.bag));
    this.intro = new Intro(next.kind, { camera: this.camera, player: this.player, rivals: this.rivals.list.map((r) => r.car), chase: this.rig.params });
    this.introOn = true;
    this.overlay.show(true);
  }

  /** The countdown on (the intro's last shot still coming round into place): its bars away, the HUD in. */
  private startCountdown(): void {
    this.flow.beginCountdown();
    this.overlay.show(false);
  }

  /** The intro over (or skipped): the chase camera from where it ended. */
  private finishIntro(): void {
    if (!this.introOn) return;
    this.introOn = false;
    this.intro?.end();
    this.rig.snap();
    this.camYaw = null; // (the camera's jump no turn for the speed blur)
  }

  /** A key or a click in the intro: straight to the countdown, the chase camera. */
  private skipIntro(): void {
    if (this.flow.phase !== 'intro') return;
    this.startCountdown();
    this.finishIntro();
  }

  /** A key or a click: the intro skipped, or the finish's show (to its end: the panel). */
  private skipShows(): void {
    this.skipIntro();
    if (this.flow.phase === 'finished' && this.finishShow && !this.finishShow.done) this.finishShow.skip();
  }

  /** Past the line: the finish's show from here (the HUD off, the bars in; its panel after it: render). */
  private beginFinishShow(): void {
    this.finishShow = new FinishShow(this.camera, this.player);
    // Past the line the AI takes the car (as the I key does; the next race hands it back), rolling on.
    if (this.aiDriver && !this.aiActive) this.toggleAi();
    this.gate.shown = false; // (its fountains go on)
    this.overlay.show(true);
  }

  /**
   * Put these cars on the grid: the player's car and the rivals are rebuilt
   * where their type changed (the player's, its paint job too; the tuning panel
   * then tunes the new player car).
   */
  applyCars(cars: CarSelection): void {
    if (cars.player !== this.cars.player || cars.paint[cars.player] !== this.cars.paint[this.cars.player]) {
      this.aiActive = false; // the new car starts with its own limiter (the AI's hand-back would restore the old car's)
      this.player.dispose(this.physics);
      this.player = new PlayerCar(this.physics, this.scene, { spec: specOf(cars.player), livery: cars.paint[cars.player] });
      this.player.surfaceGrip = surfaceGrip;
      const shown = !this.gui._hidden;
      this.gui.destroy();
      this.gui = createTuningPanel(this.player.params, this.rig.params, this.trafficSettings, this.aiSettings);
      if (shown) this.gui.show();
    }
    const spec = specOf(cars.player);
    if (this.aiDriver instanceof PlannerDriver) {
      this.aiDriver.accel = spec.ai.accel;
      this.aiDriver.latAccel = spec.ai.latAccel;
      this.aiDriver.tracker = trackerFrom(spec.ai.tracker);
      this.aiDriver.recovery = trackerFrom(spec.ai.recovery);
    }
    const rivals = raceRivals(cars, Math.random); // (at random: drawn afresh each race, the same race again too)
    if (rivals.length !== this.rivalCars.length || rivals.some((id, i) => id !== this.rivalCars[i])) {
      this.rivals.dispose();
      this.rivals = new Rivals(this.physics, this.scene, () => new WorkerPlanSource(), rivals.map(specOf));
    }
    this.rivalCars = rivals;
    this.cars = { ...cars, rivals: [...cars.rivals], paint: { ...cars.paint } };
  }

  /** Back to the garage (from the pause or the finish). */
  /** Back to the garage: to black, the race put away, the garage in from black (as the garage into the race). */
  toTitle(): void {
    if (this.leaving || this.starting) return;
    this.leaving = true;
    this.music.change(); // (a new scene: the song faded out, a moment's quiet, the next one in)
    this.overlay.toBlack(START_FADE_OUT, () => {
      this.leaving = false;
      if (this.introOn) {
        this.introOn = false;
        this.intro?.end();
        this.overlay.show(false);
      }
      this.flow.toTitle();
      this.sound.suspend(false);
      this.sound.bringBack();
      this.resetWorld();
      this.openGarage();
      this.overlay.fromBlack(START_FADE_IN);
    });
  }

  togglePause(): void {
    this.flow.togglePause();
    this.sound.suspend(this.flow.phase === 'paused');
  }

  /** Our carriageway's traffic planner. */
  get traffic(): TrafficSim {
    return this.trafficWorld.sides[0].sim;
  }

  /** Oncoming carriageway's traffic planner. */
  get oncoming(): TrafficSim {
    return this.trafficWorld.sides[1].sim;
  }

  get npcs(): Map<number, NpcVehicle> {
    return this.trafficWorld.npcs;
  }

  /** Random source for traffic (tests may swap in a seeded one). */
  get rng(): () => number {
    return this.trafficWorld.rng;
  }

  set rng(r: () => number) {
    this.trafficWorld.rng = r;
  }

  /** Traffic is kept around the player and every rival (from the hindmost to the one in front). */
  private focus(): TrafficFocus {
    let lead = this.player.s;
    let tail = this.player.s;
    for (const r of this.rivals.list) {
      lead = Math.max(lead, r.car.s);
      tail = Math.min(tail, r.car.s);
    }
    return { sLead: lead, sTail: tail, vLead: this.player.speed, raceTime: this.flow.raceTime };
  }

  /** Lanes the player's and the rivals' cars take up, so no traffic is spawned on top of them. */
  private playerOccupants(frame: RoadFrame): Occupant[] {
    const p = this.playerBox(frame);
    const own = lanesOccupied(p.dMin, p.dMax).map((lane) => ({ s: p.s, lane, length: p.length, v: Math.max(0, p.v) }));
    return [...own, ...this.rivals.occupants(frame)];
  }

  /** Clear traffic and wrecks, put the player on the start line, refill traffic ahead. */
  resetWorld(): void {
    this.prevRelS.clear();
    this.touched.clear();
    this.contactSoundAt.clear();
    this.player.resetTo(-3, 1, 0);
    this.player.nitro.reset();
    this.playerNitroAi.reset();
    this.aiDriver?.reset(this.player.d);
    this.rivals.place();
    if (this.finishShow) {
      this.finishShow = null;
      this.overlay.show(false);
    }
    this.gate.reset();
    this.skids.clear();
    this.smoke.clear();
    this.sparks.clear();
    this.rig.snap();
    this.trafficWorld.spacing = this.trafficSettings.spacing;
    this.trafficWorld.reset(this.focus(), (f) => this.playerOccupants(f));
  }

  tryReset(): void {
    if (!this.flow.canReset()) return;
    const blockers: Blocker[] = [];
    for (const npc of this.npcs.values()) {
      const agent = this.trafficWorld.sideOf(npc.id)?.name === 'ours' ? this.traffic.agents.get(npc.id) : undefined;
      if (agent && !npc.wrecked) {
        blockers.push({ s: agent.s, dMin: agent.span?.[0] ?? agent.d - agent.width / 2, dMax: agent.span?.[1] ?? agent.d + agent.width / 2, length: agent.length, v: agent.v });
        if (agent.targetLane !== null && agent.targetLane !== agent.lane) {
          // Mid lane change: it is about to occupy the target lane too.
          const c = laneCenter(agent.targetLane);
          blockers.push({ s: agent.s, dMin: c - agent.width / 2, dMax: c + agent.width / 2, length: agent.length, v: agent.v });
        }
      } else {
        blockers.push(...npc.obstacles(OUR_FRAME));
      }
    }
    blockers.push(...this.rivals.boxes(this.rivalBoxes));
    const spot = computeResetSpot(this.player.s, this.player.d, blockers, RESET_SPEED);
    this.player.resetTo(spot.s, spot.lane, RESET_SPEED);
    this.aiDriver?.reset(this.player.d);
    this.skids.cut();
    this.flow.markReset();
    this.rig.snap();
  }

  // --- loop -----------------------------------------------------------------

  start(): void {
    this.lastTime = performance.now();
    const loop = (now: number) => {
      this.stats.begin();
      const dt = Math.min(MAX_FRAME_DT, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.frame(dt);
      this.stats.end();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private frame(dt: number): void {
    // (quieter in the countdown, down to half past the finish line; real time, the garage too)
    this.music.update(dt, this.flow.phase === 'countdown', this.flow.phase === 'finished');
    this.music.setPaused(this.flow.phase === 'paused');
    this.nowPlaying.time(this.music.time, this.music.length);
    // The garage covers the whole screen and draws its own car: the world waits (and the GPU rests), the FPS meter too.
    this.stats.dom.style.visibility = this.garage.isOpen ? 'hidden' : '';
    if (this.garage.isOpen) return;
    // The race's time this frame: 0 while paused, slowed past the finish (TIME_SCALE; its show's). The world and
    // everything that moves with the race (effects, the camera, the HUD's pop-ups) run on it, so a pause stills the
    // whole picture; only the menus, and the finish's show (what sets how slow), run on real time.
    const show = this.flow.phase === 'finished' ? this.finishShow : null;
    show?.step(dt);
    const play = dt * (show ? show.timeScale : (TIME_SCALE[this.flow.phase] ?? 1));
    this.sound.setTimeScale(dt > 0 ? play / dt : 1); // (the engines slow with it; a pause leaves it as it was)
    if (play > 0 && !this.freeze) {
      this.accumulator += play;
      let steps = 0;
      while (this.accumulator >= PHYSICS_DT && steps < MAX_SUBSTEPS) {
        this.fixedStep(PHYSICS_DT);
        this.accumulator -= PHYSICS_DT;
        steps++;
      }
      if (steps === MAX_SUBSTEPS) this.accumulator = 0;
    }
    document.body.classList.toggle('game-paused', this.flow.phase === 'paused'); // (the HUD's CSS animations too)
    this.render(play, this.accumulator / PHYSICS_DT);
  }

  /** Debug: advance the simulation synchronously (independent of rAF throttling). */
  simulate(seconds: number, input?: HandlingInput, render = true): void {
    const prev = this.inputOverride;
    if (input) this.inputOverride = input;
    const n = Math.round(seconds / PHYSICS_DT);
    for (let i = 0; i < n && this.flow.phase !== 'paused'; i++) this.fixedStep(PHYSICS_DT);
    this.inputOverride = prev;
    if (render) this.render(PHYSICS_DT, 1);
  }

  /** Hand the car to the trained AI, or take it back. */
  toggleAi(): void {
    if (!this.aiDriver) {
      this.hud.message(t('toast.noAi'));
      return;
    }
    this.aiActive = !this.aiActive;
    if (this.aiActive) {
      this.humanMaxSpeed = this.player.params.maxSpeed;
      this.aiDriver.reset(this.player.d);
    } else this.player.params.maxSpeed = this.humanMaxSpeed;
  }

  /**
   * The AI driving the player's car: same inputs as in training (our carriageway's traffic, the rivals), its top
   * speed the AI's cap (the car's own when lower), no faster than `limit` (m/s).
   */
  /**
   * The AI's input for the player's car, at most `limit` (m/s). `coast` (past the line): over it the engine gives
   * no more (driveCommand: its maxSpeed), and the AI aims at the speed it has - it rolls down to it, never brakes
   * for it (only for what is ahead).
   */
  private aiInput(ai: Driver, limit: number, coast = false): HandlingInput {
    const cap = Math.min(limit, aiTopSpeed(this.aiSettings.speedCapKmh / 3.6, specOf(this.cars.player)));
    this.player.params.maxSpeed = cap;
    const seen = this.trafficWorld.ourBoxes(this.aiTraffic);
    for (const b of this.rivals.boxes(this.rivalBoxes)) seen.push(b);
    const aim = coast ? Math.max(cap, this.player.speed) : cap;
    const input = ai.drive(selfStateOf(this.player, aim), seen, this.player.params);
    return { ...input, nitro: this.playerNitroAi.want(PHYSICS_DT, input.throttle, this.player.nitro) }; // its nitro by the rivals' rule
  }

  private currentInput(): HandlingInput {
    switch (this.flow.phase) {
      case 'racing':
        if (this.aiActive && this.aiDriver && !this.inputOverride) return this.aiInput(this.aiDriver, Infinity);
        return this.inputOverride ?? this.keyboard.driving();
      case 'finished':
        // Past the line the AI has the car (beginFinishShow hands it over), rolling on as the rivals do once
        // finished (FINISHED_SPEED: the show's shots follow a car slowing down); without one, braked to a stop.
        if (this.aiActive && this.aiDriver) return this.aiInput(this.aiDriver, FINISHED_SPEED, true);
        return this.player.speed > 1 ? ROLL_OUT : HOLD; // brake to a stop, never into reverse
      case 'countdown': {
        // On the grid the brake is held for the player, whatever else they press: with the throttle that is a
        // burnout (revving on the line, smoke), let go of at the green. Off the throttle the handbrake (a brake
        // alone at a standstill selects reverse). The nitro stays full for the start.
        const keys = this.inputOverride ?? this.keyboard.driving();
        return keys.throttle > 0 ? { ...keys, brake: 1, nitro: false } : { ...keys, brake: 0, handbrake: true, nitro: false };
      }
      default:
        return HOLD;
    }
  }

  private fixedStep(dt: number): void {
    this.simTime += dt;
    const input = this.currentInput();
    this.lastInput = input;

    // The rivals race once the race is on (held on the grid before).
    const racing = this.flow.phase === 'racing' || this.flow.phase === 'finished';
    const view: RaceView = {
      player: this.player,
      traffic: this.trafficWorld.ourBoxes(this.rivalTraffic),
      speedCap: this.aiSettings.speedCapKmh / 3.6,
      topShare: this.rivalTopShare,
      raceTime: this.flow.raceTime,
    };
    if (racing) this.rivals.drive(dt, view);
    else this.rivals.hold(dt, this.flow.phase === 'countdown', this.flow.countdown);

    // Traffic AI on both carriageways (the player, the rivals and every wreck are
    // obstacles to both), then drive the NPC bodies along the planned paths.
    this.trafficWorld.rouse([{ s: this.player.s, reach: TRAFFIC_AWAKE }, ...this.rivals.list.map((r) => ({ s: r.car.s, reach: RIVAL_AWAKE }))]);
    this.trafficWorld.stepAI(dt, this.simTime, (frame) => [{ ...this.playerBox(frame), id: PLAYER_OBSTACLE_ID, isPlayer: true }, ...this.rivals.obstacles(frame)]);

    this.player.holdInPlace(this.flow.phase === 'countdown' || this.flow.phase === 'intro'); // (on the grid a burnout goes nowhere)
    this.player.prePhysics(input, dt);
    // How the racers were moving going into the step: a contact is judged on that, not on the bounce.
    const before = this.player.body.linvel();
    this.racerVelBefore[0] = { x: before.x, z: before.z };
    this.rivals.list.forEach((r, i) => {
      const v = r.car.body.linvel();
      this.racerVelBefore[i + 1] = { x: v.x, z: v.z };
    });
    // The intro's arriving cars, drawn braking: the load on their bodies (held on the grid), on their own springs.
    if (this.introOn) for (const [car, decel] of this.intro!.braking()) car.brakeLoad(decel, dt);
    this.physics.step((a, b, n) => this.onContact(a, b, n));
    this.physics.touches((t) => {
      // None off a car's underside on the ground (its nose dipping onto the road under hard braking threw them);
      // its roof or side on it (rolled over), yes.
      const ground = (t.a.type === 'static' || t.b.type === 'static') && Math.abs(t.normal.y) > 0.7; // (a rail's side: across)
      const upright = t.upA.y + t.upB.y > 0.7; // (the static one's: 0)
      if (!(ground && upright)) this.sparks.touch(t, dt);
    });
    this.player.postPhysics();
    this.trafficWorld.afterPhysics();
    this.rivals.after(dt, view, this.trafficWorld.ourBoxes(this.rivalTraffic), racing);
    const pv = this.player.body.linvel();
    // Another car's tyre smokes only within SMOKE_RANGE of the player (the puffs are few: far off they'd crowd out
    // what is near, unseen).
    const pp = this.player.body.translation();
    const near = (x: number, z: number) => (x - pp.x) ** 2 + (z - pp.z) ** 2 < SMOKE_RANGE ** 2;
    this.player.wheels.forEach((w, i) => {
      const sliding = w.inContact && w.sliding;
      const k = sliding && w.slip > 1.5 ? Math.min(1, (w.slip - 1.5) / 8) : 0;
      this.skids.add(i, w.contactX, w.contactZ, w.dirX, w.dirZ, k);
      this.smoke.emit(i, w.contactX, w.contactZ, sliding ? w.slip : 0, pv.x, pv.z, dt);
    });
    // The rivals' tyres smoke as the player's (their burnouts on the grid too). (Their keys 10 on: the player's 0..3,
    // the wrecks' 100 on.)
    for (const r of this.rivals.list) {
      const rv = r.car.body.linvel();
      r.car.wheels.forEach((w, i) => {
        const slip = w.inContact && w.sliding && near(w.contactX, w.contactZ) ? w.slip : 0;
        this.smoke.emit(10 + r.index * 4 + i, w.contactX, w.contactZ, slip, rv.x, rv.z, dt);
      });
    }
    // Wrecks run on the same tyre model, so they leave marks and smoke too.
    for (const npc of this.npcs.values()) {
      if (!npc.wrecked) continue;
      for (const { part, wheels, body } of npc.wreckWheels()) {
        const v = body.linvel();
        wheels.forEach((w, i) => {
          const key = 100 + npc.id * 16 + part * 8 + i;
          const sliding = w.inContact && w.sliding;
          const k = sliding && w.slip > 1.5 ? Math.min(1, (w.slip - 1.5) / 8) : 0;
          this.skids.add(key, w.contactX, w.contactZ, w.dirX, w.dirZ, k);
          this.smoke.emit(key, w.contactX, w.contactZ, sliding && near(w.contactX, w.contactZ) ? w.slip : 0, v.x, v.z, dt);
        });
      }
    }

    this.trafficWorld.spacing = this.trafficSettings.spacing;
    this.trafficWorld.maintain(dt, this.focus(), (f) => this.playerOccupants(f));
    this.forgetRemovedNpcs();
    this.checkNearMisses();

    const wasFinished = this.flow.phase === 'finished';
    this.flow.update(dt, this.player.s);
    if (!wasFinished && this.flow.phase === 'finished') {
      this.beginFinishShow();
      this.sound.fadeAway(); // (slowed down it sounds wrong: away; the music plays on, down to half: Music.update)
    }
  }

  /** The player's car as an obstacle in a carriageway's coordinates. */
  private playerBox(frame: RoadFrame) {
    const t = this.player.body.translation();
    const v = this.player.body.linvel();
    const f = OUR_FRAME.forwardWorld(this.player.yaw);
    return boxToFrame(frame, { x: t.x, z: t.z, fx: f.x, fz: f.z, w: this.player.width, l: this.player.length, vx: v.x, vz: v.z });
  }

  private onContact(a: EntityRef, b: EntityRef, normal: { x: number; z: number } | null): void {
    const playerHit = a.type === 'player' || b.type === 'player';
    const rival = a.type === 'rival' ? a : b.type === 'rival' ? b : null;
    if (playerHit && rival) {
      // Player and rival trading paint: feel it, the physics does the rest.
      const pv = this.player.body.linvel();
      const rv = this.rivals.list[rival.id].car.body.linvel();
      const rel = Math.hypot(pv.x - rv.x, pv.z - rv.z);
      this.crashShake(rel, normal ?? { x: pv.x - rv.x, z: pv.z - rv.z });
      // (heard by how fast they closed in along the push, going into it: a side swipe little, as with the traffic)
      const pb = this.racerVelBefore[0], rb = this.racerVelBefore[rival.id + 1];
      this.contactSound(`rival ${rival.id}`, pb && rb ? closingSpeed(pb, rb, normal) : rel);
      return;
    }
    // The player on a guardrail (the ground's contacts have no normal across it: never heard).
    if (playerHit && (a.type === 'static' || b.type === 'static')) {
      const v = this.racerVelBefore[0];
      if (normal && v) this.contactSound('rail', closingSpeed(v, { x: 0, z: 0 }, normal));
      return;
    }
    // NPC pile-ups are handled by the traffic; we get the NPC the player or a rival hit.
    const id = this.trafficWorld.onNpcContact(a, b);
    if (id === null) return;
    const npc = this.npcs.get(id);
    if (!npc) return;
    // Only a real hit knocks it out of control; a scrape it drives on from (street racing).
    const racerV = this.racerVelBefore[playerHit ? 0 : (rival?.id ?? -1) + 1];
    const nv = npc.parts[0].body.linvel();
    const hard = !racerV || knocksOut(racerV, nv, normal);
    if (hard) this.trafficWorld.wreck(id);
    if (!playerHit) return;
    const rel = racerV ? closingSpeed(racerV, nv, normal) : 0;
    this.touched.add(id);
    this.prevRelS.delete(id);
    this.crashShake(rel, normal ?? (racerV ? { x: racerV.x - nv.x, z: racerV.z - nv.z } : null));
    this.contactSound(`npc ${id}`, rel);
  }

  /**
   * Every touch of the player's heard, a scrape as much as a hit - only quieter, by `rel` (how fast they closed in).
   * The same thing (`key`) not again within CONTACT_SOUND_GAP of race time: a scrape along it touching on and off.
   */
  private contactSound(key: string, rel: number): void {
    const last = this.contactSoundAt.get(key);
    if (last !== undefined && this.simTime - last < CONTACT_SOUND_GAP) return;
    this.contactSoundAt.set(key, this.simTime);
    this.sound.crash(rel);
  }

  /**
   * A hit shakes the camera, the harder the more: most along the hit (`dir`: the contact's normal, or the cars'
   * relative velocity), much across it too - most hits are along the road, and the camera moving to and from
   * the car is hardly seen.
   */
  private crashShake(rel: number, dir: { x: number; z: number } | null): void {
    const d = dir && Math.hypot(dir.x, dir.z) > 1e-6 ? dir : { x: 1, z: 0 };
    this.rig.shake({ dir: { x: d.x, y: 0.3, z: d.z }, amplitude: Math.min(0.5, 0.05 + rel * 0.012), frequency: 14, seconds: 0.5, wave: 'noise', across: 0.8 });
  }

  /**
   * The rivals' real lamps handed out (game/rivalLights: their bodies placed; the camera as last drawn), each
   * flashing its high beam at a racer it closes on fast (game/flashing, on race time `play`), and the player's at
   * the one brightness (HEADLIGHTS: the tuning panel's). The rivals left without one: their beams painted on the road.
   */
  private lightRivals(play: number): LitCar[] {
    // The high beam while X is held (in the race: not in the garage).
    const high = !this.garage.isOpen && this.keyboard.isDown('KeyX');
    if (high !== this.player.highBeam) this.player.setHighBeam(high);
    for (const l of this.player.headlights) l.intensity = (HEADLIGHTS.pair / 2) * (high ? HEADLIGHTS.high : 1);
    const racing = this.flow.phase === 'racing';
    const road = [this.player, ...this.rivals.list.map((r) => r.car)].map((c) => ({ s: c.s, d: c.d, v: c.speed }));
    const cars = this.rivals.list.map((r, i) => {
      let f = this.flashers.get(r);
      if (!f) this.flashers.set(r, (f = new BeamFlasher()));
      const me = road[i + 1];
      const flashing = f.update(play, racing && wantsToFlash(me, road.filter((o) => o !== me)));
      return { mesh: r.car.mesh, width: r.car.width, length: r.car.length, high: flashing };
    });
    const { painted, shadows } = this.rivalLights.assign(cars, this.camera);
    this.rivalShadows = shadows;
    return painted;
  }

  /** The lights whose shadows show this frame: the player's headlights, and the rivals' pool's near ones. */
  private shadowLights(): THREE.SpotLight[] {
    return [...this.player.headlights, ...this.rivalShadows];
  }

  /**
   * The speed blur (render/speedBlur; call with the camera placed): out from where the car is going on the
   * screen (off the middle as it slides), the more the faster (POST.blurFrom km/h up, more with the nitro), and
   * across by the camera's turning (as a 1/60 s exposure would smear it). Paused, it holds as it was (the
   * picture stays); none at the title, nor in the intro's or the finish's shots.
   */
  private speedBlur(play: number): void {
    this.camera.getWorldDirection(BLUR_V);
    const yaw = Math.atan2(BLUR_V.x, BLUR_V.z);
    const shot = this.flow.phase === 'title' || this.flow.phase === 'intro' || (this.flow.phase === 'finished' && this.finishShow !== null);
    if (play > 0) {
      const v = this.player.body.linvel();
      const center = shot ? null : motionCenter(this.camera, BLUR_V.set(v.x, v.y, v.z));
      if (center) this.blurCenter.copy(center);
      this.blurAmount = center
        ? blurAmount(Math.abs(this.player.speed) * 3.6, this.player.nitro.active, { from: POST.blurFrom, full: POST.blurFull, strength: POST.blurStrength, nitro: POST.blurNitro })
        : 0;
      // (A jump of the camera - a reset - is no turn: at most 3 rad/s.)
      const turned = this.camYaw === null ? 0 : Math.atan2(Math.sin(yaw - this.camYaw), Math.cos(yaw - this.camYaw));
      const rate = Math.min(3, Math.abs(turned) / play);
      const hFov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.camera.aspect);
      this.blurSweep.set(shot ? 0 : ((rate / 60) / hFov) * POST.blurTurn, 0);
    }
    this.camYaw = yaw;
    this.post.motion(this.blurCenter, this.blurAmount, this.blurSweep);
  }

  /**
   * Wheels on the grass shake the camera a little, up and down: the more of them and the faster, the more
   * (full with all four on it from 40 km/h, 2.2 cm), quicker with speed (10 Hz at 50 km/h, 22 at 150, at most 25).
   */
  private grassRumble(): void {
    const t = this.player.body.translation();
    const cos = Math.cos(this.player.yaw);
    const sin = Math.sin(this.player.yaw);
    const half = this.player.params.wheelbase / 2;
    let onGrass = 0;
    for (const side of [-1, 1]) for (const along of [-half, half]) if (surfaceGrip(t.x + cos * side * 0.8 + sin * along) < 1) onGrass++;
    const kmh = Math.abs(this.player.speed) * 3.6;
    this.rig.rumble(0.0216 * (onGrass / 4) * Math.min(1, kmh / 40), Math.min(25, 4 + kmh * 0.12));
  }

  /**
   * A gear taking up (up, under throttle; as the shift ends): the camera dropped back a little and brought on again, along the car
   * - the push of the drive taking up. The lower the gear and the more throttle, the harder.
   */
  private gearShake(from: number): void {
    const throttle = this.lastInput.throttle;
    if (throttle < 0.1) return;
    const fx = Math.sin(this.player.yaw);
    const fz = -Math.cos(this.player.yaw);
    this.rig.shake({ dir: { x: -fx, y: 0, z: -fz }, amplitude: (0.384 * throttle) / (from + 1), frequency: 6, seconds: 0.3, wave: 'sine' });
  }

  /** Drop near-miss bookkeeping for vehicles the traffic has removed. */
  private forgetRemovedNpcs(): void {
    for (const id of this.prevRelS.keys()) if (!this.npcs.has(id)) this.prevRelS.delete(id);
    for (const id of this.touched) if (!this.npcs.has(id)) this.touched.delete(id);
    for (const key of this.contactSoundAt.keys()) if (key.startsWith('npc ') && !this.npcs.has(+key.slice(4))) this.contactSoundAt.delete(key);
  }

  private checkNearMisses(): void {
    const p = this.player;
    const fp = p.footprint();
    for (const side of this.trafficWorld.sides) {
      for (const agent of side.sim.agents.values()) {
        // Work in world terms so oncoming cars count too.
        const w = side.frame.toWorld(agent.s, agent.d);
        const rel = -w.z - p.s;
        const prev = this.prevRelS.get(agent.id);
        this.prevRelS.set(agent.id, rel);
        if (prev === undefined || this.touched.has(agent.id)) continue;
        if (prev > 0 && rel <= 0) {
          const gap = Math.max(w.x - agent.width / 2 - fp.dMax, fp.dMin - (w.x + agent.width / 2));
          if (detectNearMiss(prev, rel, gap, p.speed) && this.flow.phase === 'racing') {
            this.flow.addNearMiss();
            this.player.nitro.nearMiss();
            this.hud.nearMiss();
            this.sound.nearMiss({ x: w.x, y: p.body.translation().y, z: w.z }, this.ear());
          }
        }
      }
    }
  }

  /**
   * The engines heard from outside this frame, into `this.engineSources` (its entries reused: none made a frame):
   * the rivals' (their own rpm and throttle; keys -1, -2, ...) and the traffic's (keys their ids). How many.
   */
  private heardEngines(): number {
    let n = 0;
    const next = (): EngineSource => (this.engineSources[n++] ??= {
      key: 0, kind: 'sedan', pos: [0, 0, 0], vel: [0, 0, 0], rpm: 0, idle: 0, redline: 1, throttle: 0, gain: 1,
    });
    for (const r of this.rivals.list) {
      const c = r.car, s = next(), p = c.mesh.position, v = c.body.linvel();
      s.key = -1 - r.index;
      s.kind = c.style;
      s.pos[0] = p.x; s.pos[1] = p.y; s.pos[2] = p.z;
      s.vel[0] = v.x; s.vel[1] = v.y; s.vel[2] = v.z;
      s.rpm = c.shownRpm;
      s.idle = c.params.idleRpm;
      s.redline = c.params.redline;
      s.throttle = c.shownThrottle;
      s.gain = 1;
    }
    for (const npc of this.npcs.values()) {
      if (npc.wrecked) continue; // (its engine dead)
      const agent = this.trafficWorld.sideOf(npc.id)?.sim.agents.get(npc.id);
      if (!agent) continue;
      const t = TRAFFIC_ENGINE[npc.kind], part = npc.parts[0], p = part.mesh.position, v = part.body.linvel();
      const e = trafficEngine(agent.v, agent.accel, t.gearing), s = next();
      s.key = npc.id;
      s.kind = t.kind;
      s.pos[0] = p.x; s.pos[1] = p.y; s.pos[2] = p.z;
      s.vel[0] = v.x; s.vel[1] = v.y; s.vel[2] = v.z;
      s.rpm = e.rpm;
      s.idle = 0;
      s.redline = 1;
      s.throttle = e.throttle;
      s.gain = t.gain;
    }
    return n;
  }

  /** The wind past the rivals this frame, into `this.windSources` (its entries reused; keys -1, -2, ...). How many. */
  private heardWinds(): number {
    let n = 0;
    for (const r of this.rivals.list) {
      const s = (this.windSources[n++] ??= { key: 0, pos: [0, 0, 0], vel: [0, 0, 0], speed: 0, gain: 1, pitch: 1 });
      const p = r.car.mesh.position, v = r.car.body.linvel();
      s.key = -1 - r.index;
      s.pos[0] = p.x; s.pos[1] = p.y; s.pos[2] = p.z;
      s.vel[0] = v.x; s.vel[1] = v.y; s.vel[2] = v.z;
      s.speed = Math.hypot(v.x, v.y, v.z);
    }
    return n;
  }

  /**
   * The tyres heard rolling from outside this frame, into `this.rollSources` (its entries reused): each traffic
   * vehicle's (keys twice its id; a container's trailer the next, from its rear axles). Not the rivals' (their engines
   * are heard), nor wrecks' (theirs is the crash). How many.
   */
  private heardRolls(): number {
    let n = 0;
    const next = (): RollSource => (this.rollSources[n++] ??= { key: 0, pos: [0, 0, 0], vel: [0, 0, 0], speed: 0, gain: 1, pitch: 1 });
    const put = (s: RollSource, key: number, x: number, y: number, z: number, v: { x: number; y: number; z: number }, gain: number, pitch: number): void => {
      s.key = key;
      s.pos[0] = x; s.pos[1] = y; s.pos[2] = z;
      s.vel[0] = v.x; s.vel[1] = v.y; s.vel[2] = v.z;
      s.speed = Math.hypot(v.x, v.z);
      s.gain = gain;
      s.pitch = pitch;
    };
    for (const npc of this.npcs.values()) {
      if (npc.wrecked) continue;
      const t = TRAFFIC_ROLL[npc.kind], cab = npc.parts[0], p = cab.mesh.position;
      put(next(), 2 * npc.id, p.x, p.y, p.z, cab.body.linvel(), t.gain, t.pitch);
      const trailer = npc.parts[1];
      if (!trailer) continue;
      const axles = trailer.spec.axles, rear = axles.reduce((a, b) => a + b, 0) / axles.length;
      ROLL_AT.set(0, 0, rear).applyQuaternion(trailer.mesh.quaternion).add(trailer.mesh.position);
      put(next(), 2 * npc.id + 1, ROLL_AT.x, ROLL_AT.y, ROLL_AT.z, trailer.body.linvel(), TRAILER_ROLL.gain, TRAILER_ROLL.pitch);
    }
    return n;
  }

  /** The rivals' tyres this frame, into `this.skidSources` (where each is drawn, its strongest slide). */
  private heardSkids(): SkidSource[] {
    const list = this.rivals.list, out = this.skidSources;
    for (let i = 0; i < list.length; i++) {
      const s = (out[i] ??= { pos: { x: 0, y: 0, z: 0 }, slip: 0 }), p = list[i].car.mesh.position;
      s.pos.x = p.x; s.pos.y = p.y; s.pos.z = p.z;
      s.slip = list[i].car.maxSlip;
    }
    out.length = list.length;
    return out;
  }

  /** Where the sound is heard from, facing which way: the camera (looking back too: the others swing round it). */
  private ear(): EarPose {
    const c = this.camera, e = this.earPose;
    c.getWorldDirection(EAR_FWD);
    EAR_UP.set(0, 1, 0).applyQuaternion(c.quaternion);
    e.px = c.position.x; e.py = c.position.y; e.pz = c.position.z;
    e.fx = EAR_FWD.x; e.fy = EAR_FWD.y; e.fz = EAR_FWD.z;
    e.ux = EAR_UP.x; e.uy = EAR_UP.y; e.uz = EAR_UP.z;
    return e;
  }

  /** `play`: the race's time this frame (0 paused: frame()), what everything here moves by. */
  private render(play: number, alpha: number): void {
    // The intro's show for this frame (the cars drawn arriving, the engine blipped); the countdown in its last
    // shot, the chase camera after it.
    if (this.introOn) {
      const over = this.intro!.step(play);
      if (this.flow.phase === 'intro' && this.intro!.countdownDue) this.startCountdown();
      if (over) this.finishIntro();
    }
    this.flares.begin();
    this.npcBeams.begin();
    this.player.render(alpha, this.flares);
    const pp = this.player.mesh.position;
    for (const npc of this.npcs.values()) {
      npc.render(alpha, this.flares);
      for (const part of npc.parts) this.npcBeams.add(part.mesh, pp.x, pp.z);
    }
    this.rivals.render(alpha, this.flares);
    for (const car of this.lightRivals(play)) this.npcBeams.add(car.mesh, pp.x, pp.z); // (the rivals without a real lamp: their beams painted)
    this.flares.end();
    this.npcBeams.end();
    const planned = this.aiDriver as { plan?: Plan | null; planAge?: number } | null;
    if (this.showPlan && this.aiActive && this.flow.phase === 'racing' && planned?.plan) this.planPath.show(planned.plan, planned.planAge ?? 0);
    else this.planPath.hide();
    const p = this.player.mesh.position;
    this.road.update(-p.z, p.x);
    // After the road has placed this frame's street lights.
    // The finish's fountains (their sparks as the crashes'). Streaked as the camera moves: standing by the road
    // in the finish's first shot, not with the car.
    this.gate.spray(play, this.camera.position.z, this.emitSpark);
    const standing = this.flow.phase === 'finished' && this.finishShow?.standing;
    this.sparks.update(play, standing ? STILL : this.player.body.linvel());
    // (each flame pops: the player's unplaced, the rivals' from where they are)
    if (this.player.exhaust(play)) this.sound.backfire(null);
    for (const r of this.rivals.list) if (r.car.exhaust(play)) this.sound.backfire(r.car.body.translation(), this.ear());
    this.smoke.update(play, [
      ...this.road.activeLights().map(smokeLightFromSpot),
      ...this.player.smokeLights(),
      ...this.npcBeams.smokeLights(),
    ]);
    const lookBack = this.flow.phase === 'racing' && this.keyboard.isDown('KeyC');
    // An upshift's shake when the new gear takes up (the drive back), not as the old one lets go.
    const gear = this.player.gearbox.gear;
    if (gear > this.lastGear && this.flow.phase === 'racing') this.shiftingFrom = this.lastGear;
    else if (gear < this.lastGear) this.shiftingFrom = null;
    this.lastGear = gear;
    if (this.shiftingFrom !== null && !this.player.gearbox.shifting) {
      this.gearShake(this.shiftingFrom);
      this.shiftingFrom = null;
    }
    this.grassRumble();
    // Paused, the camera holds still too (its shakes stop where they are, and go on after). The intro's shots
    // instead while it is on, the finish's past the line (its panel in once they are over).
    const show = this.flow.phase === 'finished' ? this.finishShow : null;
    if (this.introOn) this.intro!.placeCamera();
    else if (show) show.placeCamera();
    else if (this.hoodCam && !lookBack) this.rig.updateHood(this.player.mesh, this.player.hoodEye, this.player.speed, this.player.params.maxSpeed);
    else this.rig.update(play, p, this.player.yaw, this.player.body.linvel(), this.player.speed, this.player.params.maxSpeed, lookBack);
    if (show?.done && !this.hud.finishShown) {
      this.overlay.show(false);
      this.hud.revealFinish();
    }
    // The finish gate: a flare where each racer goes through it.
    this.gate.pass(-1, this.player.s, p.x);
    for (const r of this.rivals.list) this.gate.pass(r.index, r.car.s, r.car.mesh.position.x);
    this.gate.update(play, this.camera.position.z);
    this.speedBlur(play);
    // The traffic's bodies, those in this frame's view (the camera placed).
    this.bodies.begin(this.camera, this.shadowLights()); // (the lights casting shadows)
    for (const npc of this.npcs.values()) npc.addBodies(this.bodies);
    this.player.addWheels(this.bodies);
    for (const r of this.rivals.list) r.car.addWheels(this.bodies);
    this.bodies.end();
    // (Mid-upshift the engine is let go of: it sounds off the throttle. The intro's blip, as it is put on.)
    const rev = this.player.showRev;
    const car = this.player.params;
    this.sound.setEngine(this.player.style, this.player.shownRpm, car.idleRpm, car.redline,
      rev ? rev.throttle : this.player.gearbox.shifting ? 0 : this.lastInput.throttle, this.flow.phase !== 'title');
    this.sound.setOtherEngines(this.engineSources, this.heardEngines(), this.ear(), play, this.flow.phase !== 'title');
    this.sound.setSkid(this.flow.phase === 'title' ? 0 : this.player.maxSlip);
    this.sound.setOtherSkids(this.heardSkids(), this.ear(), this.flow.phase !== 'title');
    this.sound.setNitro(this.flow.phase !== 'title' && this.player.nitro.active);
    const pv = this.player.body.linvel();
    this.sound.setWind(this.flow.phase === 'title' ? 0 : Math.hypot(pv.x, pv.y, pv.z));
    this.sound.setOtherRolls(this.rollSources, this.heardRolls(), this.ear(), play, this.flow.phase !== 'title');
    this.sound.setOtherWinds(this.windSources, this.heardWinds(), this.ear(), play, this.flow.phase !== 'title');
    const speedKmh = Math.hypot(this.player.body.linvel().x, this.player.body.linvel().z) * 3.6;
    this.flow.noteSpeed(speedKmh);
    const q = this.player.body.rotation();
    // The finish ahead, where it is on the screen (behind the camera: none).
    this.camera.updateMatrixWorld();
    const mark = GOAL.copy(this.gate.mark).project(this.camera);
    this.hud.update(play, {
      goal: mark.z < 1 && this.player.s < ROAD_LENGTH ? { x: (mark.x + 1) / 2, y: (1 - mark.y) / 2, m: ROAD_LENGTH - this.player.s } : null,
      speedKmh,
      reverse: this.player.driveMode === 'R',
      playerS: this.player.s,
      resetCooldown: this.flow.resetCooldown,
      upY: 1 - 2 * (q.x * q.x + q.z * q.z), // (the car's up axis, its world y)
      muted: this.sound.muted,
      gear: this.player.gearbox.gear,
      rpm: this.player.gaugeRpm,
      nitro: this.player.nitro.level,
      nitroOn: this.player.nitro.active,
      aiDriving: this.aiActive && this.flow.phase === 'racing',
      place: this.rivals.rank(this.player.s, this.flow.finishTime),
      shake: this.rig.shaken,
      racers: [
        { s: this.player.s, d: this.player.d, color: '#fff', me: true },
        ...this.rivals.list.map((r) => ({ s: r.car.s, d: r.car.d, color: RIVAL_CSS[r.index % RIVAL_CSS.length], me: false })),
      ],
    });
    const h = this.renderer.domElement.height;
    updateFlareScale(this.flares.material, this.camera, h);
    updateFlareScale(this.road.lampFlareMaterial, this.camera, h);
    this.post.render();
  }
}
