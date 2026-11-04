import * as THREE from 'three';
import Stats from 'stats.js';
import { LightFlares, updateFlareScale } from '../render/lightFlares';
import { NpcBeams } from '../render/npcBeams';
import { PlanPath } from '../render/planPath';
import { POST, PostFx } from '../render/postFx';
import { blurAmount, motionCenter } from '../render/speedBlur';
import { flameTextures } from '../render/exhaustFlames';
import { BodyInstances } from '../render/bodyInstances';
import type { Plan } from '../ai/planner';
import type GUI from 'lil-gui';
import { MAX_FRAME_DT, MAX_SUBSTEPS, PHYSICS_DT, RESET_SPEED } from '../config';
import { boxToFrame, OUR_FRAME, RoadFrame } from '../road/frame';
import { Sound } from '../audio/sound';
import { createTuningPanel } from '../debug/tuning';
import { Keyboard } from '../input/keyboard';
import { EntityRef, PhysicsWorld } from '../physics/physicsWorld';
import { CameraRig } from '../render/cameraRig';
import { TrafficSim } from '../traffic/trafficAI';
import { DEFAULT_SPACING, Occupant } from '../traffic/spawner';
import { TrafficFocus, TrafficWorld } from '../sim/trafficWorld';
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
import { CAR_CARDS, CarSelection, defaultSelection, loadSelection, saveSelection } from './carSelection';
import { applyDifficulty } from './difficulty';
import { Garage } from '../ui/garage';
import { IntroOverlay } from '../ui/introOverlay';
import { Intro, INTRO_KINDS } from './intro';

/** A car type by id (the supercar for an id no longer known). */
const specOf = (id: string): CarSpec => CARS[id] ?? STREET_RACER;
import { RoadScene } from '../world/roadScene';
import { SkidMarks } from '../world/skidMarks';
import { Sparks } from '../world/sparks';
import { smokeLightFromSpot, TireSmoke } from '../world/tireSmoke';
import { GameFlow, picksCars, type Phase } from './gameState';
import { RaceView, RIVAL_COLORS, RIVAL_TUNING, Rivals } from './rivals';
import { closingSpeed, knocksOut } from './contact';
import { WorkerPlanSource } from '../ai/workerPlanSource';
import { detectNearMiss } from './nearMiss';
import { Blocker, computeResetSpot } from './reset';

/** The rivals' colours, for the HUD. */
const RIVAL_CSS = RIVAL_COLORS.map((c) => `#${c.toString(16).padStart(6, '0')}`);

const HOLD: HandlingInput = { throttle: 0, brake: 0, steer: 0, handbrake: true };
const ROLL_OUT: HandlingInput = { throttle: 0, brake: 0.35, steer: 0 };
/** Every lamp state a traffic vehicle shows (brake lights dim and on, indicators off and on): for prewarm. */
const PREWARM_LAMPS: VehicleLights[] = [
  { left: [], right: [], brake: [new THREE.Mesh(undefined, BRAKE_DIM)] },
  { left: [new THREE.Object3D()], right: [new THREE.Object3D()], brake: [new THREE.Mesh(undefined, BRAKE_ON)] },
];
const PLAYER_OBSTACLE_ID = -1;
const BLUR_V = new THREE.Vector3();
/** How fast the race's time runs, by phase (frame()): stopped in a pause, slow motion past the finish line. */
const TIME_SCALE: Partial<Record<Phase, number>> = { paused: 0, finished: 0.1 };
/** A race's start: the garage faded to black, then the race faded in on its intro (ms). */
const START_FADE_OUT = 350;
const START_FADE_IN = 700;

