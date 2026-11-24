export const LANE_COUNT = 4;
export const LANE_WIDTH = 3.75;
export const ROAD_HALF_WIDTH = (LANE_COUNT * LANE_WIDTH) / 2; // 7.5
export const SHOULDER = 2.5;
export const RAIL_D = ROAD_HALF_WIDTH + SHOULDER; // 10
export const ROAD_LENGTH = 5000; // m: a race of about a minute and a half

// An elevated urban highway, one deck: the oncoming carriageway on our left beyond a narrow planted median strip,
// a guardrail along each side of the strip (each carriageway between its own two: physics/physicsWorld), a
// parapet on the deck's outer edges.
export const MEDIAN_WIDTH = 3;
export const MEDIAN_NEAR_X = -RAIL_D; // our inner shoulder ends here, at our median rail (-10)
export const MEDIAN_FAR_X = MEDIAN_NEAR_X - MEDIAN_WIDTH; // -13, the oncoming carriageway's median rail
export const ONCOMING_X = MEDIAN_FAR_X - SHOULDER - ROAD_HALF_WIDTH; // -23, oncoming centre line
export const LEFT_RAIL_X = ONCOMING_X - ROAD_HALF_WIDTH - SHOULDER; // -33, the deck's left edge
export const GRASS_GRIP = 0.55;

export const PHYSICS_DT = 1 / 120;
export const MAX_SUBSTEPS = 8;
export const MAX_FRAME_DT = 0.1;

export const KMH = 1 / 3.6;

export const RESET_SPEED = 60 * KMH;
export const RESET_COOLDOWN = 3;
export const COUNTDOWN_SECONDS = 3;

export const WRECK_LIFETIME = 12;
export const MAX_WRECKS = 12;

export type VehicleKind = 'car' | 'truck' | 'container';

export interface IdmParams {
  v0: number; // desired speed (m/s), overwritten per agent
  T: number; // time headway (s)
  s0: number; // jam distance (m)
  a: number; // max accel (m/s^2)
  b: number; // comfortable decel (m/s^2)
}

export interface VehicleSpec {
  kind: VehicleKind;
  length: number; // total length (m)
  width: number;
  height: number;
  mass: number; // kg (cab mass for container)
  speedRange: [number, number]; // desired speed range (m/s)
  laneChangeTime: number; // seconds for the lateral move
  allowedLanes: number[];
  idm: Omit<IdmParams, 'v0'>;
  politenessRange: [number, number];
}

export const VEHICLE_SPECS: Record<VehicleKind, VehicleSpec> = {
  // Car and truck: their models' bodies (public/models/sedan.glb, truck.glb), mirrors left out.
  car: {
    kind: 'car',
    length: 4.11,
    width: 1.72,
    height: 1.38,
    mass: 1300,
    speedRange: [95 * KMH, 125 * KMH],
    laneChangeTime: 2.0,
    allowedLanes: [0, 1, 2, 3],
    idm: { T: 1.3, s0: 2.5, a: 2.0, b: 2.5 },
    politenessRange: [0.1, 0.5],
  },
  truck: {
    kind: 'truck',
    length: 7.46,
    width: 2.5, // (its tyres; its cab 2.44)
    height: 3.37,
    mass: 9000,
    speedRange: [80 * KMH, 92 * KMH],
    laneChangeTime: 3.5,
    allowedLanes: [2, 3],
    idm: { T: 1.7, s0: 3, a: 1.0, b: 2.0 },
    politenessRange: [0.3, 0.6],
  },
  container: {
    kind: 'container',
    length: 16.94, // cab 6.29 + trailer 12.5 - 1.85 overlap at the fifth wheel (their models')
    width: 2.5,
    height: 3.92, // the container's top
    mass: 8000,
    speedRange: [75 * KMH, 88 * KMH],
    laneChangeTime: 4.5,
    allowedLanes: [2, 3],
    idm: { T: 1.9, s0: 3.5, a: 0.7, b: 1.8 },
    politenessRange: [0.4, 0.7],
    // (its cab's and trailer's own lengths and the trailer's mass: vehicles/npcVehicle)
  },
};
