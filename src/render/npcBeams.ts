import * as THREE from 'three';
import { AIM_DOWN, BEAM_GROUND_L, BEAM_GROUND_W, BEAM_LAMP_H, HALF_ANGLE, lowBeamGroundTexture, PENUMBRA } from '../vehicles/headlight';
import type { SmokeLight } from '../world/tireSmoke';

/** How many NPC low beams light the ground at once (the nearest ones). */
export const MAX_BEAMS = 32;

/** Where a model's low beam starts (model-local), stored in root.userData.beam. */
export interface BeamSpot {
  frontZ: number;
  groundY: number;
  /** Lamp height / BEAM_LAMP_H: the pattern on the ground scales with it. */
  k: number;
}

/** Brightness of NPC low beams on the ground (tunable). */
export const NPC_BEAM = { intensity: 7 };
/** NPC headlight pair as a light source for tyre smoke (candela, like the player's). */
const NPC_HEADLIGHT_CD = 900;
/** How many of the nearest NPCs' headlights light tyre smoke. */
const SMOKE_BEAMS = 8;

interface Candidate {
  x: number;
  y: number; // lamp height (world)
  z: number;
  fx: number;
  fz: number;
  k: number;
  pitch: number;
  dist2: number;
}

const V = new THREE.Vector3();
const D = new THREE.Vector3();

/**
 * NPC headlights as light in the ground materials' shaders rather than decals
 * painted over them: each beam's irradiance comes from the same low-beam ground
 * pattern as the player's real lights, is multiplied by the surface's albedo
 * (lane lines and asphalt texture stay visible) and summed before tone mapping
 * (overlapping beams roll off instead of adding up to flat white).
 */
export class NpcBeams {
  private readonly uniforms = {
    beamTex: { value: lowBeamGroundTexture() },
    beamPos: { value: Array.from({ length: MAX_BEAMS }, () => new THREE.Vector4()) },
    beamDir: { value: Array.from({ length: MAX_BEAMS }, () => new THREE.Vector2()) },
    beamCount: { value: 0 },
    beamColor: { value: new THREE.Color() },
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
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vBeamWorld;
uniform sampler2D beamTex;
uniform vec4 beamPos[${MAX_BEAMS}]; // lamp front x, z; height scale k; pitch (nose down > 0)
uniform vec2 beamDir[${MAX_BEAMS}]; // heading on the ground (unit x, z)
uniform int beamCount;
uniform vec3 beamColor;
vec3 npcBeamIrradiance(vec2 p) {
  vec3 e = vec3(0.0);
  for (int i = 0; i < ${MAX_BEAMS}; i++) {
    if (i >= beamCount) break;
    vec4 b = beamPos[i];
    vec2 f = beamDir[i];
    vec2 rel = (p - b.xy) / b.z;
    float d = dot(rel, f);
    float x = dot(rel, vec2(-f.y, f.x));
    if (d <= 0.01 || d > ${BEAM_GROUND_L.toFixed(1)} * 1.5 || abs(x) > ${(BEAM_GROUND_W / 2).toFixed(1)} * 1.5) continue;
    // Undo the body pitch: light reaching depression angle a left the lamp at a - pitch.
    float a0 = atan(${BEAM_LAMP_H.toFixed(3)} / d) - b.w;
    if (a0 <= 0.001) continue;
    float d0 = ${BEAM_LAMP_H.toFixed(3)} / tan(a0);
    vec2 uv = vec2(x * d0 / d / ${BEAM_GROUND_W.toFixed(1)} + 0.5, d0 / ${BEAM_GROUND_L.toFixed(1)});
    if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) continue;
    e += texture2D(beamTex, uv).rgb / b.z; // a pattern k times larger is k times dimmer
  }
  return e * beamColor;
}`,
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
reflectedLight.directDiffuse += BRDF_Lambert(diffuseColor.rgb) * npcBeamIrradiance(vBeamWorld.xz);`,
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
    D.set(0, 1, 0).applyQuaternion(root.quaternion);
    if (D.y < 0.7) return; // rolled or flipped: lights point anywhere but the road
    V.set(0, spot.groundY, spot.frontZ).applyMatrix4(root.matrix);
    D.set(0, 0, -1).applyQuaternion(root.quaternion);
    const h = Math.hypot(D.x, D.z);
    if (h < 1e-3) return;
    let c = this.cands[this.n];
    if (!c) c = this.cands[this.n] = { x: 0, y: 0, z: 0, fx: 0, fz: 0, k: 1, pitch: 0, dist2: 0 };
    this.n++;
    c.x = V.x;
    c.y = V.y + spot.k * BEAM_LAMP_H;
    c.z = V.z;
    c.fx = D.x / h;
    c.fz = D.z / h;
    c.k = spot.k;
    c.pitch = -Math.asin(THREE.MathUtils.clamp(D.y, -1, 1));
    // Rank by distance to the beam's middle, so beams pointing at the camera win ties.
    const mx = c.x + c.fx * 20 - camX;
    const mz = c.z + c.fz * 20 - camZ;
    c.dist2 = mx * mx + mz * mz;
  }

  end(): void {
    const used = (this.used = this.cands.slice(0, this.n).sort((a, b) => a.dist2 - b.dist2));
    const count = Math.min(MAX_BEAMS, used.length);
    const u = this.uniforms;
    for (let i = 0; i < count; i++) {
      const c = used[i];
      u.beamPos.value[i].set(c.x, c.z, c.k, c.pitch);
      u.beamDir.value[i].set(c.fx, c.fz);
    }
    u.beamCount.value = count;
    u.beamColor.value.set(0xfff4e6).multiplyScalar(NPC_BEAM.intensity);
  }

  /**
   * The nearest NPCs' headlights as light sources for tyre smoke (call after
   * end()): one low-beam spot per vehicle, aimed like the player's lamps and
   * tilted with the body's pitch, so smoke in front of a car turns white.
   */
  smokeLights(): SmokeLight[] {
    const cosOuter = Math.cos(HALF_ANGLE);
    const cosInner = Math.cos(HALF_ANGLE * (1 - PENUMBRA));
    return this.used.slice(0, SMOKE_BEAMS).map((c) => {
      const down = AIM_DOWN + c.pitch;
      const dir = new THREE.Vector3(c.fx * Math.cos(down), -Math.sin(down), c.fz * Math.cos(down));
      const right = new THREE.Vector3().crossVectors(dir, THREE.Object3D.DEFAULT_UP).normalize();
      return {
        pos: new THREE.Vector3(c.x, c.y, c.z),
        color: new THREE.Color(0xfff4e6).multiplyScalar(NPC_HEADLIGHT_CD),
        decay: 1,
        distance: 120,
        dir,
        cosOuter,
        cosInner,
        cookie: { right, up: new THREE.Vector3().crossVectors(right, dir) },
      };
    });
  }
}
