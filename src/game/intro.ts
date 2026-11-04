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
 * `blip` seconds in, the engine blipped (a rev and let go: the exhaust pops).
 */
interface Shot {
  seconds: number;
  from: Pose;
  to: Pose;
  ease: (t: number) => number;
  blip?: number;
}


/**
 * The arrival: every car coming up its own lane at an even speed, braking over the last ARRIVE_BRAKE s to a stop
 * at its place. Each lane its own speed (m/s); each car its own time to stop (s): all still rolling at the first
 * cut (1.5 s), the rivals stopping in the second shot (the pack drawing up), the player's in the third (the
 * close-up). In a lane the back row's car is as fast and stops later than the one ahead, so it stays behind it,
 * the gap only ever opening.
 */
const ARRIVE_SPEED = [12, 17] as const;
const ARRIVE_BRAKE = 1.5;
const ARRIVE_FRONT_STOP = [2.3, 3.0] as const;
const ARRIVE_BACK_LATER = [0.3, 0.8] as const;
/**
 * The player's car stops 0.7 s into its wheel's close-up (the third shot, from 3.0 s): its nose already in the
 * picture at the cut, braking (later, the close-up began on the bare road).
 */
const ARRIVE_PLAYER_STOP = 3.7;

/** How hard an arriving car is braking `t` s in (m/s²): its speed shed evenly over ARRIVE_BRAKE s, then none. */
function arrivalBraking(speed: number, stop: number, t: number): number {
  const left = stop - t;
  return left > 0 && left <= ARRIVE_BRAKE ? speed / ARRIVE_BRAKE : 0;
}

/** Where an arriving car is drawn (m ahead of its place: < 0) `t` s in, at `speed` till it brakes to a stop at `stop` s. */
function arriving(speed: number, stop: number, t: number): number {
  const left = Math.max(0, stop - t);
  return -(left > ARRIVE_BRAKE ? speed * (ARRIVE_BRAKE / 2 + left - ARRIVE_BRAKE) : (speed * left * left) / (2 * ARRIVE_BRAKE));
}
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const linear = (t: number) => t;

/**
 * Every intro's last shot (round into the chase camera's place) is this long (s); the countdown starts this far
 * into it, the camera still settling (the intros' shots before it 4.5 s: the countdown at 6 s each).
 */
