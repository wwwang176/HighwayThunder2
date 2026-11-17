import { LANE_WIDTH } from '../config';
import { bend, Centerline, easeTwice, type GradePiece, type Piece, straight } from './centerline';

/**
 * The mountain road: two lanes (ours d > 0, the other way's d < 0 - no traffic: all of it to race on), a rock wall
 * on one side and a railed cliff on the other; tight bends and hairpins, up a mountain or down it, laid out at random
 * each race. Lengths in m, angles in degrees, grades rise over run.
 */
export const MOUNTAIN = {
  /** The race (about a minute and a half at a mountain road's pace). */
  length: 3500,
  /** The asphalt's half width on a straight (two lanes; wider in the bends: `widen`). */
  halfWidth: LANE_WIDTH,
  /** The wall's and the rail's d (either side) on a straight: the asphalt plus a narrow shoulder. */
  edge: LANE_WIDTH + 1,
  /**
   * The bends wider (roadEdges; the player's: the road 1.5x wide was easier to keep to, but only the bends need it):
   * `by` m more either side from `full` curvature on (R 150: every bend), less in proportion below, eased in and out
   * over `ease` m as the shoulder.
   */
  widen: { by: 0.5 * LANE_WIDTH, full: 1 / 150, ease: 30 },
  /** Straight and level off the grid, and into the finish. */
  startStraight: 60,
  endStraight: 80,
  /** Hairpins: radius, turn, clothoids in and out. */
  hairpinR: [15, 25] as [number, number],
  hairpinAngle: [150, 180] as [number, number],
  hairpinEase: [8, 15] as [number, number],
  /**
   * A hairpin's chance among the elements (raised once the road is half laid without two of them), and their most.
   * (The player's: more bends and hairpins - 0.2, 6, a switchback 0.65 after 40-120 m, a straight 0.45 of 10-120 m:
   * 40 % of it straight, 5.8 hairpins a race; now 26 %, 9.9, other bends 26 -> 36, over 60 roads.)
   */
  hairpinChance: 0.35,
  maxHairpins: 10,
  /** After a hairpin, the chance of another the other way after a short straight (a switchback). */
  switchbackChance: 0.75,
  switchbackStraight: [30, 80] as [number, number],
  /** Other bends: radius, turn, clothoids (at most half the bend). */
  bendR: [30, 150] as [number, number],
  bendAngle: [25, 110] as [number, number],
  ease: [10, 40] as [number, number],
  /** The chance of the next bend turning the other way (an S), and of a straight before a bend, its length. */
  alternate: 0.7,
  straightChance: 0.2,
  straight: [10, 60] as [number, number],
  /**
   * Its rise (the player's: a mountain road goes up, or down - its hairpins there to climb steep ground at a grade a road
   * can take): all one way (up or down at random), `mean` of its length in all (7 %: ~245 m), each part's grade by what
   * it is - the straights between a switchback's hairpins the steepest (`switch`), other straights `straight`, a bend
   * by its radius (`bend`: `steep` at R 30 to `flat` at R 150, give or take `jitter`), the hairpins themselves
   * gentler (`hairpin`: steep, their insides would be steeper still) - then all of them scaled to the mean, none past
   * `most`. Between two parts a vertical curve, `vcurve` m a unit of grade's change (at least `vcurveMin`, at most half
   * the part). Two parts of the road near each other (within `legNear` m, more than sepArc apart along it) no steeper
   * apart than `legSlope` between their edges (else ground between them a cliff): laid out again.
   */
  climb: {
    mean: 0.07,
    most: 0.12,
    switch: [0.1, 0.12] as [number, number],
    straight: [0.06, 0.09] as [number, number],
    bend: { steep: 0.08, flat: 0.04, jitter: 0.01 },
    hairpin: [0.04, 0.06] as [number, number],
    vcurve: 600,
    vcurveMin: 15,
    legSlope: 0.6,
    legNear: 120,
  },
  /**
   * Its bends banked into them (Centerline.crossSlope): `max` (rad) from `full` curvature on, less in proportion below
   * (R 150: 5°), eased in and out over `ease` m. 8° (the player's: 8° at first, then more - 12°, then too steep: less
   * again): about 0.14 g more cornering, and the car leaned into the bend, not out. R 100 and tighter (not only the
   * hairpins: R 40 at first): at 150 km/h R 100 needs 1.77 g, and half the big bends (R 60-150) are tighter. The ease
   * as long as it was at 12° (a short ease made a step in the road the player saw).
   */
  bank: { max: (8 * Math.PI) / 180, full: 1 / 100, ease: 30 },
  /**
   * A shoulder on the tight bends' outside (roadEdges; the player's): the road `max` m wider there from `full`
   * curvature on (R 30: the hairpins, the tightest bends), none below `from` (R 80), in proportion between; eased in
   * and out over `ease` m (its edge never turning more than max / ease off the road's line). The inside as it was.
   */
  shoulder: { max: 3, from: 1 / 80, full: 1 / 30, ease: 30 },
  /**
   * The road a long strip, as the highway's (the player's: wandering round, it came back past itself far higher, the
   * ground between a wall): all of it - past the finish too - within `half` either side of straight ahead from the
   * start (-z), but its first `from` m round the start.
   */
  fan: { half: 25 * (Math.PI / 180), from: 40 },
  /**
   * Keeping in it: a bend turning toward the fan's middle at `follow` odds - its heading toward minus `back` times its
   * bearing (rad: back to the middle) - never left more than `turnMost` off that (rad); a switchback toward the middle
   * at `follow` odds.
   */
  steer: { follow: 0.85, back: 1.5, turnMost: 60 * (Math.PI / 180) },
  /** Parts of the road more than `sepArc` apart along it keep `minSep` apart (its centre line), the run-up before it and past the finish too. */
  minSep: 28, // (24 before the bends were widened: the gap between two legs' edges as it was)
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
    const plan = layOut(rand);
    if (!plan) continue;
    const road = new Centerline(plan.pieces, { grades: climbOf(plan.parts, rand), turnBack: true, bank: MOUNTAIN.bank });
    if (legsApart(road)) return road;
  }
  throw new Error('mountainRoad: no road laid out clear of itself');
}

