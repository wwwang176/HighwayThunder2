/**
 * The city round the elevated highway, planned: one period of it (repeating along the road), either side of the
 * deck. Its districts, each its own grid of streets turned its own way against the deck (the streets below don't
 * follow it): blocks of lots between 2+2 roads, a lot's building between 1+1 streets; the lamps along them. All in
 * the road's frame (s along it, d across), each district's own (u, v) axes turned by its yaw from the road's
 * (u across it at yaw 0, v along it): a point (u, v) of it is d = district.d + u cos(yaw) + v sin(yaw) across.
 */

/** A road: 1+1 (minor) or 2+2 (major): its asphalt's width, its pavements' either side, its lamps' spacing each side. */
export interface RoadKind {
  asphalt: number;
  walk: number;
  lampEvery: number;
}

export interface CityPlanParams {
  period: number;
  /** The deck's outer edges (d) and its middle: no district's streets past it, no buildings within `clear` of its edges. */
  deck: { left: number; right: number; mid: number };
  /** Roads running along the deck kept this far out from its edges (none under it: only across it). */
  alongClear: number;
  /**
   * Either side, rows of districts one after another along the road: each row's districts' near edges `near` m off
   * the deck's edge (< 0: their streets under it), their far edges no further than `far`.
   */
  bands: readonly { near: readonly [number, number]; far: number }[];
  /** Now and then (`odds`) a gap left between two districts (`size` m: a park, a railway, dark). */
  gap: { odds: number; size: readonly [number, number] };
  /** Most a district's turn against the road (rad, either way). */
  yaw: number;
  /** Lots each way in a block, blocks across (u) and along (v) a district. */
  lots: readonly [number, number];
  blocksAcross: readonly [number, number];
  blocksAlong: readonly [number, number];
  /** A lot's size (m, square); its building's sides; the share of lots left empty. */
  lot: number;
  size: readonly [number, number];
  empty: number;
  /** Between districts at least. */
  apart: number;
  /**
   * Most a district reaches along the road either way from its middle (laid straight from there: on a bend the deck
   * curves away from it, some L^2 / 2R m at L along - kept well inside `clear` and the deck's half width).
   */
  maxAlong: number;
  /** Buildings' tops (each block its own: low ones and towers), none nearer the deck's edge than `clear`. */
  top: readonly [number, number];
  clear: number;
  minor: RoadKind;
  major: RoadKind;
  /** The share of districts with white (LED) street lights, the rest sodium orange. */
  led: number;
}

/** A district's place: its middle (s along the road, d across) and turn (yaw's cos, sin). */
export interface Placed {
  s: number;
  d: number;
  cy: number;
  sy: number;
  yaw: number;
}

export interface PlanBuilding extends Placed {
  u: number;
  v: number;
  /** Its sides along u and v; its top over the road. */
  w: number;
  l: number;
  top: number;
}

/** A road: along u (at v = `at`) or along v (at u = `at`), from - to along it. */
export interface PlanRoad extends Placed {
  alongU: boolean;
  at: number;
  from: number;
  to: number;
  major: boolean;
  led: boolean;
}

/** A street lamp: where it stands (u, v), the way its arm reaches (over its road: unit, in u, v). */
export interface PlanLamp extends Placed {
  u: number;
  v: number;
  armU: number;
  armV: number;
  led: boolean;
}

export interface CityPlan {
  buildings: PlanBuilding[];
  roads: PlanRoad[];
  lamps: PlanLamp[];
}

/** A road's centre line across its axis and its kind (in a district's lineup of roads and lots). */
interface Line {
  at: number;
  major: boolean;
}

/**
 * One axis of a district: `blocks` blocks of `lots` lots, a major road round each block, minor ones between its
 * lots - centred on 0. Its roads, its lots' middles (and their blocks), its whole length.
 */
export function lineUp(blocks: number, lots: number, p: Pick<CityPlanParams, 'lot' | 'minor' | 'major'>): { roads: Line[]; lots: { at: number; block: number }[]; length: number } {
  const MW = p.major.asphalt + 2 * p.major.walk, mw = p.minor.asphalt + 2 * p.minor.walk;
  const length = blocks * (lots * p.lot + (lots - 1) * mw) + (blocks + 1) * MW;
  const roads: Line[] = [];
  const out: { at: number; block: number }[] = [];
  let x = -length / 2;
  for (let b = 0; b < blocks; b++) {
    roads.push({ at: x + MW / 2, major: true });
    x += MW;
    for (let k = 0; k < lots; k++) {
      if (k > 0) {
        roads.push({ at: x + mw / 2, major: false });
        x += mw;
      }
      out.push({ at: x + p.lot / 2, block: b });
      x += p.lot;
    }
  }
  roads.push({ at: x + MW / 2, major: true });
  return { roads, lots: out, length };
}

/** [from, to] less [lo, hi] (up to two pieces). */
function without(from: number, to: number, lo: number, hi: number): [number, number][] {
  if (hi <= from || lo >= to) return [[from, to]];
  const out: [number, number][] = [];
  if (lo > from) out.push([from, lo]);
  if (hi < to) out.push([hi, to]);
  return out;
}

/** Where along a road (t) its across-the-deck d = d0 + t k is in [lo, hi]. */
function within(d0: number, k: number, lo: number, hi: number): [number, number] {
  if (Math.abs(k) < 1e-9) return d0 >= lo && d0 <= hi ? [-Infinity, Infinity] : [Infinity, Infinity];
  const a = (lo - d0) / k, b = (hi - d0) / k;
  return [Math.min(a, b), Math.max(a, b)];
}

