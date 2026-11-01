import * as THREE from 'three';
import { MAX_WRECKS, WRECK_LIFETIME } from '../config';
import type { EntityRef, PhysicsWorld } from '../physics/physicsWorld';
import { ONCOMING_FRAME, OUR_FRAME, RoadFrame } from '../road/frame';
import { laneCenter, lanesOccupied } from '../road/coords';
import { Agent, Obstacle, TrafficSim } from '../traffic/trafficAI';
import { DEFAULT_SPACING, Occupant, planSpawns, shouldDespawnRange } from '../traffic/spawner';
import { NpcVehicle } from '../vehicles/npcVehicle';
import type { WheelInstances } from '../vehicles/wheelInstances';
import type { TrafficBox } from '../ai/sensors';
import type { Rng } from '../ai/rng';

const SPAWN_INTERVAL = 0.25;
const ONCOMING_FIRST_ID = 1_000_000;

/** One carriageway: its traffic planner, coordinate frame and direction relative to us. */
export interface TrafficSide {
  name: 'ours' | 'oncoming';
  frame: RoadFrame;
  facing: 1 | -1;
  sim: TrafficSim;
}

/**
 * Where the drivers traffic is kept around are, along our carriageway: the player
 * alone (lead = tail), or a spread-out group of AI cars in training. Traffic is
 * added ahead of the lead and removed only once far behind the tail.
 */
export interface TrafficFocus {
  sLead: number;
  sTail: number;
  vLead: number;
  raceTime: number;
}

/** Position along a carriageway's own s axis of a point at our-carriageway s. */
const frameS = (frame: RoadFrame, s: number) => frame.fromWorld(0, -s).s;

/**
 * The traffic on the road: planners for each carriageway, the NPC bodies that
 * follow them, wrecks, spawning and despawning. Shared by the game and AI training.
 */
