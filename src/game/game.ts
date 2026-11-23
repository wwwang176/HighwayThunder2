import * as THREE from 'three';
import Stats from 'stats.js';
import { LightFlares, updateFlareScale } from '../render/lightFlares';
import { NpcBeams } from '../render/npcBeams';
import { PlanPath } from '../render/planPath';
import { POST, PostFx } from '../render/postFx';
import { blurAmount, blurMask as emptyBlurMask, MASK_POINTS, motionCenter, type BlurMask } from '../render/speedBlur';
import { BlurMaskView } from '../debug/blurMaskView';
import { flameTextures } from '../render/exhaustFlames';
import { HEADLIGHTS } from '../vehicles/headlight';
import { BodyInstances } from '../render/bodyInstances';
import type { Plan } from '../ai/planner';
import type GUI from 'lil-gui';
import { CURVED_BEST_TIME_KEY, MAX_FRAME_DT, MAX_SUBSTEPS, MOUNTAIN_BEST_TIME_KEY, SKIDPAD_BEST_TIME_KEY, PHYSICS_DT, RESET_SPEED, ROAD_LENGTH, type VehicleKind } from '../config';
import { Centerline, randomRoad, STRAIGHT_ROAD } from '../road/centerline';
import { boxToFrame, OUR_FRAME, RoadFrame, useRoad } from '../road/frame';
import { Sound, IMPACT_PEAK, type SkidSource } from '../audio/sound';
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
import { CameraRig, type Look } from '../render/cameraRig';
import { TrafficSim } from '../traffic/trafficAI';
import { DEFAULT_SPACING, Occupant } from '../traffic/spawner';
import { TrafficFocus, TrafficWorld } from '../sim/trafficWorld';
import { pixelRatioFor, readQuality } from '../render/quality';
import { Driver, selfStateOf } from '../ai/driver';
import type { TrafficBox } from '../ai/sensors';
import { laneCenter, lanesOccupied, surfaceGrip } from '../road/coords';
import { Hud } from '../ui/hud';
import { HandlingInput, HEEL_TOE } from '../vehicles/handling';
import { allTrafficModels, NpcVehicle } from '../vehicles/npcVehicle';
import { BRAKE_DIM, BRAKE_ON, type VehicleLights } from '../vehicles/models';
import { NitroAi } from '../vehicles/nitro';
import { PLAYER_H, PlayerCar } from '../vehicles/playerCar';
import { CARS, CarSpec, STREET_RACER } from '../vehicles/cars';
import { PlannerDriver } from '../ai/plannerDriver';
import { trackerFrom } from '../ai/netTracker';
import { aiTopSpeed } from '../ai/aiTopSpeed';
import { CAR_CARDS, CarSelection, COURSE_RIVALS, defaultSelection, loadSelection, MAX_RIVALS, raceRivals, saveSelection } from './carSelection';
import { applyDifficulty, DIFFICULTIES, mountainBudget } from './difficulty';
import { Garage } from '../ui/garage';
import { SettingsPopup } from '../ui/settings';
import { IntroOverlay } from '../ui/introOverlay';
import { LoadingScreen } from '../ui/loading';
import { loadSettings, setLang, t } from '../ui/i18n';
import { Intro, INTRO_KINDS, MOUNTAIN_INTRO_KINDS, nextIntro, type IntroBag } from './intro';
import { FinishShow } from './finishShow';

/** A car type by id (the supercar for an id no longer known). */
const specOf = (id: string): CarSpec => CARS[id] ?? STREET_RACER;
/** Rivals on the mountain road (the garage's cap too). */
const MOUNTAIN_RIVALS = COURSE_RIVALS.mountain;
/** The mountain road: the player's lane (d), where its grid is (s); below the road this far, a car has fallen off (put back). */
const MOUNTAIN_LANE = MOUNTAIN.halfWidth / 2;
/** The rivals' grid on the mountain road (d, s): beside the player, and a row behind. */
const MOUNTAIN_GRID: [number, number][] = [
  [-MOUNTAIN_LANE, -3],
  [MOUNTAIN_LANE, -11],
  [-MOUNTAIN_LANE, -11],
];
const FALLEN = 5;
import { FinishGate, type SparkEmitter } from '../world/finishGate';
import { RoadScene, type Scenery } from '../world/roadScene';
import { MountainScene } from '../world/mountainScene';
import { SkidpadScene } from '../world/skidpadScene';
import { SKIDPAD, skidpadRoad } from '../road/skidpad';
import { Minimap } from '../ui/minimap';
import { MountainDriver } from '../ai/mountainDriver';
import { MountainPlannerDriver } from '../ai/mountainPlannerDriver';
import { mountainAi, mountainSetup, mountainSetupOf } from '../vehicles/mountainSetup';
import { tunedMountainAi } from '../vehicles/mountainTuneGrip';
import type { RivalDriver } from '../ai/driver';
import { MOUNTAIN, mountainRoad, roadEdges } from '../road/mountain';
import { armFollow, armPlace, armReach, CAMERA_ARM, CAMERA_SHOT } from '../render/cameraArm';
import { surfaceMesh } from '../road/surface';
import { SkidMarks } from '../world/skidMarks';
import { Sparks } from '../world/sparks';
import { smokeKick, smokeLightFromSpot, TireSmoke } from '../world/tireSmoke';
import { GameFlow, picksCars, type Phase } from './gameState';
import { FINISHED_SPEED, GRID_REV, RaceView, RIVAL_COLORS, Rivals } from './rivals';
import { type LitCar, RivalLightPool } from './rivalLights';
import { BeamFlasher, wantsToFlash } from './flashing';
import { closingSpeed, knocksOut } from './contact';
import { WorkerPlanSource } from '../ai/workerPlanSource';
import { detectNearMiss } from './nearMiss';
import { DriftTimer } from './driftTimer';
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
const HOLD: HandlingInput = { throttle: 0, brake: 0, steer: 0, hold: true };
const ROLL_OUT: HandlingInput = { throttle: 0, brake: 0.35, steer: 0 };
/** Every lamp state a traffic vehicle shows (brake lights dim and on, indicators off and on): for prewarm. */
const PREWARM_LAMPS: VehicleLights[] = [
  { left: [], right: [], brake: [new THREE.Mesh(undefined, BRAKE_DIM)], third: [] },
  { left: [new THREE.Object3D()], right: [new THREE.Object3D()], brake: [new THREE.Mesh(undefined, BRAKE_ON)], third: [] },
];
const PLAYER_OBSTACLE_ID = -1;
const BLUR_V = new THREE.Vector3();
/**
 * The speed blur's point looking back (the middle) and to a side (on the horizon, a screen's width past the side the
 * car goes to - E looks right: the car goes to the left - its streaks near level), and its share there: at the view's
 * far side 0.6 of looking ahead at a corner, the car in the middle less (at 0.35: ~90 px streaks at 12 taps, sharp
 * wheels and cars in copies).
 */
const LOOK_BLUR = {
  back: new THREE.Vector2(0.5, 0.5),
  right: new THREE.Vector2(-1, 0.5),
  left: new THREE.Vector2(2, 0.5),
  sideShare: 0.2,
};
/**
 * Where the speed blur is held off (render/speedBlur BlurMask), where the eye is. Looking ahead, a tube of balls
 * from the car's nose (the first reaching `nose` m back into it: a little of the nose sharp too) along the road
 * ahead (`ahead` m on the mountain road, `aheadHighway` on the highway; at the car's place across it and the nose's
 * height; the car's width across - `nearShare` of it at the nose, `grow` times more at the far end: far off still
 * wide enough to see) - cut where
 * the road goes behind the camera or turns back down the screen (over a crest, round a hairpin: `drop` of the
 * screen's height); its balls `near` m from the camera or more (the hood camera's: from a few metres down the
 * road). Looking back (or no tube) an
 * ellipse `focus` across (of the screen's width; half as tall as wide on the screen) round the point it goes to or
 * comes from; looking to a side round the car's own body (its box on the screen, `car` times its half-sizes: the
 * corners, the wheels' bottoms, blurred a little).
 */
