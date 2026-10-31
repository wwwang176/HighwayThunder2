import * as THREE from 'three';
import Stats from 'stats.js';
import { LightFlares, updateFlareScale } from '../render/lightFlares';
import type GUI from 'lil-gui';
import { GRASS_GRIP, MAX_FRAME_DT, MAX_SUBSTEPS, MAX_WRECKS, MEDIAN_FAR_X, MEDIAN_NEAR_X, PHYSICS_DT, RESET_SPEED, WRECK_LIFETIME } from '../config';
import { boxToFrame, ONCOMING_FRAME, OUR_FRAME, RoadFrame } from '../road/frame';
import { Sound } from '../audio/sound';
import { createTuningPanel } from '../debug/tuning';
import { Keyboard } from '../input/keyboard';
import { EntityRef, PhysicsWorld } from '../physics/physicsWorld';
import { CameraRig } from '../render/cameraRig';
import { Obstacle, TrafficSim } from '../traffic/trafficAI';
import { DEFAULT_SPACING, Occupant, planSpawns, shouldDespawn } from '../traffic/spawner';
import { laneCenter, lanesOccupied } from '../road/coords';
import { Hud } from '../ui/hud';
import { HandlingInput } from '../vehicles/handling';
import { NpcVehicle } from '../vehicles/npcVehicle';
import { WheelInstances } from '../vehicles/wheelInstances';
import { PlayerCar } from '../vehicles/playerCar';
import { RoadScene } from '../world/roadScene';
import { SkidMarks } from '../world/skidMarks';
import { TireSmoke } from '../world/tireSmoke';
import { GameFlow } from './gameState';
import { detectNearMiss } from './nearMiss';
import { Blocker, computeResetSpot } from './reset';

const HOLD: HandlingInput = { throttle: 0, brake: 0, steer: 0, handbrake: true };
const ROLL_OUT: HandlingInput = { throttle: 0, brake: 0.35, steer: 0 };
const PLAYER_OBSTACLE_ID = -1;
const SPAWN_INTERVAL = 0.25;
const ONCOMING_FIRST_ID = 1_000_000;