/** What a part of the road is (its grade by it: climbOf), and a bend's radius. */
type Kind = 'level' | 'straight' | 'switch' | 'bend' | 'hairpin';

interface Element {
  pieces: Piece[];
  len: number;
  hairpin: boolean;
  dir: number;
  kind: Kind;
  r?: number;
  /** A switchback's second hairpin (the first's queued pair: back on the way it was going). */
  second?: boolean;
}

/** Where the road is at s: its heading (rad, + to the right of straight ahead) and its bearing from the start (rad, + right; 0 near it). */
function whereAt(pieces: Piece[], s: number): { th: number; phi: number } {
  const line = new Centerline(pieces, { turnBack: true });
  const p = line.toWorld(s, 0);
  return { th: line.heading(s), phi: Math.hypot(p.x, p.z) < MOUNTAIN.fan.from ? 0 : Math.atan2(p.x, -p.z) };
}

/** The plan: straight off the grid, then bends, hairpins and straights to the finish's straight, never near itself; null: start again. */
function layOut(rand: Rand): { pieces: Piece[]; parts: { len: number; kind: Kind; r?: number }[] } | null {
  const M = MOUNTAIN;
  const pieces: Piece[] = [...straight(M.startStraight)];
  const parts: { len: number; kind: Kind; r?: number }[] = [{ len: M.startStraight, kind: 'level' }];
  let s = M.startStraight;
  const last = M.length - M.endStraight;
  let hairpins = 0;
  let dir = rand() < 0.5 ? 1 : -1;
  const queue: Element[] = [];
  while (last - s > 1e-6) {
    const room = last - s;
    let placed: Element | null = null;
    const at = whereAt(pieces, s);
    for (let t = 0; t < ELEMENT_TRIES && !placed; t++) {
      let el = queue.length ? queue[0] : draw(rand, s, hairpins, dir, at);
      if (el.len > room) {
        queue.length = 0;
        if (room > 40 && t < ELEMENT_TRIES - 1) continue;
        el = { pieces: straight(room), len: room, hairpin: false, dir, kind: 'straight' };
      }
      if (clear([...pieces, ...el.pieces], s, s + el.len)) placed = el;
      else queue.length = 0;
    }
    if (!placed) return null;
    if (queue.length && queue[0] === placed) queue.shift();
    pieces.push(...placed.pieces);
    parts.push({ len: placed.len, kind: placed.kind, r: placed.r });
    s += placed.len;
    if (placed.dir !== 0) dir = placed.dir;
    if (placed.hairpin) {
      hairpins++;
      // (hairpins in pairs - a switchback, back on the way it was going: one alone turned it back down the fan; after a
      // pair, another at switchbackChance)
      const len = within(rand, M.switchbackStraight);
      if (!placed.second) queue.push({ pieces: straight(len), len, hairpin: false, dir: 0, kind: 'switch' }, { ...hairpin(rand, -placed.dir), second: true });
      else if (rand() < M.switchbackChance && hairpins <= M.maxHairpins - 2) queue.push({ pieces: straight(len), len, hairpin: false, dir: 0, kind: 'switch' }, hairpin(rand, -placed.dir));
    }
  }
  if (hairpins < 2) return null;
  pieces.push(...straight(M.endStraight));
  parts.push({ len: M.endStraight, kind: 'level' });
  // The finish's straight and the run past it (the finish's show drives on) clear of the road too.
  return clear(pieces, last, M.length + M.after) ? { pieces, parts } : null;
}

