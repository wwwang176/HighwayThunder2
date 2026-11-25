import * as THREE from 'three';

/**
 * The police helicopter's flight (scripted: no planner, it never touches anything): `height` m over the road,
 * sliding fore and aft between `ahead` m ahead of the player (once every `aheadPeriod` s), `side` m to a side - the
 * left first - for `sideEvery` s, crossing to the other over `sideTurn` s. It flies in from `arriveFrom` m further
 * ahead over `arrive` s. Its main rotor `rotorHz` turns a second, its tail rotor `tailHz`; its white strobe flashes
 * `strobeOn` s every `strobeEvery` s; it bobs `sway` m.
 */
export const HELI = {
  // (low and far enough ahead to be in the chase camera's view, near its top; 40 m up 20-60 m ahead was over it)
  height: 30,
  ahead: [60, 110] as const,
  aheadPeriod: 23,
  side: 15,
  sideEvery: 12,
  sideTurn: 3,
  arrive: 6,
  arriveFrom: 350,
  rotorHz: 5.5,
  tailHz: 24,
  strobeEvery: 1.1,
  strobeOn: 0.06,
  sway: 0.6,
};

/**
 * Its searchlight: a cone `lampRadius` m across at the lamp, `groundRadius` at the lit car, lit air of `color`
 * (`density` a metre on its axis, summed in `steps` along a sight line; none within `near[0]` m of the camera, all
 * from `near[1]`); a real spot light (`light` candela, falling off by `decay`) lighting the ground there. Glare (a cross-flare
 * `glareSize` of the view high, `glareWide` times that across, and a veil of `veil` over the whole view) with the camera in the light - the cone
 * `glareWiden` times as wide, on to `glareBeyond` times its length past the car (the chase camera behind and over
 * the lit car) - and looking into the lamp: from `faceFrom` (the cosine of the angle off it) full at 1.
 */
export const BEAM = {
  lampRadius: 0.3,
  groundRadius: 3.5, // (5: the chase camera in the cone, the view hazed over by its far wall)
  density: 0.09,
  steps: 16,
  near: [4, 14] as const,
  color: 0xdfe8ff,
  light: 14000,
  decay: 1.6,
  glareSize: 0.14,
  glareWide: 2,
  veil: 0.17,
  glareWiden: 1.3,
  glareBeyond: 1.5,
  faceFrom: 0.8,
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => {
  const u = clamp01(x);
  return u * u * (3 - 2 * u);
};

/** Where it is `t` s into its flight: `ahead` m along the road from the player, `side` m across (+: right). */
export function heliOffset(t: number): { ahead: number; side: number } {
  const [a0, a1] = HELI.ahead;
  const ahead = (a0 + a1) / 2 - ((a1 - a0) / 2) * Math.cos((2 * Math.PI * t) / HELI.aheadPeriod);
  const k = Math.floor(t / HELI.sideEvery);
  const sign = (n: number) => (n % 2 === 0 ? -1 : 1);
  const s = k === 0 ? sign(0) : sign(k - 1) + (sign(k) - sign(k - 1)) * smooth((t - k * HELI.sideEvery) / HELI.sideTurn);
  return { ahead, side: HELI.side * s };
}

/** How much further ahead it still is, `t` s after it set off to come (flying in). */
export function arrivalAhead(t: number): number {
  return HELI.arriveFrom * (1 - smooth(t / HELI.arrive));
}

/**
 * The glare's strength (0..1): the camera `axial` m down the beam from the lamp and `radial` m off its axis, the lit
 * car `length` m down it, the camera's view `facing` (the cosine of its angle off the lamp); counted on to `beyond`
 * times the beam's length (the flare: BEAM.glareBeyond; the veil: 1 - only in the beam, not the chase camera behind
 * the lit car, its whole view greyed). See BEAM.
 */
export function beamGlare(axial: number, radial: number, length: number, facing: number, beyond = BEAM.glareBeyond): number {
  if (axial <= 0 || axial > length * beyond) return 0;
  const r = (BEAM.lampRadius + ((BEAM.groundRadius - BEAM.lampRadius) * axial) / length) * BEAM.glareWiden;
  if (radial >= r) return 0;
  const t = radial / r;
  return (1 - t * t * t * t) * clamp01((facing - BEAM.faceFrom) / (1 - BEAM.faceFrom));
}

/** The flare's light (linear, 0..): at (u, v) from its middle (-1..1 across the texture). See glareTexture. */
function flareLight(u: number, v: number): number {
  const r2 = u * u + v * v;
  const halo = 0.45 * Math.exp(-r2 / (0.4 * 0.4));
  const core = Math.exp(-r2 / (0.14 * 0.14));
  const ray = (along: number, across: number) => {
    const fade = Math.max(0, 1 - Math.abs(along));
    return 0.9 * Math.exp(-(across * across) / (0.03 * 0.03)) * fade * fade;
  };
  return halo + core + ray(u, v) + ray(v, u);
}

/**
 * A cross-flare (the browser only: the game makes the helicopter): a faint wide halo, a bright core, two thin rays
 * - every one a smooth falloff worked out per pixel (a canvas's gradients, straight between their stops, showed a
 * ring at each; rays drawn as bars, hard edges), stored sRGB-encoded (its dim fringe without bands).
 */
function glareTexture(size = 512): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const tint = [1, 0.985, 0.95];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const light = Math.min(1, flareLight(((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1));
      const i = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) {
        const l = light * tint[k];
        img.data[i + k] = Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055));
      }
      img.data[i + 3] = 255; // (added: its colour is its light)
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const UP = new THREE.Vector3(0, 1, 0);
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const DIR = new THREE.Vector3();
const TO_CAM = new THREE.Vector3();
const VIEW = new THREE.Vector3();
/** Where the lamp hangs, under its nose (the body's space: the nose toward -z). */
const LAMP_AT = new THREE.Vector3(0, -0.9, -2.2);

