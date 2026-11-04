import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { NpcBeams } from '../render/npcBeams';
import { CARS } from '../vehicles/cars';
import { buildCar } from '../vehicles/models';
import { PLAYER_H, PLAYER_L, PLAYER_W } from '../vehicles/playerCar';

const SKY = `${import.meta.env.BASE_URL}ui/garage-sky.jpg`;

// The camera: round the car (at the origin, its nose toward the camera's left), swinging slowly either side of a
// front three-quarter view, close.
const CAM = { r: 8.2, h: 1.1, look: 0.6, base: -0.42, swing: 0.35, period: 26, fov: 26 };
// Its nose (-z) turned toward the camera, three-quarter: the swing never brings the camera closer than 8 degrees
// to straight ahead of it (from there to 48).
const CAR_YAW = Math.PI - 0.9;
// Where things stand (the camera looks along -z): the lamp front right, the guardrail along the right, the
// parking bays under the car, the city far ahead.
// (Beside the car, not behind it: behind, the windscreens mirrored it into the camera, glaring.)
const LAMP = { x: 4.6, z: 1.5, h: 6.6, arm: 1.5 };
const RAIL_X = 5.6;
const FAR = 140; // the backdrop's distance (a curved strip round the car); the ground 2 FAR across
const PUDDLES = 28; // the wet patches' picture, times across the ground (each 10 m)
/** The title: the picture shifted this share of the screen's width right (the car on the right half), sliding back to the garage's over SLIDE_SECONDS. */
const TITLE_SHIFT = 0.2; // (0.25: the car's tail off the right edge)
const SLIDE_SECONDS = 0.9;

/**
 * The garage's scene: the picked car parked on a wet lay-by at night, under a sodium lamp, the city's lights
 * out of focus beyond it; everything drawn live, the camera swinging slowly round the car's front. A wet
 * ground (its asphalt lit by the lamp, the scene mirrored in it, smeared and patchy), depth of field (the car
 * sharp), the lights' bloom. Only while the garage is open.
 */
