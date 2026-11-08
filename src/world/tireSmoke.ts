import * as THREE from 'three';
import { lowBeamCookie, TAN_HALF } from '../vehicles/headlight';

const MAX = 700;
const LIFE = 1.6; // s
export const SMOKE_LIFE = LIFE;
const ALBEDO = 0.86;
/** Night sky glow + moon reaching the smoke (irradiance, linear). */
const AMBIENT = new THREE.Color(0x1c2740).multiplyScalar(0.35).add(new THREE.Color(0x8fa4d8).multiplyScalar(0.06));
/** Most lights the smoke shader takes (street lights + player + nearest NPC headlights). */
const MAX_LIGHTS = 16;
/** A puff's picture: its alpha the smoke's density (thicker in the middle, grainy), from the first Highway Thunder. */
const PUFF_TEXTURE = `${import.meta.env.BASE_URL}fx/smoke.png`;
/** How fast a puff turns (rad/s, either way, at most): no two alike, none still. */
const PUFF_SPIN = 0.6;
/** How bright a lit puff is, times its light (the fake volume's shade with it; at 1.15 the smoke glared). */
const SHADE_GAIN = 0.8;
/** The brightest a lit puff gets (linear; tone mapped, near white). */
const SMOKE_WHITE = 4;
/**
 * The low beam's cut-off in the smoke, how soft (tangent units, lowBeamPattern): the road's 0.018 (about a degree)
 * cut the smoke as with a knife - on the road, the light lying along it, that degree is metres of soft edge; seen
 * across smoke, centimetres. Spread wider, as the light scattered through the smoke softens it.
 */
const SMOKE_CUT_SOFT = 0.15;
/**
 * A spot light's light scattered round its beam (off the road, through the smoke), of the beam's: a puff out of the
 * beam lit this much as in it. None: smoke blown back past the car's own lamps went from white to black at their
 * cone's edge - as if it were only in the cone.
 */
const SMOKE_SPILL = 0.08;
/**
 * A puff at its thickest (its alpha; how many puffs, as they were): at 0.45 a burnout's cloud was too dense; at
 * 0.27, lit round the lamps too (SMOKE_SPILL), a rival's smoke ahead hid the road.
 */
const PUFF_OPACITY = 0.18;

function puffTexture(): THREE.Texture {
  return new THREE.TextureLoader().load(PUFF_TEXTURE); // (only its alpha is read)
}

/**
 * A light the smoke is lit by, in world space: a spot light (with an optional
 * low-beam cookie) or, without `dir`, a point light.
 */
export interface SmokeLight {
  pos: THREE.Vector3;
  color: THREE.Color; // colour × intensity (candela)
  decay: number;
  distance: number; // 0 = unlimited
  dir?: THREE.Vector3;
  cosOuter?: number;
  cosInner?: number;
  /** Low-beam cookie frame (right, up) when the light projects the low-beam pattern. */
  cookie?: { right: THREE.Vector3; up: THREE.Vector3 };
}

/** The smoke's view of a (visible) scene spot light. */
export function smokeLightFromSpot(l: THREE.SpotLight): SmokeLight {
  const pos = l.getWorldPosition(new THREE.Vector3());
  const dir = l.target.getWorldPosition(new THREE.Vector3()).sub(pos).normalize();
  const light: SmokeLight = {
    pos,
    color: l.color.clone().multiplyScalar(l.intensity),
    decay: l.decay,
    distance: l.distance,
    dir,
    cosOuter: Math.cos(l.angle),
    cosInner: Math.cos(l.angle * (1 - l.penumbra)),
  };
  if (l.map) {
    const right = new THREE.Vector3().crossVectors(dir, THREE.Object3D.DEFAULT_UP).normalize();
    light.cookie = { right, up: new THREE.Vector3().crossVectors(right, dir) };
  }
  return light;
}

/**
 * A puff `age` s old: size (m) and opacity. Past its life it has no size at all: a dead
 * puff left at full size, only transparent, still cost the GPU every pixel it covered -
 * a few hundred where a burnout had been held the frame rate near 30 (100 without).
 */
