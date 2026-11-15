import { LANE_WIDTH } from '../config';
import { bend, Centerline, easeTwice, type GradePiece, type Piece, straight } from './centerline';

/**
 * The mountain road: two lanes (ours d > 0, the other way's d < 0 - no traffic: all of it to race on), a rock wall
 * on one side and a railed cliff on the other; tight bends and hairpins, climbs and descents, laid out at random each
 * race. Lengths in m, angles in degrees, grades rise over run.
 */
export const MOUNTAIN = {
  /** The race (about a minute and a half at a mountain road's pace). */
  length: 3500,
  /** The asphalt's half width (two lanes). */
  halfWidth: LANE_WIDTH,
  /** The wall's and the rail's d (either side): the asphalt plus a narrow shoulder. */
  edge: LANE_WIDTH + 1,
  /** Straight and level off the grid, and into the finish. */
  startStraight: 60,
  endStraight: 80,
  /** Hairpins: radius, turn, clothoids in and out. */
  hairpinR: [15, 25] as [number, number],
  hairpinAngle: [150, 180] as [number, number],
  hairpinEase: [8, 15] as [number, number],
  /** A hairpin's chance among the elements (raised once the road is half laid without two of them), and their most. */
  hairpinChance: 0.2,
  maxHairpins: 6,
  /** After a hairpin, the chance of another the other way after a short straight (a switchback). */
  switchbackChance: 0.65,
  switchbackStraight: [40, 120] as [number, number],
  /** Other bends: radius, turn, clothoids (at most half the bend). */
  bendR: [30, 150] as [number, number],
  bendAngle: [25, 110] as [number, number],
  ease: [10, 40] as [number, number],
  /** The chance of the next bend turning the other way (an S), and of a straight before a bend, its length. */
  alternate: 0.7,
  straightChance: 0.45,
  straight: [10, 120] as [number, number],
  /** Grades: each climb or descent this steep, held this long; the vertical curve between two grades this long per unit change. */
  grade: [0.04, 0.1] as [number, number],
  hold: [150, 450] as [number, number],
  vcurvePerGrade: [500, 900] as [number, number],
  vcurveMin: 30,
  /** The chance a climb is followed by a descent (and the other way). */
  gradeFlip: 0.75,
  /**
   * Its bends banked into them (Centerline.crossSlope): `max` (rad) from `full` curvature on, less in proportion below
   * (R 150: 8°), eased in and out over `ease` m. 12° (the player's: more; 8° at first): about 0.21 g more cornering,
   * and the car leaned into the bend, not out. R 100 and tighter (not only the hairpins: R 40 at first): at 150 km/h
   * R 100 needs 1.77 g, and half the big bends (R 60-150) are tighter. The ease as long as the bank is steep: the
   * edge's rise over it what it was at 8° over 20 m (a short ease made a step in the road the player saw).
   */
  bank: { max: (12 * Math.PI) / 180, full: 1 / 100, ease: 30 },
  /**
   * A shoulder on the tight bends' outside (roadEdges; the player's): the road `max` m wider there from `full`
   * curvature on (R 30: the hairpins, the tightest bends), none below `from` (R 80), in proportion between; eased in
   * and out over `ease` m (its edge never turning more than max / ease off the road's line). The inside as it was.
   */
  shoulder: { max: 3, from: 1 / 80, full: 1 / 30, ease: 30 },
  /** Parts of the road more than `sepArc` apart along it keep `minSep` apart (its centre line), the run-up before it and past the finish too. */
  minSep: 24,
  sepArc: 70,
  before: 100,
  after: 500,
};

type Rand = () => number;
const within = (rand: Rand, [lo, hi]: [number, number]) => lo + rand() * (hi - lo);
const RAD = Math.PI / 180;

/** Sample spacing for the clearance check (m). */
const CHECK_STEP = 5;
/** Tries at one element before the road is started afresh, and at a whole road. */
const ELEMENT_TRIES = 20;
const ROAD_TRIES = 200;

/** A random mountain road (`rand`: uniform in [0, 1)): the same `rand` sequence, the same road. */
export function mountainRoad(rand: Rand): Centerline {
  for (let i = 0; i < ROAD_TRIES; i++) {
    const pieces = layOut(rand);
    if (pieces) return new Centerline(pieces, { grades: profile(rand), turnBack: true, bank: MOUNTAIN.bank });
  }
  throw new Error('mountainRoad: no road laid out clear of itself');
}

interface Element {
  pieces: Piece[];
  len: number;
  hairpin: boolean;
  dir: number;
}

