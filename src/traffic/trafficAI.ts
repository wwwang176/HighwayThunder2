import { IdmParams, LANE_WIDTH, VEHICLE_SPECS, VehicleKind, VehicleSpec } from '../config';
import { laneCenter, lanesOccupied } from '../road/coords';
import { idmAccel } from './idm';
import { mobilIncentive, mobilSafe } from './mobil';

export type LaneChangeState = 'none' | 'signal' | 'move';

export interface Agent {
  id: number;
  kind: VehicleKind;
  spec: VehicleSpec;
  s: number; // center position along the road
  d: number; // lateral center (actual)
  dPlan: number; // planned lateral center (lane-change path)
  dPlanRate: number; // planned lateral velocity
  v: number;
  lane: number; // lane it is in (source lane while changing)
  targetLane: number | null;
  lcState: LaneChangeState;
  lcTimer: number;
  lcDuration: number; // signal time while signalling, move time while moving
  lcFrom: number;
  desiredV: number;
  politeness: number;
  mirrorRange: number;
  cooldown: number;
  decisionTimer: number;
  length: number;
  width: number;
  accel: number;
  yaw: number;
  idm: IdmParams;
  /** Moved by the sim itself (as in pure mode) though the sim is not integrating: no body under it to (far from every racer). */
  free?: boolean;
}

/** Something agents must respect but do not drive: the player, wrecks. */
export interface Obstacle {
  id: number;
  s: number;
  dMin: number;
  dMax: number;
  v: number;
  length: number;
  isPlayer?: boolean;
}

interface Body {
  id: number;
  s: number;
  v: number;
  length: number;
  lanes: number[];
  agent?: Agent;
  isPlayer: boolean;
}

interface Neighbor {
  body: Body;
  gap: number;
}

// Generic IDM used to estimate how hard the player would have to brake.
const PLAYER_IDM: IdmParams = { v0: 80, T: 0.9, s0: 2, a: 4, b: 5 };
const LC_THRESHOLD: Record<VehicleKind, number> = { car: 0.25, truck: 0.5, container: 0.6 };
const KEEP_RIGHT_BIAS = 0.12;
const SIGNAL_MAX_WAIT = 4;
const B_SAFE = 4;

const smoothstep = (u: number) => u * u * (3 - 2 * u);

export class TrafficSim {
  readonly agents = new Map<number, Agent>();
  private nextId: number;

  /** @param firstId id of the first agent (keeps ids unique across several sims) */
  constructor(firstId = 1) {
    this.nextId = firstId;
  }
  private bodies: Body[] = [];

  addAgent(kind: VehicleKind, s: number, lane: number, rng: () => number): Agent {
    const spec = VEHICLE_SPECS[kind];
    const desiredV = spec.speedRange[0] + rng() * (spec.speedRange[1] - spec.speedRange[0]);
    const [p0, p1] = spec.politenessRange;
    const a: Agent = {
      id: this.nextId++,
      kind,
      spec,
      s,
      d: laneCenter(lane),
      dPlan: laneCenter(lane),
      dPlanRate: 0,
      v: desiredV,
      lane,
      targetLane: null,
      lcState: 'none',
      lcTimer: 0,
      lcDuration: 0,
      lcFrom: laneCenter(lane),
      desiredV,
      politeness: p0 + rng() * (p1 - p0),
      mirrorRange: 20 + rng() * 25,
      cooldown: 1 + rng() * 5,
      decisionTimer: rng() * 0.5,
      length: spec.length,
      width: spec.width,
      accel: 0,
      yaw: 0,
      idm: { ...spec.idm, v0: desiredV },
    };
    this.agents.set(a.id, a);
    return a;
  }

  removeAgent(id: number): void {
    this.agents.delete(id);
  }