/**
 * The next element: a hairpin (a switchback's first: toward the fan's middle - a pair to the right moves the road
 * right), a straight or a bend - mostly turning toward the fan's middle (its heading toward `steer` x its bearing back
 * to straight ahead), never left more than `turnMost` off that.
 */
function draw(rand: Rand, s: number, hairpins: number, lastDir: number, at: { th: number; phi: number }): Element {
  const M = MOUNTAIN;
  const chance = hairpins < 2 && s > M.length * 0.4 ? 0.6 : M.hairpinChance;
  if (hairpins <= M.maxHairpins - 2 && rand() < chance) {
    const toMiddle = at.phi > 0 ? -1 : at.phi < 0 ? 1 : rand() < 0.5 ? 1 : -1;
    return hairpin(rand, rand() < M.steer.follow ? toMiddle : -toMiddle);
  }
  if (rand() < M.straightChance) {
    const len = within(rand, M.straight);
    return { pieces: straight(len), len, hairpin: false, dir: 0, kind: 'straight' };
  }
  const err = at.th + M.steer.back * at.phi; // (+: heading right of where it should)
  let dir = Math.abs(err) < 5 * RAD ? (rand() < M.alternate ? -lastDir : lastDir) : rand() < M.steer.follow ? -Math.sign(err) : Math.sign(err);
  const r = within(rand, M.bendR);
  let angle = within(rand, M.bendAngle);
  // (no more than turnMost off after it: the other way, or less of a turn)
  if (Math.abs(err + dir * angle * RAD) > M.steer.turnMost) {
    if (Math.abs(err - dir * angle * RAD) <= M.steer.turnMost) dir = -dir;
    else angle = Math.max(M.bendAngle[0], (M.steer.turnMost - Math.abs(err)) / RAD);
  }
  const ease = Math.min(within(rand, M.ease), 0.5 * r * angle * RAD);
  return { pieces: bend(r, dir * angle, ease), len: r * angle * RAD + ease, hairpin: false, dir, kind: 'bend', r };
}

function hairpin(rand: Rand, dir: number): Element {
  const M = MOUNTAIN;
  const r = within(rand, M.hairpinR);
  const angle = within(rand, M.hairpinAngle);
  const ease = within(rand, M.hairpinEase);
  return { pieces: bend(r, dir * angle, ease), len: r * angle * RAD + ease, hairpin: true, dir, kind: 'hairpin', r };
}