export function puffLook(age: number): { size: number; alpha: number } {
  if (age >= LIFE) return { size: 0, alpha: 0 };
  const t = age / LIFE;
  return { size: 0.8 + t * 3.2, alpha: PUFF_OPACITY * (1 - t) * Math.min(1, t * 8) };
}

const vec3s = () => Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3());
const vec4s = () => Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4());

/**
 * Tyre smoke: grey puffs (a grainy smoke picture, each turned its own way and turning) emitted where a tyre is
 * sliding hard (burnouts, lock-ups, slides). One Points draw call; particles grow, rise and fade.
 *
 * Lit as grok-aircraft2 lights its smoke: each puff by the lights around it (spot cones, the low-beam pattern;
 * falling off as the inverse square of the distance - not the lights' own decay: the headlights' 1 lights the road
 * far ahead, but a puff 50 m off lit as one 5 m off read the same in the picture, near white) in the vertex shader
 * (per pixel, with a dozen lights, it cost most of a frame in a thick cloud): at its centre and at its edges each
 * way across and up the screen, the pixels lit between them (a beam's edge across a puff; drifting over it, the
 * puff brightens by degrees - lit at its centre alone, a puff lit up or went dark at once). Per pixel a fake volume
 * besides: the puff a ball (a normal from where on it the pixel is), its side toward the light (their weighted
 * direction) lit, the far side and its dense core (the picture's alpha: the light's way through it) darker.
 */
