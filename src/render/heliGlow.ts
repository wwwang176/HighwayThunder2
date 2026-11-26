import * as THREE from 'three';

/**
 * Light on the police helicopter's body that no real light gives it, in its materials' shaders (as render/beaconGlow
 * the light bars' on the ground): against the night sky it was all but black, only its navigation lights seen.
 * - the city's glow from under it: an irradiance `city` on what faces down, half that on its sides, none on its top;
 * - its searchlight's pool on the road lighting it back up: a point light at the pool (`pool`, world), `bounce`
 *   candela straight up (less the further over: the pool a lit surface facing up), falling off by `decay` - shaded as
 *   three shades a point light (RE_Direct), no shadow.
 * Its own materials only (a few meshes, small on the screen): no real light, which every shader would count.
 */
export class HeliGlow {
  readonly uniforms = {
    heliCity: { value: new THREE.Color(0, 0, 0) },
    heliPool: { value: new THREE.Vector3() },
    heliBounce: { value: new THREE.Color(0, 0, 0) },
    heliDecay: { value: 2 },
  };

  /** Make a material of the helicopter lit so (on top of its own shader changes). */
  patch(mat: THREE.MeshStandardMaterial): void {
    const own = mat.onBeforeCompile.bind(mat);
    const ownKey = mat.customProgramCacheKey.bind(mat)();
    mat.customProgramCacheKey = () => `${ownKey}|heliGlow`;
    mat.onBeforeCompile = (shader, renderer) => {
      own(shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vHeliWorld;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvHeliWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vHeliWorld;
uniform vec3 heliCity;
uniform vec3 heliPool;
uniform vec3 heliBounce;
uniform float heliDecay;`,
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
{
  // (the city's glow: from under it, none from over it)
  vec3 heliN = inverseTransformDirection( geometryNormal, viewMatrix );
  reflectedLight.indirectDiffuse += heliCity * ( 0.5 - 0.5 * heliN.y ) * BRDF_Lambert( material.diffuseColor );
  // (its searchlight's pool, lighting it back up)
  if ( heliBounce.r + heliBounce.g + heliBounce.b > 0.0 ) {
    vec3 heliL = ( viewMatrix * vec4( heliPool, 1.0 ) ).xyz - geometryPosition;
    float heliD = length( heliL );
    float heliUp = saturate( ( vHeliWorld.y - heliPool.y ) / max( heliD, 1e-3 ) );
    IncidentLight heliLight;
    heliLight.direction = heliL / max( heliD, 1e-3 );
    heliLight.color = heliBounce * heliUp * getDistanceAttenuation( heliD, 0.0, heliDecay );
    heliLight.visible = true;
    RE_Direct( heliLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  }
}`,
        );
    };
    mat.needsUpdate = true;
  }

  /**
   * This frame: the city's glow (`city` colour, `strength` its irradiance) and the pool of its light at `pool`
   * (world), `bounce` candela up in `color`, falling off by `decay` (0: none).
   */
  set(city: THREE.ColorRepresentation, strength: number, pool: THREE.Vector3, color: THREE.ColorRepresentation, bounce: number, decay: number): void {
    const u = this.uniforms;
    u.heliCity.value.set(city).multiplyScalar(Math.max(0, strength));
    u.heliPool.value.copy(pool);
    u.heliBounce.value.set(color).multiplyScalar(Math.max(0, bounce));
    u.heliDecay.value = decay;
  }
}