export class Game {
  readonly renderer: THREE.WebGLRenderer;
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
  /** The cars on the grid now. */
  private cars: CarSelection = defaultSelection();
  readonly flow = new GameFlow(localStorage);
  readonly sound = new Sound();
  readonly hud: Hud;
  /** The garage: the title screen, where the car and the race are picked. */
  readonly garage: Garage;
  readonly trafficSettings = { spacing: DEFAULT_SPACING };
  readonly trafficWorld: TrafficWorld;
  /** Trained driver from public/ai/driver.json (null when none could be loaded). */
  aiDriver: Driver | null = null;
  /** The AI drives the player's car (toggled with I). */
  aiActive = false;
  /** AI strength: its top speed. */
  readonly aiSettings = { speedCapKmh: 300 };
  /** The rivals' top speed (km/h) at the race's difficulty (the tuning panel's AI top speed when that is lower). */
  private rivalCapKmh = 300;
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
  /** The race's intro: the last one (its kind not picked twice running), whether it is on; a race starting (the fade). */
  private intro: Intro | null = null;
  private introOn = false;
  private starting = false;
  private overlay!: IntroOverlay;
  /** Overrides keyboard input when set (used by automated checks). */
  inputOverride: HandlingInput | null = null;
  /** Debug: stop the real-time loop from advancing the simulation. */
  freeze = false;

