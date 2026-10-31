import * as THREE from 'three';
import type GUI from 'lil-gui';
import { MAX_FRAME_DT, MAX_SUBSTEPS, MAX_WRECKS, PHYSICS_DT, RESET_SPEED, WRECK_LIFETIME } from '../config';
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
import { GameFlow } from './gameState';
import { detectNearMiss } from './nearMiss';
import { Blocker, computeResetSpot } from './reset';

const HOLD: HandlingInput = { throttle: 0, brake: 0, steer: 0, handbrake: true };
const ROLL_OUT: HandlingInput = { throttle: 0, brake: 0.35, steer: 0 };
const PLAYER_OBSTACLE_ID = -1;
const SPAWN_INTERVAL = 0.25;

export class Game {
  readonly renderer: THREE.WebGLRenderer;
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
  traffic = new TrafficSim();
  readonly npcs = new Map<number, NpcVehicle>();
  private wheelPool!: WheelInstances;
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
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);
    this.road = new RoadScene(this.scene, this.renderer);
    this.player = new PlayerCar(physics, this.scene);
    this.wheelPool = new WheelInstances(this.scene);
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

  /** Clear traffic and wrecks, put the player on the start line, refill traffic ahead. */
  resetWorld(): void {
    for (const npc of this.npcs.values()) npc.dispose();
    this.npcs.clear();
    this.traffic = new TrafficSim();
    this.prevRelS.clear();
    this.touched.clear();
    this.player.resetTo(-3, 1, 0);
    this.rig.snap();
    this.spawn(true);
  }

  tryReset(): void {
    if (!this.flow.canReset()) return;
    const blockers: Blocker[] = [];
    for (const npc of this.npcs.values()) {
      const agent = this.traffic.agents.get(npc.id);
      if (agent && !npc.wrecked) {
        blockers.push({ s: agent.s, dMin: agent.d - agent.width / 2, dMax: agent.d + agent.width / 2, length: agent.length, v: agent.v });
        if (agent.targetLane !== null && agent.targetLane !== agent.lane) {
          // Mid lane change: it is about to occupy the target lane too.
          const c = laneCenter(agent.targetLane);
          blockers.push({ s: agent.s, dMin: c - agent.width / 2, dMax: c + agent.width / 2, length: agent.length, v: agent.v });
        }
      } else {
        blockers.push(...npc.obstacles());
      }
    }
    const spot = computeResetSpot(this.player.s, this.player.d, blockers, RESET_SPEED);
    this.player.resetTo(spot.s, spot.lane, RESET_SPEED);
    this.flow.markReset();
    this.rig.snap();
  }

  // --- loop -----------------------------------------------------------------

  start(): void {
    this.lastTime = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(MAX_FRAME_DT, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.frame(dt);
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

    // Traffic AI, then drive the NPC bodies toward the AI poses.
    const obstacles: Obstacle[] = [{ ...this.player.footprint(), id: PLAYER_OBSTACLE_ID, v: Math.max(0, this.player.speed), isPlayer: true }];
    for (const npc of this.npcs.values()) {
      if (npc.wrecked) obstacles.push(...npc.obstacles());
      else npc.syncAgent(this.traffic.agents.get(npc.id)!);
    }
    this.traffic.step(dt, obstacles, this.rng, false);
    for (const npc of this.npcs.values()) {
      npc.savePrev();
      if (npc.wrecked) npc.updateWreck(dt, this.simTime);
      else npc.drive(this.traffic.agents.get(npc.id)!, dt, this.simTime);
    }

    this.player.prePhysics(input, dt);
    this.physics.step((a, b) => this.onContact(a, b));
    this.player.postPhysics();
    for (const npc of this.npcs.values()) npc.capture();

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
    this.traffic.removeAgent(id);
    this.touched.add(id);
    this.prevRelS.delete(id);
  }

  private removeNpc(npc: NpcVehicle): void {
    npc.dispose();
    this.npcs.delete(npc.id);
    this.traffic.removeAgent(npc.id);
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
        const agent = this.traffic.agents.get(npc.id);
        if (!agent || shouldDespawn(agent.s, ps)) this.removeNpc(npc);
      }
    }
    if (wrecks.length > MAX_WRECKS) {
      // Oldest first, and only ones not ahead of the player.
      const removable = wrecks.filter((w) => w.s < ps).sort((x, y) => y.wreckTime - x.wreckTime);
      for (let i = 0; i < wrecks.length - MAX_WRECKS && i < removable.length; i++) this.removeNpc(removable[i]);
    }
  }

  private spawn(initial: boolean): void {
    const occupied: Occupant[] = [];
    for (const a of this.traffic.agents.values()) {
      occupied.push({ s: a.s, lane: a.lane, length: a.length, v: a.v });
      if (a.targetLane !== null && a.targetLane !== a.lane) occupied.push({ s: a.s, lane: a.targetLane, length: a.length, v: a.v });
    }
    const p = this.player.footprint();
    for (const lane of lanesOccupied(p.dMin, p.dMax)) occupied.push({ s: p.s, lane, length: p.length, v: Math.max(0, this.player.speed) });
    for (const npc of this.npcs.values()) {
      if (!npc.wrecked) continue;
      // A wreck blocks every lane it touches.
      for (const o of npc.obstacles()) for (const lane of lanesOccupied(o.dMin, o.dMax)) occupied.push({ s: o.s, lane, length: o.length, v: 0 });
    }
    const reqs = planSpawns({
      playerS: this.player.s,
      playerV: this.player.speed,
      raceTime: this.flow.raceTime,
      occupied,
      rng: this.rng,
      initial,
      spacing: this.trafficSettings.spacing,
    });
    for (const r of reqs) {
      const agent = this.traffic.addAgent(r.kind, r.s, r.lane, this.rng);
      agent.v = Math.min(agent.v, r.vMax);
      this.npcs.set(agent.id, new NpcVehicle(this.physics, this.scene, this.wheelPool, agent, this.rng));
    }
  }

  private checkNearMisses(): void {
    const p = this.player;
    const fp = p.footprint();
    for (const agent of this.traffic.agents.values()) {
      const rel = agent.s - p.s;
      const prev = this.prevRelS.get(agent.id);
      this.prevRelS.set(agent.id, rel);
      if (prev === undefined || this.touched.has(agent.id)) continue;
      if (prev > 0 && rel <= 0) {
        const gap = Math.max(agent.d - agent.width / 2 - fp.dMax, fp.dMin - (agent.d + agent.width / 2));
        if (detectNearMiss(prev, rel, gap, p.speed) && this.flow.phase === 'racing') {
          this.flow.addNearMiss();
          this.hud.nearMiss();
          this.sound.whoosh();
        }
      }
    }
  }

  private render(dt: number, alpha: number): void {
    this.player.render(alpha);
    for (const npc of this.npcs.values()) npc.render(alpha);
    this.wheelPool.commit();
    const p = this.player.mesh.position;
    this.road.update(-p.z, p.x);
    this.rig.update(dt, p, this.player.yaw, Math.max(0, this.player.speed), this.player.params.maxSpeed);
    this.sound.setEngine(this.player.speed, this.lastInput.throttle, this.flow.phase !== 'title');
    this.hud.update(dt, {
      speedKmh: this.player.speed * 3.6,
      playerS: this.player.s,
      resetCooldown: this.flow.resetCooldown,
      muted: this.sound.muted,
    });
    this.renderer.render(this.scene, this.camera);
  }
}
