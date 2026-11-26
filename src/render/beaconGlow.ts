import * as THREE from 'three';

/** How many light bars at once light the ground this way (the police's but the nearest: its own real light). */
export const MAX_GLOWS = 4;

/** A light bar's light as a point light gives it: candela, out to `distance` m, falling off by `decay`. */
export interface GlowLight {
  intensity: number;
  distance: number;
  decay: number;
}

/**
 * The police light bars' red and blue on the ground, as light in the ground materials' shaders, not real lights
 * (as render/npcBeams the traffic's headlights): the light of a point light at each (three.js's own: its fall-off by
 * distance and its cut-off, by the angle onto the surface), times the surface's albedo, added before tone mapping -
 * the ground lit as the nearest car's real light lights it (no seam between them), but only the ground (road,
 * grass), no cars, no rails, no glints. All in one colour: the bars flash together, red or blue.
 */
export class BeaconGlow {
  readonly uniforms = {
    glowPos: { value: Array.from({ length: MAX_GLOWS }, () => new THREE.Vector3()) },
    glowCount: { value: 0 },
    glowColor: { value: new THREE.Color() },
    glowCutoff: { value: 0 },
    glowDecay: { value: 2 },
  };

  /** Make a ground material lit by the light bars (on top of its own shader changes). */
  patch(mat: THREE.MeshStandardMaterial): void {
    const own = mat.onBeforeCompile.bind(mat);
    const ownKey = mat.customProgramCacheKey.bind(mat)();
    mat.customProgramCacheKey = () => `${ownKey}|beaconGlow`;
    mat.onBeforeCompile = (shader, renderer) => {
      own(shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform vec3 glowPos[${MAX_GLOWS}];
uniform int glowCount;
uniform vec3 glowColor;
uniform float glowCutoff;
uniform float glowDecay;`,
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
{
  float glowE = 0.0;
  for ( int i = 0; i < ${MAX_GLOWS}; i ++ ) {
    if ( i >= glowCount ) break;
    vec3 glowL = ( viewMatrix * vec4( glowPos[ i ], 1.0 ) ).xyz - geometryPosition;
    float glowD = length( glowL );
    glowE += saturate( dot( geometryNormal, glowL / glowD ) ) * getDistanceAttenuation( glowD, glowCutoff, glowDecay );
  }
  reflectedLight.directDiffuse += glowE * glowColor * BRDF_Lambert( diffuseColor.rgb );
}`,
        );
    };
    mat.needsUpdate = true;
  }

  /** None this frame (till `set`). */
  clear(): void {
    this.uniforms.glowCount.value = 0;
  }

  /**
   * This frame: light bars at the first `count` of `at` (world; past MAX_GLOWS left out), all `color`, each a point
   * light as `light`.
   */
  set(at: readonly THREE.Vector3[], count: number, color: THREE.ColorRepresentation, light: GlowLight): void {
    const u = this.uniforms;
    const n = Math.max(0, Math.min(MAX_GLOWS, count, at.length));
    for (let i = 0; i < n; i++) u.glowPos.value[i].copy(at[i]);
    u.glowCount.value = n;
    u.glowColor.value.set(color).multiplyScalar(light.intensity);
    u.glowCutoff.value = light.distance;
    u.glowDecay.value = light.decay;
  }
}
