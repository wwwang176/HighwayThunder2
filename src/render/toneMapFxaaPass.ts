import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { setSpeedBlur, SPEED_BLUR_GLSL, speedBlurUniforms } from './speedBlur';

const SAMPLE = 'return texture( tex2D, uv );';
const LUMA = 'return dot( Sample( tex2D, uv ).rgb, vec3( 0.3, 0.59, 0.11 ) );';

/**
 * three's ACES filmic tone mapping and sRGB encoding (tonemapping_pars_fragment, colorspace_pars_fragment), under
 * names of their own: a ShaderMaterial gets three's only when it draws to the screen (and then twice, if included).
 */
const TONE_MAP = /* glsl */ `
uniform float exposure;
vec3 tmRRTAndODTFit( vec3 v ) {
  vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
  vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
  return a / b;
}
vec3 tmACES( vec3 color ) {
  const mat3 inMat = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
  const mat3 outMat = mat3( vec3( 1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 ) );
  color *= exposure / 0.6;
  color = outMat * tmRRTAndODTFit( inMat * color );
  return clamp( color, 0.0, 1.0 );
}
vec3 tmSRGB( vec3 c ) {
  return mix( pow( c, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) );
}`;

/**
 * OutputPass, FXAA and the speed blur in one: FXAA reading the HDR picture, what it shows smeared (blur()),
 * tone mapped (ACES, the renderer's exposure) and made sRGB as it is read. Full-screen passes fewer (each the
 * picture written out and read back again: ~1.3 ms a frame at 2560 x 1341 on an integrated GPU).
 */
export class ToneMapFxaaPass extends ShaderPass {
  constructor() {
    if (!FXAAShader.fragmentShader.includes(SAMPLE) || !FXAAShader.fragmentShader.includes(LUMA)) {
      throw new Error('ToneMapFxaaPass: FXAAShader changed (its Sample() / SampleLuminance())');
    }
    super({
      name: 'ToneMapFxaaShader',
      uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new THREE.Vector2(1 / 1024, 1 / 512) },
        exposure: { value: 1 },
        ...speedBlurUniforms(),
      },
      vertexShader: FXAAShader.vertexShader,
      fragmentShader: FXAAShader.fragmentShader
        .replace('uniform sampler2D tDiffuse;', `uniform sampler2D tDiffuse;\n${TONE_MAP}\n${SPEED_BLUR_GLSL}`)
        // What it shows: the speed blur's smear of the HDR picture (one tap where there is none), then tone mapped.
        .replace(SAMPLE, 'return vec4( tmSRGB( tmACES( speedBlurred( tex2D, uv, resolution ) ) ), 1.0 );')
        // Its edge finding (9 to 21 taps a pixel) on a cheap stand-in for the tone mapped luma (rising like it, 0..1,
        // gamma-ish); the full tone mapping only for the one tap it shows.
        .replace(LUMA, 'float l = dot( texture( tex2D, uv ).rgb, vec3( 0.3, 0.59, 0.11 ) ) * exposure;\nreturn sqrt( l / ( 1.0 + l ) );'),
    });
  }

  setSize(width: number, height: number): void {
    this.material.uniforms.resolution.value.set(1 / width, 1 / height);
  }

  /** This frame's speed blur (render/speedBlur), smeared into what it shows. */
  blur(center: THREE.Vector2, amount: number, sweep: THREE.Vector2): void {
    setSpeedBlur(this.material.uniforms, center, amount, sweep);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
    this.material.uniforms.exposure.value = renderer.toneMappingExposure;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}
