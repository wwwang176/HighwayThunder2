import * as THREE from 'three';

const DIR = `${import.meta.env.BASE_URL}fx/fire/`;
/** Sprites per flame, from the tip back. */
const N = 5;

let textures: { orange: THREE.Texture[]; blue: THREE.Texture[] } | null = null;
function fireTextures() {
  if (!textures) {
    const loader = new THREE.TextureLoader();
    const load = (f: string) => {
      const t = loader.load(DIR + f);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    textures = {
      orange: [2, 3, 4, 5, 6].map((i) => load(`fire${i}.png`)),
      blue: [2, 3, 4, 5, 6].map((i) => load(`fire${i}-blue.png`)),
    };
  }
  return textures;
}

/** A flame's look: the sprites' spacing back from the tip and their sizes (m), the first to the last. */
interface Look {
  step: number;
  size: [number, number];
  alpha: number;
}
const LOOK: Record<'backfire' | 'nitro', Look> = {
  backfire: { step: 0.09, size: [0.07, 0.34], alpha: 0.9 },
  nitro: { step: 0.12, size: [0.09, 0.45], alpha: 1 },
};

/**
 * Flames out of a car's exhaust pipes: an orange one while it backfires, a blue one while its nitro burns. Each
 * a few fire sprites (glowing, added on) in a row back from the tip, growing, flickering: jumping about a
 * little, their brightness and turn new every frame. Children of the car's body.
 */
export class ExhaustFlames {
  private readonly backfire: THREE.Group[] = [];
  private readonly nitro: THREE.Group[] = [];

  constructor(root: THREE.Object3D, tips: THREE.Vector3[]) {
    const tex = fireTextures();
    for (const tip of tips) {
      this.backfire.push(this.flame(root, tip, tex.orange, LOOK.backfire));
      this.nitro.push(this.flame(root, tip, tex.blue, LOOK.nitro));
    }
  }

  private flame(root: THREE.Object3D, tip: THREE.Vector3, maps: THREE.Texture[], look: Look): THREE.Group {
    const g = new THREE.Group();
    g.position.copy(tip);
    g.visible = false;
    for (let i = 0; i < N; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: maps[i], blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }),
      );
      const k = i / (N - 1);
      s.position.z = (i + 0.5) * look.step; // back from the tip (the tail is +z)
      s.scale.setScalar(look.size[0] + (look.size[1] - look.size[0]) * k);
      s.userData.z = s.position.z;
      s.userData.alpha = look.alpha;
      s.renderOrder = 2;
      g.add(s);
    }
    root.add(g);
    return g;
  }

  /** This frame (`dt` s of the race's time; 0 paused: they hold still): whether it backfires, whether its nitro burns. */
  update(dt: number, backfire: boolean, nitro: boolean): void {
    this.show(this.backfire, backfire && !nitro, dt > 0);
    this.show(this.nitro, nitro, dt > 0);
  }

  private show(groups: THREE.Group[], on: boolean, flicker: boolean): void {
    for (const g of groups) {
      g.visible = on;
      if (!on || !flicker) continue;
      for (const o of g.children) {
        const s = o as THREE.Sprite;
        const r = s.scale.x;
        s.position.set((Math.random() - 0.5) * 0.25 * r, (Math.random() - 0.5) * 0.25 * r, s.userData.z * (0.85 + Math.random() * 0.3));
        s.material.opacity = s.userData.alpha * (0.35 + Math.random() * 0.65);
        s.material.rotation = Math.random() * Math.PI * 2;
      }
    }
  }

  dispose(): void {
    for (const g of [...this.backfire, ...this.nitro]) {
      g.removeFromParent();
      for (const o of g.children) (o as THREE.Sprite).material.dispose();
    }
  }
}