/** The plan: straight off the grid, then bends, hairpins and straights to the finish's straight, never near itself; null: start again. */
function layOut(rand: Rand): Piece[] | null {
  const M = MOUNTAIN;
  const pieces: Piece[] = [...straight(M.startStraight)];
  let s = M.startStraight;
  const last = M.length - M.endStraight;
  let hairpins = 0;
  let dir = rand() < 0.5 ? 1 : -1;
  const queue: Element[] = [];
  while (last - s > 1e-6) {
    const room = last - s;
    let placed: Element | null = null;
    for (let t = 0; t < ELEMENT_TRIES && !placed; t++) {
      let el = queue.length ? queue[0] : draw(rand, s, hairpins, dir);
      if (el.len > room) {
        queue.length = 0;
        if (room > 40 && t < ELEMENT_TRIES - 1) continue;
        el = { pieces: straight(room), len: room, hairpin: false, dir };
      }
      if (clear([...pieces, ...el.pieces], s, s + el.len)) placed = el;
      else queue.length = 0;
    }
    if (!placed) return null;
    if (queue.length && queue[0] === placed) queue.shift();
    pieces.push(...placed.pieces);
    s += placed.len;
    if (placed.dir !== 0) dir = placed.dir;
    if (placed.hairpin) {
      hairpins++;
      if (rand() < M.switchbackChance && hairpins < M.maxHairpins) {
        const len = within(rand, M.switchbackStraight);
        queue.push({ pieces: straight(len), len, hairpin: false, dir: 0 }, hairpin(rand, -placed.dir));
      }
    }
  }
  if (hairpins < 2) return null;
  pieces.push(...straight(M.endStraight));
  // The finish's straight and the run past it (the finish's show drives on) clear of the road too.
  return clear(pieces, last, M.length + M.after) ? pieces : null;
}

/** The next element: a hairpin, a straight or a bend (the next bend mostly the other way). */
function draw(rand: Rand, s: number, hairpins: number, lastDir: number): Element {
  const M = MOUNTAIN;
  const chance = hairpins < 2 && s > M.length * 0.4 ? 0.6 : M.hairpinChance;
  if (hairpins < M.maxHairpins && rand() < chance) return hairpin(rand, rand() < 0.5 ? 1 : -1);
  if (rand() < M.straightChance) {
    const len = within(rand, M.straight);
    return { pieces: straight(len), len, hairpin: false, dir: 0 };
  }
  const dir = rand() < M.alternate ? -lastDir : lastDir;
  const r = within(rand, M.bendR);
  const angle = within(rand, M.bendAngle);
  const ease = Math.min(within(rand, M.ease), 0.5 * r * angle * RAD);
  return { pieces: bend(r, dir * angle, ease), len: r * angle * RAD + ease, hairpin: false, dir };
}

function hairpin(rand: Rand, dir: number): Element {
  const M = MOUNTAIN;
  const r = within(rand, M.hairpinR);
  const angle = within(rand, M.hairpinAngle);
  const ease = within(rand, M.hairpinEase);
  return { pieces: bend(r, dir * angle, ease), len: r * angle * RAD + ease, hairpin: true, dir };
}

/** Whether the road's stretch from s0 to s1 keeps minSep from every part of it more than sepArc back along it (its run-up before 0 too). */
function clear(pieces: Piece[], s0: number, s1: number): boolean {
  const M = MOUNTAIN;
  const line = new Centerline(pieces, { turnBack: true });
  const old: { s: number; x: number; z: number }[] = [];
  for (let s = -M.before; s < s1 - M.sepArc; s += CHECK_STEP) old.push({ s, ...line.toWorld(s, 0) });
  for (let s = s0; s <= s1 + 1e-6; s += CHECK_STEP) {
    const p = line.toWorld(s, 0);
    for (const q of old) {
      if (s - q.s <= M.sepArc) break;
      if (Math.hypot(p.x - q.x, p.z - q.z) < M.minSep) return false;
    }
  }
  return true;
}

/** The height profile: level off the grid, climbs and descents (mostly one after the other) eased by vertical curves, level into the finish. */
function profile(rand: Rand): GradePiece[] {
  const M = MOUNTAIN;
  const out: GradePiece[] = [{ len: M.startStraight, g: 0 }];
  const endAt = M.length - M.endStraight;
  let s = M.startStraight;
  let g = 0;
  let sign = rand() < 0.5 ? 1 : -1;
  for (;;) {
    const target = sign * within(rand, M.grade);
    const vc = Math.max(M.vcurveMin, Math.abs(target - g) * within(rand, M.vcurvePerGrade));
    const back = Math.max(M.vcurveMin, Math.abs(target) * M.vcurvePerGrade[1]); // (room left to come back to level, at the longest)
    const avail = endAt - s - vc - back;
    if (avail < 60) break;
    const hold = Math.min(within(rand, M.hold), avail);
    out.push({ len: vc, g: target }, { len: hold, g: target });
    s += vc + hold;
    g = target;
    if (rand() < M.gradeFlip) sign = -sign;
  }
  const remaining = endAt - s;
  const vf = Math.min(remaining, Math.max(M.vcurveMin, Math.abs(g) * within(rand, M.vcurvePerGrade)));
  out.push({ len: vf, g: 0 });
  if (remaining - vf > 1e-6) out.push({ len: remaining - vf, g: 0 });
  out.push({ len: M.endStraight, g: 0 });
  return out;
}

