import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/** Most taps along a pixel's smear (one every 2 pixels of it: a pixel near where the car is going takes one). */
const MAX_TAPS = 12;

/**
 * The speed blur in GLSL, for a pass of its own or folded into another (ToneMapFxaaPass): `speedBlurred` is the
 * picture at `uv` smeared toward and away from `blurCenter`, the farther the more (`blurAmount` of the way), and
 * across by `blurSweep`; `texel` is a pixel's size (1 / the picture's).
 */
export const SPEED_BLUR_GLSL = /* glsl */ `
uniform vec2 blurCenter;
uniform float blurAmount;
uniform vec2 blurSweep;
vec3 speedBlurred( sampler2D tex, vec2 uv, vec2 texel ) {
  vec2 smear = ( uv - blurCenter ) * blurAmount + blurSweep;
  int n = int( clamp( length( smear / texel ) * 0.5, 1.0, ${MAX_TAPS.toFixed(1)} ) );
  if ( n <= 1 ) return texture( tex, uv ).rgb;
  vec3 sum = vec3( 0.0 );
  for ( int i = 0; i < ${MAX_TAPS}; i++ ) {
    if ( i >= n ) break;
    sum += texture( tex, uv - smear * ( float( i ) / float( n - 1 ) - 0.5 ) ).rgb;
  }
  return sum / float( n );
}`;

/** The speed blur's uniforms (SPEED_BLUR_GLSL's), off. */
export function speedBlurUniforms() {
  return { blurCenter: { value: new THREE.Vector2(0.5, 0.5) }, blurAmount: { value: 0 }, blurSweep: { value: new THREE.Vector2() } };
}

/** Set a material's speed blur uniforms; whether there is any blur. */
export function setSpeedBlur(uniforms: Record<string, THREE.IUniform>, center: THREE.Vector2, amount: number, sweep: THREE.Vector2): boolean {
  uniforms.blurCenter.value.copy(center);
  uniforms.blurAmount.value = amount;
  uniforms.blurSweep.value.copy(sweep);
  return amount > 1e-4 || sweep.lengthSq() > 1e-8;
}

/** How much the picture smears out from the motion's centre (its share of the way there): by speed, more with the nitro. */
export function blurAmount(kmh: number, nitro: boolean, p: { from: number; full: number; strength: number; nitro: number }): number {
  const k = THREE.MathUtils.clamp((kmh - p.from) / (p.full - p.from), 0, 1);
  return k * p.strength * (nitro ? p.nitro : 1);
}

const V = new THREE.Vector3();

/**
 * Where the camera is going, on the screen (0..1, y up): `velocity`'s direction from the camera, projected. The
 * point everything streams out from - off the middle when the car slides or swings round. Null standing or
 * going away from where the camera looks.
 */
export function motionCenter(camera: THREE.Camera, velocity: THREE.Vector3): THREE.Vector2 | null {
  if (velocity.lengthSq() < 1e-6) return null;
  V.copy(velocity).normalize().multiplyScalar(100).add(camera.getWorldPosition(new THREE.Vector3()));
  V.applyMatrix4(camera.matrixWorldInverse);
  if (V.z >= -1e-3) return null; // (behind the camera)
  V.applyMatrix4(camera.projectionMatrix);
  return new THREE.Vector2(V.x * 0.5 + 0.5, V.y * 0.5 + 0.5);
}

/**
 * The speed blur as a pass of its own, on the HDR picture (the lights streak), before the tone mapping: for
 * SMAA / MSAA / none (with FXAA it is folded into ToneMapFxaaPass, a full-screen pass fewer).
 */
export class SpeedBlurPass extends ShaderPass {
  constructor() {
    super({
      name: 'SpeedBlurShader',
      uniforms: { tDiffuse: { value: null }, texel: { value: new THREE.Vector2(1 / 1024, 1 / 512) }, ...speedBlurUniforms() },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec2 texel;
        varying vec2 vUv;
        ${SPEED_BLUR_GLSL}
        void main() {
          gl_FragColor = vec4(speedBlurred(tDiffuse, vUv, texel), 1.0);
        }`,
    });
  }

  setSize(width: number, height: number): void {
    this.material.uniforms.texel.value.set(1 / width, 1 / height);
  }

  /** This frame's blur (none, or `off`: the pass is skipped). */
  set(center: THREE.Vector2, amount: number, sweep: THREE.Vector2, off = false): void {
    this.enabled = setSpeedBlur(this.material.uniforms, center, amount, sweep) && !off;
  }
}
