import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { FullResBloomPass } from './bloomPass';
import { FlarePass } from './flarePass';
import { SpeedBlurPass, type BlurMask } from './speedBlur';
import { ToneMapFxaaPass } from './toneMapFxaaPass';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

export type Antialias = 'fxaa' | 'smaa' | 'msaa' | 'none';

const ZERO = new THREE.Vector2();

/** The race's post-processing (mutable: tuned live from the panel). */
export const POST = {
  // Edges smoothed after the picture (one cheap pass) rather than by multisampling: 4x MSAA at full resolution
  // ate a third of the frame on an integrated GPU.
  antialias: 'fxaa' as Antialias,
  bloom: true,
  strength: 0.05,
  radius: 0,
  // Only the lights themselves (flames, sparks, lamp heads) glow: at 1 the start's floodlit cars and road hazed over.
  threshold: 2.05,
  /** The bloom's own pictures, times the screen's (three's: from half of that down). */
  bloomScale: 0.5,
  /** The speed blur (render/speedBlur): from `blurFrom` km/h, full (`blurStrength`) at `blurFull`, times `blurNitro` with the nitro. */
  speedBlur: true,
  blurFrom: 120,
  blurFull: 300,
  blurStrength: 0.05,
  blurNitro: 1.5,
  /** The camera's turning smeared across, times what a 1/60 s exposure would. */
  blurTurn: 1,
};

/**
 * The race's picture through a bloom, as the garage's: the scene into an HDR target, its lights glowing, tone
 * mapped, its edges smoothed (POST.antialias; the canvas has none of its own: FXAA tone maps as it smooths).
 */
export class PostFx {
  private readonly composer: EffectComposer;
  private readonly bloom: FullResBloomPass;
  private readonly output = new OutputPass();
  private readonly fxaa = new ToneMapFxaaPass(); // (tone maps too: the OutputPass off with it)
  private readonly smaa = new SMAAPass();
  /** The speed blur, set each frame (motion()); skipped when there is none. */
  private readonly blur = new SpeedBlurPass();
  private samples = 0;
  private bloomScale = 1;
  private readonly size = new THREE.Vector2();
  /** Drawn after the bloom, so never glowing (its fog the scene's). */
  readonly unbloomed = new THREE.Scene();
  /** The vehicles' lamp glows, over the scene, each faded by how much of it is hidden (render/flarePass). */
  readonly flares: FlarePass;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ) {
    // (its depth a texture: the flares read it; the composer's second target gets one of its own)
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.samples, depthTexture: new THREE.DepthTexture(1, 1) });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.flares = new FlarePass(camera);
    this.composer.addPass(this.flares);
    this.bloom = new FullResBloomPass(new THREE.Vector2(1, 1), POST.strength, POST.radius, POST.threshold);
    this.composer.addPass(this.bloom);
    // Then what is lit, not alight, however bright (tyre smoke by a headlight): over the bloom, in the same depth.
    const late = new RenderPass(this.unbloomed, camera);
    late.clear = false;
    this.composer.addPass(late);
    // The speed blur on the HDR picture, smoke and all (the lights streak), before the tone mapping: a pass of its
    // own for SMAA / MSAA / none (with FXAA it is folded into that pass).
    this.composer.addPass(this.blur);
    this.composer.addPass(this.output);
    // (FXAA tone maps as it reads; SMAA after the tone mapping: on the picture as it will be seen.)
    this.composer.addPass(this.fxaa);
    this.composer.addPass(this.smaa);
  }

  setSize(w: number, h: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.size.set(w, h).multiplyScalar(this.renderer.getPixelRatio());
    this.bloomScale = 1; // (the composer just sized it to the screen)
  }

  /** This frame's speed blur: where the camera is going on the screen, how much, and across by its turning. */
  motion(center: THREE.Vector2, amount: number, sweep: THREE.Vector2, mask?: BlurMask): void {
    const a = POST.speedBlur ? amount : 0;
    const s = POST.speedBlur ? sweep : ZERO;
    // With FXAA, folded into its pass (a full-screen pass fewer); else a pass of its own.
    this.fxaa.blur(center, a, s, mask);
    this.blur.set(center, a, s, mask, POST.antialias === 'fxaa');
  }

  render(): void {
    const samples = POST.antialias === 'msaa' ? 4 : 0;
    if (samples !== this.samples) {
      this.samples = samples;
      for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) {
        t.samples = samples;
        t.dispose(); // (made again, so, at the next render)
      }
    }
    if (POST.bloomScale !== this.bloomScale) {
      this.bloomScale = POST.bloomScale;
      this.bloom.setSize(Math.round(this.size.x * this.bloomScale), Math.round(this.size.y * this.bloomScale));
    }
    this.unbloomed.fog = this.scene.fog;
    this.fxaa.enabled = POST.antialias === 'fxaa';
    this.output.enabled = !this.fxaa.enabled;
    this.smaa.enabled = POST.antialias === 'smaa';
    this.bloom.enabled = POST.bloom;
    this.bloom.strength = POST.strength;
    this.bloom.radius = POST.radius;
    this.bloom.threshold = POST.threshold;
    this.composer.render();
  }
}