export class GarageScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(CAM.fov, 1, 0.1, 400);
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly bokeh: BokehPass;
  private readonly shadow: THREE.Mesh;
  private readonly beams = new NpcBeams();
  private car: THREE.Object3D | null = null;
  private running = false;
  private t = 0;
  /** The picture's shift toward the right half (0: the car in the middle, 1: the title's), and its slide. */
  private shift = 0;
  private slideFrom = 0;
  private slideTo = 0;
  private slideT = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(1); // (the depth of field softens most of it anyway)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.scene.background = new THREE.Color(0x070a14);
    this.scene.fog = new THREE.Fog(0x080b15, 20, 110);

    this.scene.add(new THREE.HemisphereLight(0x5a6fb0, 0x120c06, 0.9));
    const rim = new THREE.DirectionalLight(0x7aa8ff, 1.2); // the city's glow behind the car, outlining it
    rim.position.set(-5, 4, -9);
    this.scene.add(rim);

    this.ground();
    this.bays();
    this.lamps();
    this.rail();
    this.backdrop();

    // A soft contact shadow under the car.
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.9)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.0, 5.4),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.set(-Math.PI / 2, 0, CAR_YAW);
    this.shadow.position.y = 0.006;
    this.shadow.renderOrder = 1;
    this.scene.add(this.shadow);

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Only the lights themselves bloom (over 1), not what they light.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.5, 1.0);
    this.composer.addPass(this.bloom);
    this.bokeh = new BokehPass(this.scene, this.camera, { focus: CAM.r, aperture: 0.0006, maxblur: 0.008 });
    this.composer.addPass(this.bokeh);
    this.composer.addPass(new OutputPass());
    addEventListener('resize', () => this.resize());
  }

  /** Car `id` in its paint job `livery` (none: its own). */
  show(id: string, livery?: string): void {
    if (this.car) this.scene.remove(this.car);
    const spec = CARS[id];
    this.car = buildCar(PLAYER_W, PLAYER_H, PLAYER_L, spec.color, spec.style, true, true, livery).root;
    this.car.position.y = PLAYER_H / 2; // on the ground
    this.car.rotation.y = CAR_YAW;
    this.car.updateMatrix();
    // Its low beam on the ground ahead, as the race's NPCs' (no real light: one by the nose, seen from in front,
    // glared off the wet asphalt right under the camera).
    this.beams.begin();
    this.beams.add(this.car, 0, 0);
    this.beams.end();
    this.scene.add(this.car);
    this.resize();
    if (!this.running) {
      this.running = true;
      let last = performance.now();
      const loop = (now: number) => {
        if (!this.running) return;
        const dt = Math.min(0.1, (now - last) / 1000);
        this.t += dt;
        last = now;
        this.slideOn(dt);
        this.frame();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  }

  stop(): void {
    this.running = false;
  }

  /**
   * The car on the right half of the screen (`right`: the title, its left half the game's name), or in the middle
   * (the garage); sliding there over SLIDE_SECONDS, or at once.
   */
  slide(right: boolean, animate: boolean): void {
    const to = right ? 1 : 0;
    if (!animate) {
      this.shift = this.slideTo = to;
      this.slideT = 1;
      this.placeView();
      return;
    }
    this.slideFrom = this.shift;
    this.slideTo = to;
    this.slideT = 0;
  }

  private slideOn(dt: number): void {
    if (this.slideT >= 1) return;
    this.slideT = Math.min(1, this.slideT + dt / SLIDE_SECONDS);
    const k = this.slideT * this.slideT * (3 - 2 * this.slideT);
    this.shift = this.slideFrom + (this.slideTo - this.slideFrom) * k;
    this.placeView();
  }

  private frame(): void {
    const a = CAM.base + CAM.swing * Math.sin((this.t / CAM.period) * Math.PI * 2);
    this.camera.position.set(CAM.r * Math.sin(a), CAM.h, CAM.r * Math.cos(a));
    this.camera.lookAt(0, CAM.look, 0);
    (this.bokeh.uniforms as { focus: { value: number } }).focus.value = this.camera.position.distanceTo(new THREE.Vector3(0, CAM.look, 0));
    this.composer.render();
  }

  private resize(): void {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.placeView();
  }

  /** The car low in the middle (under the stats panel's height), or `shift` of the way to the right half's middle. */
  private placeView(): void {
    const w = innerWidth;
    const h = innerHeight;
    this.camera.setViewOffset(w, h, -w * TITLE_SHIFT * this.shift, -h * 0.1, w, h);
  }

  /** The asphalt, lit, its wet patches smoother; over it the scene mirrored (Reflector), smeared down the screen and patchy. */
  private ground(): void {
    const wet = puddles();
    const grain = noise(256, 0.6, 1.0);
    grain.repeat.set(30, 30);
    const rough = wet.clone();
    rough.repeat.set(PUDDLES, PUDDLES);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a2c31, map: grain, roughness: 0.75, roughnessMap: invert(rough) });
    this.beams.patch(mat); // the car's low beam on it
    const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(2 * FAR, 2 * FAR), mat);
    asphalt.rotation.x = -Math.PI / 2;
    this.scene.add(asphalt);

    const mirror = new Reflector(new THREE.PlaneGeometry(2 * FAR, 2 * FAR), {
      textureWidth: 512, // (smeared anyway)
      textureHeight: 512,
      clipBias: 0.003,
      shader: WET_SHADER,
    });
    const m = mirror.material as THREE.ShaderMaterial;
    m.transparent = true;
    m.blending = THREE.AdditiveBlending;
    m.depthWrite = false;
    m.uniforms.tWet = { value: wet };
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = 0.002;
    this.scene.add(mirror);
  }

  /** The parking bays: white lines across, the car in one, the lay-by's edge line along. */
  private bays(): void {
    const paint = new THREE.MeshStandardMaterial({ color: 0xcfd2d6, roughness: 0.5 });
    this.beams.patch(paint);
    const line = (w: number, l: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), paint);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.004, z);
      this.scene.add(m);
    };
    // Bays 2.8 m wide, 5.6 deep, across the lay-by (the cars nose in toward the rail), along it.
    for (let z = 1.4 - 2.8 * 12; z <= 1.4 + 2.8 * 3; z += 2.8) line(5.6, 0.12, 0.6, z);
    line(0.12, 2.8 * 15, 3.4, 1.4 - 2.8 * 5.5); // their ends, by the rail
    line(0.15, 120, -2.4, -40); // the lay-by's edge, toward the road
  }

  /** Sodium lamps along the rail, the near one over the car. */
  private lamps(): void {
    const pole = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.6, metalness: 0.6 });
    const glow = new THREE.MeshBasicMaterial({ color: 0xffc27a });
    glow.color.multiplyScalar(6); // over the bloom's threshold
    for (const z of [LAMP.z, LAMP.z - 32, LAMP.z - 64, LAMP.z - 96]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, LAMP.h, 10), pole);
      post.position.set(LAMP.x, LAMP.h / 2, z);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(LAMP.arm, 0.07, 0.07), pole);
      arm.position.set(LAMP.x - LAMP.arm / 2, LAMP.h, z);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.22), glow);
      head.position.set(LAMP.x - LAMP.arm, LAMP.h - 0.08, z);
      this.scene.add(post, arm, head);
    }
    // Only the near one lights the scene (the others, far, just glow: every light costs every pixel).
    const light = new THREE.SpotLight(0xff9a45, 170, 26, 0.8, 0.8, 1.6);
    light.position.set(LAMP.x - LAMP.arm, LAMP.h - 0.08, LAMP.z);
    light.target.position.set(LAMP.x - LAMP.arm - 2, 0, LAMP.z + 1); // a pool on the bays, the car in it
    this.scene.add(light, light.target);
  }

  /** The guardrail along the right (its beam, posts and yellow reflectors), the grass bank rising behind it. */
  private rail(): void {
    const steel = new THREE.MeshStandardMaterial({ color: 0x8a8e94, roughness: 0.35, metalness: 0.8 });
    const len = 130;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, len), steel);
    beam.position.set(RAIL_X, 0.62, 8 - len / 2);
    this.scene.add(beam);
    const n = len / 2;
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.75, 0.1), steel, n);
    const tabs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.02, 0.09, 0.07), new THREE.MeshBasicMaterial({ color: 0xffc400 }), n);
    const at = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const z = 8 - 2 * i;
      posts.setMatrixAt(i, at.makeTranslation(RAIL_X + 0.1, 0.375, z));
      tabs.setMatrixAt(i, at.makeTranslation(RAIL_X - 0.04, 0.66, z));
    }
    this.scene.add(posts, tabs);
    const slope = 0.22;
    const geo = new THREE.PlaneGeometry(14, len).rotateX(-Math.PI / 2).rotateZ(slope); // rising away from the rail, 3 m
    const bank = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x12160d, roughness: 1 }));
    bank.position.set(RAIL_X + 0.4 + 7 * Math.cos(slope), 7 * Math.sin(slope), 8 - len / 2);
    this.scene.add(bank);
  }

  /** The sky and the city, far off, out of focus: a picture on a curved strip round the car. */
  private backdrop(): void {
    const tex = new THREE.TextureLoader().load(SKY);
    tex.colorSpace = THREE.SRGBColorSpace;
    const arc = (105 * Math.PI) / 180; // (the camera sees 44 degrees across, swinging 20 either way)
    const width = FAR * arc;
    const height = width / (21 / 9);
    const geo = new THREE.CylinderGeometry(FAR, FAR, height, 48, 1, true, Math.PI - arc / 2, arc);
    const strip = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, fog: false }));
    // The city's foot (70% down the picture) at the camera's eye level.
    strip.position.y = CAM.h + height * (0.7 - 0.5);
    strip.scale.x = -1; // seen from inside: the picture the right way round
    this.scene.add(strip);
  }
}