/**
 * The police helicopter (src/game/police.ts's chase; docs/superpowers/specs/2026-11-25-police-helicopter-design.md):
 * primitives the eye reads as one from far below, flown by heliOffset over the player, its searchlight on them.
 * In the scene throughout, shown once the chase is on (its spot light kept: a light coming and going rebuilds every
 * material).
 */
export class Helicopter {
  private readonly object = new THREE.Group();
  private readonly rotor = new THREE.Group();
  private readonly tailRotor = new THREE.Group();
  private readonly strobe: THREE.Mesh;
  private readonly beam: THREE.Mesh;
  private readonly glare: THREE.Sprite;
  private readonly veil: THREE.Mesh;
  private readonly light: THREE.SpotLight;
  private readonly lamp = new THREE.Vector3();
  private readonly disposables: { dispose(): void }[] = [];
  /** Its flight's clock (s, the race's time), and since it set off to come (-1: not yet). */
  private clock = 0;
  private since = -1;
  private lastSide = 0;
  private lastAhead = 0;
  /** Where it is and how it moves (world): its rotor heard from there. */
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  /** Out and flying (the chase on). */
  flying = false;

  constructor(private readonly scene: THREE.Scene) {
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c2026, roughness: 0.55, metalness: 0.3 });
    const glassy = new THREE.MeshStandardMaterial({ color: 0x0c1218, roughness: 0.15, metalness: 0.6 });
    const blade = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 });
    const disc = new THREE.MeshBasicMaterial({ color: 0x9aa4b0, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
    const lit = (hex: number) => new THREE.MeshBasicMaterial({ color: hex, toneMapped: false });
    const add = <T extends THREE.BufferGeometry>(g: T, m: THREE.Material, to: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      to.add(mesh);
      this.disposables.push(g);
      return mesh;
    };
    const body = new THREE.Group();
    // The cabin: a capsule lying along z, its nose (-z) glazed; the tail boom tapering back; the fin, the tail rotor.
    add(new THREE.CapsuleGeometry(1.15, 2.6, 6, 12).rotateX(Math.PI / 2), dark, body);
    add(new THREE.SphereGeometry(1.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2), glassy, body, 0, 0.1, -1.6);
    add(new THREE.CylinderGeometry(0.22, 0.5, 5.2, 8).rotateX(Math.PI / 2), dark, body, 0, 0.35, 4.3);
    add(new THREE.BoxGeometry(0.12, 1.5, 0.9), dark, body, 0, 1.0, 6.7);
    this.tailRotor.position.set(0.25, 1.0, 6.8);
    add(new THREE.BoxGeometry(0.04, 1.3, 0.12), blade, this.tailRotor);
    add(new THREE.BoxGeometry(0.04, 0.12, 1.3), blade, this.tailRotor);
    body.add(this.tailRotor);
    // Skids.
    for (const x of [-0.95, 0.95]) {
      add(new THREE.CylinderGeometry(0.06, 0.06, 3.6, 6).rotateX(Math.PI / 2), dark, body, x, -1.55, 0);
      for (const z of [-0.8, 0.9]) add(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6), dark, body, x * 0.85, -1.2, z);
    }
    // The main rotor: a mast, two crossed blades, a faint disc (the blur).
    add(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 8), dark, body, 0, 1.35, -0.2);
    this.rotor.position.set(0, 1.6, -0.2);
    add(new THREE.BoxGeometry(11, 0.05, 0.35), blade, this.rotor);
    add(new THREE.BoxGeometry(0.35, 0.05, 11), blade, this.rotor);
    body.add(this.rotor);
    add(new THREE.CircleGeometry(5.5, 32).rotateX(-Math.PI / 2), disc, body, 0, 1.6, -0.2);
    // Navigation lights: red to port (left), green to starboard, the white strobe under the tail.
    add(new THREE.SphereGeometry(0.12, 8, 6), lit(0xff2a20), body, -1.1, 0, 0.2);
    add(new THREE.SphereGeometry(0.12, 8, 6), lit(0x20ff50), body, 1.1, 0, 0.2);
    this.strobe = add(new THREE.SphereGeometry(0.16, 8, 6), lit(0xffffff), body, 0, -0.1, 6.9);
    // The lamp itself.
    add(new THREE.CylinderGeometry(0.25, 0.3, 0.35, 10), lit(0xf2f6ff), body, LAMP_AT.x, LAMP_AT.y, LAMP_AT.z);
    this.object.add(body);
    this.disposables.push(dark, glassy, blade, disc);

    // The beam: lit air in a cone from the lamp to the lit car, added (black is no light). Each pixel as bright as
    // the light its sight line goes through: where that line is in the cone (worked out exactly: a cone, cut at the
    // lamp and the car), summed in `BEAM.steps` steps - the light thickest on its axis, none at its edge (soft, no
    // hard rim), thinning down it (the spot on the ground the real light's), none near the camera (`near`). Seen
    // along it (the chase camera behind the lit car) a bright shaft; from the side, a soft one. (A thin-walled cone
    // drawn translucent instead: from behind the car its open end a dome over the view; its walls faded by how they
    // faced the camera, nothing - seen along the beam, every wall is side-on.) Drawn on the bounding cone's far side:
    // once a pixel, its sight line ending there (or at what is in front).
    const cone = new THREE.CylinderGeometry(BEAM.groundRadius * 1.06, BEAM.lampRadius * 1.06, 1, 32, 1, false).translate(0, 0.5, 0);
    const beamMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform vec3 color;
        uniform float density;
        uniform vec2 near;
        uniform vec3 lamp;
        uniform vec3 axis;
        uniform float len;
        uniform vec2 radii;
        varying vec3 vWorld;
        const int STEPS = ${BEAM.steps};
        void main() {
          vec3 o = cameraPosition;
          vec3 toEnd = vWorld - o;
          float tEnd = length(toEnd);
          vec3 d = toEnd / tEnd;
          vec3 w = o - lamp;
          float da = dot(d, axis);
          float oa = dot(w, axis);
          // Between the lamp (a = 0) and the car (a = len).
          float t0 = 0.0, t1 = tEnd;
          if (abs(da) > 1e-5) {
            float ta = -oa / da, tb = (len - oa) / da;
            t0 = max(t0, min(ta, tb));
            t1 = min(t1, max(ta, tb));
          } else if (oa < 0.0 || oa > len) discard;
          // In the cone: radius r0 + k a = k (a - aV), its apex aV behind the lamp. f(t) = A t^2 + B t + C <= 0.
          float k = (radii.y - radii.x) / len;
          float aV = -radii.x / k;
          float k2 = k * k;
          float A = 1.0 - da * da - k2 * da * da;
          float B = 2.0 * (dot(w, d) - oa * da - k2 * (oa - aV) * da);
          float C = dot(w, w) - oa * oa - k2 * (oa - aV) * (oa - aV);
          float disc = B * B - 4.0 * A * C;
          if (disc < 0.0) { if (A > 0.0) discard; }
          else {
            float q = sqrt(disc);
            float r1 = (-B - q) / (2.0 * A), r2 = (-B + q) / (2.0 * A);
            float lo = min(r1, r2), hi = max(r1, r2);
            if (A > 0.0) { t0 = max(t0, lo); t1 = min(t1, hi); }
            else {
              // (outside the roots: one side the other nappe, cut off by the lamp's end - keep the longer)
              float s0 = t0, s1 = min(t1, lo), u0 = max(t0, hi), u1 = t1;
              if (s1 - s0 >= u1 - u0) { t0 = s0; t1 = s1; } else { t0 = u0; t1 = u1; }
            }
          }
          if (t1 <= t0) discard;
          float dt = (t1 - t0) / float(STEPS);
          float sum = 0.0;
          for (int i = 0; i < STEPS; i++) {
            float t = t0 + (float(i) + 0.5) * dt;
            vec3 p = w + d * t;
            float a = dot(p, axis);
            float r = length(p - axis * a) / (radii.x + k * a);
            float soft = clamp(1.0 - r * r, 0.0, 1.0);
            sum += soft * soft * mix(1.0, 0.3, a / len) * smoothstep(near.x, near.y, t);
          }
          float light = 1.0 - exp(-density * sum * dt);
          gl_FragColor = vec4(color * light, 1.0);
        }`,
      uniforms: {
        color: { value: new THREE.Color(BEAM.color) },
        density: { value: BEAM.density },
        near: { value: new THREE.Vector2(BEAM.near[0], BEAM.near[1]) },
        lamp: { value: new THREE.Vector3() },
        axis: { value: new THREE.Vector3(0, -1, 0) },
        len: { value: 1 },
        radii: { value: new THREE.Vector2(BEAM.lampRadius, BEAM.groundRadius) },
      },
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.BackSide,
    });
    this.beam = new THREE.Mesh(cone, beamMat);
    this.beam.frustumCulled = false; // (scaled each frame: its bounds are the unit cone's)
    this.disposables.push(cone, beamMat);
    // The glare: on the lamp, the camera's phenomenon (no depth test: over the body too).
    const tex = glareTexture();
    const glareMat = new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
    this.glare = new THREE.Sprite(glareMat);
    this.glare.renderOrder = 999;
    this.disposables.push(tex, glareMat);
    // The veil: two triangles over the whole view (clip space: no camera), added, drawn last.
    const veilGeo = new THREE.BufferGeometry();
    veilGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    const veilMat = new THREE.ShaderMaterial({
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform vec3 color; uniform float strength; void main() { gl_FragColor = vec4(color * strength, 1.0); }',
      uniforms: { color: { value: new THREE.Color(BEAM.color) }, strength: { value: 0 } },
      blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
    });
    this.veil = new THREE.Mesh(veilGeo, veilMat);
    this.veil.frustumCulled = false;
    this.veil.renderOrder = 1000;
    this.disposables.push(veilGeo, veilMat);
    this.light = new THREE.SpotLight(BEAM.color, 0, 0, 0.12, 0.45, BEAM.decay);
    scene.add(this.object, this.beam, this.glare, this.veil, this.light, this.light.target);
    this.hide();
  }

  /** A race's start: not out yet. */
  reset(): void {
    this.clock = 0;
    this.since = -1;
    this.flying = false;
    this.hide();
  }

  private hide(): void {
    this.object.visible = this.beam.visible = this.glare.visible = this.veil.visible = false;
    this.light.intensity = 0;
  }

  /**
   * A frame: `play` s of the race's time on; `on` the chase (it sets off the first time); over `car` (the lit car's
   * position), along the road: `place(ahead, side, out)` the road's point `ahead` m on from the player and `side` m
   * across (its height the player's); the glare by `camera` (placed for this frame).
   */
  update(play: number, on: boolean, car: THREE.Vector3, place: (ahead: number, side: number, out: THREE.Vector3) => THREE.Vector3, camera: THREE.Camera): void {
    if (on && this.since < 0) this.since = 0;
    if (this.since < 0) return;
    this.flying = true;
    this.clock += play;
    this.since += play;
    const off = heliOffset(this.clock);
    const ahead = off.ahead + arrivalAhead(this.since);
    place(ahead, off.side, A);
    place(ahead + 5, off.side, B);
    const was = B.copy(B).sub(A); // (along the road there)
    const yaw = Math.atan2(-was.x, -was.z);
    const t = this.clock;
    const y = A.y + HELI.height + HELI.sway * Math.sin(t * 0.9) + 0.3 * Math.sin(t * 2.3);
    const prev = TO_CAM.copy(this.position);
    this.position.set(A.x, y, A.z);
    if (play > 0) this.velocity.copy(this.position).sub(prev).divideScalar(play);
    // Banked into its sideways slide, nose down a little more as it pulls ahead.
    const sideRate = play > 0 ? (off.side - this.lastSide) / play : 0;
    const aheadRate = play > 0 ? (ahead - this.lastAhead) / play : 0;
    this.lastSide = off.side;
    this.lastAhead = ahead;
    this.object.position.copy(this.position);
    this.object.rotation.set(-0.06 - Math.max(-0.15, Math.min(0.15, aheadRate * 0.01)), yaw, Math.max(-0.35, Math.min(0.35, -sideRate * 0.05)), 'YXZ');
    this.rotor.rotation.y += play * 2 * Math.PI * HELI.rotorHz;
    this.tailRotor.rotation.x += play * 2 * Math.PI * HELI.tailHz;
    this.strobe.visible = t % HELI.strobeEvery < HELI.strobeOn;
    this.object.visible = true;
    // The beam, from the lamp to the car (a little off it: a hand on the lamp, not a servo).
    this.object.updateMatrixWorld();
    this.lamp.copy(LAMP_AT).applyMatrix4(this.object.matrixWorld);
    DIR.set(car.x + 0.6 * Math.sin(t * 1.3), car.y, car.z + 0.8 * Math.sin(t * 0.8 + 1)).sub(this.lamp);
    const len = DIR.length();
    DIR.divideScalar(len);
    this.beam.position.copy(this.lamp);
    this.beam.quaternion.setFromUnitVectors(UP, DIR);
    this.beam.scale.set(1, len, 1);
    const u = (this.beam.material as THREE.ShaderMaterial).uniforms;
    u.lamp.value.copy(this.lamp);
    u.axis.value.copy(DIR);
    u.len.value = len;
    this.beam.visible = true;
    this.light.position.copy(this.lamp);
    this.light.target.position.copy(this.lamp).addScaledVector(DIR, len);
    this.light.angle = Math.atan((BEAM.groundRadius * 1.1) / len);
    this.light.intensity = BEAM.light;
    // The glare and the veil: the camera in the light, looking into the lamp.
    TO_CAM.copy(camera.position).sub(this.lamp);
    const dist = TO_CAM.length();
    const axial = DIR.dot(TO_CAM);
    const radial = Math.sqrt(Math.max(0, dist * dist - axial * axial));
    camera.getWorldDirection(VIEW);
    const facing = -VIEW.dot(TO_CAM) / Math.max(1e-6, dist);
    const g = beamGlare(axial, radial, len, facing);
    this.glare.visible = g > 0;
    if (g > 0) {
      this.glare.position.copy(this.lamp);
      const size = dist * BEAM.glareSize;
      this.glare.scale.set(size * BEAM.glareWide, size, 1);
      this.glare.material.opacity = g;
    }
    const v = beamGlare(axial, radial, len, facing, 1);
    this.veil.visible = v > 0;
    (this.veil.material as THREE.ShaderMaterial).uniforms.strength.value = BEAM.veil * v;
  }

  dispose(): void {
    this.scene.remove(this.object, this.beam, this.glare, this.veil, this.light, this.light.target);
    this.light.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