  /**
   * Plan one step. With `integrate` the sim also moves the agents (pure mode, used
   * by tests); otherwise s/d/v/yaw are owned by physics and read back by the caller,
   * and the sim only produces `accel` and the lateral path `dPlan`/`dPlanRate`.
   */
  step(dt: number, obstacles: Obstacle[], rng: () => number, integrate = true): void {
    this.buildBodies(obstacles);

    for (const a of this.agents.values()) {
      a.cooldown -= dt;
      a.decisionTimer -= dt;
      if (a.lcState === 'none' && a.cooldown <= 0 && a.decisionTimer <= 0) {
        a.decisionTimer = 0.4 + rng() * 0.3;
        this.considerLaneChange(a, rng);
      } else if (a.lcState === 'signal') {
        this.updateSignal(a, dt, rng);
      }
    }

    for (const a of this.agents.values()) {
      let acc = Infinity;
      for (const lane of this.lanesOf(a)) acc = Math.min(acc, this.accelInLane(a, lane, a.s));
      a.accel = acc;
    }

    for (const a of this.agents.values()) {
      const prevPlan = a.dPlan;
      if (a.lcState === 'move') this.updateMove(a, dt, rng);
      a.dPlanRate = (a.dPlan - prevPlan) / dt;
      if (integrate || a.free) {
        a.v = Math.max(0, a.v + a.accel * dt);
        a.s += a.v * dt;
        a.d = a.dPlan;
        a.yaw = Math.atan2(a.dPlanRate, Math.max(a.v, 4));
      }
    }
  }

  // ---------------------------------------------------------------------------

  private buildBodies(obstacles: Obstacle[]): void {
    this.bodies.length = 0;
    for (const a of this.agents.values()) {
      this.bodies.push({ id: a.id, s: a.s, v: a.v, length: a.length, lanes: this.lanesOf(a), agent: a, isPlayer: false });
    }
    for (const o of obstacles) {
      this.bodies.push({ id: o.id, s: o.s, v: o.v, length: o.length, lanes: lanesOccupied(o.dMin, o.dMax), isPlayer: !!o.isPlayer });
    }
  }

  /** Lanes an agent currently blocks (its target lane is claimed once it starts moving). */
  private lanesOf(a: Agent): number[] {
    const lanes = lanesOccupied(a.d - a.width / 2, a.d + a.width / 2);
    if (a.lcState === 'move' && a.targetLane !== null && !lanes.includes(a.targetLane)) lanes.push(a.targetLane);
    if (lanes.length === 0) lanes.push(a.lane);
    return lanes;
  }

  private leaderIn(lane: number, s: number, len: number, selfId: number): Neighbor | null {
    let best: Neighbor | null = null;
    for (const b of this.bodies) {
      if (b.id === selfId || b.s <= s || !b.lanes.includes(lane)) continue;
      const gap = b.s - b.length / 2 - (s + len / 2);
      if (!best || gap < best.gap) best = { body: b, gap };
    }
    return best;
  }

  private followerIn(lane: number, s: number, len: number, selfId: number): Neighbor | null {
    let best: Neighbor | null = null;
    for (const b of this.bodies) {
      if (b.id === selfId || b.s > s || !b.lanes.includes(lane)) continue;
      if (!b.agent && !b.isPlayer) continue; // wrecks behind do not follow
      const gap = s - len / 2 - (b.s + b.length / 2);
      if (!best || gap < best.gap) best = { body: b, gap };
    }
    return best;
  }

  private accelInLane(a: Agent, lane: number, s: number): number {
    const l = this.leaderIn(lane, s, a.length, a.id);
    return idmAccel(a.v, l ? l.gap : null, l ? a.v - l.body.v : 0, a.idm);
  }

  /** Accel a follower body would have behind a leader with given gap and speed. */
  private followerAccel(f: Body, gap: number | null, leaderV: number): number {
    const p = f.agent ? f.agent.idm : { ...PLAYER_IDM, v0: Math.max(f.v, 1) };
    return idmAccel(f.v, gap, gap === null ? 0 : f.v - leaderV, p);
  }

  /** Should this follower be considered at all? Drivers only notice the player within a window. */
  private noticed(a: Agent, f: Neighbor | null): Neighbor | null {
    if (!f || !f.body.isPlayer) return f;
    const window = Math.max(a.mirrorRange, 2.5 * Math.max(0, f.body.v - a.v));
    return f.gap <= window ? f : null;
  }

  private changeIsSafe(a: Agent, target: number): boolean {
    // Anything alongside in the target lane (including wrecks whose center is
    // slightly behind us) blocks the change.
    for (const b of this.bodies) {
      if (b.id === a.id || !b.lanes.includes(target)) continue;
      if (Math.abs(b.s - a.s) < (b.length + a.length) / 2 + 2) return false;
    }
    const lead = this.leaderIn(target, a.s, a.length, a.id);
    if (lead && lead.gap < 2) return false;
    const rawF = this.followerIn(target, a.s, a.length, a.id);
    if (rawF && rawF.gap < 2) return false;
    const f = this.noticed(a, rawF);
    if (!f) return true;
    return mobilSafe(this.followerAccel(f.body, f.gap, a.v), B_SAFE);
  }