export class TireSmoke {
  private readonly pos = new Float32Array(MAX * 3);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly age = new Float32Array(MAX).fill(LIFE);
  private readonly size = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);
  private readonly turn = new Float32Array(MAX);
  private readonly spin = new Float32Array(MAX);
  private readonly geo = new THREE.BufferGeometry();
  private readonly uniforms = {
    lightCount: { value: 0 },
    lightPos: { value: vec3s() },
    lightColor: { value: vec3s() },
    lightDir: { value: vec3s() },
    // decay, distance (0 = unlimited), cos outer, cos inner (point light: -2, -1)
    lightParams: { value: vec4s() },
    // cookie right (xyz) + has-cookie flag (w); cookie up
    lightRight: { value: vec4s() },
    lightUp: { value: vec3s() },
    cookieTex: { value: lowBeamCookie(128, SMOKE_CUT_SOFT) },
    puffTex: { value: puffTexture() },
    ambient: { value: AMBIENT.clone().multiplyScalar(ALBEDO / Math.PI) },
    // Half the picture's height (px, as drawn: its pixel ratio's): a puff's radius in the world from its size drawn.
    halfHeight: { value: 500 },
    spill: { value: SMOKE_SPILL },
  };
  private next = 0;
  private carry = new Map<number, number>();

  constructor(scene: THREE.Scene) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('turn', new THREE.BufferAttribute(this.turn, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { scale: { value: 600 } }]),
      vertexShader: `
        #define MAX_LIGHTS ${MAX_LIGHTS}
        attribute float size;
        attribute float alpha;
        attribute float turn;
        uniform float scale;
        uniform int lightCount;
        uniform vec3 lightPos[MAX_LIGHTS];
        uniform vec3 lightColor[MAX_LIGHTS];
        uniform vec3 lightDir[MAX_LIGHTS];
        uniform vec4 lightParams[MAX_LIGHTS];
        uniform vec4 lightRight[MAX_LIGHTS];
        uniform vec3 lightUp[MAX_LIGHTS];
        uniform sampler2D cookieTex;
        uniform float halfHeight;
        uniform float spill;
        varying float vAlpha;
        varying float vTurn;
        varying vec3 vLit;
        varying vec3 vLitR;
        varying vec3 vLitL;
        varying vec3 vLitU;
        varying vec3 vLitD;
        varying vec3 vToLight;
        #include <fog_pars_vertex>
        // The light reaching world point p (irradiance), and the way it comes from (each light's, by its strength).
        vec3 lightAt(vec3 p, out vec3 toLight) {
          vec3 e = vec3(0.0);
          toLight = vec3(0.0);
          for (int i = 0; i < MAX_LIGHTS; i++) {
            if (i >= lightCount) break;
            vec3 l = p - lightPos[i];
            float dist = length(l);
            vec4 prm = lightParams[i];
            float k = 1.0 / max(dist * dist, 0.01); // (inverse square, whatever the light's own decay: see above)
            if (prm.y > 0.0) {
              float r = clamp(1.0 - pow(dist / prm.y, 4.0), 0.0, 1.0);
              k *= r * r;
            }
            if (prm.z > -1.5) {
              // Its beam (cone, low-beam pattern), and round it the light scattered (spill): out of the beam a puff
              // is dim, not dark - near a lamp it is seen grey, the dark coming on with the distance.
              float along = dot(l, lightDir[i]);
              float beam = smoothstep(prm.z, prm.w, along / dist);
              if (lightRight[i].w > 0.5) {
                vec2 uv = vec2(dot(l, lightRight[i].xyz), dot(l, lightUp[i])) / max(along, 1e-4);
                uv = uv / ${(2 * TAN_HALF).toFixed(4)} + 0.5;
                beam *= (along > 0.0 && uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) ? texture2D(cookieTex, uv).r : 0.0;
              }
              k *= spill + (1.0 - spill) * beam;
            }
            vec3 c = lightColor[i] * k;
            e += c;
            toLight -= l / max(dist, 0.001) * (c.r + c.g + c.b);
          }
          return e;
        }
        void main() {
          vAlpha = alpha;
          vTurn = turn;
          vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mvPosition.z;
          gl_Position = projectionMatrix * mvPosition;
          // Lit at its centre and at its edges across and up the screen (its radius as drawn, in the world): the
          // pixels go between them, so a beam's edge falls across the puff, and a puff drifting over it brightens
          // by degrees - lit at its centre only, the whole puff lit up or went dark at once.
          float radius = 0.5 * gl_PointSize * -mvPosition.z / (projectionMatrix[1][1] * halfHeight);
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]) * radius;
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]) * radius;
          vec3 toLight, unused;
          // Outgoing light of a diffuse grey surface (albedo / pi x irradiance), as the scene's materials.
          float k = ${(ALBEDO / Math.PI).toFixed(4)};
          vLit = lightAt(p, toLight) * k;
          vLitR = lightAt(p + right, unused) * k;
          vLitL = lightAt(p - right, unused) * k;
          vLitU = lightAt(p + up, unused) * k;
          vLitD = lightAt(p - up, unused) * k;
          vToLight = mat3(viewMatrix) * toLight; // (seen from the camera: the puff faces it)
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D puffTex;
        uniform vec3 ambient;
        varying float vAlpha;
        varying float vTurn;
        varying vec3 vLit;
        varying vec3 vLitR;
        varying vec3 vLitL;
        varying vec3 vLitU;
        varying vec3 vLitD;
        varying vec3 vToLight;
        #include <fog_pars_fragment>
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float cs = cos(vTurn), sn = sin(vTurn);
          float density = texture2D(puffTex, mat2(cs, sn, -sn, cs) * c + 0.5).a;
          // None past the round the picture fills (its square's edges hold up to 12/255, and turned, its corners
          // reach past them, its edge stretched out: brightly lit, a faint square showed round the puff).
          density *= 1.0 - smoothstep(0.8, 1.0, length(c) * 2.0);
          if (density < 0.004) discard;
          // The puff a ball: its normal where this pixel is (x right, y up, z toward the camera).
          vec2 xy = vec2(c.x, -c.y) * 2.0;
          // Its light here: from its centre's toward its edge's on each side, across and up.
          vec3 lit = vLit + (xy.x > 0.0 ? vLitR - vLit : vLitL - vLit) * abs(xy.x) + (xy.y > 0.0 ? vLitU - vLit : vLitD - vLit) * abs(xy.y);
          lit = max(lit, 0.0);
          vec3 n = vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.0)));
          float lightLen = length(vToLight);
          float facing = lightLen > 1e-6 ? dot(normalize(n), vToLight / lightLen) : 0.0;
          float direct = smoothstep(-0.35, 0.85, facing);
          // Its dense core the light's longest way through: darkest on the far side.
          float core = pow(density, 1.35);
          float shade = mix(0.58, 1.0, direct) * (1.0 - core * mix(0.32, 0.12, direct));
          vec3 col = ambient + lit * shade * ${SHADE_GAIN.toFixed(2)};
          // Its own white: past 1 eased toward SMOKE_WHITE (the picture is tone mapped only after the smoke is
          // laid over it: a puff by a headlight, ~100, made even its faint square's edge show).
          vec3 over = max(col - 1.0, 0.0);
          col = min(col, 1.0) + over / (1.0 + over / ${(SMOKE_WHITE - 1).toFixed(1)});
          gl_FragColor = vec4(col, vAlpha * density);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    Object.assign(mat.uniforms, this.uniforms);
    const pts = new THREE.Points(this.geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 2;
    scene.add(pts);
  }

  /** The picture it is drawn into is `heightPx` tall (its drawing buffer's: call as it is sized). */
  setView(heightPx: number): void {
    this.uniforms.halfHeight.value = heightPx / 2;
  }

  /** Emit for wheel `id` at a contact point; `slip` in m/s, carVel = car velocity (world). */
  emit(id: number, x: number, z: number, slip: number, carVx: number, carVz: number, dt: number): void {
    if (slip < 3) {
      this.carry.delete(id);
      return;
    }
    const rate = Math.min(90, (slip - 3) * 9); // puffs per second
    let n = (this.carry.get(id) ?? 0) + rate * dt;
    while (n >= 1) {
      n -= 1;
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.3;
      this.pos[i * 3 + 1] = 0.25;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3;
      // Smoke is left behind: it keeps only a little of the car's motion.
      this.vel[i * 3] = carVx * 0.15 + (Math.random() - 0.5) * 1.2;
      this.vel[i * 3 + 1] = 0.25 + Math.random() * 0.3; // (rising: it climbed twice as high)
      this.vel[i * 3 + 2] = carVz * 0.15 + (Math.random() - 0.5) * 1.2;
      this.turn[i] = Math.random() * Math.PI * 2;
      this.spin[i] = (Math.random() * 2 - 1) * PUFF_SPIN;
      this.age[i] = 0;
    }
    this.carry.set(id, n);
  }

  /** Advance the puffs; `lights` (world space, see smokeLightFromSpot) light them this frame. */
  update(dt: number, lights: SmokeLight[] = []): void {
    const drag = Math.exp(-2.5 * dt);
    for (let i = 0; i < MAX; i++) {
      if (this.age[i] < LIFE) {
        this.age[i] += dt;
        this.vel[i * 3] *= drag;
        this.vel[i * 3 + 2] *= drag;
        this.pos[i * 3] += this.vel[i * 3] * dt;
        this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
        this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
        this.turn[i] += this.spin[i] * dt;
      }
      const look = puffLook(this.age[i]);
      this.size[i] = look.size;
      this.alpha[i] = look.alpha;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('alpha') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('turn') as THREE.BufferAttribute).needsUpdate = true;
    this.setLights(lights);
  }

  private setLights(lights: SmokeLight[]): void {
    const u = this.uniforms;
    const n = Math.min(MAX_LIGHTS, lights.length);
    for (let i = 0; i < n; i++) {
      const l = lights[i];
      u.lightPos.value[i].copy(l.pos);
      u.lightColor.value[i].set(l.color.r, l.color.g, l.color.b);
      if (l.dir) {
        u.lightDir.value[i].copy(l.dir);
        u.lightParams.value[i].set(l.decay, l.distance, l.cosOuter!, l.cosInner!);
      } else u.lightParams.value[i].set(l.decay, l.distance, -2, -1);
      if (l.cookie) {
        const r = l.cookie.right;
        u.lightRight.value[i].set(r.x, r.y, r.z, 1);
        u.lightUp.value[i].copy(l.cookie.up);
      } else u.lightRight.value[i].w = 0;
    }
    u.lightCount.value = n;
  }

  clear(): void {
    this.age.fill(LIFE);
    this.alpha.fill(0);
    this.size.fill(0);
    this.carry.clear();
  }
}