const LAST_SHOT = 2.0;
const COUNTDOWN_INTO = 1.5;

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
  /** Each rival's place (grid coordinates); its arrival (way back, time); the intro's time so far. */
  private readonly rivalsAt: [number, number, number][];
  private readonly arrivals: { speed: number; stop: number }[];
  private readonly playerArrival: { speed: number; stop: number };
  private elapsed = 0;

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
    // Each lane's speed; the front row's stops (the player's: the end of the first two shots), then the back row's.
    const within = ([lo, hi]: readonly [number, number]) => lo + Math.random() * (hi - lo);
    const lane = (x: number) => Math.round(x / LANE_WIDTH);
    const speeds = new Map<number, number>();
    const speedOf = (x: number) => speeds.get(lane(x)) ?? speeds.set(lane(x), within(ARRIVE_SPEED)).get(lane(x))!;
    const stops = new Map<number, number>([[0, ARRIVE_PLAYER_STOP]]); // the front row's, by lane
    this.playerArrival = { speed: speedOf(0), stop: ARRIVE_PLAYER_STOP };
    const front = this.rivalsAt.map((g, i) => [g, i] as const).filter(([g]) => g[2] >= -1);
    const back = this.rivalsAt.map((g, i) => [g, i] as const).filter(([g]) => g[2] < -1);
    this.arrivals = [];
    for (const [g, i] of front) {
      this.arrivals[i] = { speed: speedOf(g[0]), stop: within(ARRIVE_FRONT_STOP) };
      stops.set(lane(g[0]), this.arrivals[i].stop);
    }
    for (const [g, i] of back) {
      const ahead = stops.get(lane(g[0])) ?? ARRIVE_FRONT_STOP[1];
      this.arrivals[i] = { speed: speedOf(g[0]), stop: ahead + within(ARRIVE_BACK_LATER) };
    }
    this.shots = this.script(kind, car.y);
  }

  /** Total length (s). */
  get seconds(): number {
    return this.shots.reduce((a, s) => a + s.seconds, 0);
  }

  /** When the countdown starts (s): COUNTDOWN_INTO the last shot, the camera still coming round into place. */
  get countdownAt(): number {
    return this.seconds - LAST_SHOT + COUNTDOWN_INTO;
  }

  /** Whether the countdown is due (the intro's time past countdownAt). */
  get countdownDue(): boolean {
    return this.elapsed >= this.countdownAt - 1e-6;
  }

  /** `dt` s on: the car's show for this frame. Whether the intro is over. */
  step(dt: number): boolean {
    this.t += dt;
    this.elapsed += dt;
    while (this.shot < this.shots.length && this.t >= this.shots[this.shot].seconds) {
      this.t -= this.shots[this.shot].seconds;
      this.shot++;
      this.blipAt = null;
    }
    const done = this.shot >= this.shots.length;
    const s = this.shots[Math.min(this.shot, this.shots.length - 1)];
    const car = this.scene.player;
    if (this.kind === 'arrival') {
      car.showOffset = arriving(this.playerArrival.speed, this.playerArrival.stop, this.elapsed);
      this.scene.rivals.forEach((r, i) => (r.showOffset = arriving(this.arrivals[i].speed, this.arrivals[i].stop, this.elapsed)));
    }
    if (!done && s.blip !== undefined && this.t >= s.blip && this.blipAt === null) this.blipAt = 0;
    else if (this.blipAt !== null) this.blipAt += dt;
    car.showRev = this.blipAt === null ? null : this.rev(this.blipAt);
    if (done) this.end();
    return done;
  }

  /**
   * The arriving cars' braking now (m/s² each; none but in the arrival): for their bodies to take its load on
   * their own springs (PlayerCar.brakeLoad, before each physics step) - drawn arriving, held on the grid.
   */
  braking(): [PlayerCar, number][] {
    if (this.kind !== 'arrival') return [];
    const t = this.elapsed;
    return [
      [this.scene.player, arrivalBraking(this.playerArrival.speed, this.playerArrival.stop, t)],
      ...this.scene.rivals.map((r, i) => [r, arrivalBraking(this.arrivals[i].speed, this.arrivals[i].stop, t)] as [PlayerCar, number]),
    ];
  }

  /** The camera where this frame's shot has it. */
  placeCamera(): void {
    const s = this.shots[Math.min(this.shot, this.shots.length - 1)];
    const k = this.shot >= this.shots.length ? 1 : s.ease(this.t / s.seconds);
    const lerp = (a: number[], b: number[]) => [0, 1, 2].map((i) => THREE.MathUtils.lerp(a[i], b[i], k));
    const pos = lerp(s.from.pos, s.to.pos);
    const look = lerp(s.from.look, s.to.look);
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
      // Every car coming up its own lane: seen low from the roadside behind the grid as they come by; from up on
      // the right behind them as the pack draws up on the grid; then the player's front wheel rolling to a stop;
      // then up behind it. (Facing the cars' headlights - from ahead of the grid, or turned after them coming -
      // whited the picture out.)
      const wheel: [number, number, number] = [-track, r, half];
      return [
        {
          // (Far enough back that the cars come by in it: they come from ~30-50 m back.)
          seconds: 1.5,
          from: { pos: [-LANE_WIDTH - 2.6, 0.65, -30], look: [-0.5, 0.8, -6], fov: 38 },
          to: { pos: [-LANE_WIDTH - 2.4, 0.7, -28], look: [-0.5, 0.8, -6], fov: 35 },
          ease: linear, // (still moving at the cut)
        },
        {
          seconds: 1.5,
          from: { pos: [2 * LANE_WIDTH + 5, 3.4, -15], look: [LANE_WIDTH / 2, 0.4, -2], fov: 40 },
          to: { pos: [2 * LANE_WIDTH + 4.4, 3.1, -12], look: [LANE_WIDTH / 2, 0.4, -2], fov: 38 },
          ease: linear, // (still moving at the cut)
        },
        {
          // Low beside and behind where its front wheel stops, looking at that: the car's side sweeping in from
          // behind the camera, the wheel rolling into the middle and stopping (from ahead, its headlights glared).
          seconds: 1.5,
          from: { pos: [wheel[0] - 1.35, 0.3, wheel[2] - 1.3], look: [...wheel], fov: 36 },
          to: { pos: [wheel[0] - 1.2, 0.32, wheel[2] - 1.0], look: [...wheel], fov: 34 },
          ease: linear, // (still moving at the cut)
        },
        {
          seconds: LAST_SHOT,
          from: { pos: [wheel[0] - 1.15, 0.45, wheel[2] - 0.8], look: [wheel[0] + 0.2, r + 0.1, wheel[2]], fov: 34 },
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
          seconds: 1.5,
          from: { pos: [mid, 9.5, front + 26], look: [mid, 0, -4], fov: 48 },
          to: { pos: [mid, 7.5, front + 19], look: [mid, 0, -4], fov: 48 },
          ease: linear, // (still moving at the cut)
        },
        {
          seconds: 1.9,
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
          seconds: LAST_SHOT,
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
        seconds: 1.3,
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
        seconds: 1.0,
        from: tail,
        to: { ...tail, pos: [-1.0, 0.42, -p.length / 2 - 2.0] },
        ease: linear, // (still moving at the cut)
      },
      {
        seconds: LAST_SHOT,
        from: { ...tail, pos: [-1.0, 0.42, -p.length / 2 - 2.0] },
        to: chase,
        ease: easeOut, // (in moving, settling where the chase camera starts)
      },
    ];
  }
}