/**
 * A point (a camera) kept over the road: within `room` m of its centre line across (between the wall and the rail),
 * at least `lift` m over its surface. `hint`: an s near it (the car it films). Moved in place; whether it was.
 */
export function keepOverRoad(road: Centerline, p: { x: number; y: number; z: number }, hint: number, room: number, lift: number): boolean {
  const at = road.project(p.x, p.z, hint);
  const d = Math.max(-room, Math.min(room, at.d));
  const floor = road.surfaceHeight(at.s, d) + lift;
  if (Math.abs(at.d) <= room && p.y >= floor) return false;
  const w = road.toWorld(at.s, d);
  p.x = w.x;
  p.z = w.z;
  p.y = Math.max(p.y, floor);
  return true;
}

/** wallSide at each of `ss` (ascending), at once: from the curvature's sign there or at the nearest bent one. */
export function wallSides(road: Centerline, ss: number[]): Int8Array {
  const n = ss.length;
  const sign = ss.map((s) => Math.sign(road.curvature(s)));
  const out = new Int8Array(n).fill(1);
  const back = new Float64Array(n).fill(Infinity); // (distance to the last bent one behind, its sign)
  const backSign = new Int8Array(n).fill(1);
  let last = -Infinity;
  let lastSign = 1;
  for (let i = 0; i < n; i++) {
    if (sign[i] !== 0) {
      last = ss[i];
      lastSign = sign[i];
    }
    back[i] = ss[i] - last;
    backSign[i] = lastSign;
  }
  let next = Infinity;
  let nextSign = backSign[n - 1];
  for (let i = n - 1; i >= 0; i--) {
    if (sign[i] !== 0) {
      next = ss[i];
      nextSign = sign[i];
    }
    out[i] = next - ss[i] < back[i] ? nextSign : backSign[i];
  }
  return out;
}

/** Which side the rock wall is on at s (+1: +d, the right): the inside of the bend there or nearest it (the cliff's rail outside). */
export function wallSide(road: Centerline, s: number): 1 | -1 {
  for (let k = 0; k <= 600; k++) {
    for (const t of k === 0 ? [s] : [s - k, s + k]) {
      const c = road.curvature(t);
      if (c > 1e-9) return 1;
      if (c < -1e-9) return -1;
    }
  }
  return 1;
}

/** A road's edges (MOUNTAIN.shoulder): `at(s, side)`, how far from its centre line its edge is on `side` (+1 right, -1 left; m). */
export interface RoadEdges {
  at(s: number, side: 1 | -1): number;
}

/** Sample spacing of the shoulder's width (m), and how far past the road's ends it is worked out (beyond: none). */
const EDGE_STEP = 1;
const EDGES = new WeakMap<Centerline, RoadEdges>();

/**
 * The mountain road's edges: MOUNTAIN.edge either side, and on a tight bend's outside (the side away from its
 * curvature) MOUNTAIN.shoulder's more, eased in and out (Centerline easeTwice, as its bank). Worked out once a road.
 */
export function roadEdges(road: Centerline): RoadEdges {
  const known = EDGES.get(road);
  if (known) return known;
  if (road.straight) return { at: () => MOUNTAIN.edge }; // (no bends: the scenery's road before the first race)
  const S = MOUNTAIN.shoulder;
  const from = MOUNTAIN.before + S.ease;
  const n = Math.ceil((road.length + MOUNTAIN.after + 2 * from) / EDGE_STEP) + 1;
  const right = new Float64Array(n);
  const left = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = road.curvature(i * EDGE_STEP - from);
    const w = S.max * Math.min(1, Math.max(0, (Math.abs(k) - S.from) / (S.full - S.from)));
    if (k < 0) right[i] = w; // (a left bend's outside: its right)
    else if (k > 0) left[i] = w;
  }
  const h = Math.round(S.ease / 2 / EDGE_STEP);
  const widths = { [1]: easeTwice(right, h), [-1]: easeTwice(left, h) } as Record<1 | -1, Float64Array>;
  const edges: RoadEdges = {
    at(s, side) {
      const a = widths[side];
      const x = (s + from) / EDGE_STEP;
      if (x <= 0 || x >= n - 1) return MOUNTAIN.edge;
      const i = Math.floor(x);
      const w = a[i] + (a[i + 1] - a[i]) * (x - i);
      return w > 1e-9 ? MOUNTAIN.edge + w : MOUNTAIN.edge;
    },
  };
  EDGES.set(road, edges);
  return edges;
}
