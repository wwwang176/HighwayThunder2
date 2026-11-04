import * as THREE from 'three';
import { AIM_DOWN, BEAM_LAMP_H, HALF_ANGLE, HEADLIGHTS, PENUMBRA } from '../vehicles/headlight';
import type { SmokeLight } from '../world/tireSmoke';

/** How many NPC low beams light the ground at once (the nearest ones). */
export const MAX_BEAMS = 32;

/** Where a model's low beam starts (model-local), stored in root.userData.beam. */
export interface BeamSpot {
  frontZ: number;
  groundY: number;
  /** Lamp height / BEAM_LAMP_H. */
  k: number;
}

/** Brightness of NPC low beams on the ground (tunable): the ground beam's 1 (headlight's groundBeam). */
export const NPC_BEAM = { intensity: 5.9 };
/** How many of the nearest NPCs' headlights light tyre smoke. */
const SMOKE_BEAMS = 8;

/** A beam: its pair's middle, aimed along `a`, `r` toward its right lamp (world), and how near it is to the camera. */
interface Candidate {
  c: THREE.Vector3;
  a: THREE.Vector3;
  r: THREE.Vector3;
  dist2: number;
}

const BODY_AXIS = new THREE.Vector3(0, -Math.sin(AIM_DOWN), -Math.cos(AIM_DOWN)); // (a car's lamps, aimed a little down)
const BODY_RIGHT = new THREE.Vector3(1, 0, 0);

/**
 * NPC headlights as light in the ground materials' shaders rather than real lights: each beam's irradiance worked
 * out from its car's whole pose (headlight's groundBeam: leaning, on its side, on its roof, it lights the ground as
 * it would), multiplied by the surface's albedo (lane lines and asphalt texture stay visible) and summed before tone
 * mapping (overlapping beams roll off instead of adding up to flat white). The ground materials also take a rival's
 * real lamp as this beam (HT2_GROUND: headlight's installLowBeamShader), shadowed.
 */
export class NpcBeams {
  private readonly uniforms = {
    beamC: { value: Array.from({ length: MAX_BEAMS }, () => new THREE.Vector3()) },
    beamA: { value: Array.from({ length: MAX_BEAMS }, () => new THREE.Vector3()) },
    beamR: { value: Array.from({ length: MAX_BEAMS }, () => new THREE.Vector3()) },
    beamCount: { value: 0 },
    ht2GroundTint: { value: new THREE.Color() },
  };
  private cands: Candidate[] = [];
  private used: Candidate[] = [];
  private n = 0;

  /** Make a ground material receive NPC low beams (on top of any shader changes of its own). */
  patch(mat: THREE.MeshStandardMaterial): void {
    const own = mat.onBeforeCompile.bind(mat);
    const ownKey = mat.customProgramCacheKey.bind(mat)();
    mat.customProgramCacheKey = () => `${ownKey}|npcBeams`;
    mat.onBeforeCompile = (shader, renderer) => {
      own(shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBeamWorld;')
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\nvBeamWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
      shader.fragmentShader = `#define HT2_GROUND\n${shader.fragmentShader}`
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vBeamWorld;
uniform vec3 beamC[${MAX_BEAMS}];
uniform vec3 beamA[${MAX_BEAMS}];
uniform vec3 beamR[${MAX_BEAMS}];
uniform int beamCount;
uniform vec3 ht2GroundTint;`,
        )
        .replace(
          '#include <lights_pars_begin>',
          `#include <lights_pars_begin>
vec3 npcBeamIrradiance( vec3 p ) {
  float e = 0.0;
  for ( int i = 0; i < ${MAX_BEAMS}; i ++ ) {
    if ( i >= beamCount ) break;
    e += ht2GroundBeam( beamC[ i ], beamA[ i ], beamR[ i ], vec3( 0.0, 1.0, 0.0 ), p );
  }
  return e * ht2GroundTint;
}`,
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
reflectedLight.directDiffuse += BRDF_Lambert( diffuseColor.rgb ) * npcBeamIrradiance( vBeamWorld );`,
        );
    };
    mat.needsUpdate = true;
  }

  begin(): void {
    this.n = 0;
  }

  /** Offer one vehicle body's beam (call after its matrix is updated). */
  add(root: THREE.Object3D, camX: number, camZ: number): void {
    const spot = root.userData.beam as BeamSpot | undefined;
    if (!spot) return;
    let c = this.cands[this.n];
    if (!c) c = this.cands[this.n] = { c: new THREE.Vector3(), a: new THREE.Vector3(), r: new THREE.Vector3(), dist2: 0 };
    this.n++;
    c.c.set(0, spot.groundY + spot.k * BEAM_LAMP_H, spot.frontZ).applyMatrix4(root.matrix);
    c.a.copy(BODY_AXIS).applyQuaternion(root.quaternion);
    c.r.copy(BODY_RIGHT).applyQuaternion(root.quaternion);
    // Rank by distance to the beam's middle, so beams pointing at the camera win ties.
    const mx = c.c.x + c.a.x * 20 - camX;
    const mz = c.c.z + c.a.z * 20 - camZ;
    c.dist2 = mx * mx + mz * mz;
  }

  end(): void {
    const used = (this.used = this.cands.slice(0, this.n).sort((a, b) => a.dist2 - b.dist2));
    const count = Math.min(MAX_BEAMS, used.length);
    const u = this.uniforms;
    for (let i = 0; i < count; i++) {
      u.beamC.value[i].copy(used[i].c);
      u.beamA.value[i].copy(used[i].a);
      u.beamR.value[i].copy(used[i].r);
    }
    u.beamCount.value = count;
    u.ht2GroundTint.value.set(0xfff4e6).multiplyScalar(NPC_BEAM.intensity);
  }

  /**
   * The nearest NPCs' headlights as light sources for tyre smoke (call after end()): one low-beam spot per
   * vehicle, aimed as its body aims it, so smoke in front of a car turns white.
   */
  smokeLights(): SmokeLight[] {
    const cosOuter = Math.cos(HALF_ANGLE);
    const cosInner = Math.cos(HALF_ANGLE * (1 - PENUMBRA));
    return this.used.slice(0, SMOKE_BEAMS).map((c) => ({
      pos: c.c.clone(),
      color: new THREE.Color(0xfff4e6).multiplyScalar(HEADLIGHTS.pair),
      decay: 1,
      distance: 120,
      dir: c.a.clone(),
      cosOuter,
      cosInner,
      cookie: { right: c.r.clone(), up: new THREE.Vector3().crossVectors(c.r, c.a) },
    }));
  }
}