  constructor(container: HTMLElement, uiRoot: HTMLElement, readonly physics: PhysicsWorld) {
    physics.timestep = PHYSICS_DT;
    // (No antialiasing of its own: the picture's edges are smoothed in render/postFx.)
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    // Night: lights glow through flare sprites (steady however far), and through a gentle
    // bloom over them (render/postFx: only what is brighter than white). Only the player's
    // headlights cast shadows (needed for their low-beam cookie).
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    container.appendChild(this.renderer.domElement);
    this.post = new PostFx(this.renderer, this.scene, this.camera);
    this.flares = new LightFlares(this.scene);
    this.road = new RoadScene(this.scene, this.renderer);
    for (const m of this.road.groundMaterials) this.npcBeams.patch(m);
    this.player = new PlayerCar(physics, this.scene);
    this.player.surfaceGrip = surfaceGrip;
    this.bodies = new BodyInstances(this.scene);
    this.planPath = new PlanPath(this.scene);
    this.rivals = new Rivals(physics, this.scene, () => new WorkerPlanSource(), this.cars.rivals.map(specOf));
    this.trafficWorld = new TrafficWorld(physics, Math.random, { oncoming: true });
    this.skids = new SkidMarks(this.scene);
    this.smoke = new TireSmoke(this.post.unbloomed); // (lit, however brightly: no glow)
    this.sparks = new Sparks(this.scene);
    this.stats.dom.style.cssText = 'position:fixed;left:24px;top:84px;z-index:20;opacity:0.85;cursor:pointer';
    document.body.appendChild(this.stats.dom);
    this.hud = new Hud(uiRoot, this.flow, {
      onAgain: () => this.startRace(this.cars),
      onResume: () => this.togglePause(),
      onTitle: () => this.toTitle(),
    });
    this.garage = new Garage(uiRoot, RIVAL_COLORS, (cars) => {
      saveSelection(localStorage, cars);
      this.startRace(cars);
    });
    this.overlay = new IntroOverlay(uiRoot); // (over the garage: its fade covers it)
    this.gui = createTuningPanel(this.player.params, this.rig.params, this.trafficSettings, this.aiSettings);
    this.bindKeys();
    // Any key or click skips the intro.
    addEventListener('keydown', () => this.flow.phase === 'intro' && this.endIntro());
    addEventListener('pointerdown', () => this.flow.phase === 'intro' && this.endIntro());
    this.resize();
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.flow.phase === 'racing' || this.flow.phase === 'countdown')) this.togglePause();
    });
    this.resetWorld();
    this.openGarage();
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
    this.bodies.begin(this.camera, this.player.headlights);
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
    // Enter: in the garage, into the race (not while a pop-up is open, nor on a focused button: Enter presses that one);
    // after the finish, the same race again.
    const enter = () => {
      if (g.isOpen) {
        if (!g.popOpen && !(document.activeElement instanceof HTMLButtonElement)) g.start();
      } else if (this.flow.phase === 'finished') this.startRace(this.cars); // the race just run, saved or not
    };
    k.onPress('Enter', enter);
    k.onPress('NumpadEnter', enter);
    k.onPress('Escape', () => (g.popOpen ? g.closePop() : g.isOpen ? undefined : this.togglePause()));
    k.onPress('ArrowUp', () => g.isOpen && !g.popOpen && g.step(-1));
    k.onPress('ArrowDown', () => g.isOpen && !g.popOpen && g.step(1));
    k.onPress('ArrowLeft', () => g.isOpen && !g.popOpen && g.stepPaint(-1));
    k.onPress('ArrowRight', () => g.isOpen && !g.popOpen && g.stepPaint(1));
    // Race keys do nothing in the garage.
    k.onPress('KeyR', () => !g.isOpen && this.tryReset());
    k.onPress('KeyM', () => this.sound.toggleMute());
    k.onPress('KeyI', () => !g.isOpen && this.toggleAi());
    k.onPress('KeyP', () => !g.isOpen && (this.showPlan = !this.showPlan));
    k.onPress('Backquote', () => (this.gui._hidden ? this.gui.show() : this.gui.hide()));
  }

  private resize(): void {
    this.renderer.setSize(innerWidth, innerHeight);
    this.post.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  // --- flow -----------------------------------------------------------------

  /** The garage, with the race picked last time (only before a race: at the title or after the finish). */
  openGarage(): void {
    if (!picksCars(this.flow.phase)) return;
    // The world (and its render, which drives the engine and tyre sounds) stops: no engine left running in the garage.
    this.sound.setEngine(0, 0, false);
    this.sound.setSkid(0);
    this.hud.hide();
    this.garage.open(loadSelection(localStorage));
  }

  /**
   * Start a race as picked (`cars`: the cars, difficulty and weather), else on the grid as it is. Only from the
   * title or the finish. A fade to black (the race set up behind it, prewarm's stall unseen), then back on its
   * intro.
   */
  startRace(cars?: CarSelection): void {
    if (!picksCars(this.flow.phase) || this.starting) return;
    this.starting = true;
    this.sound.init(); // (in the click or key itself: the browser lets the sound start only there)
    this.overlay.toBlack(START_FADE_OUT, () => {
      this.starting = false;
      this.garage.close();
      // Every race starts with the player driving (I hands the car to the AI again), on the car's own limiter.
      if (this.aiActive) {
        this.aiActive = false;
        this.player.params.maxSpeed = this.humanMaxSpeed;
      }
      if (cars) {
        this.applyCars(cars);
        this.rivalCapKmh = applyDifficulty(cars.difficulty, RIVAL_TUNING);
      }
      this.hud.setAccent(CAR_CARDS.find((c) => c.id === this.cars.player)?.accent ?? '#ff3b30');
      this.resetWorld();
      this.prewarm();
      this.flow.start();
      this.beginIntro();
      this.overlay.fromBlack(START_FADE_IN);
    });
  }

  /** The race's intro: one of its shot lists, not the last one's. */
  private beginIntro(): void {
    const kinds = INTRO_KINDS.filter((k) => k !== this.intro?.kind);
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    this.intro = new Intro(kind, { camera: this.camera, player: this.player, rivals: this.rivals.list.map((r) => r.car), chase: this.rig.params });
    this.introOn = true;
    this.overlay.show(true);
  }

  /** The intro over (or skipped, a key): the chase camera from where it ended, the countdown. */
  private endIntro(): void {
    if (!this.introOn) return;
    this.introOn = false;
    this.intro?.end();
    this.flow.beginCountdown();
    this.rig.snap();
    this.camYaw = null; // (the camera's jump no turn for the speed blur)
    this.overlay.show(false);
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
    }
    if (cars.rivals.length !== this.cars.rivals.length || cars.rivals.some((id, i) => id !== this.cars.rivals[i])) {
      this.rivals.dispose();
      this.rivals = new Rivals(this.physics, this.scene, () => new WorkerPlanSource(), cars.rivals.map(specOf));
    }
    this.cars = { ...cars, rivals: [...cars.rivals], paint: { ...cars.paint } };
  }

  /** Back to the garage (from the pause or the finish). */
  toTitle(): void {
    if (this.introOn) {
      this.introOn = false;
      this.intro?.end();
      this.overlay.show(false);
    }
    this.flow.toTitle();
    this.sound.suspend(false);
    this.resetWorld();
    this.openGarage();
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
    this.player.resetTo(-3, 1, 0);
    this.player.nitro.reset();
    this.playerNitroAi.reset();
    this.aiDriver?.reset(this.player.d);
    this.rivals.place();
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
        blockers.push({ s: agent.s, dMin: agent.d - agent.width / 2, dMax: agent.d + agent.width / 2, length: agent.length, v: agent.v });
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
    // The garage covers the whole screen and draws its own car: the world waits (and the GPU rests), the FPS meter too.
    this.stats.dom.style.visibility = this.garage.isOpen ? 'hidden' : '';
    if (this.garage.isOpen) return;
    // The race's time this frame: 0 while paused, slowed past the finish (TIME_SCALE). The world and everything
    // that moves with the race (effects, the camera, the HUD's pop-ups) run on it, so a pause stills the whole
    // picture; only the menus run on real time.
    const play = dt * (TIME_SCALE[this.flow.phase] ?? 1);
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
      this.hud.message('沒有可用的 AI 駕駛（請先在 lab/train.html 訓練並存檔）');
      return;
    }
    this.aiActive = !this.aiActive;
    if (this.aiActive) {
      this.humanMaxSpeed = this.player.params.maxSpeed;
      this.aiDriver.reset(this.player.d);
    } else this.player.params.maxSpeed = this.humanMaxSpeed;
  }

  private currentInput(): HandlingInput {
    switch (this.flow.phase) {
      case 'racing':
        if (this.aiActive && this.aiDriver && !this.inputOverride) {
          // Same inputs as in training: our carriageway's traffic, and its own top speed (the car's when lower).
          const cap = aiTopSpeed(this.aiSettings.speedCapKmh / 3.6, specOf(this.cars.player));
          this.player.params.maxSpeed = cap;
          const seen = this.trafficWorld.ourBoxes(this.aiTraffic);
          for (const b of this.rivals.boxes(this.rivalBoxes)) seen.push(b);
          const input = this.aiDriver.drive(selfStateOf(this.player, cap), seen, this.player.params);
          return { ...input, nitro: this.playerNitroAi.want(PHYSICS_DT, input.throttle, this.player.nitro) }; // its nitro by the rivals' rule
        }
        return this.inputOverride ?? this.keyboard.driving();
      case 'finished':
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
      speedCap: Math.min(this.aiSettings.speedCapKmh, this.rivalCapKmh) / 3.6,
      raceTime: this.flow.raceTime,
    };
    if (racing) this.rivals.drive(dt, view);
    else this.rivals.hold(dt);

    // Traffic AI on both carriageways (the player, the rivals and every wreck are
    // obstacles to both), then drive the NPC bodies along the planned paths.
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
    this.player.wheels.forEach((w, i) => {
      const sliding = w.inContact && w.sliding;
      const k = sliding && w.slip > 1.5 ? Math.min(1, (w.slip - 1.5) / 8) : 0;
      this.skids.add(i, w.contactX, w.contactZ, w.dirX, w.dirZ, k);
      this.smoke.emit(i, w.contactX, w.contactZ, sliding ? w.slip : 0, pv.x, pv.z, dt);
    });
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
          this.smoke.emit(key, w.contactX, w.contactZ, sliding ? w.slip : 0, v.x, v.z, dt);
        });
      }
    }

    this.trafficWorld.spacing = this.trafficSettings.spacing;
    this.trafficWorld.maintain(dt, this.focus(), (f) => this.playerOccupants(f));
    this.forgetRemovedNpcs();
    this.checkNearMisses();

    const wasFinished = this.flow.phase === 'finished';
    this.flow.update(dt, this.player.s);
    if (!wasFinished && this.flow.phase === 'finished') this.sound.whoosh();
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
      this.sound.crash(rel);
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
    if (hard) this.sound.crash(rel);
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
   * The speed blur (render/speedBlur; call with the camera placed): out from where the car is going on the
   * screen (off the middle as it slides), the more the faster (POST.blurFrom km/h up, more with the nitro), and
   * across by the camera's turning (as a 1/60 s exposure would smear it). Paused, it holds as it was (the
   * picture stays); none at the title.
   */
  private speedBlur(play: number): void {
    this.camera.getWorldDirection(BLUR_V);
    const yaw = Math.atan2(BLUR_V.x, BLUR_V.z);
    if (play > 0) {
      const v = this.player.body.linvel();
      const center = this.flow.phase === 'title' || this.flow.phase === 'intro' ? null : motionCenter(this.camera, BLUR_V.set(v.x, v.y, v.z));
      if (center) this.blurCenter.copy(center);
      this.blurAmount = center
        ? blurAmount(Math.abs(this.player.speed) * 3.6, this.player.nitro.active, { from: POST.blurFrom, full: POST.blurFull, strength: POST.blurStrength, nitro: POST.blurNitro })
        : 0;
      // (A jump of the camera - a reset - is no turn: at most 3 rad/s.)
      const turned = this.camYaw === null ? 0 : Math.atan2(Math.sin(yaw - this.camYaw), Math.cos(yaw - this.camYaw));
      const rate = Math.min(3, Math.abs(turned) / play);
      const hFov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.camera.aspect);
      this.blurSweep.set(this.flow.phase === 'title' || this.flow.phase === 'intro' ? 0 : ((rate / 60) / hFov) * POST.blurTurn, 0);
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
            this.sound.whoosh();
          }
        }
      }
    }
  }

  /** `play`: the race's time this frame (0 paused: frame()), what everything here moves by. */
  private render(play: number, alpha: number): void {
    // The intro's show for this frame (the car drawn arriving, its engine blipped); over, the countdown.
    if (this.introOn && this.intro!.step(play)) this.endIntro();
    this.flares.begin();
    this.npcBeams.begin();
    this.player.render(alpha, this.flares);
    const pp = this.player.mesh.position;
    for (const npc of this.npcs.values()) {
      npc.render(alpha, this.flares);
      for (const part of npc.parts) this.npcBeams.add(part.mesh, pp.x, pp.z);
    }
    this.rivals.render(alpha, this.flares);
    for (const r of this.rivals.list) this.npcBeams.add(r.car.mesh, pp.x, pp.z);
    this.flares.end();
    this.npcBeams.end();
    const planned = this.aiDriver as { plan?: Plan | null; planAge?: number } | null;
    if (this.showPlan && this.aiActive && this.flow.phase === 'racing' && planned?.plan) this.planPath.show(planned.plan, planned.planAge ?? 0);
    else this.planPath.hide();
    const p = this.player.mesh.position;
    this.road.update(-p.z, p.x);
    // After the road has placed this frame's street lights.
    this.sparks.update(play, this.player.body.linvel());
    this.player.exhaust(play);
    for (const r of this.rivals.list) r.car.exhaust(play);
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
    // instead while it is on.
    if (this.introOn) this.intro!.placeCamera();
    else this.rig.update(play, p, this.player.yaw, this.player.body.linvel(), this.player.speed, this.player.params.maxSpeed, lookBack);
    this.speedBlur(play);
    // The traffic's bodies, those in this frame's view (the camera placed).
    this.bodies.begin(this.camera, this.player.headlights); // (the only lights casting shadows)
    for (const npc of this.npcs.values()) npc.addBodies(this.bodies);
    this.player.addWheels(this.bodies);
    for (const r of this.rivals.list) r.car.addWheels(this.bodies);
    this.bodies.end();
    // (Mid-upshift the engine is let go of: it sounds off the throttle. The intro's blip, as it is put on.)
    const rev = this.player.showRev;
    this.sound.setEngine(this.player.shownRpm, rev ? rev.throttle : this.player.gearbox.shifting ? 0 : this.lastInput.throttle, this.flow.phase !== 'title');
    this.sound.setSkid(this.flow.phase === 'title' ? 0 : this.player.maxSlip);
    this.hud.update(play, {
      speedKmh: Math.hypot(this.player.body.linvel().x, this.player.body.linvel().z) * 3.6,
      reverse: this.player.driveMode === 'R',
      playerS: this.player.s,
      resetCooldown: this.flow.resetCooldown,
      muted: this.sound.muted,
      gear: this.player.gearbox.gear,
      rpm: this.player.rpm,
      nitro: this.player.nitro.level,
      nitroOn: this.player.nitro.active,
      aiDriving: this.aiActive && this.flow.phase === 'racing',
      place: this.rivals.rank(this.player.s, this.flow.finishTime),
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
