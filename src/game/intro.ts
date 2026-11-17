import * as THREE from 'three';
import { LANE_WIDTH } from '../config';
import type { CameraParams } from '../render/cameraRig';
import type { Centerline } from '../road/centerline';
import { roadEdges } from '../road/mountain';
import type { PlayerCar } from '../vehicles/playerCar';

/** The race's intro shot lists (one picked at random each race, Game.startRace). */
export type IntroKind = 'arrival' | 'grid' | 'details' | 'tracking' | 'skyline' | 'climb' | 'hairpin';
/** The highway's: a flat, straight road, lanes on lanes. */
export const INTRO_KINDS: IntroKind[] = ['arrival', 'grid', 'details', 'tracking'];
/**
 * The mountain road's (its two lanes, its four cars; up into its bends - the highway's, drawn on a flat straight road,
 * had cars and cameras in the rock): from high over its hairpins down to the grid ('skyline'); the cars coming up the
 * straight to the grid ('climb'); the first hairpin's chevron boards blinking, then the grid ('hairpin').
 */
export const MOUNTAIN_INTRO_KINDS: IntroKind[] = ['skyline', 'climb', 'hairpin'];

/** The intros left in this round (shuffled), and the last one shown (the next round never starts with it). */
export interface IntroBag {
  left: IntroKind[];
  last: IntroKind | null;
}

/**
 * The next race's intro: from a shuffled round of all of them, a new round once one is used up (its first not
 * the one just shown) - every one seen once in each round, none twice in a row. A bag with something
 * unknown in it (read back from an older game) starts a fresh round.
 */
export function nextIntro(bag: IntroBag, rng: () => number = Math.random, kinds: IntroKind[] = INTRO_KINDS): { kind: IntroKind; bag: IntroBag } {
  let left = bag.left.every((k) => kinds.includes(k)) ? [...bag.left] : [];
  if (left.length === 0) {
    left = [...kinds];
    for (let i = left.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [left[i], left[j]] = [left[j], left[i]];
    }
    if (left[0] === bag.last) left.push(left.shift()!);
  }
  const [kind, ...rest] = left;
  return { kind, bag: { left: rest, last: kind } };
}

/**
 * A camera pose in the grid's frame: x right, y up from the ground, z ahead (the player's car on the origin). `road`:
 * along the road instead (the mountain road's, up into its bends) - x its d, y up from its surface there, z its s.
 */
interface Pose {
  pos: [number, number, number];
  look: [number, number, number];
  fov: number;
  road?: boolean;
}

/**
 * What a camera rides along with (its pose's z from there, not from the grid): the player's car as drawn
 * arriving ('car'), or where it would be had it not braked ('cruise': on at its even speed).
 */
type Ride = 'car' | 'cruise';

/**
 * A shot: the camera from one pose to another over `seconds` (a cut into it: the shot before ends elsewhere).
 * `blip` seconds in, the engine blipped (a rev and let go: the exhaust pops). `ride` / `lookRide`: what its
 * position / where it looks ride along with (none: held to the grid). `shake`: the camera shaken this much (m: a
 * camera car's at speed).
 */
interface Shot {
  seconds: number;
  from: Pose;
  to: Pose;
  ease: (t: number) => number;
  blip?: number;
  ride?: Ride;
  lookRide?: Ride;
  shake?: number;
  pass?: Pass;
}

/**
 * A car through a bend in a shot (the mountain road's: its headlights lighting the bend up - without one, it was
 * near black): one of the rivals drawn there (its body held on the grid; back on it at the cut). `at`: where it is
 * `t` s into the shot - along the road, across it, and how far its nose is turned in from the way it goes (rad: a
 * drift's). `inside`: the bend's inside (d's sign). `brake`: its brake lights on; `smoke`: its rear tyres smoking.
 */
interface Pass {
  at: (t: number) => { s: number; d: number; slip: number };
  inside: number;
  brake?: boolean;
  smoke?: boolean;
}

/** A puff of tyre smoke at a wheel drawn sliding (Intro.puffs: the game's TireSmoke from them). */
export interface Puff {
  x: number;
  y: number;
  z: number;
  slip: number;
  vx: number;
  vz: number;
  dirX: number;
  dirZ: number;
  omega: number;
  r: number;
}


