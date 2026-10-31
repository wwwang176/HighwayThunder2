import * as THREE from 'three';
import { MAX_FRAME_DT, MAX_SUBSTEPS, PHYSICS_DT } from '../config';
import { Keyboard } from '../input/keyboard';
import { EntityRef, PhysicsWorld } from '../physics/physicsWorld';
import { CameraRig } from '../render/cameraRig';
import { PlayerCar } from '../vehicles/playerCar';
import { RoadScene } from '../world/roadScene';
import { HandlingInput } from '../vehicles/handling';

const NO_INPUT: HandlingInput = { throttle: 0, brake: 0, steer: 0 };

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 3000);
  readonly keyboard = new Keyboard();
  readonly rig = new CameraRig(this.camera);
  readonly road: RoadScene;
  readonly player: PlayerCar;
  private accumulator = 0;
  private lastTime = 0;
  /** Overrides keyboard input when set (used by automated checks). */
  inputOverride: HandlingInput | null = null;

  constructor(container: HTMLElement, readonly physics: PhysicsWorld) {
    physics.timestep = PHYSICS_DT;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);
    this.road = new RoadScene(this.scene, this.renderer);
    this.player = new PlayerCar(physics, this.scene);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

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
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= PHYSICS_DT && steps < MAX_SUBSTEPS) {
      this.fixedStep(PHYSICS_DT);
      this.accumulator -= PHYSICS_DT;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) this.accumulator = 0;
    const alpha = this.accumulator / PHYSICS_DT;
    this.render(dt, alpha);
  }

  /** Debug: advance the simulation synchronously (independent of rAF throttling). */
  simulate(seconds: number, input?: HandlingInput): void {
    const prev = this.inputOverride;
    if (input) this.inputOverride = input;
    const n = Math.round(seconds / PHYSICS_DT);
    for (let i = 0; i < n; i++) this.fixedStep(PHYSICS_DT);
    this.inputOverride = prev;
    this.render(PHYSICS_DT, 1);
  }

  private fixedStep(dt: number): void {
    const input = this.inputOverride ?? this.keyboard.driving();
    this.player.prePhysics(input ?? NO_INPUT, dt);
    this.physics.step((a, b) => this.onContact(a, b));
    this.player.postPhysics();
  }

  private onContact(_a: EntityRef, _b: EntityRef): void {}

  private render(dt: number, alpha: number): void {
    this.player.render(alpha);
    const p = this.player.mesh.position;
    this.road.update(-p.z, p.x);
    this.rig.update(dt, p, this.player.yaw, Math.max(0, this.player.speed), this.player.params.maxSpeed);
    this.renderer.render(this.scene, this.camera);
  }
}