/** The mirrored scene, smeared down the screen (as a wet road's reflections are), stronger in the wet patches and at grazing angles. */
const WET_SHADER = {
  name: 'WetReflection',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    tWet: { value: null },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec2 vMap;
    varying vec3 vWorld;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vMap = uv * ${PUDDLES}.0;
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tWet;
    varying vec4 vUv;
    varying vec2 vMap;
    varying vec3 vWorld;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec2 uv = vUv.xy / vUv.w;
      vec3 sum = vec3(0.0);
      float total = 0.0;
      for (int i = -6; i <= 6; i++) {
        float k = float(i);
        float wgt = exp(-k * k / 18.0);
        sum += texture2D(tDiffuse, uv + vec2(k * 0.0008, k * 0.006)).rgb * wgt;
        total += wgt;
      }
      vec3 refl = sum / total;
      float wet = texture2D(tWet, vMap).r;
      vec3 view = normalize(cameraPosition - vWorld);
      float fresnel = 0.04 + 0.96 * pow(1.0 - clamp(view.y, 0.0, 1.0), 5.0);
      float strength = mix(0.18, 0.85, wet) * mix(0.35, 1.0, fresnel);
      gl_FragColor = vec4(refl * strength, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

/** Blotchy wet patches (white wet, black drier), tiling. */
function puddles(): THREE.CanvasTexture {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  g.fillStyle = '#404040';
  g.fillRect(0, 0, n, n);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const x = rnd() * n;
    const y = rnd() * n;
    const r = 10 + rnd() * 40;
    for (const dx of [-n, 0, n]) {
      for (const dy of [-n, 0, n]) {
        const grad = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        grad.addColorStop(0, `rgba(255,255,255,${0.35 + rnd() * 0.4})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The same picture, dark for light (a roughness map from a wetness one). */
function invert(t: THREE.CanvasTexture): THREE.CanvasTexture {
  const src = t.image as HTMLCanvasElement;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d')!;
  g.filter = 'invert(1)';
  g.drawImage(src, 0, 0);
  const out = new THREE.CanvasTexture(c);
  out.wrapS = out.wrapT = THREE.RepeatWrapping;
  out.repeat.copy(t.repeat);
  return out;
}

/** Fine grey grain (the asphalt's), `lo`..`hi` brightness, tiling. */
function noise(n: number, lo: number, hi: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const img = g.createImageData(n, n);
  let seed = 11;
  for (let i = 0; i < n * n; i++) {
    seed = (seed * 16807) % 2147483647;
    const v = Math.round(255 * (lo + (hi - lo) * (seed / 2147483647)));
    img.data.set([v, v, v, 255], i * 4);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