/**
 * The arrival: every car coming up its own lane at an even speed, braking over the last ARRIVE_BRAKE s to a stop
 * at its place. Each lane its own speed (m/s); each car its own time to stop (s): all still rolling at the first
 * cut (1.5 s), the rivals stopping in the second shot (the pack drawing up), the player's in the third (the
 * close-up). In a lane the back row's car is as fast and stops later than the one ahead, so it stays behind it,
 * the gap only ever opening.
 */
const ARRIVE_SPEED = [12, 17] as const;
const ARRIVE_BRAKE = 2.0; // (0.6-0.85 g: drawing up, not a stop in a hurry - at 1.5, ~1 g, the tails popped up)
/** The braking's load on a body building up over this long (s), as a car's weight comes forward (at once, it bounced). */
const ARRIVE_LOAD_RISE = 0.4;
const ARRIVE_FRONT_STOP = [2.3, 3.0] as const;
const ARRIVE_BACK_LATER = [0.3, 0.8] as const;
/**
 * The player's car stops 0.7 s into its wheel's close-up (the third shot, from 3.0 s): its nose already in the
 * picture at the cut, braking (later, the close-up began on the bare road).
 */
const ARRIVE_PLAYER_STOP = 3.7;

/**
 * The tracking shots: the cars come up as a pack, all at one speed (m/s). The player's brakes 0.1 s into its
 * brake light's close-up (from 2.2 s: the third shot) and stops 0.7 s into its front wheel's (4.2: the fifth); the
 * front row's later by TRACK_FRONT_LATER s (so ~6-9 m behind it as they come: out of the shots alongside it, the
 * one on its left past the camera in the fourth), the back row's TRACK_BACK_LATER s after the one ahead in its
 * lane - every car still by 4.95 s (the countdown at 5).
 */
const TRACK_SPEED = [15, 17] as const;
const TRACK_PLAYER_STOP = 4.2;
const TRACK_FRONT_LATER = [0.4, 0.55] as const;
const TRACK_BACK_LATER = [0.1, 0.2] as const;
/** The fourth shot: the car going by the camera this far into it (s), the cut 0.55 s after (it tearing away up the road). */
const TRACK_PASS = 0.15;
/** The camera between the player's lane and the one on its left (clear of both cars). */
const TRACK_X = -LANE_WIDTH / 2;

/**
 * The braking's load on an arriving car `t` s in (as m/s² of deceleration): its speed shed evenly over
 * ARRIVE_BRAKE s, the load building up over ARRIVE_LOAD_RISE s of it; then none (stopped: it comes back).
 */
function arrivalBraking(speed: number, stop: number, t: number): number {
  const left = stop - t;
  if (left <= 0 || left > ARRIVE_BRAKE) return 0;
  return (speed / ARRIVE_BRAKE) * THREE.MathUtils.smoothstep(ARRIVE_BRAKE - left, 0, ARRIVE_LOAD_RISE);
}

/** Where an arriving car is drawn (m ahead of its place: < 0) `t` s in, at `speed` till it brakes to a stop at `stop` s. */
function arriving(speed: number, stop: number, t: number): number {
  const left = Math.max(0, stop - t);
  return -(left > ARRIVE_BRAKE ? speed * (ARRIVE_BRAKE / 2 + left - ARRIVE_BRAKE) : (speed * left * left) / (2 * ARRIVE_BRAKE));
}
/** The car drifting through the first hairpin (the mountain road's 'skyline'): its speed (m/s), its nose turned in (rad). */
const DRIFT_SPEED = 15;
const DRIFT_SLIP = 0.65;
/** Its shot: straight down from this high (m), sliding this far either side of the middle (m), this long (s). */
const TOP_HEIGHT = 26;
const TOP_SLIDE = 8;
const TOP_SECONDS = 2.7;
/** The car driven round it ('hairpin'): from this far before it (m), at this speed (m/s), braking (m/s²). */
const CRUISE_BACK = 11;
const CRUISE_SPEED = 14;
const CRUISE_BRAKE = 2.5;
const UP = new THREE.Vector3(0, 1, 0);
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const linear = (t: number) => t;

