import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** The most source pixels across (and down) one bright-pass pixel takes in: a bloom at an eighth of the screen. */
const MOST_STEPS = 8;

const pickShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    texel: { value: new THREE.Vector2() },
    steps: { value: new THREE.Vector2(1, 1) },
    threshold: { value: 1 },
    smoothWidth: { value: 0.01 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 texel;
    uniform vec2 steps;
    uniform float threshold;
    uniform float smoothWidth;
    varying vec2 vUv;
    void main() {
      vec4 sum = vec4(0.0);
      vec2 origin = vUv - 0.5 * steps * texel + 0.5 * texel; // the first source pixel's centre under this one
      for (int j = 0; j < ${MOST_STEPS}; j++) {
        if (float(j) >= steps.y) break;
        for (int i = 0; i < ${MOST_STEPS}; i++) {
          if (float(i) >= steps.x) break;
          vec4 c = texture2D(tDiffuse, origin + vec2(float(i), float(j)) * texel);
          float v = dot(c.rgb, vec3(0.2126729, 0.7151522, 0.0721750)); // (three's luminance, as its own bright pass)
          sum += c * smoothstep(threshold, threshold + smoothWidth, v);
        }
      }
      gl_FragColor = sum / (steps.x * steps.y);
    }`,
};

/**
 * three's UnrealBloomPass, its bright parts picked out at the full picture's resolution. Its own bright pass runs on
 * the picture shrunk (to half of the size it's given, itself a share of the screen's: POST.bloomScale): a lamp only
 * a pixel or two across is averaged with the dark round it first, so most of it falls under the threshold and only
 * patches of it glow. Here each pixel is held against the threshold first, those over it averaged down into the
 * bright pass's size (a thin lamp still all there, its glow only fainter, as its light is less), and the pass's
 * own bright pass made a plain copy of that (threshold 0, reading ours). The rest of it - its blurs, its mix over
 * the picture - as it was.
 */
export class FullResBloomPass extends UnrealBloomPass {
  private readonly picked = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private readonly pick = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(pickShader.uniforms),
    vertexShader: pickShader.vertexShader,
    fragmentShader: pickShader.fragmentShader,
  });
  private readonly quad = new FullScreenQuad(this.pick);

  constructor(resolution: THREE.Vector2, strength: number, radius: number, threshold: number) {
    super(resolution, strength, radius, threshold);
    this.picked.texture.generateMipmaps = false;
    // Its bright pass reads ours, whatever it is told to read (it sets its source every render).
    const picked = this.picked;
    (this.highPassUniforms as Record<string, THREE.IUniform>).tDiffuse = {
      get value() {
        return picked.texture;
      },
      set value(_: unknown) {},
    };
    this.picked.setSize(Math.round(resolution.x / 2), Math.round(resolution.y / 2));
  }

  override setSize(width: number, height: number): void {
    super.setSize(width, height);
    this.picked.setSize(Math.round(width / 2), Math.round(height / 2)); // (the size of its own bright pass)
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    const u = this.pick.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.texel.value.set(1 / readBuffer.width, 1 / readBuffer.height);
    u.steps.value.set(
      Math.min(MOST_STEPS, Math.max(1, Math.round(readBuffer.width / this.picked.width))),
      Math.min(MOST_STEPS, Math.max(1, Math.round(readBuffer.height / this.picked.height))),
    );
    u.threshold.value = this.threshold;
    renderer.setRenderTarget(this.picked);
    this.quad.render(renderer);
    const threshold = this.threshold;
    this.threshold = 0; // (its own bright pass: a copy of ours)
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    this.threshold = threshold;
  }

  override dispose(): void {
    super.dispose();
    this.picked.dispose();
    this.pick.dispose();
    this.quad.dispose();
  }
}
