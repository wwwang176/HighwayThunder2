export const LANE_COUNT = 4;
export const LANE_WIDTH = 3.75;
export const ROAD_HALF_WIDTH = (LANE_COUNT * LANE_WIDTH) / 2; // 7.5
export const SHOULDER = 2.5;
export const RAIL_D = ROAD_HALF_WIDTH + SHOULDER; // 10
export const ROAD_LENGTH = 10000;

export const PHYSICS_DT = 1 / 120;
export const MAX_SUBSTEPS = 8;
export const MAX_FRAME_DT = 0.1;

export const KMH = 1 / 3.6;

export const RESET_SPEED = 60 * KMH;
export const RESET_COOLDOWN = 3;
export const COUNTDOWN_SECONDS = 3;

export const WRECK_LIFETIME = 12;
export const MAX_WRECKS = 12;

export const BEST_TIME_KEY = 'highwayThunder2.bestTime';

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
  // container only
  cabLength?: number;
  trailerLength?: number;
  trailerMass?: number;
}

export const VEHICLE_SPECS: Record<VehicleKind, VehicleSpec> = {
  car: {
    kind: 'car',
    length: 4.5,
    width: 1.85,
    height: 1.45,
    mass: 1300,
    speedRange: [95 * KMH, 125 * KMH],
    laneChangeTime: 2.0,
    allowedLanes: [0, 1, 2, 3],
    idm: { T: 1.3, s0: 2.5, a: 2.0, b: 2.5 },
    politenessRange: [0.1, 0.5],
  },
  truck: {
    kind: 'truck',
    length: 8.5,
    width: 2.4,
    height: 3.3,
    mass: 9000,
    speedRange: [80 * KMH, 92 * KMH],
    laneChangeTime: 3.5,
    allowedLanes: [2, 3],
    idm: { T: 1.7, s0: 3, a: 1.0, b: 2.0 },
    politenessRange: [0.3, 0.6],
  },
  container: {
    kind: 'container',
    length: 18.9, // cab 6 + gap 0.4 + trailer 12.5
    width: 2.5,
    height: 4.0,
    mass: 8000,
    speedRange: [75 * KMH, 88 * KMH],
    laneChangeTime: 4.5,
    allowedLanes: [2, 3],
    idm: { T: 1.9, s0: 3.5, a: 0.7, b: 1.8 },
    politenessRange: [0.4, 0.7],
    cabLength: 6,
    trailerLength: 12.5,
    trailerMass: 16000,
  },
};