/**
 * Every intro's last shot (round into the chase camera's place) is this long (s); the countdown starts this far
 * into it, the camera still settling (the intros' shots before it 4.5 s: the countdown at 5 s each).
 */
const LAST_SHOT = 2.0;
const COUNTDOWN_INTO = 0.5;

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
  /** The road (the mountain road's intros: their shots along it). */
  road?: Centerline;
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
  /** The car drawn through a bend (a shot's Pass), its body's height over the road; its rear tyres' smoke now. */
  private readonly passCar: PlayerCar | null;
  private readonly passRide: number = 0;
  private passPuffs: Puff[] = [];

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
    // Each lane's speed (the tracking shots: the pack's one); the front row's stops (the player's: the end of the
    // first two shots; tracking, into the third), then the back row's.
    const within = ([lo, hi]: readonly [number, number]) => lo + Math.random() * (hi - lo);
    const lane = (x: number) => Math.round(x / LANE_WIDTH);
    const tracking = kind === 'tracking';
    const pack = within(TRACK_SPEED);
    const speeds = new Map<number, number>();
    const speedOf = (x: number) => (tracking ? pack : (speeds.get(lane(x)) ?? speeds.set(lane(x), within(ARRIVE_SPEED)).get(lane(x))!));
    const playerStop = tracking ? TRACK_PLAYER_STOP : ARRIVE_PLAYER_STOP;
    const frontStop = () => (tracking ? playerStop + within(TRACK_FRONT_LATER) : within(ARRIVE_FRONT_STOP));
    const stops = new Map<number, number>([[0, playerStop]]); // the front row's, by lane
    this.playerArrival = { speed: speedOf(0), stop: playerStop };
    const front = this.rivalsAt.map((g, i) => [g, i] as const).filter(([g]) => g[2] >= -1);
    const back = this.rivalsAt.map((g, i) => [g, i] as const).filter(([g]) => g[2] < -1);
    this.arrivals = [];
    for (const [g, i] of front) {
      this.arrivals[i] = { speed: speedOf(g[0]), stop: frontStop() };
      stops.set(lane(g[0]), this.arrivals[i].stop);
    }
    for (const [g, i] of back) {
      const ahead = stops.get(lane(g[0])) ?? (tracking ? playerStop + TRACK_FRONT_LATER[1] : ARRIVE_FRONT_STOP[1]);
      this.arrivals[i] = { speed: speedOf(g[0]), stop: ahead + within(tracking ? TRACK_BACK_LATER : ARRIVE_BACK_LATER) };
    }
    // (the back row's car on the left: in none of the grid's shots up close)
    const road = scene.road;
    const pick = this.rivalsAt.findIndex((g) => g[0] < -1 && g[2] < -1);
    const i = pick >= 0 ? pick : 0;
    this.passCar = road && scene.rivals.length ? scene.rivals[i] : null;
    if (road && this.passCar) {
      const [x, y, z] = this.rivalsAt[i];
      this.passRide = y - road.surfaceHeight(scene.player.s + z, scene.player.d + x);
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
    if (this.drawnArriving) {
      // Drawn arriving, their brake lights on while they brake.
      const braking = (a: { stop: number }) => a.stop - this.elapsed > 0 && a.stop - this.elapsed <= ARRIVE_BRAKE;
      car.showOffset = arriving(this.playerArrival.speed, this.playerArrival.stop, this.elapsed);
      car.showBrake = braking(this.playerArrival);
      this.scene.rivals.forEach((r, i) => {
        r.showOffset = arriving(this.arrivals[i].speed, this.arrivals[i].stop, this.elapsed);
        r.showBrake = braking(this.arrivals[i]);
      });
    }
    if (!done && s.blip !== undefined && this.t >= s.blip && this.blipAt === null) this.blipAt = 0;
    else if (this.blipAt !== null) this.blipAt += dt;
    car.showRev = this.blipAt === null ? null : this.rev(this.blipAt);
    this.passPuffs = [];
    if (this.passCar) {
      if (!done && s.pass) this.drawPass(this.passCar, s.pass, this.t);
      else {
        this.passCar.showPose = null;
        this.passCar.showBrake = null;
      }
    }
    if (done) this.end();
    return done;
  }

  /** The tyre smoke of the car drawn through a bend, this frame (none: no such car, or it is not sliding). */
  puffs(): Puff[] {
    return this.passPuffs;
  }

  /** `car` drawn where `pass` has it `t` s into its shot: on the road, its nose turned in by the slip, steering. */
  private drawPass(car: PlayerCar, pass: Pass, t: number): void {
    const road = this.scene.road!;
    const point = (s: number, d: number) => {
      const w = road.toWorld(s, d);
      return new THREE.Vector3(w.x, road.surfaceHeight(s, d), w.z);
    };
    const now = pass.at(t);
    const before = pass.at(t - 0.02);
    const after = pass.at(t + 0.02);
    const go = point(after.s, after.d).sub(point(before.s, before.d)); // (the way it goes, uphill or down)
    const speed = go.length() / 0.04;
    go.normalize();
    const at = point(now.s, now.d);
    const inward = point(now.s, now.d + pass.inside).sub(at).setY(0).normalize();
    const fwd = go.clone().multiplyScalar(Math.cos(now.slip)).addScaledVector(inward, Math.sin(now.slip)).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd);
    const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd.clone().negate()));
    at.y += this.passRide;
    // Steering into the bend (as far as it turns), less a drift's countersteer (its wheels on round toward the way
    // it goes). (+: left)
    const p = car.params;
    const into = Math.atan(p.wheelbase * Math.abs(road.curvature(now.s))) - 0.8 * now.slip;
    const steer = (inward.dot(right) < 0 ? 1 : -1) * THREE.MathUtils.clamp(into, -0.55, 0.6);
    car.showPose = { pos: at, quat, rolled: now.s, steer };
    car.showBrake = pass.brake ?? null;
    if (!pass.smoke || now.slip < 0.15) return;
    // Its rear tyres (the last two) sliding sideways: as fast as it goes across them; spinning on (driven).
    for (const w of car.wheels.slice(2)) {
      const c = new THREE.Vector3(w.x, -this.passRide, w.z).applyQuaternion(quat).add(at);
      this.passPuffs.push({
        x: c.x,
        y: c.y,
        z: c.z,
        slip: speed * Math.sin(now.slip) + 3,
        vx: go.x * speed,
        vz: go.z * speed,
        dirX: fwd.x,
        dirZ: fwd.z,
        omega: (speed * 1.4) / p.wheelRadius,
        r: p.wheelRadius,
      });
    }
  }

  /**
   * The arriving cars' braking now (m/s² each; none but in the arrival): for their bodies to take its load on
   * their own springs (PlayerCar.brakeLoad, before each physics step) - drawn arriving, held on the grid.
   */
  braking(): [PlayerCar, number][] {
    if (!this.drawnArriving) return [];
    const t = this.elapsed;
    return [
      [this.scene.player, arrivalBraking(this.playerArrival.speed, this.playerArrival.stop, t)],
      ...this.scene.rivals.map((r, i) => [r, arrivalBraking(this.arrivals[i].speed, this.arrivals[i].stop, t)] as [PlayerCar, number]),
    ];
  }

  /** Whether the cars are drawn arriving (and braking to their places). */
  private get drawnArriving(): boolean {
    return this.kind === 'arrival' || this.kind === 'tracking' || this.kind === 'climb';
  }

  /** How far a camera riding along with `ride` is from the grid now (m ahead: < 0 behind). */
  private along(ride: Ride | undefined): number {
    if (!ride) return 0;
    const { speed, stop } = this.playerArrival;
    return ride === 'car' ? arriving(speed, stop, this.elapsed) : -speed * (stop - ARRIVE_BRAKE / 2 - this.elapsed);
  }

  /** The camera where this frame's shot has it. */
  placeCamera(): void {
    const s = this.shots[Math.min(this.shot, this.shots.length - 1)];
    const k = this.shot >= this.shots.length ? 1 : s.ease(this.t / s.seconds);
    const lerp = (a: number[], b: number[]) => [0, 1, 2].map((i) => THREE.MathUtils.lerp(a[i], b[i], k));
    const cam = this.scene.camera;
    if (s.from.road || s.to.road) {
      // Along the road: between two of its poses, along it (round its bends); from one to the grid's, in the world.
      const both = !!s.from.road && !!s.to.road;
      const at = (p: number[], road: boolean | undefined) => (road ? this.roadWorld(p) : this.world(p));
      const pos = both ? this.roadWorld(lerp(s.from.pos, s.to.pos)) : at(s.from.pos, s.from.road).lerp(at(s.to.pos, s.to.road), k);
      const look = both ? this.roadWorld(lerp(s.from.look, s.to.look)) : at(s.from.look, s.from.road).lerp(at(s.to.look, s.to.road), k);
      cam.position.copy(pos);
      cam.lookAt(look);
    } else {
      const pos = lerp(s.from.pos, s.to.pos);
      const look = lerp(s.from.look, s.to.look);
      pos[2] += this.along(s.ride);
      look[2] += this.along(s.lookRide);
      if (s.shake) {
        // A camera car's shake: a few quick sines out of step (never the same twice in a second).
        const e = this.elapsed;
        pos[0] += s.shake * (Math.sin(e * 29) + 0.6 * Math.sin(e * 47 + 1.3) + 0.3 * Math.sin(e * 83 + 2.1)) / 1.9;
        pos[1] += s.shake * (Math.sin(e * 37 + 0.7) + 0.6 * Math.sin(e * 59 + 2.4) + 0.3 * Math.sin(e * 97 + 0.4)) / 1.9;
      }
      cam.position.copy(this.world(pos));
      cam.lookAt(this.world(look));
    }
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
    car.showBrake = null;
    for (const r of this.scene.rivals) {
      r.showOffset = 0;
      r.showBrake = null;
      r.showPose = null;
    }
    this.passPuffs = [];
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

  /** A road pose's point in the world: (d, up from its surface there, s). */
  private roadWorld([d, h, s]: number[]): THREE.Vector3 {
    const road = this.scene.road!;
    const w = road.toWorld(s, d);
    return new THREE.Vector3(w.x, road.surfaceHeight(s, d) + h, w.z);
  }

  /** Grid coordinates of a world point. */
  private grid(p: THREE.Vector3): [number, number, number] {
    const dx = p.x - this.origin.x;
    const dz = p.z - this.origin.z;
    return [dx * this.right.x + dz * this.right.z, p.y, dx * this.ahead.x + dz * this.ahead.z];
  }

  /** The shots of `kind`, the car's centre `carY` up. */
  private script(kind: IntroKind, carY: number): Shot[] {
    if (MOUNTAIN_INTRO_KINDS.includes(kind)) return this.mountainScript(kind, carY);
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
    if (kind === 'tracking') {
      // Tracking, cut as a film's: long lenses close in, short shots cut on what happens. The pack from far back
      // and up (its tail lights in a row on the dark road); low on the player's rear wheel, riding along (the road
      // streaming by, the camera car shaking); its brake light, coming on; a rival tearing past the camera, the
      // player's car braking ahead; its front wheel rolling to a stop as its nose dives; then up behind it.
      // (Never ahead of a car looking back: its headlights white the picture out.)
      const L = p.length / 2;
      // The car tearing past in the fourth shot: the rival in the front row nearest the player's left (else right),
      // else the player's; the camera between its lane and the player's, still, where it is TRACK_PASS s in.
      const front = this.rivalsAt.map((g, i) => ({ x: g[0], z: g[2], ...this.arrivals[i] })).filter((g) => g.z >= -1);
      const left = front.filter((g) => g.x < 0).sort((a, b) => b.x - a.x);
      const right = front.filter((g) => g.x > 0).sort((a, b) => a.x - b.x);
      const passer = left[0] ?? right[0] ?? { x: 0, z: 0, ...this.playerArrival };
      const passAt = 1.3 + 0.8 + 0.7 + TRACK_PASS;
      const passZ = passer.z + arriving(passer.speed, passer.stop, passAt);
      const passX = passer.x === 0 ? TRACK_X : passer.x / 2;
      const wheelStop: Pose = { pos: [-track - 1.2, 0.33, half - 1.1], look: [-track, r + 0.05, half], fov: 30 };
      return [
        {
          // From far back and up, on a long lens, riding along with the pack.
          seconds: 1.3,
          from: { pos: [-8, 5, -46], look: [1.5, 0.4, -9], fov: 18 },
          to: { pos: [-7.2, 4.6, -43], look: [1.5, 0.4, -7], fov: 17 },
          ease: linear, // (still moving at the cut)
          ride: 'cruise',
          lookRide: 'cruise',
        },
        {
          // Low on its left rear wheel, riding along (between its lane and the left one's rival, behind).
          seconds: 0.8,
          from: { pos: [-2.0, 0.3, -4.6], look: [-track, r + 0.05, -half + 0.2], fov: 24 },
          to: { pos: [-1.95, 0.32, -4.2], look: [-track, r + 0.05, -half + 0.2], fov: 23 },
          ease: linear,
          ride: 'car',
          lookRide: 'car',
          shake: 0.01,
        },
        {
          // Its left brake light close up, coming on 0.1 s in.
          seconds: 0.7,
          from: { pos: [-1.25, 0.85, -L - 1.9], look: [-0.55, 0.72, -L + 0.1], fov: 22 },
          to: { pos: [-1.15, 0.83, -L - 1.55], look: [-0.55, 0.72, -L + 0.1], fov: 21 },
          ease: linear,
          ride: 'car',
          lookRide: 'car',
          shake: 0.006,
        },
        {
          // Low and wide, still, looking up the road: the rival tearing past (the player's car braking ahead).
          seconds: 0.7,
          from: { pos: [passX, 0.5, passZ - 0.3], look: [passer.x * 0.75, 0.7, passZ + 14], fov: 52 },
          to: { pos: [passX, 0.52, passZ - 0.2], look: [passer.x * 0.75, 0.7, passZ + 14], fov: 50 },
          ease: linear,
          shake: 0.012,
        },
        {
          // Low beside and behind where its front wheel stops: the wheel rolling in, its nose diving, still.
          seconds: 1.0,
          from: { pos: [-track - 1.35, 0.3, half - 1.4], look: [-track, r, half], fov: 32 },
          to: wheelStop,
          ease: linear, // (still moving at the cut)
        },
        {
          seconds: LAST_SHOT,
          from: wheelStop,
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

  /**
   * The mountain road's shots (MOUNTAIN_INTRO_KINDS), the car's centre `carY` up: the grid on the straight before the
   * road's start (level: the cars drawn arriving as on the highway), the bends' shots along the road (Pose.road).
   * (Never ahead of a car looking back at it, low: its headlights white the picture out.)
   */
  private mountainScript(kind: IntroKind, carY: number): Shot[] {
    const road = this.scene.road!;
    const edges = roadEdges(road);
    const car = this.scene.player;
    const p = car.params;
    const c = this.scene.chase;
    const chase: Pose = { pos: [0, carY + c.height, -c.distance], look: [0, carY + 0.9, c.lookAhead], fov: c.fovMin };
    const s0 = car.s;
    const d0 = car.d;
    // (the grid's frame: the other lane's x, the road's middle, its edges)
    const other = -2 * d0;
    const middle = -d0;
    const leftEdge = -edges.at(s0, -1) - d0;
    const rightEdge = edges.at(s0, 1) - d0;
    // The first hairpin up the road (tighter than R 26), and which way it turns (+1 right).
    let from = -1;
    let to = -1;
    for (let s = Math.max(0, s0); s < road.length; s += 1) {
      const tight = Math.abs(road.curvature(s)) > 1 / 26;
      if (tight && from < 0) from = s;
      else if (!tight && from >= 0) {
        to = s;
        break;
      }
    }
    if (from < 0 || to < 0) [from, to] = [s0 + 120, s0 + 160];
    const dir = Math.sign(road.curvature((from + to) / 2)) || 1;
    const mid = (from + to) / 2;
    const r = p.wheelRadius;
    const half = p.wheelbase / 2;
    const track = Math.abs(car.wheels[0].x);
    const smooth = THREE.MathUtils.smoothstep;
    // A car drifting through the hairpin (DRIFT_SPEED, through its middle halfway through the shot): in from the
    // outside before it, then one line round it near its inside (as its middle's edge has it: a hairpin is widened on
    // its inside, its middle line drawn between them), out to the outside after it; its nose turned in DRIFT_SLIP.
    // (Swung out-in-out within the bend, the car's line ran near straight at the middle: its body turned back the
    // other way for a moment, -31 deg/s against a round's +40. On one line it turns round evenly.)
    const lineIn = dir * (edges.at(mid, dir as 1 | -1) - 2.2);
    const lineOut = -dir * (edges.at(from, -dir as 1 | -1) - 1.6);
    const drift = (seconds: number): Pass => ({
      at: (t) => {
        const s = mid + DRIFT_SPEED * (t - seconds / 2);
        const slip = DRIFT_SLIP * smooth(s, from - 12, from + 2) * (1 - smooth(s, to - 2, to + 12));
        const into = smooth(s, from - 20, from) * (1 - smooth(s, to, to + 20));
        return { s, d: THREE.MathUtils.lerp(lineOut, lineIn, into), slip };
      },
      inside: dir,
      smoke: true,
    });

    if (kind === 'skyline') {
      // Straight down on the first hairpin's middle (its outside up the picture: an arch), sliding along it as a car
      // drifts through under it (its headlights lighting the bend up: without one, near black); diving down the road
      // to over the grid, looking down on it; then low behind the cars, their tail lights in a row.
      const behind: Pose = { pos: [middle + 0.2, 1.4, -20], look: [middle, 0.8, 0], fov: 40 };
      // (the middle between its edges: a hairpin is widened on its inside)
      const dMid = (dir * (edges.at(mid, dir as 1 | -1) - edges.at(mid, -dir as 1 | -1))) / 2;
      const apex = this.roadWorld([dMid, 0, mid]);
      const along = this.roadWorld([dMid, 0, mid + 1]).sub(apex).setY(0).normalize();
      const inward = this.roadWorld([dMid + dir, 0, mid]).sub(apex).setY(0).normalize();
      // (over a point a little inside the middle, `x` m along the way the road goes there; looking down, tipped
      // a hair outward - straight down, which way is up the picture is not set)
      const above = (x: number, fov: number): Pose => {
        const at = apex.clone().addScaledVector(inward, 4).addScaledVector(along, x);
        const look = at.clone().addScaledVector(inward, -0.4);
        return { pos: this.grid(at.setY(apex.y + TOP_HEIGHT)), look: this.grid(look), fov };
      };
      return [
        {
          seconds: TOP_SECONDS,
          from: above(-TOP_SLIDE, 42),
          to: above(TOP_SLIDE, 42),
          ease: linear, // (still moving at the cut)
          pass: drift(TOP_SECONDS),
        },
        {
          // (from 40 m up the road, not 80: over the 1.2 s it has now, ~60 m/s was a blur)
          seconds: 1.2,
          from: { pos: [0, 22, s0 + 40], look: [0, 0, s0 + 8], fov: 44, road: true },
          to: { pos: [d0 / 2, 14, s0 + 6], look: [d0 / 2, 0, s0 - 6], fov: 44, road: true },
          ease: linear, // (still moving at the cut)
        },
        {
          seconds: 0.6,
          from: { pos: [middle, 1.6, -24], look: [middle, 0.8, 0], fov: 40 },
          to: behind,
          ease: linear, // (still moving at the cut)
        },
        { seconds: LAST_SHOT, from: behind, to: chase, ease: easeOut },
      ];
    }
    if (kind === 'climb') {
      // The cars coming up the straight to the grid, each in its lane (as the highway's arrival, on the mountain
      // road's two): on the left shoulder behind the grid as they come by, on up the road away from it (past the rail,
      // low, its posts filled the picture and a car going by close blacked half of it); up on the right behind them as
      // they draw up; the player's front wheel rolling to a stop; then up behind it.
      const wheel: [number, number, number] = [-track, r, half];
      const stopped: Pose = { pos: [wheel[0] - 1.15, 0.45, wheel[2] - 0.8], look: [wheel[0] + 0.2, r + 0.1, wheel[2]], fov: 34 };
      return [
        {
          seconds: 1.5,
          from: { pos: [leftEdge + 0.4, 1.1, -36], look: [other / 2, 0.8, -6], fov: 38 },
          to: { pos: [leftEdge + 0.45, 1.15, -34], look: [other / 2, 0.8, -6], fov: 35 },
          ease: linear, // (still moving at the cut)
        },
        {
          seconds: 1.5,
          from: { pos: [rightEdge + 2.5, 3.6, -15], look: [other / 2, 0.4, -2], fov: 40 },
          to: { pos: [rightEdge + 2.2, 3.3, -12], look: [other / 2, 0.4, -2], fov: 38 },
          ease: linear, // (still moving at the cut)
        },
        {
          seconds: 1.5,
          from: { pos: [wheel[0] - 1.35, 0.3, wheel[2] - 1.3], look: [...wheel], fov: 36 },
          to: { pos: [wheel[0] - 1.2, 0.32, wheel[2] - 1.0], look: [...wheel], fov: 34 },
          ease: linear, // (still moving at the cut)
        },
        { seconds: LAST_SHOT, from: stopped, to: chase, ease: easeOut },
      ];
    }
    // The first hairpin: low by its outside's chevron boards, their lamps blinking, looking round it; then the grid
    // low between the lanes from behind (four cars' tail lights); the exhaust popping (a blip); its tail light; out.
    const out = -dir;
    const edgeOut = edges.at(from, out as 1 | -1);
    const tips = (car.mesh.userData.exhausts ?? []) as THREE.Vector3[];
    const tip: [number, number, number] = tips.length ? [tips[0].x, carY + tips[0].y, -tips[0].z] : [0.5, 0.35, -p.length / 2];
    const tail: Pose = { pos: [-1.3, 0.42, -p.length / 2 - 2.3], look: [0, 0.6, -p.length / 2 + 0.4], fov: 34 };
    return [
      {
        seconds: 2.6,
        from: { pos: [out * (edgeOut - 0.7), 1.3, from - 7], look: [out * (edgeOut + 0.5), 1.5, from + 0.35 * (to - from)], fov: 42, road: true },
        to: { pos: [out * (edgeOut - 0.7), 1.3, from - 4], look: [out * (edgeOut + 0.5), 1.5, from + 0.35 * (to - from)], fov: 40, road: true },
        ease: linear, // (still moving at the cut)
        // A car coming up its lane from behind the camera, braking into the hairpin, by it and on round it.
        pass: {
          at: (t) => ({ s: from - CRUISE_BACK + CRUISE_SPEED * t - (CRUISE_BRAKE * t * t) / 2, d: d0, slip: 0 }),
          inside: dir,
          brake: true,
        },
      },
      {
        seconds: 0.9,
        from: { pos: [middle, 0.55, -17], look: [middle, 0.75, 4], fov: 34 },
        to: { pos: [middle, 0.55, -14], look: [middle, 0.75, 4], fov: 33 },
        ease: linear, // (still moving at the cut)
      },
      {
        seconds: 0.6,
        from: { pos: [tip[0] + 0.9, tip[1] + 0.18, tip[2] - 1.6], look: [...tip], fov: 30 },
        to: { pos: [tip[0] + 0.75, tip[1] + 0.15, tip[2] - 1.35], look: [...tip], fov: 28 },
        ease: linear, // (still moving at the cut)
        blip: 0.1,
      },
      {
        seconds: 0.4,
        from: tail,
        to: { ...tail, pos: [-1.1, 0.42, -p.length / 2 - 2.1] },
        ease: linear, // (still moving at the cut)
      },
      { seconds: LAST_SHOT, from: { ...tail, pos: [-1.1, 0.42, -p.length / 2 - 2.1] }, to: chase, ease: easeOut },
    ];
  }
}