/** Whether the road's stretch from s0 to s1 is within the fan (MOUNTAIN.fan) and keeps minSep from every part of it more than sepArc back along it (its run-up before 0 too). */
function clear(pieces: Piece[], s0: number, s1: number): boolean {
  const M = MOUNTAIN;
  const line = new Centerline(pieces, { turnBack: true });
  // (within the fan: ahead of the start, no more than fan.half off straight ahead)
  for (let s = Math.max(0, s0); s <= s1 + 1e-6; s += CHECK_STEP) {
    const p = line.toWorld(s, 0);
    if (Math.hypot(p.x, p.z) < M.fan.from) continue;
    if (-p.z <= 0 || Math.abs(Math.atan2(p.x, -p.z)) > M.fan.half) return false;
  }
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

/**
 * The road's grades (MOUNTAIN.climb): each part's by what it is, all one way - up or down, at random - scaled so it
 * rises (or falls) `mean` of its length in all, none past `most`; a vertical curve into each part at its start (the
 * last into the level finish at the end of the part before it: the finish's straight level throughout).
 */
function climbOf(parts: { len: number; kind: Kind; r?: number }[], rand: Rand): GradePiece[] {
  const C = MOUNTAIN.climb;
  const raw = parts.map((p) => {
    switch (p.kind) {
      case 'level':
        return 0;
      case 'switch':
        return within(rand, C.switch);
      case 'straight':
        return within(rand, C.straight);
      case 'hairpin':
        return within(rand, C.hairpin);
      case 'bend': {
        const u = Math.max(0, Math.min(1, ((p.r ?? 90) - MOUNTAIN.bendR[0]) / (MOUNTAIN.bendR[1] - MOUNTAIN.bendR[0])));
        return C.bend.steep + (C.bend.flat - C.bend.steep) * u + (rand() * 2 - 1) * C.bend.jitter;
      }
    }
  });
  const sign = rand() < 0.5 ? 1 : -1;
  const pieces = (g: number[]) => {
    const out: GradePiece[] = [];
    let prev = 0;
    parts.forEach((p, i) => {
      const next = i + 1 < parts.length ? g[i + 1] : 0;
      const vIn = Math.min(p.len / 2, Math.max(C.vcurveMin, Math.abs(g[i] - prev) * C.vcurve));
      if (parts[i + 1]?.kind === 'level' && i > 0) {
        // (into the level finish: the curve at this part's end)
        const vOut = Math.min(p.len / 2, Math.max(C.vcurveMin, Math.abs(g[i] - next) * C.vcurve));
        out.push({ len: vIn, g: g[i] }, { len: p.len - vIn - vOut, g: g[i] }, { len: vOut, g: next });
      } else if (g[i] === prev) out.push({ len: p.len, g: g[i] });
      else out.push({ len: vIn, g: g[i] }, { len: p.len - vIn, g: g[i] });
      prev = parts[i + 1]?.kind === 'level' ? next : g[i];
    });
    return out;
  };
  const rise = (ps: GradePiece[]) => {
    let h = 0, g0 = 0;
    for (const p of ps) {
      h += ((g0 + p.g) / 2) * p.len;
      g0 = p.g;
    }
    return h;
  };
  // Scaled to the mean rise (a few rounds: those held to `most` leave more to the rest).
  const total = parts.reduce((a, p) => a + p.len, 0);
  let g = raw.slice();
  for (let round = 0; round < 6; round++) {
    const k = (C.mean * total) / Math.max(1e-6, rise(pieces(g)));
    g = g.map((x) => Math.min(C.most, x * k));
  }
  return pieces(g.map((x) => sign * x + 0)); // (+ 0: the level parts 0, not -0, going down)
}

/** Whether parts of the road near each other (MOUNTAIN.climb.legNear) are no steeper apart than legSlope between their edges. */
function legsApart(road: Centerline): boolean {
  const M = MOUNTAIN;
  const pts: { s: number; x: number; z: number; y: number }[] = [];
  for (let s = 0; s <= road.length; s += CHECK_STEP) pts.push({ s, ...road.toWorld(s, 0), y: road.height(s) });
  const e = 2 * (M.edge + M.widen.by + M.shoulder.max / 2);
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      if (pts[j].s - pts[i].s <= M.sepArc) continue;
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
      if (d > M.climb.legNear) continue;
      if (Math.abs(pts[i].y - pts[j].y) > M.climb.legSlope * Math.max(1, d - e)) return false;
    }
  return true;
}

/** A slope off the road reaches on a bend's inside at most this share of its radius from the centre line... */
const INSIDE_SHARE = 0.8;
/** ...its tightest within this far along either way (m: the clothoids into it, its rows' neighbours). */
const INSIDE_ALONG = 30;
const INSIDE_STEP = 2;
const REACHES = new WeakMap<Centerline, (s: number, side: 1 | -1) => number>();

/**
 * How far from the centre line (m) the slopes off the road may reach on `side` at s: on a bend's inside, short of its
 * centre (INSIDE_SHARE of the tightest radius within INSIDE_ALONG m) - past it a row's points fall behind the row
 * before's, its triangles turned over (the player's: broken slopes) - the edge's strip of ground (mountainScene) stops
 * there, the ground's grid (terrain) goes on; elsewhere +Infinity. Worked out once a road.
 */