  private considerLaneChange(a: Agent, rng: () => number): void {
    const selfOld = this.accelInLane(a, a.lane, a.s);
    let bestLane: number | null = null;
    let bestScore = LC_THRESHOLD[a.kind];

    const oldF = this.noticed(a, this.followerIn(a.lane, a.s, a.length, a.id));
    const myLeader = this.leaderIn(a.lane, a.s, a.length, a.id);
    let oldFollowerOld = 0;
    let oldFollowerNew = 0;
    if (oldF) {
      oldFollowerOld = this.followerAccel(oldF.body, oldF.gap, a.v);
      oldFollowerNew = myLeader
        ? this.followerAccel(oldF.body, oldF.gap + a.length + myLeader.gap, myLeader.body.v)
        : this.followerAccel(oldF.body, null, 0);
    }

    for (const target of [a.lane - 1, a.lane + 1]) {
      if (!a.spec.allowedLanes.includes(target)) continue;
      if (!this.changeIsSafe(a, target)) continue;
      const selfNew = this.accelInLane(a, target, a.s);
      const nf = this.noticed(a, this.followerIn(target, a.s, a.length, a.id));
      let newFollowerNew = 0;
      let newFollowerOld = 0;
      if (nf) {
        newFollowerNew = this.followerAccel(nf.body, nf.gap, a.v);
        const nfLeader = this.leaderIn(target, nf.body.s, nf.body.length, nf.body.id);
        newFollowerOld = nfLeader
          ? this.followerAccel(nf.body, nfLeader.gap, nfLeader.body.v)
          : this.followerAccel(nf.body, null, 0);
      }
      let bias = target > a.lane ? KEEP_RIGHT_BIAS : -KEEP_RIGHT_BIAS;
      if (a.kind === 'container') bias *= 3;
      const score = mobilIncentive({
        selfNew,
        selfOld,
        newFollowerNew,
        newFollowerOld,
        oldFollowerNew,
        oldFollowerOld,
        politeness: a.politeness,
        bias,
      });
      if (score > bestScore) {
        bestScore = score;
        bestLane = target;
      }
    }

    if (bestLane !== null) {
      a.lcState = 'signal';
      a.targetLane = bestLane;
      a.lcTimer = 0;
      a.lcDuration = 1.0 + rng() * 0.5;
    }
  }

  private updateSignal(a: Agent, dt: number, rng: () => number): void {
    a.lcTimer += dt;
    const target = a.targetLane!;
    if (a.lcTimer >= a.lcDuration && this.changeIsSafe(a, target)) {
      a.lcState = 'move';
      a.lcFrom = a.dPlan;
      a.lcTimer = 0;
      a.lcDuration = a.spec.laneChangeTime;
    } else if (a.lcTimer > a.lcDuration + SIGNAL_MAX_WAIT) {
      this.endLaneChange(a, a.lane, rng);
    }
  }

  private updateMove(a: Agent, dt: number, rng: () => number): void {
    const target = a.targetLane!;
    // Abort (steer back) if it became dangerous, e.g. the player showed up fast.
    if (target !== a.lane && a.lcTimer < a.lcDuration * 0.5 && !this.changeIsSafe(a, target)) {
      a.targetLane = a.lane;
      a.lcFrom = a.dPlan;
      a.lcTimer = 0;
      a.lcDuration = Math.max(0.5, (a.spec.laneChangeTime * Math.abs(a.dPlan - laneCenter(a.lane))) / LANE_WIDTH);
      return this.updateMove(a, dt, rng);
    }
    a.lcTimer += dt;
    const u = Math.min(1, a.lcTimer / a.lcDuration);
    const to = laneCenter(a.targetLane!);
    a.dPlan = a.lcFrom + (to - a.lcFrom) * smoothstep(u);
    if (u >= 1) this.endLaneChange(a, a.targetLane!, rng);
  }

  private endLaneChange(a: Agent, lane: number, rng: () => number): void {
    a.lane = lane;
    a.dPlan = laneCenter(lane);
    a.lcState = 'none';
    a.targetLane = null;
    a.lcTimer = 0;
    a.cooldown = 4 + rng() * 5;
  }

  /** Is the agent's turn signal on, and which side? */
  static indicator(a: Agent): -1 | 0 | 1 {
    if (a.lcState === 'none' || a.targetLane === null || a.targetLane === a.lane) return 0;
    return a.targetLane < a.lane ? -1 : 1;
  }
}
