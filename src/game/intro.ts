import * as THREE from 'three';
import { LANE_WIDTH } from '../config';
import type { CameraParams } from '../render/cameraRig';
import type { PlayerCar } from '../vehicles/playerCar';

/** The race's intro shot lists (one picked at random each race, Game.startRace). */
export type IntroKind = 'arrival' | 'grid' | 'details';
export const INTRO_KINDS: IntroKind[] = ['arrival', 'grid', 'details'];

/** A camera pose in the grid's frame: x right, y up from the ground, z ahead (the player's car on the origin). */
interface Pose {
  pos: [number, number, number];
  look: [number, number, number];
  fov: number;
}

/**
 * A shot: the camera from one pose to another over `seconds` (a cut into it: the shot before ends elsewhere).
 * The player's car drawn `offset` metres ahead of its spot meanwhile (from, to), and `blip` seconds in the
 * engine blipped (a rev and let go: the exhaust pops). The camera can look at where the car is drawn
 * (`follow`: the look's z is added to its offset).
 */
interface Shot {
  seconds: number;
  from: Pose;
  to: Pose;
  ease: (t: number) => number;
  offset?: [number, number];
  offsetEase?: (t: number) => number;
  follow?: boolean;
  blip?: number;
}


/**
 * The arrival: every car coming up its own lane to its place together, as a pack. A rival `z` m behind the line
 * comes from further back by this much a metre (the back row: the gap to the car ahead of it only opening on
 * the way in, never closing); the front row a little behind the player's, by its turn.
 */
const ARRIVAL_SPREAD = 0.05;
const ARRIVAL_STAGGER = 0.04;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const linear = (t: number) => t;

/** A blip: up to this share of the redline, held this long, then let go (the rpm falls back over BLIP_FALL s). */
const BLIP_RPM = 0.8;
const BLIP_HOLD = 0.22;
const BLIP_FALL = 0.7;

/** What the intro sees of the race: the player's car (its spot the grid's origin), the rivals', the chase camera's set-up. */
export interface IntroScene {
  camera: THREE.PerspectiveCamera;
  player: PlayerCar;
  rivals: PlayerCar[];
  chase: CameraParams;
}

/**
 * The race's intro: a few seconds of shots of the cars on the grid before the countdown, ending where the
 * chase camera starts (so it takes over without a jump). It places the camera, and puts the player's car's show
 * on (drawn arriving, its engine blipped). Runs on the race's time.
 */
export class Intro {
  private readonly shots: Shot[];
  private readonly origin = new THREE.Vector3();
  private readonly ahead = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private shot = 0;
  private t = 0;
  private blipAt: number | null = null; // the blip's time so far (s), while it lasts
  private readonly idle: number;
  private readonly redline: number;
  /** Each rival's place (grid coordinates), and how far behind the player's it is (m). */
  private readonly rivalsAt: [number, number, number][];
  private readonly behind: number[];