export function insideReach(road: Centerline): (s: number, side: 1 | -1) => number {
  const known = REACHES.get(road);
  if (known) return known;
  const from = -MOUNTAIN.before - INSIDE_ALONG;
  const n = Math.ceil((road.length + MOUNTAIN.after + INSIDE_ALONG - from) / INSIDE_STEP) + 1;
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) k[i] = road.curvature(from + i * INSIDE_STEP);
  const w = Math.round(INSIDE_ALONG / INSIDE_STEP);
  // The tightest curvature each way within the window (a bend to the right: +, its inside +d).
  const most = { [1]: new Float64Array(n), [-1]: new Float64Array(n) } as Record<1 | -1, Float64Array>;
  for (let i = 0; i < n; i++) {
    let r = 0, l = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) {
      if (k[j] > r) r = k[j];
      if (-k[j] > l) l = -k[j];
    }
    most[1][i] = r;
    most[-1][i] = l;
  }
  const reach = (s: number, side: 1 | -1) => {
    const i = Math.round((s - from) / INSIDE_STEP);
    const c = most[side][Math.max(0, Math.min(n - 1, i))];
    return c > 1e-9 ? INSIDE_SHARE / c : Infinity;
  };
  REACHES.set(road, reach);
  return reach;
}

/** A road's edges (MOUNTAIN.widen, MOUNTAIN.shoulder): `at(s, side)`, how far from its centre line its edge is on `side` (+1 right, -1 left; m). */
export interface RoadEdges {
  at(s: number, side: 1 | -1): number;
  /** How much wider than on a straight the road is at s, either side (MOUNTAIN.widen: the bend's; not the shoulder) (m). */
  widen(s: number): number;
}

/** Sample spacing of the shoulder's width (m), and how far past the road's ends it is worked out (beyond: none). */
const EDGE_STEP = 1;
const EDGES = new WeakMap<Centerline, RoadEdges>();

/**
 * The mountain road's edges: MOUNTAIN.edge either side, wider in a bend (MOUNTAIN.widen, either side), and on a tight
 * bend's outside (the side away from its curvature) MOUNTAIN.shoulder's more, eased in and out (Centerline easeTwice,
 * as its bank). Worked out once a road.
 */
export function roadEdges(road: Centerline): RoadEdges {
  const known = EDGES.get(road);
  if (known) return known;
  if (road.straight) return { at: () => MOUNTAIN.edge, widen: () => 0 }; // (no bends: the scenery's road before the first race)
  const S = MOUNTAIN.shoulder, W = MOUNTAIN.widen;
  const from = MOUNTAIN.before + Math.max(S.ease, W.ease);
  const n = Math.ceil((road.length + MOUNTAIN.after + 2 * from) / EDGE_STEP) + 1;
  const right = new Float64Array(n);
  const left = new Float64Array(n);
  const both = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = road.curvature(i * EDGE_STEP - from);
    const w = S.max * Math.min(1, Math.max(0, (Math.abs(k) - S.from) / (S.full - S.from)));
    if (k < 0) right[i] = w; // (a left bend's outside: its right)
    else if (k > 0) left[i] = w;
    both[i] = W.by * Math.min(1, Math.abs(k) / W.full);
  }
  const h = Math.round(S.ease / 2 / EDGE_STEP);
  const widths = { [1]: easeTwice(right, h), [-1]: easeTwice(left, h) } as Record<1 | -1, Float64Array>;
  const wider = easeTwice(both, Math.round(W.ease / 2 / EDGE_STEP));
  const lerp = (a: Float64Array, s: number) => {
    const x = (s + from) / EDGE_STEP;
    if (x <= 0 || x >= n - 1) return 0;
    const i = Math.floor(x);
    const w = a[i] + (a[i + 1] - a[i]) * (x - i);
    return w > 1e-9 ? w : 0;
  };
  const edges: RoadEdges = {
    at: (s, side) => MOUNTAIN.edge + lerp(wider, s) + lerp(widths[side], s),
    widen: (s) => lerp(wider, s),
  };
  EDGES.set(road, edges);
  return edges;
}
