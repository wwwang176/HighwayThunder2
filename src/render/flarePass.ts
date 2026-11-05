import * as THREE from 'three';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';

/** What flares that look at the scene's depth need (LightFlares' `occluded` mode): set by the FlarePass each frame. */
export interface FlareDepth {
  tDepth: { value: THREE.Texture | null };
  depthRes: { value: THREE.Vector2 };
  cameraNear: { value: number };
  cameraFar: { value: number };
}

/**
 * The vehicles' lamp glows drawn over the scene once it is drawn, each one seeing from the scene's depth how much
 * of it is hidden (a few points across it) and fading whole by that: behind a car, a rail, the glow dims and goes
 * smoothly, instead of the depth test cutting its sprite with a hard edge (a fender through half of it). Before the
 * bloom (they glow) and what is drawn after it. (A target's depth can't be read while drawing into it: a copy.)
 */
export class FlarePass extends Pass {
  /** The flares (LightFlares made with this pass's `depth`). */
  readonly scene = new THREE.Scene();
  readonly depth: FlareDepth = {
    tDepth: { value: null },
    depthRes: { value: new THREE.Vector2(1, 1) },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 1000 },
  };
  private readonly copy = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) });
  private ready = false;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    super();
    this.needsSwap = false;
    this.depth.tDepth.value = this.copy.depthTexture;
  }

  setSize(width: number, height: number): void {
    this.copy.setSize(width, height);
    this.depth.depthRes.value.set(width, height);
    this.ready = false;
  }

  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    if (!read.depthTexture) return;
    if (!this.ready) {
      renderer.initRenderTarget(this.copy);
      this.ready = true;
    }
    renderer.copyTextureToTexture(read.depthTexture, this.copy.depthTexture!);
    this.depth.cameraNear.value = this.camera.near;
    this.depth.cameraFar.value = this.camera.far;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(read);
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }

  dispose(): void {
    this.copy.dispose();
  }
}
