/**
 * The mountain road's planner (docs/superpowers/specs/2026-11-16-mountain-planner-net-design.md): a path a little way
 * ahead, as offsets across the road from its reference - the line the mountain driver drives alone (MountainDriver.
 * refAt: its racing line, eased onto the next drift's entry) - over the whole road's width, no lanes. Every other car
 * seen (where it will be as it goes on), it goes round them on whichever side the cost likes best, or follows one it
 * cannot get by. Alone, no offset is cheapest: the plan is its reference.
 *
 * Stations every `step` m ahead; at each, offsets on a `grid`, no further from the last than `slope` a metre; the
 * cheapest run of them by dynamic programming (each state keeping the one before). Cost a station: its offset
 * squared (`wRef`), its slope squared (`wTurn`), the speed a tighter path than its reference's costs (`wSlow`), past
 * the road's room (`wWall`); at a kick point (`stopAt`) its offset squared again (`wEnd`, back toward the drift's
 * entry). A station where a car will be is ruled out (but the first: one beside it now does not shut every way).
 */

/** Its reference along the road: across (m, + right), the speed it aims at (m/s), its curvature (1/m), its room either side (m). */
export interface PlanRef {
  d(s: number): number;
  v(s: number): number;
  kappa(s: number): number;
  room(s: number): number;
}

/** Another car: where it is, across (its d range), its speed and how it is speeding up (m/s²) to `vAhead` at most, its length. */
export interface PlanOther {
  s: number;
  dMin: number;
  dMax: number;
  v: number;
  accel: number;
  vAhead: number;
  length: number;
}

export interface PlanInput {
  /** The car now (road coordinates: s along, d across, v along it). */
  s: number;
  d: number;
  v: number;
  /** The offset from its reference it starts from (the last plan's where it is, or where the car is: a drift's end). */
  startOffset: number;
  halfWidth: number;
  halfLength: number;
  ref: PlanRef;
  others: PlanOther[];
  /** The next drift's kick point: the plan ends there, its offset drawn back toward 0 (the drift's entry). */
  stopAt: number | null;
  /** The road's end: no further. */
  roadEnd: number;
}

export interface MountainPlan {
  s0: number;
  step: number;
  /** Offset from its reference at each station (m). */
  offsets: Float64Array;
  /** The speed it may go at each station (m/s; Infinity: as its reference). */
  vCap: Float64Array;
  /** No way by: following the car in its way. */
  blocked: boolean;
  offsetAt(s: number): number;
  vAt(s: number): number;
}

export const MOUNTAIN_PLAN = {
  /** Between stations (m). */
  step: 4,
  /** How far ahead: this many seconds of its speed, at least `horizonMin` m. */
  horizonTime: 4,
  horizonMin: 60,
  /** Offsets on this grid (m). */
  grid: 0.25,
  /** Across no faster than this a metre along. */
  slope: 0.3,
  /** Room kept from another car: along (m, bumper to bumper) and across (m, side to side). */
  gapS: 1.5,
  gapD: 0.4,
  wRef: 1,
  wTurn: 2,
  wSlow: 0.5,
  wEnd: 20,
  wWall: 1000,
  /**
   * The bend of a path's kinks is spread so (stations 4 m apart, the wheel rounds a kink over several): its curvature
   * the reference's plus `smooth` x the offsets' second difference. A tighter path than the reference's (and than
   * R 1 / kFloor) slows to keep its sideways grip: v_ref x sqrt(k_ref / k_path).
   */
  smooth: 0.3,
  kFloor: 1 / 80,
  /** A standing car about to set off (the start) speeds up like this (m/s²); the car itself too. */
  accelOthers: 4,
  /** Following one it cannot get by: its speed plus `followGain` a metre of gap past `followGap` (bumper to bumper). */
  followGap: 5,
  followGain: 0.5,
  /**
   * No clean way by and a car in the way standing (under `standing` m/s, not speeding up): squeezed past - its side a
   * cost (`wSqueeze` a station alongside), no faster than `squeezeSpeed` (m/s). Right behind a stalled car there is no
   * clean way round, and following it waited for ever.
   */
  standing: 1,
  wSqueeze: 30,
  squeezeSpeed: 3,
};

/** How far (m) a car at v speeding up at a (to vMax at most) goes in t s. */
function travelled(v: number, a: number, vMax: number, t: number): number {
  if (a <= 0 || v >= vMax) return v * t;
  const tUp = (vMax - v) / a;
  if (t <= tUp) return v * t + 0.5 * a * t * t;
  return v * tUp + 0.5 * a * tUp * tUp + vMax * (t - tUp);
}