/** One carriageway: its traffic planner, coordinate frame and direction relative to the player. */
interface Side {
  name: 'ours' | 'oncoming';
  frame: RoadFrame;
  facing: 1 | -1;
  sim: TrafficSim;
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  private flares!: LightFlares;
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
  private sides: Side[] = [];
  private sideOf = new Map<number, Side>();
  readonly npcs = new Map<number, NpcVehicle>();
  private wheelPool!: WheelInstances;
  private skids!: SkidMarks;
  private smoke!: TireSmoke;
  readonly stats = new Stats();
  private gui: GUI;
  private accumulator = 0;
  private lastTime = 0;
  private simTime = 0;
  private spawnTimer = 0;
  private prevRelS = new Map<number, number>();
  private touched = new Set<number>();
  private lastInput: HandlingInput = HOLD;
  /** Overrides keyboard input when set (used by automated checks). */
  inputOverride: HandlingInput | null = null;
  rng: () => number = Math.random;
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
    this.player = new PlayerCar(physics, this.scene);
    this.player.surfaceGrip = (x) => (x < MEDIAN_NEAR_X && x > MEDIAN_FAR_X ? GRASS_GRIP : 1);
    this.wheelPool = new WheelInstances(this.scene);
    this.skids = new SkidMarks(this.scene);
    this.smoke = new TireSmoke(this.scene);
    this.stats.dom.style.cssText = 'position:fixed;left:24px;top:84px;z-index:20;opacity:0.85;cursor:pointer';
    document.body.appendChild(this.stats.dom);
    this.hud = new Hud(uiRoot, this.flow, {
      onStart: () => this.startRace(),
      onResume: () => this.togglePause(),
      onTitle: () => this.toTitle(),
    });
    this.gui = createTuningPanel(this.player.params, this.rig.params, this.trafficSettings);
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
    return this.sides[0].sim;
  }

  /** Oncoming carriageway's traffic planner. */
  get oncoming(): TrafficSim {
    return this.sides[1].sim;
  }

  /** Clear traffic and wrecks, put the player on the start line, refill traffic ahead. */
  resetWorld(): void {
    for (const npc of this.npcs.values()) npc.dispose();
    this.npcs.clear();
    this.sideOf.clear();
    this.sides = [
      { name: 'ours', frame: OUR_FRAME, facing: 1, sim: new TrafficSim() },
      { name: 'oncoming', frame: ONCOMING_FRAME, facing: -1, sim: new TrafficSim(ONCOMING_FIRST_ID) },
    ];
    this.prevRelS.clear();
    this.touched.clear();
    this.player.resetTo(-3, 1, 0);
    this.skids.clear();
    this.smoke.clear();
    this.rig.snap();
    this.spawn(true);
  }

  tryReset(): void {
    if (!this.flow.canReset()) return;
    const blockers: Blocker[] = [];
    for (const npc of this.npcs.values()) {
      const agent = this.sideOf.get(npc.id)?.name === 'ours' ? this.traffic.agents.get(npc.id) : undefined;
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

  private currentInput(): HandlingInput {
    switch (this.flow.phase) {
      case 'racing':
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
    for (const side of this.sides) {
      const obstacles: Obstacle[] = [{ ...this.playerBox(side.frame), id: PLAYER_OBSTACLE_ID, isPlayer: true }];
      for (const npc of this.npcs.values()) {
        if (npc.wrecked) obstacles.push(...npc.obstacles(side.frame));
        else if (this.sideOf.get(npc.id) === side) npc.syncAgent(side.sim.agents.get(npc.id)!);
      }
      side.sim.step(dt, obstacles, this.rng, false);
    }
    for (const npc of this.npcs.values()) {
      npc.savePrev();
      if (npc.wrecked) npc.updateWreck(dt, this.simTime);
      else npc.drive(this.agentOf(npc.id)!, dt, this.simTime);
    }

    this.player.prePhysics(input, dt);
    this.physics.step((a, b) => this.onContact(a, b));
    this.player.postPhysics();
    for (const npc of this.npcs.values()) npc.capture();
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

    this.cullVehicles();
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = SPAWN_INTERVAL;
      this.spawn(false);
    }
    this.checkNearMisses();

    const wasFinished = this.flow.phase === 'finished';
    this.flow.update(dt, this.player.s);
    if (!wasFinished && this.flow.phase === 'finished') this.sound.whoosh();
  }

  private agentOf(id: number) {
    return this.sideOf.get(id)?.sim.agents.get(id);
  }

  /** The player's car as an obstacle in a carriageway's coordinates. */
  private playerBox(frame: RoadFrame) {
    const t = this.player.body.translation();
    const v = this.player.body.linvel();
    const f = OUR_FRAME.forwardWorld(this.player.yaw);
    return boxToFrame(frame, { x: t.x, z: t.z, fx: f.x, fz: f.z, w: 1.86, l: 4.4, vx: v.x, vz: v.z });
  }

  private onContact(a: EntityRef, b: EntityRef): void {
    if (a.type === 'static' || b.type === 'static') return;
    if (a.type === 'npc' && b.type === 'npc') {
      this.wreckNpc(a.id, 0);
      this.wreckNpc(b.id, 0);
      return;
    }
    const npcRef = a.type === 'npc' ? a : b.type === 'npc' ? b : null;
    if (!npcRef) return;
    const npc = this.npcs.get(npcRef.id);
    if (!npc) return;
    const pv = this.player.body.linvel();
    const nv = npc.parts[0].body.linvel();
    const rel = Math.hypot(pv.x - nv.x, pv.z - nv.z);
    this.wreckNpc(npcRef.id, rel);
    this.rig.shake(Math.min(0.5, 0.05 + rel * 0.012));
    this.sound.crash(rel);
  }

  private wreckNpc(id: number, _impact: number): void {
    const npc = this.npcs.get(id);
    if (!npc || npc.wrecked) return;
    npc.wreck();
    this.sideOf.get(id)?.sim.removeAgent(id);
    this.touched.add(id);
    this.prevRelS.delete(id);
  }

  private removeNpc(npc: NpcVehicle): void {
    npc.dispose();
    this.npcs.delete(npc.id);
    this.sideOf.get(npc.id)?.sim.removeAgent(npc.id);
    this.sideOf.delete(npc.id);
    this.prevRelS.delete(npc.id);
    this.touched.delete(npc.id);
  }

  private cullVehicles(): void {
    const ps = this.player.s;
    const wrecks: NpcVehicle[] = [];
    for (const npc of [...this.npcs.values()]) {
      if (npc.wrecked) {
        if (npc.wreckTime > WRECK_LIFETIME || npc.s < ps - 260 || npc.s > ps + 900) this.removeNpc(npc);
        else wrecks.push(npc);
      } else {
        const side = this.sideOf.get(npc.id)!;
        const agent = side.sim.agents.get(npc.id);
        if (!agent || shouldDespawn(agent.s, this.playerS(side.frame), side.facing)) this.removeNpc(npc);
      }
    }
    if (wrecks.length > MAX_WRECKS) {
      // Oldest first, and only ones not ahead of the player.
      const removable = wrecks.filter((w) => w.s < ps).sort((x, y) => y.wreckTime - x.wreckTime);
      for (let i = 0; i < wrecks.length - MAX_WRECKS && i < removable.length; i++) this.removeNpc(removable[i]);
    }
  }

  /** Player position along a carriageway's own s axis. */
  private playerS(frame: RoadFrame): number {
    const t = this.player.body.translation();
    return frame.fromWorld(t.x, t.z).s;
  }

  private spawn(initial: boolean): void {
    for (const side of this.sides) this.spawnSide(side, initial);
  }

  private spawnSide(side: Side, initial: boolean): void {
    const occupied: Occupant[] = [];
    for (const a of side.sim.agents.values()) {
      occupied.push({ s: a.s, lane: a.lane, length: a.length, v: a.v });
      if (a.targetLane !== null && a.targetLane !== a.lane) occupied.push({ s: a.s, lane: a.targetLane, length: a.length, v: a.v });
    }
    const p = this.playerBox(side.frame);
    for (const lane of lanesOccupied(p.dMin, p.dMax)) occupied.push({ s: p.s, lane, length: p.length, v: Math.max(0, p.v) });
    for (const npc of this.npcs.values()) {
      if (!npc.wrecked) continue;
      // A wreck blocks every lane it touches.
      for (const o of npc.obstacles(side.frame)) for (const lane of lanesOccupied(o.dMin, o.dMax)) occupied.push({ s: o.s, lane, length: o.length, v: 0 });
    }
    const reqs = planSpawns({
      playerS: this.playerS(side.frame),
      playerV: this.player.speed,
      raceTime: this.flow.raceTime,
      occupied,
      rng: this.rng,
      initial,
      spacing: this.trafficSettings.spacing,
      facing: side.facing,
    });
    for (const r of reqs) {
      const agent = side.sim.addAgent(r.kind, r.s, r.lane, this.rng);
      agent.v = Math.min(agent.v, r.vMax);
      this.npcs.set(agent.id, new NpcVehicle(this.physics, this.scene, this.wheelPool, side.frame, agent, this.rng));
      this.sideOf.set(agent.id, side);
    }
  }

  private checkNearMisses(): void {
    const p = this.player;
    const fp = p.footprint();
    for (const side of this.sides) {
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
    this.player.render(alpha, this.flares);
    for (const npc of this.npcs.values()) npc.render(alpha, this.flares);
    this.flares.end();
    this.wheelPool.commit();
    this.smoke.update(this.flow.phase === 'paused' ? 0 : dt);
    const p = this.player.mesh.position;
    this.road.update(-p.z, p.x);
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
    });
    const h = this.renderer.domElement.height;
    updateFlareScale(this.flares.material, this.camera, h);
    updateFlareScale(this.road.lampFlareMaterial, this.camera, h);
    this.renderer.render(this.scene, this.camera);
  }
}