  constructor(
    readonly kind: IntroKind,
    private readonly scene: IntroScene,
  ) {
    // Where the cars are (their bodies: not as drawn, a show's offset on them).
    const at = (c: PlayerCar) => {
      const t = c.body.translation();
      return new THREE.Vector3(t.x, t.y, t.z);
    };
    const car = at(scene.player);
    const q = scene.player.body.rotation();
    this.origin.set(car.x, 0, car.z);
    this.ahead.set(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)).setY(0).normalize();
    this.right.set(-this.ahead.z, 0, this.ahead.x);
    this.idle = scene.player.params.idleRpm;
    this.redline = scene.player.params.redline;
    this.rivalsAt = scene.rivals.map((r) => this.grid(at(r)));
    this.behind = this.rivalsAt.map((g) => Math.max(0, -g[2]));
    this.shots = this.script(kind, car.y);
  }

  /** Total length (s). */
  get seconds(): number {
    return this.shots.reduce((a, s) => a + s.seconds, 0);
  }

  /** `dt` s on: the car's show for this frame. Whether the intro is over. */
  step(dt: number): boolean {
    this.t += dt;
    while (this.shot < this.shots.length && this.t >= this.shots[this.shot].seconds) {
      this.t -= this.shots[this.shot].seconds;
      this.shot++;
      this.blipAt = null;
    }
    const done = this.shot >= this.shots.length;
    const s = this.shots[Math.min(this.shot, this.shots.length - 1)];
    const k = done ? 1 : this.t / s.seconds;
    const car = this.scene.player;
    car.showOffset = s.offset ? THREE.MathUtils.lerp(s.offset[0], s.offset[1], (s.offsetEase ?? linear)(k)) : 0;
    if (this.kind === 'arrival') {
      this.scene.rivals.forEach((r, i) => {
        const behind = this.behind[i];
        r.showOffset = car.showOffset * (1 + behind * ARRIVAL_SPREAD + (behind > 1 ? 0 : (i + 1) * ARRIVAL_STAGGER));
      });
    }
    if (!done && s.blip !== undefined && this.t >= s.blip && this.blipAt === null) this.blipAt = 0;
    else if (this.blipAt !== null) this.blipAt += dt;
    car.showRev = this.blipAt === null ? null : this.rev(this.blipAt);
    if (done) this.end();
    return done;
  }

  /** The camera where this frame's shot has it. */
  placeCamera(): void {
    const s = this.shots[Math.min(this.shot, this.shots.length - 1)];
    const k = this.shot >= this.shots.length ? 1 : s.ease(this.t / s.seconds);
    const lerp = (a: number[], b: number[]) => [0, 1, 2].map((i) => THREE.MathUtils.lerp(a[i], b[i], k));
    const pos = lerp(s.from.pos, s.to.pos);
    const look = lerp(s.from.look, s.to.look);
    if (s.follow) look[2] += this.scene.player.showOffset;
    const cam = this.scene.camera;
    cam.position.copy(this.world(pos));
    cam.lookAt(this.world(look));
    const fov = THREE.MathUtils.lerp(s.from.fov, s.to.fov, k);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  /** The car's show off (the intro over, or skipped). */
  end(): void {
    const car = this.scene.player;
    car.showOffset = 0;
    car.showRev = null;
    for (const r of this.scene.rivals) r.showOffset = 0;
  }

  /** The blip `t` s in: the rpm up fast and the throttle held, then let go and the rpm falling back. */
  private rev(t: number): { rpm: number; throttle: number } {
    const top = this.idle + (this.redline * BLIP_RPM - this.idle);
    if (t < BLIP_HOLD) return { rpm: this.idle + (top - this.idle) * Math.min(1, t / 0.15), throttle: 1 };
    const fall = Math.min(1, (t - BLIP_HOLD) / BLIP_FALL);
    return { rpm: top + (this.idle - top) * easeOut(fall), throttle: 0 };
  }

  private world([x, y, z]: number[]): THREE.Vector3 {
    return new THREE.Vector3().copy(this.origin).addScaledVector(this.right, x).addScaledVector(this.ahead, z).setY(y);
  }

  /** Grid coordinates of a world point. */
  private grid(p: THREE.Vector3): [number, number, number] {
    const dx = p.x - this.origin.x;
    const dz = p.z - this.origin.z;
    return [dx * this.right.x + dz * this.right.z, p.y, dx * this.ahead.x + dz * this.ahead.z];
  }

  /** The shots of `kind`, the car's centre `carY` up. */
  private script(kind: IntroKind, carY: number): Shot[] {
    const car = this.scene.player;
    const p = car.params;
    const c = this.scene.chase;
    const chase: Pose = { pos: [0, carY + c.height, -c.distance], look: [0, carY + 0.9, c.lookAhead], fov: c.fovMin };
    const r = p.wheelRadius;
    const half = p.wheelbase / 2;
    const track = Math.abs(car.wheels[0].x);
    if (kind === 'arrival') {
      // Every car coming up its own lane together and drawing up on the grid, seen low from the roadside behind it
      // (coming by the camera into the picture); then the player's front wheel rolling to a stop; then up behind it.
      // (Facing the cars' headlights - from ahead of the grid, or turned after them coming - whited it out.)
      const wheel: [number, number, number] = [-track, r, half];
      return [
        {
          seconds: 2.4,
          from: { pos: [-LANE_WIDTH - 2.6, 0.65, -24], look: [-0.5, 0.8, -4], fov: 38 },
          to: { pos: [-LANE_WIDTH - 2.4, 0.7, -22], look: [-0.5, 0.8, -4], fov: 34 },
          ease: linear, // (still moving at the cut)
          offset: [-50, -1.4],
          offsetEase: easeOut,
        },
        {
          seconds: 1.2,
          from: { pos: [wheel[0] - 1.25, 0.3, wheel[2] + 1.1], look: [...wheel], fov: 34 },
          to: { pos: [wheel[0] - 1.05, 0.32, wheel[2] + 0.75], look: [...wheel], fov: 32 },
          ease: linear, // (still moving at the cut)
          offset: [-1.4, 0],
          offsetEase: easeOut,
          follow: true,
        },
        {
          seconds: 1.5,
          from: { pos: [wheel[0] - 1.1, 0.45, wheel[2] + 0.4], look: [wheel[0] + 0.2, r + 0.1, wheel[2]], fov: 34 },
          to: chase,
          ease: easeOut, // (in moving, settling where the chase camera starts)
        },
      ];
    }
    if (kind === 'grid') {
      // The grid from up high ahead, then low along the cars' noses, then the player's car (a blip), then round behind it.
      const xs = [0, ...this.rivalsAt.map((g) => g[0])];
      const zs = [0, ...this.rivalsAt.map((g) => g[2])];
      const left = Math.min(...xs) - 2.5;
      const rightX = Math.max(...xs) + 2.5;
      const front = Math.max(...zs) + 6.5;
      const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
      const hero: Pose = { pos: [2.9, 0.85, 6.2], look: [0, 0.6, 0], fov: 30 };
      return [
        {
          seconds: 1.6,
          from: { pos: [mid, 9.5, front + 26], look: [mid, 0, -4], fov: 48 },
          to: { pos: [mid, 7.5, front + 19], look: [mid, 0, -4], fov: 48 },
          ease: linear, // (still moving at the cut)
        },
        {
          seconds: 2.0,
          from: { pos: [rightX, 0.7, front], look: [rightX - 2.5, 0.6, 0], fov: 44 },
          to: { pos: [left, 0.7, front], look: [left + 2.5, 0.6, 0], fov: 44 },
          ease: linear, // (still moving at the cut)
        },
        {
          seconds: 1.1,
          from: hero,
          to: { ...hero, pos: [2.6, 0.8, 5.5] },
          ease: linear, // (still moving at the cut)
          blip: 0.15,
        },
        {
          seconds: 1.4,
          from: { ...hero, pos: [2.6, 0.8, 5.5] },
          to: chase,
          ease: easeOut, // (in moving, settling where the chase camera starts)
        },
      ];
    }
    // Details: the rear wheel on the wet road, the exhaust popping, along the bonnet, the tail lights; then out.
    const tips = (car.mesh.userData.exhausts ?? []) as THREE.Vector3[];
    const tip: [number, number, number] = tips.length ? [tips[0].x, carY + tips[0].y, -tips[0].z] : [0.5, 0.35, -p.length / 2];
    const rear: [number, number, number] = [track, r, -half];
    const tail: Pose = { pos: [-1.3, 0.42, -p.length / 2 - 2.3], look: [0, 0.6, -p.length / 2 + 0.4], fov: 34 };
    return [
      {
        seconds: 1.1,
        from: { pos: [rear[0] + 1.3, 0.22, rear[2] - 1.1], look: [...rear], fov: 32 },
        to: { pos: [rear[0] + 1.15, 0.24, rear[2] - 0.7], look: [...rear], fov: 30 },
        ease: linear, // (still moving at the cut)
      },
      {
        seconds: 1.2,
        from: { pos: [tip[0] + 0.9, tip[1] + 0.18, tip[2] - 1.6], look: [...tip], fov: 30 },
        to: { pos: [tip[0] + 0.75, tip[1] + 0.15, tip[2] - 1.35], look: [...tip], fov: 28 },
        ease: linear, // (still moving at the cut)
        blip: 0.1,
      },
      {
        // Its front corner, the headlight (along the bonnet the night left it all dark).
        seconds: 1.1,
        from: { pos: [track + 1.5, carY - 0.05, p.length / 2 + 1.4], look: [track - 0.2, carY, p.length / 2 - 0.4], fov: 34 },
        to: { pos: [track + 1.2, carY + 0.05, p.length / 2 + 1.0], look: [track - 0.35, carY, p.length / 2 - 0.5], fov: 32 },
        ease: linear, // (still moving at the cut)
      },
      {
        seconds: 0.9,
        from: tail,
        to: { ...tail, pos: [-1.0, 0.42, -p.length / 2 - 2.0] },
        ease: linear, // (still moving at the cut)
      },
      {
        seconds: 1.3,
        from: { ...tail, pos: [-1.0, 0.42, -p.length / 2 - 2.0] },
        to: chase,
        ease: easeOut, // (in moving, settling where the chase camera starts)
      },
    ];
  }
}