export function planMountain(input: PlanInput): MountainPlan {
  const P = MOUNTAIN_PLAN;
  const { ref } = input;
  // (from where it is: on the grid, before 0 - from 0 it took itself level with the car ahead of it)
  const s0 = input.s;
  let sEnd = s0 + Math.max(P.horizonMin, P.horizonTime * Math.max(0, input.v));
  const stops = input.stopAt !== null && input.stopAt < sEnd && input.stopAt > s0;
  if (stops) sEnd = input.stopAt!;
  sEnd = Math.min(sEnd, Math.max(s0, input.roadEnd));
  const n = Math.max(1, Math.floor((sEnd - s0) / P.step + 1e-9) + 1);
  const so = input.startOffset;
  const band = P.slope * P.step;

  // Each station's candidate offsets: on the grid, within its room and within reach of where it starts (starting
  // outside the room - thrown wide out of a drift - the reach's end nearest the room, at a cost: back in as it can).
  const cands: Float64Array[] = [new Float64Array([so])];
  for (let i = 1; i < n; i++) {
    const s = s0 + i * P.step;
    const r = ref.room(s);
    const d = ref.d(s);
    let lo = Math.max(-r - d, so - i * band);
    let hi = Math.min(r - d, so + i * band);
    if (lo > hi) {
      const edge = so < -r - d ? so + i * band : so - i * band;
      lo = hi = edge;
    }
    const kLo = Math.ceil(lo / P.grid - 1e-9);
    const kHi = Math.floor(hi / P.grid + 1e-9);
    const c = kLo <= kHi ? new Float64Array(kHi - kLo + 1) : new Float64Array([lo]);
    if (kLo <= kHi) for (let k = kLo; k <= kHi; k++) c[k - kLo] = k * P.grid + 0;
    cands.push(c);
  }

  // Others: where each will be at a time (its centre along s).
  const others = input.others.filter((b) => b.s + b.length / 2 >= s0 - input.halfLength); // (behind it now: not its business)
  const otherAt = (b: PlanOther, t: number) => b.s + travelled(Math.max(0, b.v), Math.max(0, b.accel), Math.max(b.v, b.vAhead), t);

  /**
   * The cheapest run of offsets (null: none): DP, each state's cost, previous index, time and speed (the offset
   * before the previous: its curvature). `squeeze`: a standing car in the way not a wall but a cost (wSqueeze a
   * station alongside it, past it at squeezeSpeed at most).
   */
  const search = (squeeze: boolean): { offsets: Float64Array; vCap: Float64Array } | null => {
    const cost: Float64Array[] = cands.map((c) => new Float64Array(c.length).fill(Infinity));
    const prev: Int32Array[] = cands.map((c) => new Int32Array(c.length).fill(-1));
    const time: Float64Array[] = cands.map((c) => new Float64Array(c.length));
    const speed: Float64Array[] = cands.map((c) => new Float64Array(c.length));
    const vPathOf: Float64Array[] = cands.map((c) => new Float64Array(c.length).fill(Infinity));
    cost[0][0] = P.wRef * so * so;
    speed[0][0] = Math.max(0, input.v);
    for (let i = 1; i < n; i++) {
      const s = s0 + i * P.step;
      const r = ref.room(s);
      const dRef = ref.d(s);
      const vRef = ref.v(s);
      const kRef = ref.kappa(s);
      const kRefAbs = Math.max(Math.abs(kRef), P.kFloor);
      const ci = cands[i];
      const cp = cands[i - 1];
      for (let b = 0; b < ci.length; b++) {
        const off = ci[b];
        const at = dRef + off;
        const excess = Math.max(0, Math.abs(at) - r);
        const here = P.wRef * off * off + P.wWall * excess * excess;
        for (let a = 0; a < cp.length; a++) {
          const base = cost[i - 1][a];
          if (base === Infinity) continue;
          const dOff = off - cp[a];
          if (Math.abs(dOff) > band + 1e-9) continue;
          // (its bend: its reference's plus its offsets' kink, spread)
          const pa = prev[i - 1][a];
          const before = i >= 2 && pa >= 0 ? cands[i - 2][pa] : cp[a]; // (before the first: as if level)
          const d2 = (off - 2 * cp[a] + before) / (P.step * P.step);
          const kPath = Math.abs(kRef + P.smooth * d2);
          let vPath = kPath > kRefAbs ? vRef * Math.sqrt(kRefAbs / kPath) : vRef;
          // (its own speed there: speeding up from where it is at accelOthers, no faster than its path allows)
          const u0 = speed[i - 1][a];
          let u = Math.min(vPath, Math.sqrt(u0 * u0 + 2 * P.accelOthers * P.step));
          const t = time[i - 1][a] + P.step / Math.max(0.5, 0.5 * (u0 + u));
          // (another car where it will be: ruled out - or, squeezing, a standing one a cost and a crawl)
          let hit = false;
          let squeezed = 0;
          for (const o of others) {
            const os = otherAt(o, t);
            if (Math.abs(os - s) >= o.length / 2 + input.halfLength + P.gapS) continue;
            if (at + input.halfWidth + P.gapD <= o.dMin || at - input.halfWidth - P.gapD >= o.dMax) continue;
            if (squeeze && o.v < P.standing && o.accel <= 0) {
              squeezed++;
              continue;
            }
            hit = true;
            break;
          }
          if (hit) continue;
          if (squeezed) {
            vPath = Math.min(vPath, P.squeezeSpeed);
            u = Math.min(u, vPath);
          }
          let c = base + here + P.wTurn * (dOff / P.step) ** 2 + P.wSlow * Math.max(0, vRef - vPath) + P.wSqueeze * squeezed;
          if (stops && i === n - 1) c += P.wEnd * off * off;
          if (c < cost[i][b]) {
            cost[i][b] = c;
            prev[i][b] = a;
            time[i][b] = t;
            speed[i][b] = u;
            vPathOf[i][b] = vPath;
          }
        }
      }
    }

    // The cheapest end, back through its states.
    const last = n - 1;
    let best = -1;
    for (let b = 0; b < cands[last].length; b++) if (cost[last][b] < Infinity && (best < 0 || cost[last][b] < cost[last][best])) best = b;
    const offsets = new Float64Array(n);
    const vCap = new Float64Array(n).fill(Infinity);
    if (n === 1) {
      offsets[0] = so;
      return { offsets, vCap };
    }
    if (best < 0) return null;
    for (let i = last, k = best; i >= 0; i--) {
      offsets[i] = cands[i][k];
      const vp = vPathOf[i][k];
      vCap[i] = vp < ref.v(s0 + i * P.step) ? vp : Infinity;
      k = prev[i][k];
    }
    // (squeezing past: a crawl from where it is till it is by)
    if (squeeze) {
      let lastSqueeze = -1;
      for (let i = 0; i < n; i++) if (vCap[i] <= P.squeezeSpeed) lastSqueeze = i;
      for (let i = 0; i < lastSqueeze; i++) vCap[i] = Math.min(vCap[i], P.squeezeSpeed);
    }
    return { offsets, vCap };
  };

  let blocked = false;
  let found = search(false);
  if (!found && others.some((o) => o.v < P.standing && o.accel <= 0)) found = search(true);
  const offsets = found ? found.offsets : new Float64Array(n);
  const vCap = found ? found.vCap : new Float64Array(n);
  if (!found) {
    // No way by: back toward its reference, following the nearest car in the way.
    blocked = true;
    for (let i = 0; i < n; i++) offsets[i] = Math.sign(so) * Math.max(0, Math.abs(so) - i * band);
    let follow = Infinity;
    for (const o of others) {
      const dHere = ref.d(o.s);
      if (dHere + input.halfWidth + P.gapD <= o.dMin || dHere - input.halfWidth - P.gapD >= o.dMax) continue;
      const gap = o.s - o.length / 2 - (input.s + input.halfLength);
      if (gap < -input.halfLength) continue;
      follow = Math.min(follow, Math.max(0, o.v) + P.followGain * Math.max(0, gap - P.followGap));
    }
    vCap.fill(follow);
  }

  const at = (arr: Float64Array, s: number, past: number) => {
    const x = (s - s0) / P.step;
    if (x <= 0) return arr[0];
    if (x >= n - 1) return past;
    const i = Math.floor(x);
    const f = x - i;
    const a = arr[i];
    const b = arr[i + 1];
    if (a === Infinity || b === Infinity) return f < 0.5 ? a : b;
    return a + (b - a) * f;
  };
  return {
    s0,
    step: P.step,
    offsets,
    vCap,
    blocked,
    offsetAt: (s) => at(offsets, s, stops ? 0 : offsets[n - 1]),
    vAt: (s) => at(vCap, s, vCap[n - 1]),
  };
}
