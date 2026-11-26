import * as THREE from 'three';

/** How many light bars at once light the ground this way. */
export const MAX_GLOWS = 4;

/** A light bar's light as a point light gives it: candela, out to `distance` m, falling off by `decay`. */
export interface GlowLight {
  intensity: number;
  distance: number;
  decay: number;
}

/** A level rectangle of a car's body (its mesh's space): at height `y`, `x` either side, from `z0` to `z1`. */
export interface ShadeRect {
  y: number;
  x: number;
  z0: number;
  z1: number;
}

/**
 * What of its own car shades a light bar's light: its roof and its body at its shoulders (each a level rectangle:
 * a light over the roof is cut off by its outline), their shadows' edges softened over `soft` m at the rectangle (the
 * bar no point: its penumbra, wider the further it falls).
 */
export interface GlowShade {
  roof: ShadeRect;
  body: ShadeRect;
  soft: number;
}

/** One light bar this frame: where (world), where on its car (its mesh's space), and world -> that space. */
export interface GlowSpot {
  pos: THREE.Vector3;
  local: THREE.Vector3;
  inv: THREE.Matrix4;
}

const POINT_INFO = 'getPointLightInfo( pointLight, geometryPosition, directLight );';

/**
 * The police light bars' red and blue on the ground, as light in the ground materials' shaders, not real lights
 * (as render/npcBeams the traffic's headlights): the light of a point light at each (three.js's own: its fall-off by
 * distance and its cut-off, by the angle onto the surface), shaded by its own car (GlowShade: the ground round it
 * dark, not lit under it - it floated on its pool of light), shaded as three shades a point light (RE_Direct: its
 * diffuse and its glints).
 * The ground only (road, grass): the real light of the nearest (as bright, a point light of the same `decay`) lights
 * all but the ground - these materials leave it out, these the ground's light.
 */
export class BeaconGlow {
  readonly uniforms = {
    glowPos: { value: Array.from({ length: MAX_GLOWS }, () => new THREE.Vector3()) },
    glowLocal: { value: Array.from({ length: MAX_GLOWS }, () => new THREE.Vector3()) },
    glowInv: { value: Array.from({ length: MAX_GLOWS }, () => new THREE.Matrix4()) },
    glowCount: { value: 0 },
    glowColor: { value: new THREE.Color() },
    glowCutoff: { value: 0 },
    /** (-1 till set: no point light's) */
    glowDecay: { value: -1 },
    /** The roof's and the body's rectangles: (y, x, z0, z1) each; their edges' softness. */
    glowRoof: { value: new THREE.Vector4() },
    glowBody: { value: new THREE.Vector4() },
    glowSoft: { value: 0.1 },
  };

  /** Make a ground material lit by the light bars (on top of its own shader changes). */
  patch(mat: THREE.MeshStandardMaterial): void {
    const own = mat.onBeforeCompile.bind(mat);
    const ownKey = mat.customProgramCacheKey.bind(mat)();
    mat.customProgramCacheKey = () => `${ownKey}|beaconGlow`;
    mat.onBeforeCompile = (shader, renderer) => {
      own(shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      // (three's lights, as patched by then: the light bars' real light left out here)
      const begin = THREE.ShaderChunk.lights_fragment_begin;
      if (!begin.includes(POINT_INFO)) throw new Error('BeaconGlow: three.js point light code changed');
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGlowWorld;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvGlowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vGlowWorld;
uniform vec3 glowPos[${MAX_GLOWS}];
uniform vec3 glowLocal[${MAX_GLOWS}];
uniform mat4 glowInv[${MAX_GLOWS}];
uniform int glowCount;
uniform vec3 glowColor;
uniform float glowCutoff;
uniform float glowDecay;
uniform vec4 glowRoof;
uniform vec4 glowBody;
uniform float glowSoft;
// How much of a level rectangle r (y, x, z0, z1) stands between light l and point p (its car's space), 0..1 (soft).
float glowShade( vec3 l, vec3 p, vec4 r ) {
  if ( !( p.y < r.x && l.y > r.x ) ) return 0.0;
  vec3 h = mix( l, p, ( l.y - r.x ) / ( l.y - p.y ) );
  float inside = min( r.y - abs( h.x ), min( h.z - r.z, r.w - h.z ) );
  return smoothstep( - glowSoft, glowSoft, inside );
}`,
        )
        .replace(
          '#include <lights_fragment_begin>',
          begin.replace(POINT_INFO, `${POINT_INFO}\n\t\tif ( abs( pointLight.decay - glowDecay ) < 1e-4 ) directLight.color = vec3( 0.0 );`),
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
for ( int i = 0; i < ${MAX_GLOWS}; i ++ ) {
  if ( i >= glowCount ) break;
  vec3 glowL = ( viewMatrix * vec4( glowPos[ i ], 1.0 ) ).xyz - geometryPosition;
  float glowD = length( glowL );
  if ( glowD >= glowCutoff ) continue;
  vec3 glowP = ( glowInv[ i ] * vec4( vGlowWorld, 1.0 ) ).xyz;
  float glowLit = 1.0 - max( glowShade( glowLocal[ i ], glowP, glowRoof ), glowShade( glowLocal[ i ], glowP, glowBody ) );
  if ( glowLit <= 0.0 ) continue;
  // (shaded as three shades a point light: its diffuse and its glints on the asphalt both)
  directLight.direction = glowL / glowD;
  directLight.color = glowColor * glowLit * getDistanceAttenuation( glowD, glowCutoff, glowDecay );
  directLight.visible = true;
  RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
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
   * This frame: light bars at the first `count` of `spots` (past MAX_GLOWS left out), all `color`, each a point light
   * as `light` (the real one's `decay`: that one left out of the ground), each shaded by its car as `shade`.
   */
  set(spots: readonly GlowSpot[], count: number, color: THREE.ColorRepresentation, light: GlowLight, shade: GlowShade): void {
    const u = this.uniforms;
    const n = Math.max(0, Math.min(MAX_GLOWS, count, spots.length));
    for (let i = 0; i < n; i++) {
      u.glowPos.value[i].copy(spots[i].pos);
      u.glowLocal.value[i].copy(spots[i].local);
      u.glowInv.value[i].copy(spots[i].inv);
    }
    u.glowCount.value = n;
    u.glowColor.value.set(color).multiplyScalar(light.intensity);
    u.glowCutoff.value = light.distance;
    u.glowDecay.value = light.decay;
    const r = shade.roof, b = shade.body;
    u.glowRoof.value.set(r.y, r.x, r.z0, r.z1);
    u.glowBody.value.set(b.y, b.x, b.z0, b.z1);
    u.glowSoft.value = shade.soft;
  }
}