export function planCity(p: CityPlanParams, rnd: () => number): CityPlan {
  const plan: CityPlan = { buildings: [], roads: [], lamps: [] };
  const lerp = (r: readonly [number, number], k = rnd()) => r[0] + k * (r[1] - r[0]);
  const pick = (r: readonly [number, number]) => r[0] + Math.floor(rnd() * (r[1] - r[0] + 1));
  for (const side of [1, -1])
    for (const band of p.bands) {
      const edge = side > 0 ? p.deck.right : p.deck.left;
      // Along the road from a start of its own, a district after another (round to the start again, a period on).
      const start = rnd() * p.period;
      let along = 0; // (from the start: the next district's near end)
      let firstHs = -1;
      for (;;) {
        let made = null;
        for (let tries = 0; !made && tries < 60; tries++) {
          const yaw = (rnd() * 2 - 1) * p.yaw;
          const cy = Math.cos(yaw), sy = Math.sin(yaw);
          const U = lineUp(pick(p.blocksAcross), pick(p.lots), p), V = lineUp(pick(p.blocksAlong), pick(p.lots), p);
          // (its reach across the road and along it, either way from its middle)
          const hd = (U.length / 2) * cy + (V.length / 2) * Math.abs(sy);
          const hs = (U.length / 2) * Math.abs(sy) + (V.length / 2) * cy;
          const near = lerp(band.near);
          if (near + 2 * hd <= band.far && hs <= p.maxAlong) made = { yaw, cy, sy, U, V, hd, hs, near };
        }
        if (!made) break;
        const { yaw, cy, sy, U, V, hd, hs, near } = made;
        if (rnd() < p.gap.odds && firstHs >= 0) along += lerp(p.gap.size);
        const mid = along + hs;
        if (firstHs >= 0 && mid + hs > p.period - p.apart) break; // (the first one, a period on)
        if (firstHs < 0) firstHs = hs;
        along = mid + hs + p.apart;
        const s = (start + mid) % p.period;
        district(side, edge, { s, d: edge + side * (near + hd), cy, sy, yaw }, U, V);
      }
    }
  return plan;

  function district(side: number, edge: number, at: Placed, U: ReturnType<typeof lineUp>, V: ReturnType<typeof lineUp>): void {
    const { d, cy, sy } = at;
    const led = rnd() < p.led;
    const across = (u: number, v: number) => d + u * cy + v * sy;

    // Its buildings, a lot each (some empty), the deck kept clear; each block its own height.
    const tops = new Map<string, number>();
    for (const lu of U.lots)
      for (const lv of V.lots) {
        if (rnd() < p.empty) continue;
        const key = `${lu.block},${lv.block}`;
        if (!tops.has(key)) tops.set(key, lerp(p.top, rnd() ** 1.6));
        const w = lerp(p.size), l = lerp(p.size);
        const u = lu.at + (rnd() - 0.5) * (p.lot - w), v = lv.at + (rnd() - 0.5) * (p.lot - l);
        const reach = (w / 2) * cy + (l / 2) * Math.abs(sy);
        if (side * (across(u, v) - edge) - reach < p.clear) continue;
        plan.buildings.push({ ...at, u, v, w, l, top: tops.get(key)! * (0.45 + 0.55 * rnd()) });
      }

    // Its roads, cut back from the deck: those across it (along u) no further than its middle (their ends hidden
    // under it), those along it (along v) not under it at all.
    const roadsOf = (alongU: boolean, lines: Line[], length: number, cross: Line[]) => {
      for (const line of lines) {
        const kind = line.major ? p.major : p.minor;
        const half = kind.asphalt / 2 + kind.walk;
        // d along it: d0 + t k (t its own coordinate), its pavements' outer edges either side
        const d0 = alongU ? across(0, line.at) : across(line.at, 0);
        const k = alongU ? cy : sy;
        const reach = half * (alongU ? Math.abs(sy) : cy);
        let pieces: [number, number][] = [[-length / 2, length / 2]];
        const cut = alongU
          ? side > 0 ? within(d0, k, -1e9, p.deck.mid + reach) : within(d0, k, p.deck.mid - reach, 1e9)
          : within(d0, k, p.deck.left - p.alongClear - reach, p.deck.right + p.alongClear + reach);
        pieces = pieces.flatMap(([a, b]) => without(a, b, cut[0], cut[1]));
        for (const [from, to] of pieces) {
          if (to - from < 2 * half) continue;
          plan.roads.push({ ...at, alongU, at: line.at, from, to, major: line.major, led });
          // Its lamps, on its pavements, the two sides' staggered (none standing in a road across it).
          for (const sgn of [1, -1]) {
            const phase = sgn > 0 ? 0.25 : 0.75;
            const off = kind.asphalt / 2 + kind.walk * 0.6;
            for (let t = (Math.ceil(from / kind.lampEvery - phase) + phase) * kind.lampEvery; t < to; t += kind.lampEvery) {
              if (cross.some((c) => Math.abs(t - c.at) < (c.major ? p.major : p.minor).asphalt / 2 + (c.major ? p.major : p.minor).walk + 1)) continue;
              const pu = alongU ? t : line.at + sgn * off, pv = alongU ? line.at + sgn * off : t;
              plan.lamps.push({ ...at, u: pu, v: pv, armU: alongU ? 0 : -sgn, armV: alongU ? -sgn : 0, led });
            }
          }
        }
      }
    };
    roadsOf(true, V.roads, U.length, U.roads);
    roadsOf(false, U.roads, V.length, V.roads);
  }
}