export class TrafficWorld {
  readonly npcs = new Map<number, NpcVehicle>();
  sides: TrafficSide[] = [];
  spacing = DEFAULT_SPACING;
  private readonly side = new Map<number, TrafficSide>();
  private spawnTimer = 0;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly scene: THREE.Scene,
    private readonly wheelPool: WheelInstances,
    public rng: Rng,
    private readonly opts: { oncoming: boolean },
  ) {}

  /** Clear all traffic and wrecks and fill the road ahead of the focus. */
  reset(focus: TrafficFocus, occupants: (frame: RoadFrame) => Occupant[]): void {
    for (const npc of this.npcs.values()) npc.dispose();
    this.npcs.clear();
    this.side.clear();
    this.sides = [{ name: 'ours', frame: OUR_FRAME, facing: 1, sim: new TrafficSim() }];
    if (this.opts.oncoming) this.sides.push({ name: 'oncoming', frame: ONCOMING_FRAME, facing: -1, sim: new TrafficSim(ONCOMING_FIRST_ID) });
    this.spawnTimer = SPAWN_INTERVAL;
    this.spawn(focus, occupants, true);
  }

  sideOf(id: number): TrafficSide | undefined {
    return this.side.get(id);
  }

  agentOf(id: number): Agent | undefined {
    return this.side.get(id)?.sim.agents.get(id);
  }

  /** Plan traffic on every carriageway (wrecks and `obstacles` are respected), then drive the NPC bodies. */
  stepAI(dt: number, simTime: number, obstacles: (frame: RoadFrame) => Obstacle[]): void {
    for (const side of this.sides) {
      const obs = obstacles(side.frame);
      for (const npc of this.npcs.values()) {
        if (npc.wrecked) obs.push(...npc.obstacles(side.frame));
        else if (this.side.get(npc.id) === side) npc.syncAgent(side.sim.agents.get(npc.id)!);
      }
      side.sim.step(dt, obs, this.rng, false);
    }
    for (const npc of this.npcs.values()) {
      npc.savePrev();
      if (npc.wrecked) npc.updateWreck(dt, simTime);
      else npc.drive(this.agentOf(npc.id)!, dt, simTime);
    }
  }

  /** Call after the physics step. */
  afterPhysics(): void {
    for (const npc of this.npcs.values()) npc.capture();
  }

  /** Remove traffic that fell out of range and periodically add more. */
  maintain(dt: number, focus: TrafficFocus, occupants: (frame: RoadFrame) => Occupant[]): void {
    this.cull(focus);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = SPAWN_INTERVAL;
      this.spawn(focus, occupants, false);
    }
  }

  /**
   * Contact callback for the physics step. Two NPCs touching both become wrecks
   * (returns null); an NPC hitting anything else returns its id for the caller
   * to handle (the game wrecks it and shakes the camera).
   */
  onNpcContact(a: EntityRef, b: EntityRef): number | null {
    if (a.type === 'static' || b.type === 'static') return null;
    if (a.type === 'npc' && b.type === 'npc') {
      this.wreck(a.id);
      this.wreck(b.id);
      return null;
    }
    return a.type === 'npc' ? a.id : b.type === 'npc' ? b.id : null;
  }

  wreck(id: number): void {
    const npc = this.npcs.get(id);
    if (!npc || npc.wrecked) return;
    npc.wreck();
    this.side.get(id)?.sim.removeAgent(id);
  }

  /**
   * Every vehicle and wreck on our carriageway as boxes in our road coordinates
   * (a car changing lanes also blocks its target lane).
   */
  ourBoxes(out: TrafficBox[] = []): TrafficBox[] {
    out.length = 0;
    const ours = this.sides[0];
    for (const a of ours.sim.agents.values()) {
      out.push({ id: a.id, s: a.s, dMin: a.d - a.width / 2, dMax: a.d + a.width / 2, v: a.v, length: a.length });
      // The lane it is moving into counts as taken. Only signalling, it still waits until the change is
      // safe (for the player too, in the game), so that lane is not blocked yet.
      if (a.lcState === 'move' && a.targetLane !== null && a.targetLane !== a.lane) {
        const c = laneCenter(a.targetLane);
        out.push({ id: a.id, s: a.s, dMin: c - a.width / 2, dMax: c + a.width / 2, v: a.v, length: a.length, phantom: true });
      }
    }
    for (const npc of this.npcs.values()) if (npc.wrecked) out.push(...npc.obstacles(OUR_FRAME));
    return out;
  }

  /** Remove every NPC (e.g. when a training generation ends). */
  dispose(): void {
    for (const npc of this.npcs.values()) npc.dispose();
    this.npcs.clear();
    this.side.clear();
  }

  private removeNpc(npc: NpcVehicle): void {
    npc.dispose();
    this.npcs.delete(npc.id);
    this.side.get(npc.id)?.sim.removeAgent(npc.id);
    this.side.delete(npc.id);
  }

  private cull(focus: TrafficFocus): void {
    const wrecks: NpcVehicle[] = [];
    for (const npc of [...this.npcs.values()]) {
      if (npc.wrecked) {
        if (npc.wreckTime > WRECK_LIFETIME || npc.s < focus.sTail - 260 || npc.s > focus.sLead + 900) this.removeNpc(npc);
        else wrecks.push(npc);
      } else {
        const side = this.side.get(npc.id)!;
        const agent = side.sim.agents.get(npc.id);
        if (!agent || shouldDespawnRange(agent.s, frameS(side.frame, focus.sTail), frameS(side.frame, focus.sLead), side.facing)) this.removeNpc(npc);
      }
    }
    if (wrecks.length > MAX_WRECKS) {
      // Oldest first, and only ones nobody still has to drive past.
      const removable = wrecks.filter((w) => w.s < focus.sTail).sort((x, y) => y.wreckTime - x.wreckTime);
      for (let i = 0; i < wrecks.length - MAX_WRECKS && i < removable.length; i++) this.removeNpc(removable[i]);
    }
  }

  private spawn(focus: TrafficFocus, occupants: (frame: RoadFrame) => Occupant[], initial: boolean): void {
    for (const side of this.sides) {
      const occupied: Occupant[] = [];
      for (const a of side.sim.agents.values()) {
        occupied.push({ s: a.s, lane: a.lane, length: a.length, v: a.v });
        if (a.targetLane !== null && a.targetLane !== a.lane) occupied.push({ s: a.s, lane: a.targetLane, length: a.length, v: a.v });
      }
      occupied.push(...occupants(side.frame));
      for (const npc of this.npcs.values()) {
        if (!npc.wrecked) continue;
        // A wreck blocks every lane it touches.
        for (const o of npc.obstacles(side.frame)) for (const lane of lanesOccupied(o.dMin, o.dMax)) occupied.push({ s: o.s, lane, length: o.length, v: 0 });
      }
      const reqs = planSpawns({
        playerS: frameS(side.frame, focus.sLead),
        playerV: focus.vLead,
        raceTime: focus.raceTime,
        occupied,
        rng: this.rng,
        initial,
        spacing: this.spacing,
        facing: side.facing,
      });
      for (const r of reqs) {
        const agent = side.sim.addAgent(r.kind, r.s, r.lane, this.rng);
        agent.v = Math.min(agent.v, r.vMax);
        this.npcs.set(agent.id, new NpcVehicle(this.physics, this.scene, this.wheelPool, side.frame, agent, this.rng));
        this.side.set(agent.id, side);
      }
    }
  }
}