const BLUR_MASK = { focus: 0.09, car: 1.1, nose: 0.3, ahead: 80, aheadHighway: 200, grow: 5, nearShare: 0.8, drop: 0.01, near: 4 };
const MASK_CORNER = new THREE.Vector3();
const MASK_VIEW = new THREE.Vector3();
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
/** The player's engine heard placed (drawn through a bend in an intro): its key among the others' (rivals -1, -2, ...). */
const PLAYER_DRAWN_KEY = -1000;
/** The traffic's engines: each kind's sound, its gearing (for its rpm by its speed), how loud against a rival's. */
const TRAFFIC_ENGINE: Record<VehicleKind, { kind: EngineKind; gearing: TrafficGearing; gain: number }> = {
  car: { kind: 'sedan', gearing: { gears: 5, top: 55 }, gain: 0.6 },
  truck: { kind: 'truck', gearing: { gears: 6, top: 35 }, gain: 1.1 },
  container: { kind: 'container', gearing: { gears: 8, top: 32 }, gain: 1.25 },
};
const STILL = { x: 0, y: 0, z: 0 };
/** The finish gate's mark, on the screen (render: the HUD's goal). */
const GOAL = new THREE.Vector3();
/** On a curved road the goal is marked over the road this far ahead (m) till the finish is nearer. */
const GOAL_AHEAD = 500;
/** How fast the race's time runs, by phase (frame()): stopped in a pause (past the finish line: its show's, finishTimeScale). */
const TIME_SCALE: Partial<Record<Phase, number>> = { paused: 0 };
/** A race's start: the garage faded to black, then the race faded in on its intro (ms). */
const START_FADE_OUT = 350;
const START_FADE_IN = 700;
/** The race's world run this long (s) behind the black before its intro: the cars settled on their springs. */
const SETTLE_SECONDS = 0.6;
/** The same thing touched again within this (s of race time) isn't heard again (game.contactSound). */
const CONTACT_SOUND_GAP = 0.3;
/** How often (ms) the shaders being made are looked at (prewarmAsync: the loading bar's steps). */
const COMPILE_POLL = 30;
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
  /** The course's scenery (built with it: useCourse), and what holds it, the gate too (taken away with it). */
  road!: Scenery;
  private courseRoot: THREE.Scene | null = null;
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
  readonly flow: GameFlow;
  /** The player's drift (its seconds on the HUD). */
  private readonly driftTimer = new DriftTimer();
  /** The practice ground's slide readout (degrees, by the speedometer) and what it shows now (to write it only when it changes). */
  private slideReadout: HTMLElement | null = null;
  private slideShown = -1;
  /** The mountain road (road/mountain: two lanes, hairpins, climbs; no traffic) instead of the highway. */
  mountain = false;
  /** The drift practice ground (?skidpad; road/skidpad): flat, lined, no rivals - on the mountain road's setup. */
  skidpad = false;
  /** The race's length (m). */
  courseLength = ROAD_LENGTH;
  /** The mountain road's round map (bottom left of the HUD; none on the highway). */
  private minimap: Minimap | null = null;
  private readonly uiRoot: HTMLElement;
  /** The player's car's accent colour (the HUD's: CAR_CARDS). */
  private accent = '#ff3b30';
  /** The road's centre line this race. */
  roadLine: Centerline = STRAIGHT_ROAD;
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
  /** The race's difficulty (DIFFICULTIES' index): the mountain rivals' grip their lines are planned to (mountainBudget). */
  private rivalLevel = DIFFICULTIES.length - 1;
  private humanMaxSpeed = 0;
  /** Draw the AI's planned path on the road (P). */
  showPlan = true;
  private planPath!: PlanPath;
  /** The rival racers (RIVAL_TUNING.count of them). */
  rivals!: Rivals<RivalDriver>;
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
  /** Last frame's look (speedBlur: a cut to another is no turn). */
  private blurLook: Look = 'ahead';
  /** Where the speed blur is held off (BLUR_MASK; held while paused, as the blur). */
  private readonly blurMask: BlurMask = emptyBlurMask();
  /** Debug: the blur's mask marked on the screen (POST.blurMaskShow). */
  private readonly blurMaskView = new BlurMaskView();
  /** The race's intro, whether it is on; a race starting (the fade). */
  private intro: Intro | null = null;
  private introOn = false;
  /** The skid trails the intro's drifting cars drew on last frame (their keys). */
  private introMarks = new Set<number>();
  /** The hood camera instead of the chase camera (V). */
  private hoodCam = false;
  /** The player's high beam, on or off by X (each race starts with it off on the highway, on on the mountain road). */
  private highBeamOn = false;
  /** The mountain road's camera arm: how far out it is now (0..1 of where the camera would be; cameraArm). */
  private armShare = 1;
  /** The finish's show (past the line, till the next race), and the gate it is at. */
  private finishShow: FinishShow | null = null;
  private gate!: FinishGate;
  private readonly emitSpark: SparkEmitter = (x, y, z, vx, vy, vz, life) => this.sparks.emit(x, y, z, vx, vy, vz, life);
  private starting = false;
  /** The loading screen (index.html's, main.ts's at the start): over the black as a race is set up (setUpRace). */
  private readonly loading = new LoadingScreen();
  /** A race being set up (setUpRace, between its steps): the world's frames held, its state half made. */
  private loadingRace = false;
  /** Fading out of the race, to the garage (toTitle). */
  private leaving = false;
  private overlay!: IntroOverlay;
  /** Overrides keyboard input when set (used by automated checks). */
  inputOverride: HandlingInput | null = null;
  /** Debug: stop the real-time loop from advancing the simulation. */
  freeze = false;

  constructor(container: HTMLElement, uiRoot: HTMLElement, readonly physics: PhysicsWorld, opts: { mountain?: boolean; skidpad?: boolean } = {}) {
    this.uiRoot = uiRoot;
    this.flow = new GameFlow(localStorage); // (its course's record and length: useCourse)
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
    this.player = new PlayerCar(physics, this.scene);
    this.player.surfaceGrip = surfaceGrip;
    this.bodies = new BodyInstances(this.scene);
    this.planPath = new PlanPath(this.scene);
    this.rivals = this.makeRivals([]); // (its course's: useCourse)
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
    // The course to start on: the one picked last (main.ts; ?skidpad the practice ground).
    this.useCourse(opts.skidpad ? 'skidpad' : opts.mountain ? 'mountain' : 'highway');
    this.settings = new SettingsPopup(uiRoot);
    this.settings.onQuality = (pr) => this.setQuality(pr);
    this.settings.onVolumes = (v) => this.setVolumes(v);
    this.setVolumes(loadVolumes(localStorage));
    this.garage = new Garage(uiRoot, RIVAL_COLORS, (cars) => {
      saveSelection(localStorage, cars);
      this.startRace(cars, true); // (another course: built as the race is set up, under its loading screen)
    }, this.settings);
    this.overlay = new IntroOverlay(uiRoot); // (over the garage: its fade covers it)
    // The menus' click (Sound.uiClick) on a button or anything clicked that has its own click handler (a car in the
    // list, a paint job, a tuning knob's pip, a pop-up's backdrop) - by mouse, or by the Enter on a focused button.
    uiRoot.addEventListener(
      'click',
      (e) => {
        for (let el = e.target as HTMLElement | null; el && el !== uiRoot; el = el.parentElement)
          if (el instanceof HTMLButtonElement || el.onclick) return this.sound.uiClick();
      },
      true,
    );
    // The song playing: in the race under the place (in the HUD, shaking with it), in the garage under its buttons.
    this.nowPlaying = new NowPlaying([uiRoot.querySelector<HTMLElement>('#hud')!, uiRoot.querySelector<HTMLElement>('#garage .g-corner')!]);
    this.music.onSong = (song) => this.nowPlaying.show(songTitle(song));
    this.gui = createTuningPanel(this.player.params, this.rig.params, this.trafficSettings, this.aiSettings);
    this.bindKeys();
    // Esc or Space skips the intro, and the finish's show (its panel in on the next frame: the same key not also
    // picking from it) - only those, pressed (a key held from before, repeating, not; nor the race's own keys).
    // (After the keyboard's own handlers: Esc in the intro is not the countdown's pause as well.)
    addEventListener('keydown', (e) => !e.repeat && (e.code === 'Escape' || e.code === 'Space') && this.skipShows());
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
    // (Once only, the first of either: the other one later - a first mouse click on the pause's menu after a race
    // played on the keys - woke the race's sound, stopped by the pause.)
    const wake = (): void => {
      removeEventListener('pointerdown', wake);
      removeEventListener('keydown', wake);
      this.sound.init();
      this.music.start();
    };
    addEventListener('pointerdown', wake);
    addEventListener('keydown', wake);
  }

  /**
   * Every shader compiled and picture sent before the first race (prewarmAsync: main.ts, its own step on the loading
   * screen, `progress` 0..1 through it).
   */
  warmUp(progress?: (share: number) => void): Promise<void> {
    return this.prewarmAsync(progress);
  }

  /**
   * prewarm, its shaders made first without holding the page: sent all at once (PostFx.compileScenes), then waited
   * for, the share ready reported as they come (`progress`: the loading screen's bar moving, the page not frozen -
   * made one after another as drawn, 49 of them held it ~5 s). Then prewarm itself: what is left made as it draws
   * (the effects' passes, the shadows' depth), quickly.
   */
  private async prewarmAsync(progress?: (share: number) => void): Promise<void> {
    for (const t of flameTextures()) this.renderer.initTexture(t);
    this.render(0, 1, false); // (everything placed, not drawn: its shaders made below)
    const undo = this.stageAll();
    // (half the bar as they are sent, half as they are ready)
    const materials = await this.post.compileScenes(this.camera, (share) => progress?.(share / 2));
    undo();
    const props = this.renderer.properties;
    const total = materials.size;
    let left = [...materials];
    for (;;) {
      left = left.filter((m) => !((props.get(m) as { currentProgram?: { isReady(): boolean } }).currentProgram?.isReady() ?? true));
      progress?.(0.5 + (total ? 0.5 * (1 - left.length / total) : 0.5));
      if (!left.length) break;
      await new Promise((r) => setTimeout(r, COMPILE_POLL));
    }
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
    const undo = this.stageAll();
    this.post.motion(new THREE.Vector2(0.5, 0.5), 0.01, new THREE.Vector2()); // (the speed blur's shader too: off till 120 km/h)
    this.post.render();
    undo();
    this.render(0, 1);
  }

  /**
   * Everything there to be drawn once (prewarm): every traffic model in both lamp states ahead of the car, the
   * racers' wheels; hidden things shown, and nothing culled (by the camera or the headlights) - what is behind the
   * camera or out of the beams now (the rails' posts, the trees) is drawn, and casts its shadow, later. Undone by
   * what it returns.
   */
  private stageAll(): () => void {
    const ahead = new THREE.Matrix4().makeTranslation(0, 0, -15).premultiply(this.player.mesh.matrix);
    this.bodies.begin(this.camera, this.shadowLights());
    for (const m of allTrafficModels()) for (const lamps of PREWARM_LAMPS) this.bodies.add(m.key, m.template, ahead, lamps);
    this.player.addWheels(this.bodies);
    for (const r of this.rivals.list) r.car.addWheels(this.bodies);
    this.bodies.end();
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
    return () => {
      for (const o of hidden) o.visible = false;
      for (const o of culled) o.frustumCulled = true;
    };
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
    // A menu's key (the garage, its pop-ups, the settings, the pause and finish menus): its click (Sound.uiClick).
    const click = () => this.sound.uiClick();
    const enter = () => {
      if (document.activeElement instanceof HTMLButtonElement) return;
      if (set.isOpen || (g.isOpen && !g.keysOpen) || menu()) click();
      if (set.isOpen) return set.confirm();
      if (g.isOpen) {
        if (g.keysOpen) return;
        if (g.resetAsking) return g.resetPick();
        if (g.tuneOpen) return g.closePop(); // (the tuning done, as Esc: back to the garage, not into a race)
        if (g.onTitle) g.enter();
        else g.start();
      } else if (menu()) this.hud.menuPick();
    };
    k.onPress('Enter', enter);
    k.onPress('NumpadEnter', enter);
    // Esc: cancels the settings; closes what is over the garage; races, pauses and resumes; after the finish, back
    // to the garage.
    k.onPress('Escape', () => {
      if (this.loadingRace) return; // (a race being set up: restarted from the pause, Esc would let it run on under the loading)
      // (the pause opened and closed too, in a race)
      if (set.isOpen || (g.isOpen && g.popOpen) || menu() || (!g.isOpen && (this.flow.phase === 'racing' || this.flow.phase === 'countdown'))) click();
      if (set.isOpen) return set.close();
      if (g.isOpen) return g.popOpen && g.back();
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
      if (set.isOpen || setup() || (g.isOpen && g.tuneOpen) || picking() || menu()) click();
      if (set.isOpen) return dy ? set.move(dy) : set.adjust(dx);
      if (setup()) return dy ? g.setupMove(dy) : g.setupAdjust(dx);
      if (g.isOpen && g.tuneOpen) {
        if (g.resetAsking) return g.resetMove(dy || dx);
        return dy ? g.tuneMove(dy) : g.tuneAdjust(dx);
      }
      if (picking()) return dy ? g.step(dy) : g.stepPaint(dx);
      if (menu()) this.hud.menuMove(dy || dx);
    };
    const corner = () => g.isOpen && !g.onTitle && !g.setupOpen;
    k.onPress('KeyH', () => corner() && !set.isOpen && (click(), g.toggleKeys()));
    k.onPress('KeyO', () => corner() && !g.keysOpen && (click(), g.toggleSettings()));
    // T: the tuning panel (the car's knobs), or closed again; R in it, the car as built.
    k.onPress('KeyT', () => corner() && !set.isOpen && !g.keysOpen && !g.resetAsking && (click(), g.toggleTune()));
    k.onPress('ArrowUp', () => arrow(-1, 0));
    k.onPress('ArrowDown', () => arrow(1, 0));
    k.onPress('ArrowLeft', () => arrow(0, -1));
    k.onPress('ArrowRight', () => arrow(0, 1));
    k.onPress('KeyE', () => picking() && (click(), g.openSetup()));
    for (let n = 0; n <= MAX_RIVALS; n++) {
      k.onPress(`Digit${n}`, () => setup() && (click(), g.setupCount(n)));
      k.onPress(`Numpad${n}`, () => setup() && (click(), g.setupCount(n)));
    }
    // Race keys do nothing in the garage.
    k.onPress('KeyR', () => {
      if (g.isOpen) return g.tuneOpen && !set.isOpen && (click(), g.tuneReset());
      this.tryReset();
    });
    k.onPress('KeyM', () => {
      const v = { ...loadVolumes(localStorage), muted: !this.sound.muted };
      saveVolumes(localStorage, v);
      this.setVolumes(v);
    });
    k.onPress('KeyN', () => this.music.skip());
    k.onPress('KeyV', () => {
      if (g.isOpen) return;
      this.hoodCam = !this.hoodCam;
      this.endIntroShot(); // (in the countdown: the view switched seen at once, not after the intro's last shot)
    });
    k.onPress('KeyX', () => !g.isOpen && (this.highBeamOn = !this.highBeamOn));
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
    this.sound.hush(); // (the squeals, the nitro, the wind: at once, even from a pause - its clock not yet running again)
    this.hud.hide();
    // (its course the one the game is on: the saved one, or ?skidpad's, whatever was saved)
    this.garage.open({ ...loadSelection(localStorage), course: this.mountain ? 'mountain' : 'highway' }, title);
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
    // (in the click or key itself: the browser lets the sound start only there; paused, the race's sound stays
    // stopped - silent through the fade and the loading - and comes back with the new race, setUpRace)
    if (this.flow.phase !== 'paused') this.sound.init();
    if (fromGarage) this.sound.startup(specOf((cars ?? this.cars).player).style);
    this.music.change(); // (a new scene: the song faded out, a moment's quiet, the next one in)
    this.overlay.toBlack(START_FADE_OUT, () => void this.setUpRace(cars));
  }

  /**
   * The race set up behind the black, under the loading screen (in the player's car's accent): the cars, the road,
   * the cars settled, every shader compiled - each step drawn before it holds the page (the world's frames held
   * meanwhile: loadingRace) - then its intro, out of the black.
   */
  private async setUpRace(cars?: CarSelection): Promise<void> {
    this.loadingRace = true;
    const accent =CAR_CARDS.find((c) => c.id === (cars ?? this.cars).player)?.accent ?? '#ff3b30';
    this.loading.show(accent);
    await this.loading.hold();
    await this.loading.next('loading.grid', 0.1);
    this.garage.close();
    // Restarted while paused: the pause's menu shut (and an intro still running ended); its sound back on only as the
    // new race comes in (below).
    if (this.introOn) {
      this.introOn = false;
      this.intro?.end();
    }
    // Every race starts with the player driving (I hands the car to the AI again), on the car's own limiter.
    if (this.aiActive) {
      this.aiActive = false;
      this.player.params.maxSpeed = this.humanMaxSpeed;
    }
    // Another course picked (the practice ground counted the mountain road's): built now, the one before taken away.
    const course = cars && (cars.course === 'mountain') !== this.mountain ? cars.course : null;
    if (course) {
      await this.loading.next('loading.course', 0.2);
      this.useCourse(course === 'mountain' ? 'mountain' : 'highway');
    }
    this.highBeamOn = this.mountain; // (each race's start: off on the highway, on on the dark mountain road)
    if (cars) {
      this.applyCars(cars);
      this.rivalTopShare = applyDifficulty(cars.difficulty);
      this.rivalLevel = cars.difficulty;
    }
    // (the mountain rivals' grip by the difficulty too: their lines laid anew as they are placed - Rivals.budget)
    // The player's car as tuned (src/vehicles/tuning; as built where it isn't).
    const spec = specOf(this.cars.player);
    if (course && !this.mountain) {
      // (off the mountain road: its setup off the car - its body as built, as on a highway the game started on)
      Object.assign(this.player.params, spec.params);
      this.player.applyMass();
    }
    Object.assign(this.player.params, tuned(spec.params, this.cars.tuning?.[spec.id] ?? {}, TUNE_CAL[spec.id]));
    if (this.mountain) {
      // (the mountain road's setup on top: vehicles/mountainSetup - its centre of mass lower, its body given it anew)
      Object.assign(this.player.params, mountainSetup(this.player.params, mountainSetupOf(spec.id)));
      this.player.applyMass();
    }
    this.hud.setAccent(accent);
    this.accent = accent;
    await this.loading.next('loading.road', 0.35);
    this.resetWorld();
    this.flow.start(); // (the intro's phase: the cars held on the grid - after a race the rivals would drive off)
    await this.loading.next('loading.settle', 0.55);
    // The cars settled on their springs, unseen (put on the grid a little high, they bounced ~5 cm in the
    // intro's first shot).
    this.simulate(SETTLE_SECONDS, undefined, false);
    await this.loading.next('loading.shaders', 0.75);
    await this.prewarmAsync((share) => this.loading.set('loading.shaders', 0.75 + 0.2 * share));
    await this.loading.finish('loading.go');
    this.loadingRace = false;
    this.starting = false;
    // The sound back on (after a pause, faded in from silence; after the finish, its fade-away undone) with the new
    // race - not under the loading, where the old race's engine, frozen as it was paused, sounded on.
    // (the old race's engines, squeals, nitro and wind silenced: the new one's own from its first frame)
    this.sound.silenceEngine();
    this.sound.hush();
    this.sound.suspend(false);
    this.sound.bringBack();
    this.beginIntro();
    this.overlay.fromBlack(START_FADE_IN);
  }

  /** The race's intro: the next of its shuffled round (none twice in a row, every one once in each round). */
  private beginIntro(): void {
    // From the shuffled round kept between visits (game/intro nextIntro: every one once in each round).
    // (the mountain road its own intros - up into its bends - and its own round of them)
    const mountain = this.mountain && !this.skidpad;
    const key = mountain ? `${INTRO_BAG_KEY}.mountain` : INTRO_BAG_KEY;
    let bag: IntroBag = { left: [], last: null };
    try {
      bag = { ...bag, ...JSON.parse(localStorage.getItem(key) ?? '{}') };
    } catch {
      // (unreadable: a fresh round)
    }
    const next = nextIntro(bag, Math.random, mountain ? MOUNTAIN_INTRO_KINDS : INTRO_KINDS);
    localStorage.setItem(key, JSON.stringify(next.bag));
    this.intro = new Intro(next.kind, { camera: this.camera, player: this.player, rivals: this.rivals.list.map((r) => r.car), chase: this.rig.params, road: mountain ? this.roadLine : undefined });
    this.introOn = true;
    this.overlay.show(true);
  }

  /** The countdown on (the intro's last shot still coming round into place): its bars away, the HUD in. */
  private startCountdown(): void {
    this.flow.beginCountdown();
    this.sound.countdownBeat(false, IMPACT_PEAK); // (3, from its loudest: the next beats and the green ahead of them, fixedStep)
    this.overlay.show(false);
  }

  /** The intro over (or skipped): the chase camera from where it ended. */
  private finishIntro(): void {
    if (!this.introOn) return;
    this.introOn = false;
    this.intro?.end();
    for (const k of this.introMarks) this.skids.add(k, 0, 0, 0, 0, 0); // (its drifting cars' trails ended)
    this.introMarks.clear();
    this.rig.snap();
    this.camYaw = null; // (the camera's jump no turn for the speed blur)
  }

  /**
   * Esc or Space in the intro: straight to the countdown, the chase camera. Only once it is playing: the race's
   * phase is the intro's already as the race is set up under the loading screen, and a key there would start the
   * countdown under the intro still to come.
   */
  private skipIntro(): void {
    if (this.flow.phase !== 'intro' || !this.introOn) return;
    this.startCountdown();
    this.finishIntro();
  }

  /** The countdown on and the intro's last shot still coming round into place: the chase (or hood) camera now. */
  private endIntroShot(): void {
    if (this.flow.phase === 'countdown') this.finishIntro();
  }

  /** Esc or Space: the intro skipped, or the finish's show (to its end: the panel). */
  private skipShows(): void {
    this.skipIntro();
    if (this.flow.phase === 'finished' && this.finishShow && !this.finishShow.done) this.finishShow.skip();
  }

  /** Past the line: the finish's show from here (the HUD off, the bars in; its panel after it: render). */
  private beginFinishShow(): void {
    // (the mountain road: its camera by its own narrow road's edges)
    this.finishShow = this.mountain ? new FinishShow(this.camera, this.player, [MOUNTAIN.edge - 0.8, -MOUNTAIN.edge + 0.8]) : new FinishShow(this.camera, this.player);
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
      this.player.road = this.roadLine;
      const shown = !this.gui._hidden;
      this.gui.destroy();
      this.gui = createTuningPanel(this.player.params, this.rig.params, this.trafficSettings, this.aiSettings);
      if (shown) this.gui.show();
    }
    const spec = specOf(cars.player);
    if (this.aiDriver instanceof PlannerDriver) {
      this.aiDriver.accel = spec.ai.accel;
      this.aiDriver.latAccel = spec.ai.latAccel;
      this.aiDriver.brake = spec.ai.brake;
      this.aiDriver.tracker = trackerFrom(spec.ai.tracker);
      this.aiDriver.recovery = trackerFrom(spec.ai.recovery);
    }
    const drawn = raceRivals(cars, Math.random); // (at random: drawn afresh each race, the same race again too)
    const rivals = this.mountain ? drawn.slice(0, this.skidpad ? 0 : MOUNTAIN_RIVALS) : drawn;
    if (rivals.length !== this.rivalCars.length || rivals.some((id, i) => id !== this.rivalCars[i])) {
      this.rivals.dispose();
      this.rivals = this.makeRivals(rivals.map(specOf));
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
      // (the race's sound silent in the garage - after the finish, its fade-away left as it is - back with the next
      // race: setUpRace)
      this.sound.quiet();
      this.sound.suspend(false);
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
    // A new road each race (and on the title's road too).
    this.roadLine = this.skidpad ? skidpadRoad() : this.mountain ? mountainRoad(Math.random) : randomRoad(Math.random, ROAD_LENGTH);
    useRoad(this.roadLine); // (both carriageways' frames: the traffic's places, the obstacles every AI sees)
    if (this.skidpad) {
      // (the practice ground: flat tarmac as wide as it is, walls along its sides)
      const ground = surfaceMesh(this.roadLine, -100, SKIDPAD.length + 100, () => [-SKIDPAD.half - 40, SKIDPAD.half + 40]);
      this.physics.setRoad(this.roadLine, { rails: { left: () => -SKIDPAD.half, right: () => SKIDPAD.half }, ground });
    } else if (this.mountain) {
      // (its edges along it: a shoulder on a tight bend's outside)
      const e = roadEdges(this.roadLine);
      const ground = surfaceMesh(this.roadLine, -MOUNTAIN.before, this.courseLength + MOUNTAIN.after, (s) => [-e.at(s, -1) - 1.5, e.at(s, 1) + 1.5]); // (past the walls: no edge to fall off)
      this.physics.setRoad(this.roadLine, { rails: { left: (s) => -e.at(s, -1), right: (s) => e.at(s, 1) }, ground });
    } else this.physics.setRoad(this.roadLine);
    this.player.road = this.roadLine;
    this.rivals.setRoad(this.roadLine);
    this.road.setRoad(this.roadLine);
    this.gate.setRoad(this.roadLine);
    this.minimap?.setRoad(this.roadLine, this.courseLength);
    // (the player's AI - the I key, past the finish - on the mountain road: its line worked out for this road)
    if (this.aiDriver instanceof MountainDriver || this.aiDriver instanceof MountainPlannerDriver) {
      const id = this.cars.player;
      this.aiDriver.setRoad(this.roadLine, tunedMountainAi(mountainAi(specOf(id).ai, mountainSetupOf(id)), id, this.cars.tuning?.[id]));
    }
    if (this.skidpad) this.player.resetAt(SKIDPAD.start, 0, 0);
    else if (this.mountain) this.player.resetAt(-3, MOUNTAIN_LANE, 0);
    else this.player.resetTo(-3, 1, 0);
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
    this.trafficWorld.reset(this.focus(), (f) => this.playerOccupants(f), !this.mountain); // (the mountain road: no traffic)
  }

  tryReset(): void {
    if (!this.flow.canReset()) return;
    if (this.mountain) {
      this.putBackOnMountain();
      this.flow.markReset();
      return;
    }
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

  /**
   * Build this course, the one before it taken away: its scenery (lights, sky and fog with it), its finish gate, its
   * record and length, its rivals (the highway's or the mountain road's kind), the player's AI, the mountain road's
   * map and sparks off its slopes, the practice ground's slide readout. Its road itself is laid with each race
   * (resetWorld). False: on it already.
   */
  private useCourse(course: 'highway' | 'mountain' | 'skidpad'): boolean {
    const was = this.skidpad ? 'skidpad' : this.mountain ? 'mountain' : this.courseRoot ? 'highway' : null;
    if (course === was) return false;
    if (this.courseRoot) {
      // (everything it drew, from the GPU too: three.js sends a shared one again, should another course draw it)
      this.scene.remove(this.courseRoot);
      this.courseRoot.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) {
          for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
          mat.dispose();
        }
      });
    }
    this.minimap?.dispose();
    this.minimap = null;
    this.slideReadout?.remove();
    this.slideReadout = null;
    this.slideShown = -1;
    this.skidpad = course === 'skidpad';
    this.mountain = course !== 'highway';
    this.courseLength = this.skidpad ? Infinity : this.mountain ? MOUNTAIN.length : ROAD_LENGTH;
    this.flow.setCourse(this.skidpad ? SKIDPAD_BEST_TIME_KEY : this.mountain ? MOUNTAIN_BEST_TIME_KEY : CURVED_BEST_TIME_KEY, this.courseLength);
    // Its own root in the scene (taken away whole); its sky and fog the scene's.
    const root = new THREE.Scene();
    this.courseRoot = root;
    this.scene.add(root);
    this.road = this.skidpad ? new SkidpadScene(root, this.renderer) : this.mountain ? new MountainScene(root, this.renderer) : new RoadScene(root, this.renderer);
    this.scene.background = root.background;
    this.scene.fog = root.fog;
    root.background = null;
    root.fog = null;
    for (const m of this.road.groundMaterials) this.npcBeams.patch(m);
    this.gate = this.mountain ? new FinishGate(root, { left: -MOUNTAIN.edge - 0.6, right: MOUNTAIN.edge + 0.6, length: this.skidpad ? SKIDPAD.length : this.courseLength }) : new FinishGate(root);
    // (the practice ground: no finish, no time - its course endless, the gate and the HUD's time and track not shown)
    document.body.classList.toggle('skidpad', this.skidpad);
    if (this.skidpad) {
      this.gate.hide();
      this.slideReadout = document.createElement('div');
      this.slideReadout.className = 'slide-readout';
      this.uiRoot.appendChild(this.slideReadout);
    }
    if (this.mountain && !this.skidpad) this.minimap = new Minimap(this.uiRoot.querySelector<HTMLElement>('#hud')!); // (in the HUD Hud built)
    // (the mountain road climbs and falls: its sparks bounce off it where they were struck - found with no hint, any
    // racer's, on whichever leg of the road)
    this.sparks.floorAt = this.mountain
      ? (x, z) => {
          const at = this.roadLine.project(x, z);
          const e = roadEdges(this.roadLine);
          return this.roadLine.surfaceHeight(at.s, Math.max(-e.at(at.s, -1), Math.min(e.at(at.s, 1), at.d))); // (its bank to its edge: a shoulder's too)
        }
      : () => 0;
    // Its kind of rivals (each race their perf knobs at random): their cars put on with the race's (applyCars).
    this.rivals.dispose();
    this.rivals = this.makeRivals([]);
    this.rivalCars = [];
    // I hands the car to the AI: the highway's path planner (its plans worked out in a worker), or the mountain
    // road's racing-line driver (its line worked out with each race's road). (Not driving now: setUpRace.)
    (this.aiDriver as Partial<RivalDriver> | null)?.dispose?.(); // (the planner's worker ended)
    this.aiDriver = this.mountain ? new MountainPlannerDriver() : new PlannerDriver(new WorkerPlanSource());
    return true;
  }

  /**
   * The rivals on these cars, their perf knobs at random each race: the highway's (the planner AI, plans in a worker),
   * or the mountain road's (its racing-line drivers, its two lanes, no grip push, its grid behind and beside the player).
   */
  private makeRivals(specs: CarSpec[]): Rivals<RivalDriver> {
    const rivals = this.mountain
      ? new Rivals<RivalDriver>(this.physics, this.scene, () => null, specs, {
          makeDriver: () => new MountainPlannerDriver(),
          grid: MOUNTAIN_GRID,
          gripBoost: 0,
          edge: (s, side) => roadEdges(this.roadLine).at(s, side), // (a shoulder's too)
          lanes: [MOUNTAIN_LANE, -MOUNTAIN_LANE],
          setup: { params: (p, spec) => mountainSetup(p, mountainSetupOf(spec.id)), ai: (ai, spec, tuning) => tunedMountainAi(mountainAi(ai, mountainSetupOf(spec.id)), spec.id, tuning) },
        })
      : new Rivals<RivalDriver>(this.physics, this.scene, () => new WorkerPlanSource(), specs);
    rivals.tuneAtRandom = true;
    if (this.mountain) rivals.budget = (spec) => mountainBudget(this.rivalLevel, spec.id);
    rivals.length = this.courseLength;
    if (this.mountain) rivals.setRoad(this.roadLine);
    return rivals;
  }

  /**
   * The mountain road's put-back (R, or fallen off): in its lane where it is (further back while a rival is within a
   * few car lengths), pointing along the road, at a speed it can take the bends ahead at.
   */
  private putBackOnMountain(): void {
    // (the practice ground: back to its start, standing)
    if (this.skidpad) {
      this.player.resetAt(SKIDPAD.start, 0, 0);
      this.aiDriver?.reset(this.player.d);
      this.skids.cut();
      this.rig.snap();
      return;
    }
    const road = this.roadLine;
    const rivals = this.rivals.boxes(this.rivalBoxes);
    let s = Math.max(0, Math.min(this.player.s, this.courseLength));
    for (let back = 0; back < 20 && rivals.some((b) => Math.abs(b.s - s) < 12 && b.dMax > MOUNTAIN_LANE - 2 && b.dMin < MOUNTAIN_LANE + 2); back++) s = Math.max(0, s - 6);
    let k = 0;
    for (let a = 0; a <= 40; a += 4) k = Math.max(k, Math.abs(road.curvature(s + a)));
    const speed = Math.min(RESET_SPEED, k > 0 ? Math.sqrt((0.5 * 9.81) / k) : RESET_SPEED);
    this.player.resetAt(s, MOUNTAIN_LANE, speed);
    this.aiDriver?.reset(this.player.d);
    this.skids.cut();
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
    if (this.garage.isOpen || this.loadingRace) return;
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
    const input = this.aiDrive(ai, limit, coast);
    return { ...input, nitro: this.playerNitroAi.want(PHYSICS_DT, input.throttle, this.player.nitro) }; // its nitro by the rivals' rule
  }

  /** The AI's pedals and steering (no nitro); also its planning on the grid before the green (unused there). */
  private aiDrive(ai: Driver, limit: number, coast = false): HandlingInput {
    const cap = Math.min(limit, aiTopSpeed(this.aiSettings.speedCapKmh / 3.6, specOf(this.cars.player)));
    this.player.params.maxSpeed = cap;
    const seen = this.trafficWorld.ourBoxes(this.aiTraffic);
    for (const b of this.rivals.boxes(this.rivalBoxes)) seen.push(b);
    const aim = coast ? Math.max(cap, this.player.speed) : cap;
    return ai.drive(selfStateOf(this.player, aim), seen, this.player.params);
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
        // burnout (revving on the line, smoke), let go of at the green. Off the throttle it is held (a brake
        // alone at a standstill selects reverse). The nitro stays full for the start, the handbrake off.
        // The AI (if it has the car) plans from GRID_REV.planAhead s before the green, so it has a plan at the green.
        if (this.aiActive && this.aiDriver && !this.inputOverride && this.flow.countdown <= GRID_REV.planAhead) this.aiDrive(this.aiDriver, Infinity);
        const keys = this.inputOverride ?? this.keyboard.driving();
        return keys.throttle > 0 ? { ...keys, brake: 1, handbrake: false, nitro: false } : { ...keys, brake: 0, hold: true, handbrake: false, nitro: false };
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
    else this.rivals.hold(dt, this.flow.phase === 'countdown', this.flow.countdown, view);

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
    // Under the mountain road (got through its surface: a mesh has no inside): put back on it.
    if (this.mountain && this.player.body.translation().y < this.roadLine.height(this.player.s) - FALLEN) this.putBackOnMountain();
    this.trafficWorld.afterPhysics();
    this.rivals.after(dt, view, this.trafficWorld.ourBoxes(this.rivalTraffic), racing);
    const pv = this.player.body.linvel();
    // Another car's tyre smokes only within SMOKE_RANGE of the player (the puffs are few: far off they'd crowd out
    // what is near, unseen).
    const pp = this.player.body.translation();
    const near = (x: number, z: number) => (x - pp.x) ** 2 + (z - pp.z) ** 2 < SMOKE_RANGE ** 2;
    // (an arcade drift: sliding sideways, marked and smoking - PlayerCar.slidingSideways)
    const sideways = this.player.slidingSideways;
    this.player.wheels.forEach((w, i) => {
      const sliding = w.inContact && (w.sliding || sideways);
      const k = sliding && w.slip > 1.5 ? Math.min(1, (w.slip - 1.5) / 8) : 0;
      this.skids.add(i, w.contactX, w.contactZ, w.dirX, w.dirZ, k, w.contactY);
      const kick = smokeKick(w.dirX, w.dirZ, w.omega, w.r, pv.x, pv.z); // (spinning: thrown back)
      this.smoke.emit(i, w.contactX, w.contactZ, sliding ? w.slip : 0, pv.x, pv.z, dt, kick.x, kick.z, w.contactY);
    });
    // The rivals' tyres mark the road and smoke as the player's (their burnouts on the grid too; smoke only near the
    // player). (Their keys 10 on: the player's 0..3, the wrecks' 100 on.)
    for (const r of this.rivals.list) {
      const rv = r.car.body.linvel();
      const rSideways = r.car.slidingSideways;
      r.car.wheels.forEach((w, i) => {
        const sliding = w.inContact && (w.sliding || rSideways);
        this.skids.add(10 + r.index * 4 + i, w.contactX, w.contactZ, w.dirX, w.dirZ, sliding && w.slip > 1.5 ? Math.min(1, (w.slip - 1.5) / 8) : 0, w.contactY);
        const kick = smokeKick(w.dirX, w.dirZ, w.omega, w.r, rv.x, rv.z);
        this.smoke.emit(10 + r.index * 4 + i, w.contactX, w.contactZ, sliding && near(w.contactX, w.contactZ) ? w.slip : 0, rv.x, rv.z, dt, kick.x, kick.z, w.contactY);
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
          const kick = smokeKick(w.dirX, w.dirZ, w.omega, w.r, v.x, v.z);
          this.smoke.emit(key, w.contactX, w.contactZ, sliding && near(w.contactX, w.contactZ) ? w.slip : 0, v.x, v.z, dt, kick.x, kick.z);
        });
      }
    }

    this.trafficWorld.spacing = this.trafficSettings.spacing;
    if (!this.mountain) this.trafficWorld.maintain(dt, this.focus(), (f) => this.playerOccupants(f));
    this.forgetRemovedNpcs();
    this.checkNearMisses();
    this.checkDrift(dt);

    const wasFinished = this.flow.phase === 'finished';
    const counting = this.flow.phase === 'countdown', countdownWas = this.flow.countdown;
    this.flow.update(dt, this.player.lead);
    // The countdown's impact IMPACT_PEAK s ahead of each number (2, 1) and of the green: its loudest as it shows.
    if (counting) {
      const left = this.flow.phase === 'countdown' ? this.flow.countdown : 0;
      for (const n of [2, 1, 0]) if (countdownWas - IMPACT_PEAK > n && left - IMPACT_PEAK <= n) this.sound.countdownBeat(n === 0);
    }
    if (!wasFinished && this.flow.phase === 'finished') {
      this.sound.finishImpact();
      this.beginFinishShow();
      this.sound.fadeAway(); // (slowed down it sounds wrong: away; the music plays on, down to half: Music.update)
    }
  }

  /** The player's car as an obstacle in a carriageway's coordinates. */
  private playerBox(frame: RoadFrame) {
    const t = this.player.body.translation();
    const v = this.player.body.linvel();
    const f = OUR_FRAME.forwardWorld(this.player.yaw, this.player.s);
    return boxToFrame(frame, { x: t.x, z: t.z, fx: f.x, fz: f.z, w: this.player.width, l: this.player.length, vx: v.x, vz: v.z }, frame.sOf(this.player.s));
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
    // The high beam as X left it (in the race: not in the garage); drawn through a bend in an intro, as the rivals'.
    const high = (!this.garage.isOpen && this.highBeamOn) || !!this.player.showPose;
    if (high !== this.player.highBeam) this.player.setHighBeam(high);
    for (const l of this.player.headlights) l.intensity = (HEADLIGHTS.pair / 2) * (high ? HEADLIGHTS.high : 1);
    const racing = this.flow.phase === 'racing';
    const road = [this.player, ...this.rivals.list.map((r) => r.car)].map((c) => ({ s: c.s, d: c.d, v: c.speed }));
    const cars = this.rivals.list.map((r, i) => {
      let f = this.flashers.get(r);
      if (!f) this.flashers.set(r, (f = new BeamFlasher()));
      const me = road[i + 1];
      const flashing = f.update(play, racing && wantsToFlash(me, road.filter((o) => o !== me)));
      // (a car drawn through a bend in an intro: its high beam on - lighting the bend up, the dark night round it)
      return { mesh: r.car.mesh, width: r.car.width, length: r.car.length, high: flashing || !!r.car.showPose };
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
   * picture stays); none at the title, nor in the intro's or the finish's shots. Looking back or to a side (`look`)
   * its point is held where it would be going straight: the middle looking back (the road streaming into it), off
   * the screen's side the car goes to looking to a side (LOOK_BLUR: the road streaming across, a little fanned) -
   * not projected from the motion: square to the view, as the car slid that point jumped from far off to a side
   * (the picture smeared into broken streaks) to behind (none) - looking back, where it comes from (the motion's
   * opposite), held on the screen. The cut to a look and back is no turn. Held off round where the eye is
   * (BLUR_MASK): the point ahead or behind, or the car's own body looking to a side (it moves with the camera).
   */
  private speedBlur(play: number, look: Look): void {
    this.camera.getWorldDirection(BLUR_V);
    const yaw = Math.atan2(BLUR_V.x, BLUR_V.z);
    if (look !== this.blurLook) this.camYaw = null; // (the cut: no turn)
    this.blurLook = look;
    const shot = this.flow.phase === 'title' || this.flow.phase === 'intro' || (this.flow.phase === 'finished' && this.finishShow !== null);
    if (play > 0) {
      const v = this.player.body.linvel();
      let share = 1;
      let center: THREE.Vector2 | null = null;
      if (shot) center = null;
      else if (look === 'ahead') center = motionCenter(this.camera, BLUR_V.set(v.x, v.y, v.z));
      else if (look === 'back') {
        const from = motionCenter(this.camera, BLUR_V.set(-v.x, -v.y, -v.z));
        center = from ? from.clampScalar(0, 1) : LOOK_BLUR.back; // (sliding hard: kept on the screen)
      } else {
        center = look === 'right' ? LOOK_BLUR.right : LOOK_BLUR.left;
        share = LOOK_BLUR.sideShare;
      }
      if (center) this.blurCenter.copy(center);
      const mask = this.blurMask;
      mask.count = 0;
      mask.aspect = this.camera.aspect;
      if (look === 'left' || look === 'right') this.carOnScreen(mask);
      else {
        const r = BLUR_MASK.focus / 2;
        // Ahead: the band from the nose (none found - the nose behind the camera: the ellipse as looking back).
        if (look === 'ahead') this.roadPath(mask, this.mountain ? BLUR_MASK.ahead : BLUR_MASK.aheadHighway);
        if (mask.count >= 2) mask.radius.set(0, 0);
        else {
          mask.center.copy(this.blurCenter);
          mask.radius.set(r, (r * this.camera.aspect) / 2);
        }
      }
      this.blurAmount = center
        ? share * Math.max(POST.blurForce, blurAmount(Math.abs(this.player.speed) * 3.6, this.player.nitro.active, { from: POST.blurFrom, full: POST.blurFull, strength: POST.blurStrength, nitro: POST.blurNitro }))
        : 0;
      // (A jump of the camera - a reset - is no turn: at most 3 rad/s.)
      const turned = this.camYaw === null ? 0 : Math.atan2(Math.sin(yaw - this.camYaw), Math.cos(yaw - this.camYaw));
      const rate = Math.min(3, Math.abs(turned) / play);
      const hFov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.camera.aspect);
      // (none looking back or to a side: that camera turns with the car at once, unsmoothed - its every twitch a smear)
      this.blurSweep.set(shot || look !== 'ahead' ? 0 : ((rate / 60) / hFov) * POST.blurTurn, 0);
    }
    this.camYaw = yaw;
    this.blurMask.debug = POST.blurMaskShow;
    this.post.motion(this.blurCenter, this.blurAmount, this.blurSweep, this.blurMask);
    this.blurMaskView.draw(POST.blurMaskShow && !this.garage.isOpen, this.blurMask, this.blurCenter);
  }

  /**
   * A ball of radius `half` m at a world point, on the screen as the blur's mask takes it: its centre (`out`, 0..1,
   * y up) and radius (in the screen's heights); false behind the camera or nearer it than BLUR_MASK.near (the hood
   * camera over the nose: a ball there filled half the screen).
   */
  private maskBall(x: number, y: number, z: number, half: number, out: THREE.Vector2): number | false {
    const v = MASK_VIEW.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
    if (v.z > -BLUR_MASK.near) return false;
    const depth = -v.z;
    v.applyMatrix4(this.camera.projectionMatrix);
    out.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
    return (half * 0.5) / (depth * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  /**
   * The tube: balls the car's width across, along the road ahead (`ahead` m, the car's place across it, at the
   * nose's height over the road; closer together near the car) - the first ahead of the nose, reaching back
   * BLUR_MASK.nose m into it; from the first one far enough from the camera (the hood camera's: a few metres down
   * the road); as far as the road keeps going up the screen (behind a crest, or round a hairpin back toward the
   * camera: cut there).
   */
  private roadPath(mask: BlurMask, ahead: number): void {
    const p = this.player, road = this.roadLine;
    // (a ball's radius `along` the way: the car's half-width, `nearShare` of it at the nose, `grow` times more far off)
    const radius = (along: number) => (p.width / 2) * (BLUR_MASK.nearShare + (1 - BLUR_MASK.nearShare) * along) * (1 + BLUR_MASK.grow * along);
    const half = radius(0);
    const mesh = p.mesh;
    mesh.updateWorldMatrix(true, false);
    // (the nose at -z; at the body's top: seen from behind and above, the road ahead shows over its roof)
    const n = MASK_CORNER.set(0, PLAYER_H / 2, -p.length / 2 + BLUR_MASK.nose - half).applyMatrix4(mesh.matrixWorld);
    const from = p.lead - BLUR_MASK.nose + half;
    const lift = n.y - road.surfaceHeight(from, p.d);
    let count = 0;
    let top = -Infinity;
    for (let k = 0; k < MASK_POINTS; k++) {
      const along = (k / (MASK_POINTS - 1)) ** 2;
      const s = from + ahead * along;
      const w = k ? road.toWorld(s, p.d) : null;
      const at = mask.path[count];
      const r = w
        ? this.maskBall(w.x, road.surfaceHeight(s, p.d) + lift, w.z, radius(along), at)
        : this.maskBall(n.x, n.y, n.z, half, at);
      if (r === false) {
        if (count) break; // (gone behind the camera)
        continue; // (too near it yet)
      }
      if (count && at.y < top - BLUR_MASK.drop) break;
      top = Math.max(top, at.y);
      mask.width[count] = r;
      count++;
    }
    mask.count = count;
  }

  /** The player's car on the screen (0..1, y up) as an ellipse: round its box's corners' (BLUR_MASK.car of them). */
  private carOnScreen(mask: BlurMask): void {
    const mesh = this.player.mesh, p = this.player.params;
    mesh.updateWorldMatrix(true, false);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      MASK_CORNER.set(((i & 1) - 0.5) * p.width, (((i >> 1) & 1) - 0.5) * PLAYER_H, (((i >> 2) & 1) - 0.5) * p.length);
      MASK_CORNER.applyMatrix4(mesh.matrixWorld).project(this.camera);
      x0 = Math.min(x0, MASK_CORNER.x);
      x1 = Math.max(x1, MASK_CORNER.x);
      y0 = Math.min(y0, MASK_CORNER.y);
      y1 = Math.max(y1, MASK_CORNER.y);
    }
    // (normalised device -1..1 to the screen's 0..1: halved)
    mask.center.set((x0 + x1) / 4 + 0.5, (y0 + y1) / 4 + 0.5);
    mask.radius.set(((x1 - x0) / 4) * BLUR_MASK.car, ((y1 - y0) / 4) * BLUR_MASK.car);
  }

  /**
   * Wheels on the grass shake the camera a little, up and down: the more of them and the faster, the more
   * (full with all four on it from 40 km/h, 2.2 cm), quicker with speed (10 Hz at 50 km/h, 22 at 150, at most 25).
   */
  private grassRumble(): void {
    // (on the road: its d and road-relative yaw)
    const cos = Math.cos(this.player.yaw);
    const sin = Math.sin(this.player.yaw);
    const half = this.player.params.wheelbase / 2;
    let onGrass = 0;
    for (const side of [-1, 1]) for (const along of [-half, half]) if (surfaceGrip(this.player.d + cos * side * 0.8 + sin * along) < 1) onGrass++;
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
    const fx = Math.sin(this.player.worldYaw);
    const fz = -Math.cos(this.player.worldYaw);
    this.rig.shake({ dir: { x: -fx, y: 0, z: -fz }, amplitude: (0.384 * throttle) / (from + 1), frequency: 6, seconds: 0.3, wave: 'sine' });
  }

  /** Drop near-miss bookkeeping for vehicles the traffic has removed. */
  private forgetRemovedNpcs(): void {
    for (const id of this.prevRelS.keys()) if (!this.npcs.has(id)) this.prevRelS.delete(id);
    for (const id of this.touched) if (!this.npcs.has(id)) this.touched.delete(id);
    for (const key of this.contactSoundAt.keys()) if (key.startsWith('npc ') && !this.npcs.has(+key.slice(4))) this.contactSoundAt.delete(key);
  }

  /** The player's drift on the HUD (DriftTimer: its seconds, held a moment when let go) - racing only. */
  private checkDrift(dt: number): void {
    if (this.flow.phase !== 'racing') {
      this.driftTimer.reset();
      this.hud.clearDrift();
      return;
    }
    const p = this.player;
    const slide = Math.abs(Math.atan2(p.vLat, Math.max(Math.abs(p.vLong), 1)));
    this.hud.drift(this.driftTimer.update(dt, slide, p.speed));
    // (the practice ground: its slide in degrees, written only when it changes)
    if (this.slideReadout) {
      const deg = p.speed > 1 ? Math.round((slide * 180) / Math.PI) : 0;
      if (deg !== this.slideShown) {
        this.slideShown = deg;
        this.slideReadout.textContent = t('hud.slide', { deg: String(deg) });
      }
    }
  }

  private checkNearMisses(): void {
    const p = this.player;
    const fp = p.footprint();
    for (const side of this.trafficWorld.sides) {
      for (const agent of side.sim.agents.values()) {
        // In our road's terms (along it, across it), so oncoming cars count too.
        const rel = side.frame.ourS(agent.s) - p.s;
        const across = side.frame.xCenter + side.frame.dir * agent.d;
        const prev = this.prevRelS.get(agent.id);
        this.prevRelS.set(agent.id, rel);
        if (prev === undefined || this.touched.has(agent.id)) continue;
        if (prev > 0 && rel <= 0) {
          const gap = Math.max(across - agent.width / 2 - fp.dMax, fp.dMin - (across + agent.width / 2));
          if (detectNearMiss(prev, rel, gap, p.speed) && this.flow.phase === 'racing') {
            this.flow.addNearMiss();
            this.player.nitro.nearMiss();
            this.hud.nearMiss();
            const w = side.frame.toWorld(agent.s, agent.d);
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
      // (a car drawn through a bend in an intro: heard going as it is drawn going)
      const c = r.car, s = next(), p = c.mesh.position, v = c.showPose?.vel ?? c.body.linvel();
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
    // The player's car drawn through a bend in an intro: heard there, as the rivals' (its own engine silent meanwhile).
    const pc = this.player, pose = pc.showPose;
    if (pose) {
      const s = next(), p = pc.mesh.position, v = pose.vel;
      s.key = PLAYER_DRAWN_KEY;
      s.kind = pc.style;
      s.pos[0] = p.x; s.pos[1] = p.y; s.pos[2] = p.z;
      s.vel[0] = v.x; s.vel[1] = v.y; s.vel[2] = v.z;
      s.rpm = pc.shownRpm;
      s.idle = pc.params.idleRpm;
      s.redline = pc.params.redline;
      s.throttle = pc.shownThrottle;
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

  /**
   * The rivals' tyres this frame, into `this.skidSources` (where each is drawn, its strongest slide); the player's
   * too while it is drawn through a bend in an intro (heard there, its own squeal silent meanwhile).
   */
  private heardSkids(): SkidSource[] {
    const list = this.rivals.list, out = this.skidSources;
    for (let i = 0; i < list.length; i++) {
      const s = (out[i] ??= { pos: { x: 0, y: 0, z: 0 }, slip: 0 }), p = list[i].car.mesh.position;
      s.pos.x = p.x; s.pos.y = p.y; s.pos.z = p.z;
      s.slip = list[i].car.showPose?.slip ?? list[i].car.maxSlip; // (drawn drifting in an intro: squealing as drawn)
    }
    let n = list.length;
    const pose = this.player.showPose;
    if (pose) {
      const s = (out[n++] ??= { pos: { x: 0, y: 0, z: 0 }, slip: 0 }), p = this.player.mesh.position;
      s.pos.x = p.x; s.pos.y = p.y; s.pos.z = p.z;
      s.slip = pose.slip;
    }
    out.length = n;
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
  /** The frame drawn (`draw`: else everything placed for it, nothing drawn - prewarmAsync). */
  private render(play: number, alpha: number, draw = true): void {
    // The intro's show for this frame (the cars drawn arriving, the engine blipped); the countdown in its last
    // shot, the chase camera after it.
    if (this.introOn) {
      const over = this.intro!.step(play);
      // (the cars drawn drifting through a bend: their rear tyres' smoke and marks - keys 60 on, clear of the cars'
      // own; a trail not drawn on this frame ended, as a tyre stopping sliding)
      const marked = this.introMarks;
      const now = new Set<number>();
      this.intro!.puffs().forEach((f) => {
        const kick = smokeKick(f.dirX, f.dirZ, f.omega, f.r, f.vx, f.vz);
        this.smoke.emit(60 + f.key, f.x, f.z, f.slip, f.vx, f.vz, play, kick.x, kick.z, f.y);
        if (play > 0) this.skids.add(60 + f.key, f.x, f.z, f.dirX, f.dirZ, f.slip > 1.5 ? Math.min(1, (f.slip - 1.5) / 8) : 0, f.y);
        now.add(60 + f.key);
      });
      for (const k of marked) if (!now.has(k)) this.skids.add(k, 0, 0, 0, 0, 0);
      this.introMarks = now;
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
    const planned = this.aiDriver as { plan?: Plan | null; planAge?: number; planShown?: boolean } | null;
    const drawPlan = this.showPlan && this.aiActive && this.flow.phase === 'racing';
    if (planned && 'planShown' in planned) planned.planShown = drawPlan; // (the mountain AI: its drift's path worked out only then)
    if (drawPlan && planned?.plan) {
      this.planPath.show(planned.plan, planned.planAge ?? 0, this.mountain ? (s, d) => this.roadLine.surfaceHeight(s, d) : undefined);
    } else this.planPath.hide();
    const p = this.player.mesh.position;
    this.road.update(this.roadLine.project(p.x, p.z, this.player.s).s, play);
    // After the road has placed this frame's street lights.
    // The finish's fountains (their sparks as the crashes'). Streaked as the camera moves: standing by the road
    // in the finish's first shot, not with the car.
    this.gate.spray(play, this.camera.position, this.emitSpark);
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
    // Held while racing or on the grid (the countdown): C looks back, Q to the car's left, E to its right (back first
    // if both).
    const kb = this.keyboard;
    const looking = this.flow.phase === 'racing' || this.flow.phase === 'countdown';
    const look: Look = !looking ? 'ahead' : kb.isDown('KeyC') ? 'back' : kb.isDown('KeyQ') ? 'left' : kb.isDown('KeyE') ? 'right' : 'ahead';
    // A look in the countdown while the intro's last shot is still coming round: that shot cut short, the look now.
    if (look !== 'ahead') this.endIntroShot();
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
    else if (this.hoodCam && look === 'ahead') this.rig.updateHood(this.player.mesh, this.player.hoodEye, this.player.speed, this.player.params.maxSpeed);
    else this.rig.update(play, p, this.player.worldYaw, this.player.body.linvel(), this.player.speed, this.player.params.maxSpeed, look);
    // The camera kept clear of the scenery's ground (Scenery.groundAt: the mountain's rock and hillside, the highway's
    // flat) on an arm from over the car (cameraArm: in along it, looking the same way - no jump in the view); the set
    // shots (intro, finish) only lifted out of it where they are, some low on purpose (CAMERA_SHOT) - a shot far off
    // (over a hairpin, 200 m up the road) pulled in along an arm from the car went down behind the hill between. (The
    // mountain road's chase camera swinging wide round a hairpin went into the rock; kept within the road's edges
    // instead, the side looks were pulled in to the edge on the narrow road where no rock was too.)
    const scene = this.road;
    if (scene.groundAt) {
      const shot = this.introOn || !!show;
      const A = shot ? CAMERA_SHOT : CAMERA_ARM;
      const c = this.player.body.translation();
      const pivot = { x: c.x, y: c.y + A.pivot, z: c.z };
      const want = { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z };
      // (a shot far off: where it is on the road found anywhere, not near the car)
      const ground = (x: number, z: number) => scene.groundAt!(x, z, shot ? undefined : this.player.s);
      this.armShare = shot ? 1 : armFollow(this.armShare, armReach(pivot, want, ground, A), play, A);
      const at = armPlace(pivot, want, this.armShare, ground, A);
      this.camera.position.set(at.x, at.y, at.z);
    }
    if (show?.done && !this.hud.finishShown) {
      this.overlay.show(false);
      this.hud.revealFinish();
    }
    // The finish gate: a flare where each racer goes through it.
    this.gate.pass(-1, this.player.lead, this.player.d); // (as it finishes: the front of its body through the curtain)
    for (const r of this.rivals.list) this.gate.pass(r.index, r.car.lead, r.car.d);
    this.gate.update(play, this.camera.position);
    this.speedBlur(play, look);
    // The traffic's bodies, those in this frame's view (the camera placed).
    this.bodies.begin(this.camera, this.shadowLights()); // (the lights casting shadows)
    for (const npc of this.npcs.values()) npc.addBodies(this.bodies);
    this.player.addWheels(this.bodies);
    for (const r of this.rivals.list) r.car.addWheels(this.bodies);
    this.bodies.end();
    // (Mid-upshift the engine is let go of: it sounds off the throttle. The intro's blip, as it is put on; a
    // downshift's heel-and-toe blip, on the throttle.)
    const rev = this.player.showRev;
    const car = this.player.params;
    // (drawn through a bend in an intro: heard there instead - heardEngines, heardSkids)
    const drawn = !!this.player.showPose;
    const own = this.player.gearbox.shifting ? 0 : this.lastInput.throttle;
    this.sound.setEngine(this.player.style, this.player.shownRpm, car.idleRpm, car.redline,
      rev ? rev.throttle : this.player.blipping ? Math.max(HEEL_TOE.throttle, own) : own, this.flow.phase !== 'title' && !drawn);
    this.sound.setOtherEngines(this.engineSources, this.heardEngines(), this.ear(), play, this.flow.phase !== 'title');
    this.sound.setSkid(this.flow.phase === 'title' || drawn ? 0 : this.player.maxSlip);
    this.sound.setOtherSkids(this.heardSkids(), this.ear(), this.flow.phase !== 'title');
    this.sound.setNitro(this.flow.phase !== 'title' && this.player.nitro.active);
    const pv = this.player.body.linvel();
    this.sound.setWind(this.flow.phase === 'title' ? 0 : Math.hypot(pv.x, pv.y, pv.z));
    this.sound.setOtherRolls(this.rollSources, this.heardRolls(), this.ear(), play, this.flow.phase !== 'title');
    this.sound.setOtherWinds(this.windSources, this.heardWinds(), this.ear(), play, this.flow.phase !== 'title');
    const speedKmh = Math.hypot(this.player.body.linvel().x, this.player.body.linvel().z) * 3.6;
    this.flow.noteSpeed(speedKmh);
    const q = this.player.body.rotation();
    // The finish ahead, where it is on the screen (behind the camera: none). On a bend it may be off to a side, out
    // of sight: marked over the road GOAL_AHEAD m ahead, the finish itself once nearer.
    this.camera.updateMatrixWorld();
    const toGo = this.courseLength - this.player.s;
    const mark = (
      this.roadLine.straight || toGo <= GOAL_AHEAD ? GOAL.copy(this.gate.mark) : this.gate.markAt(this.roadLine, this.player.s + GOAL_AHEAD, GOAL)
    ).project(this.camera);
    // (the mountain road winds too much for a mark far ahead: the finish only once it is near)
    const goalShown = mark.z < 1 && toGo > 0 && (!this.mountain || toGo <= GOAL_AHEAD);
    this.hud.update(play, {
      goal: goalShown ? { x: (mark.x + 1) / 2, y: (1 - mark.y) / 2, m: toGo } : null,
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
      place: this.rivals.rank(this.player.lead, this.flow.finishTime),
      shake: this.rig.shaken,
      racers: [
        { s: this.player.s, d: this.player.d, color: '#fff', me: true },
        ...this.rivals.list.map((r) => ({ s: r.car.s, d: r.car.d, color: RIVAL_CSS[r.index % RIVAL_CSS.length], me: false })),
      ],
    });
    // The round map (the mountain road's): the car as drawn, heading up it, the rivals as dots in their colours.
    if (this.minimap) {
      const at = this.player.mesh.position;
      const others = this.rivals.list.map((r) => ({ x: r.car.mesh.position.x, z: r.car.mesh.position.z, color: RIVAL_CSS[r.index % RIVAL_CSS.length] }));
      this.minimap.update(at.x, at.z, this.player.worldYaw, others, this.accent);
    }
    const h = this.renderer.domElement.height;
    updateFlareScale(this.flares.material, this.camera, h);
    updateFlareScale(this.road.lampFlareMaterial, this.camera, h);
    if (draw) this.post.render();
  }
}
