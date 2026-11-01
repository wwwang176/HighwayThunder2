import * as THREE from 'three';
import Stats from 'stats.js';
import { LightFlares, updateFlareScale } from '../render/lightFlares';
import { NpcBeams } from '../render/npcBeams';
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
import { AiDriver, selfStateOf } from '../ai/driver';
import type { TrafficBox } from '../ai/sensors';
import { laneCenter, lanesOccupied, surfaceGrip } from '../road/coords';
import { Hud } from '../ui/hud';
import { HandlingInput } from '../vehicles/handling';
import { NpcVehicle } from '../vehicles/npcVehicle';
import { WheelInstances } from '../vehicles/wheelInstances';
import { PlayerCar } from '../vehicles/playerCar';
import { RoadScene } from '../world/roadScene';
import { SkidMarks } from '../world/skidMarks';
import { smokeLightFromSpot, TireSmoke } from '../world/tireSmoke';
import { GameFlow } from './gameState';
import { detectNearMiss } from './nearMiss';
import { Blocker, computeResetSpot } from './reset';

const HOLD: HandlingInput = { throttle: 0, brake: 0, steer: 0, handbrake: true };
const ROLL_OUT: HandlingInput = { throttle: 0, brake: 0.35, steer: 0 };
const PLAYER_OBSTACLE_ID = -1;

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  private flares!: LightFlares;
  readonly npcBeams = new NpcBeams();
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 3000);
  readonly keyboard = new Keyboard();
  readonly rig = new CameraRig(this.camera);
  readonly road: RoadScene;
  readonly player: PlayerCar;
  readonly flow = new GameFlow(localStorage);
  readonly sound = new Sound();
  readonly hud: Hud;
  readonly trafficSettings = { spacing: DEFAULT_SPACING };
  readonly trafficWorld: TrafficWorld;
  /** Trained driver from public/ai/driver.json (null when none could be loaded). */
  aiDriver: AiDriver | null = null;
  /** The AI drives the player's car (toggled with I). */
  aiActive = false;
  /** AI strength: its top speed. */
  readonly aiSettings = { speedCapKmh: 300 };
  private humanMaxSpeed = 0;
  private aiTraffic: TrafficBox[] = [];
  private wheelPool!: WheelInstances;
  private skids!: SkidMarks;
  private smoke!: TireSmoke;
  readonly stats = new Stats();
  private gui: GUI;
  private accumulator = 0;
  private lastTime = 0;
  private simTime = 0;
  private prevRelS = new Map<number, number>();
  private touched = new Set<number>();
  private lastInput: HandlingInput = HOLD;
  /** Overrides keyboard input when set (used by automated checks). */
  inputOverride: HandlingInput | null = null;
  /** Debug: stop the real-time loop from advancing the simulation. */
  freeze = false;

  constructor(container: HTMLElement, uiRoot: HTMLElement, readonly physics: PhysicsWorld) {
    physics.timestep = PHYSICS_DT;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    // Night: lights glow through flare sprites rather than a bloom pass (bloom made
    // distant lights shimmer and blew out close ones). Only the player's headlights
    // cast shadows (needed for their low-beam cookie).
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    container.appendChild(this.renderer.domElement);
    this.flares = new LightFlares(this.scene);
    this.road = new RoadScene(this.scene, this.renderer);
    for (const m of this.road.groundMaterials) this.npcBeams.patch(m);
    this.player = new PlayerCar(physics, this.scene);
    this.player.surfaceGrip = surfaceGrip;
    this.wheelPool = new WheelInstances(this.scene);
    this.trafficWorld = new TrafficWorld(physics, this.scene, this.wheelPool, Math.random, { oncoming: true });
    this.skids = new SkidMarks(this.scene);
    this.smoke = new TireSmoke(this.scene);
    this.stats.dom.style.cssText = 'position:fixed;left:24px;top:84px;z-index:20;opacity:0.85;cursor:pointer';
    document.body.appendChild(this.stats.dom);
    this.hud = new Hud(uiRoot, this.flow, {
      onStart: () => this.startRace(),
      onResume: () => this.togglePause(),
      onTitle: () => this.toTitle(),
    });
    this.gui = createTuningPanel(this.player.params, this.rig.params, this.trafficSettings, this.aiSettings);
    this.bindKeys();
    this.resize();
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.flow.phase === 'racing' || this.flow.phase === 'countdown')) this.togglePause();
    });
    this.resetWorld();
  }

  private bindKeys(): void {
    const k = this.keyboard;
    k.onPress('Enter', () => {
      if (this.flow.phase === 'title' || this.flow.phase === 'finished') this.startRace();
    });
    k.onPress('NumpadEnter', () => {
      if (this.flow.phase === 'title' || this.flow.phase === 'finished') this.startRace();
    });
    k.onPress('Escape', () => this.togglePause());
    k.onPress('KeyR', () => this.tryReset());
    k.onPress('KeyM', () => this.sound.toggleMute());
    k.onPress('KeyI', () => this.toggleAi());
    k.onPress('Backquote', () => (this.gui._hidden ? this.gui.show() : this.gui.hide()));
  }

  private resize(): void {
    this.renderer.setSize(innerWidth, innerHeight);

    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  // --- flow -----------------------------------------------------------------

  startRace(): void {
    this.sound.init();
    this.resetWorld();
    this.flow.start();
  }

  toTitle(): void {
    this.flow.toTitle();
    this.sound.suspend(false);
    this.resetWorld();
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

  /** Traffic is kept around the player. */
  private focus(): TrafficFocus {
    return { sLead: this.player.s, sTail: this.player.s, vLead: this.player.speed, raceTime: this.flow.raceTime };
  }

  /** Lanes the player's car takes up, so no traffic is spawned on top of it. */
  private playerOccupants(frame: RoadFrame): Occupant[] {
    const p = this.playerBox(frame);
    return lanesOccupied(p.dMin, p.dMax).map((lane) => ({ s: p.s, lane, length: p.length, v: Math.max(0, p.v) }));
  }

  /** Clear traffic and wrecks, put the player on the start line, refill traffic ahead. */
  resetWorld(): void {
    this.prevRelS.clear();
    this.touched.clear();
    this.player.resetTo(-3, 1, 0);
    this.aiDriver?.reset(this.player.d);
    this.skids.clear();
    this.smoke.clear();
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
    if (this.flow.phase !== 'paused' && !this.freeze) {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= PHYSICS_DT && steps < MAX_SUBSTEPS) {
        this.fixedStep(PHYSICS_DT);
        this.accumulator -= PHYSICS_DT;
        steps++;
      }
      if (steps === MAX_SUBSTEPS) this.accumulator = 0;
    }
    this.render(dt, this.accumulator / PHYSICS_DT);
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
          // Same inputs as in training: our carriageway's traffic, and its own top speed.
          const cap = this.aiSettings.speedCapKmh / 3.6;
          this.player.params.maxSpeed = cap;
          return this.aiDriver.drive(selfStateOf(this.player, cap), this.trafficWorld.ourBoxes(this.aiTraffic), this.player.params);
        }
        return this.inputOverride ?? this.keyboard.driving();
      case 'finished':
        return this.player.speed > 1 ? ROLL_OUT : HOLD; // brake to a stop, never into reverse
      default:
        return HOLD;
    }
  }

  private fixedStep(dt: number): void {
    this.simTime += dt;
    const input = this.currentInput();
    this.lastInput = input;

    // Traffic AI on both carriageways (the player and every wreck are obstacles
    // to both), then drive the NPC bodies along the planned paths.
    this.trafficWorld.stepAI(dt, this.simTime, (frame) => [{ ...this.playerBox(frame), id: PLAYER_OBSTACLE_ID, isPlayer: true }]);

    this.player.prePhysics(input, dt);
    this.physics.step((a, b) => this.onContact(a, b));
    this.player.postPhysics();
    this.trafficWorld.afterPhysics();
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
    return boxToFrame(frame, { x: t.x, z: t.z, fx: f.x, fz: f.z, w: 1.86, l: 4.4, vx: v.x, vz: v.z });
  }

  private onContact(a: EntityRef, b: EntityRef): void {
    // NPC pile-ups are handled by the traffic; we get the NPC the player hit.
    const id = this.trafficWorld.onNpcContact(a, b);
    if (id === null) return;
    const npc = this.npcs.get(id);
    if (!npc) return;
    const pv = this.player.body.linvel();
    const nv = npc.parts[0].body.linvel();
    const rel = Math.hypot(pv.x - nv.x, pv.z - nv.z);
    this.trafficWorld.wreck(id);
    this.touched.add(id);
    this.prevRelS.delete(id);
    this.rig.shake(Math.min(0.5, 0.05 + rel * 0.012));
    this.sound.crash(rel);
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
            this.hud.nearMiss();
            this.sound.whoosh();
          }
        }
      }
    }
  }

  private render(dt: number, alpha: number): void {
    this.flares.begin();
    this.npcBeams.begin();
    this.player.render(alpha, this.flares);
    const pp = this.player.mesh.position;
    for (const npc of this.npcs.values()) {
      npc.render(alpha, this.flares);
      for (const part of npc.parts) this.npcBeams.add(part.mesh, pp.x, pp.z);
    }
    this.flares.end();
    this.npcBeams.end();
    this.wheelPool.commit();
    const p = this.player.mesh.position;
    this.road.update(-p.z, p.x);
    // After the road has placed this frame's street lights.
    this.smoke.update(this.flow.phase === 'paused' ? 0 : dt, [
      ...this.road.activeLights().map(smokeLightFromSpot),
      ...this.player.smokeLights(),
      ...this.npcBeams.smokeLights(),
    ]);
    const lookBack = this.flow.phase === 'racing' && this.keyboard.isDown('KeyC');
    this.rig.update(dt, p, this.player.yaw, this.player.body.linvel(), this.player.speed, this.player.params.maxSpeed, lookBack);
    this.sound.setEngine(this.player.rpm, this.lastInput.throttle, this.flow.phase !== 'title');
    this.sound.setSkid(this.flow.phase === 'title' ? 0 : this.player.maxSlip);
    this.hud.update(dt, {
      speedKmh: Math.hypot(this.player.body.linvel().x, this.player.body.linvel().z) * 3.6,
      reverse: this.player.driveMode === 'R',
      playerS: this.player.s,
      resetCooldown: this.flow.resetCooldown,
      muted: this.sound.muted,
      gear: this.player.gearbox.gear,
      rpm: this.player.rpm,
      aiDriving: this.aiActive && this.flow.phase === 'racing',
    });
    const h = this.renderer.domElement.height;
    updateFlareScale(this.flares.material, this.camera, h);
    updateFlareScale(this.road.lampFlareMaterial, this.camera, h);
    this.renderer.render(this.scene, this.camera);
  }
}
