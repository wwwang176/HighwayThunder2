import * as THREE from 'three';

/** Half angle of the headlight's projection (rad). */
export const HALF_ANGLE = 0.75;
/** Fraction of the cone over which the spot light's edge fades out. */
export const PENUMBRA = 0.35;
/** How far the beam's axis is aimed below horizontal (rad). */
export const AIM_DOWN = THREE.MathUtils.degToRad(3);
/** A car's lamps' height over the ground (m) the traffic's beam is scaled to (models: their beam spots). */
export const BEAM_LAMP_H = 0.7;

/** Tangent of the half angle: the cookie spans ±TAN_HALF in the light's projection. */
export const TAN_HALF = Math.tan(HALF_ANGLE);
/** Cut-off line, in tangent units of the light's projection (just below the horizon). */
const CUT_V = Math.tan(AIM_DOWN) - Math.tan(THREE.MathUtils.degToRad(0.6));
const KINK = Math.tan(THREE.MathUtils.degToRad(15));
const KINK_RISE = Math.tan(THREE.MathUtils.degToRad(2));
const EDGE = 0.018; // softness of the cut-off
const SPREAD = 0.75 * TAN_HALF;
const FALL = 0.45 * TAN_HALF;

/**
 * Low-beam pattern: relative intensity (0..1) toward direction (u, v), given
 * as tangents in the light's projection (u = right, v = up, axis = 0,0).
 * A sharp horizontal cut-off just below the horizon (so it lights the road,
 * not the car in front's whole body or oncoming drivers), the right-hand 15°
 * step-up of right-hand-traffic beams, a wide horizontal spread and a gentle
 * fade toward the car.
 */
export function lowBeamPattern(u: number, v: number): number {
  const cut = u > 0 ? CUT_V + Math.min(u * KINK, KINK_RISE) : CUT_V;
  const below = cut - v;
  const edge = Math.min(1, Math.max(0, below / EDGE));
  const spread = Math.exp(-(((u - 0.073) / SPREAD) ** 2));
  const fall = 0.3 + 0.7 * Math.exp(-(((below - 0.058) / FALL) ** 2));
  return edge * spread * fall;
}

/** Every headlight's decay, and no other spot light's (the street lamps': 1.6): the lit shaders know a headlight by it. */
export const HEADLIGHT_DECAY = 1.0;

/**
 * The real headlights' brightness (the player's and the rivals'; the tuning panel's, applied each frame), candela
 * for a car's two lamps together. 216 lights the road 8 m ahead as the traffic's painted beams do (NPC_BEAM): theirs
 * 5.9 x 0.39 there, a real pair I x 0.98 x 1/8 m x 0.7/8 m = I x 0.0107 (it was 900: four times theirs).
 */
export const HEADLIGHTS = { pair: 216, high: 2 };
// (`high`: the high beam's brightness, times the low beam's.)

/**
 * The high beam (the player's, while X is held): a plain spot light, aimed level - no low-beam cut-off (its decay out of the
 * lit shaders' headlight range: installLowBeamShader leaves it round). Told apart by decay alone (a uniform): the
 * switch recompiles nothing.
 */
export const HIGH_BEAM_DECAY = 1.05;

/**
 * A rival's lamp (one per car, both its lamps' light: game/rivalLights): shaped as a low beam on what it lights,
 * but on the ground (the materials npcBeams patches: HT2_GROUND) it lights as the traffic's pair does (groundBeam),
 * its shadow still on it - the player's car shadowed on the road by the car behind.
 */
export const RIVAL_DECAY = 1.001;

const g = (x: number) => x.toFixed(6);
/**
 * lowBeamPattern in GLSL, toward `p` from a spot light at `lightPos` whose uniform `direction` points back at it
 * (three.js's), all in view space: (u, v) its tangents along the lamp's right and up (level: square to the world's
 * up), as the cookie was projected.
 */
export const LOW_BEAM_GLSL = /* glsl */ `
float ht2LowBeam( vec3 lightPos, vec3 towardLight, vec3 p ) {
  vec3 axis = - towardLight;
  vec3 right = normalize( cross( axis, ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) );
  vec3 up = cross( right, axis );
  vec3 d = p - lightPos;
  float along = dot( d, axis );
  if ( along <= 1e-4 ) return 0.0;
  float u = dot( d, right ) / along;
  float v = dot( d, up ) / along;
  float cut = u > 0.0 ? ${g(CUT_V)} + min( u * ${g(KINK)}, ${g(KINK_RISE)} ) : ${g(CUT_V)};
  float below = cut - v;
  float edge = clamp( below / ${g(EDGE)}, 0.0, 1.0 );
  float su = ( u - 0.073 ) / ${g(SPREAD)};
  float sb = ( below - 0.058 ) / ${g(FALL)};
  return edge * exp( - su * su ) * ( 0.3 + 0.7 * exp( - sb * sb ) );
}`;

/** A pair of lamps' half spacing (m), as the traffic's beams take it. */
export const PAIR_HALF = 0.55;
/** The beam's reach on the ground (m): faded out over its last quarter, and its sides past half `GROUND_W`. */
const GROUND_L = 64;
const GROUND_W = 32;
// The spot fade of the ground beam: the cone's edge a little wider than the real light's (right in front of the
// lamps it falls on the ground within a hand's breadth and would look jagged).
const COS_OUTER = Math.cos(HALF_ANGLE + 0.1);
const COS_INNER = Math.cos(HALF_ANGLE * (1 - PENUMBRA) - 0.1);
const smooth = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

type V3 = { x: number; y: number; z: number };
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/** One lamp's light on flat ground at `p` (pattern x spot fade x 1/d x the incidence h/d), its frame given. */
function lampOnGround(lamp: V3, axis: V3, right: V3, up: V3, ground: V3, p: V3): number {
  const d = { x: p.x - lamp.x, y: p.y - lamp.y, z: p.z - lamp.z };
  const along = dot(d, axis);
  if (along <= 1e-4) return 0;
  const d2 = dot(d, d);
  const h = -dot(d, ground); // (the lamp's height over the point: the incidence's cosine x d)
  if (h <= 0) return 0;
  const fade = smooth(along / Math.sqrt(d2), COS_OUTER, COS_INNER);
  return (lowBeamPattern(dot(d, right) / along, dot(d, up) / along) * fade * h) / d2;
}

/** A level pair's light 8 m ahead of it, BEAM_LAMP_H up: the ground beam's scale (there: 1 - e^-0.5). */
const GROUND_REF = (() => {
  const axis = { x: 0, y: -Math.sin(AIM_DOWN), z: -Math.cos(AIM_DOWN) };
  const right = { x: 1, y: 0, z: 0 };
  const up = cross(right, axis);
  const ground = { x: 0, y: 1, z: 0 };
  let e = 0;
  for (const s of [-1, 1]) e += lampOnGround({ x: s * PAIR_HALF, y: BEAM_LAMP_H, z: 0 }, axis, right, up, ground, { x: 0, y: 0, z: -8 });
  return e;
})();

/**
 * What a pair of low beams lights on flat ground at `p` (0..1, the traffic's beam brightness its 1): the pair's
 * middle at `center`, aimed along `axis`, `right` toward its right lamp, `ground` the ground's up (any space, all
 * in the same one). Its own frame, so a car leaning, on its side or on its roof lights the ground as it would (its
 * cut-off tilted, the beam going off the ground). Rolls off softly toward the lamps (no white patch under the
 * nose); fades out at the far end and the sides.
 */
export function groundBeam(center: V3, axis: V3, right: V3, ground: V3, p: V3): number {
  const up = cross(right, axis);
  let e = 0;
  for (const s of [-1, 1]) {
    const lamp = { x: center.x + right.x * s * PAIR_HALF, y: center.y + right.y * s * PAIR_HALF, z: center.z + right.z * s * PAIR_HALF };
    e += lampOnGround(lamp, axis, right, up, ground, p);
  }
  const d = { x: p.x - center.x, y: p.y - center.y, z: p.z - center.z };
  const win = smooth(GROUND_W / 2 - Math.abs(dot(d, right)), 0, GROUND_W * 0.2) * smooth(GROUND_L - dot(d, axis), 0, GROUND_L * 0.25);
  return (1 - Math.exp((-0.5 * e) / GROUND_REF)) * win;
}

/** groundBeam in GLSL (`ht2GroundBeam`, the same arguments; lowBeamPattern as `ht2Pattern`). */
export const GROUND_BEAM_GLSL = /* glsl */ `
float ht2Pattern( float u, float v ) {
  float cut = u > 0.0 ? ${g(CUT_V)} + min( u * ${g(KINK)}, ${g(KINK_RISE)} ) : ${g(CUT_V)};
  float below = cut - v;
  float edge = clamp( below / ${g(EDGE)}, 0.0, 1.0 );
  float su = ( u - 0.073 ) / ${g(SPREAD)};
  float sb = ( below - 0.058 ) / ${g(FALL)};
  return edge * exp( - su * su ) * ( 0.3 + 0.7 * exp( - sb * sb ) );
}
float ht2LampOnGround( vec3 lamp, vec3 axis, vec3 right, vec3 up, vec3 ground, vec3 p ) {
  vec3 d = p - lamp;
  float along = dot( d, axis );
  float h = - dot( d, ground );
  if ( along <= 1e-4 || h <= 0.0 ) return 0.0;
  float d2 = dot( d, d );
  float fade = smoothstep( ${g(COS_OUTER)}, ${g(COS_INNER)}, along * inversesqrt( d2 ) );
  return ht2Pattern( dot( d, right ) / along, dot( d, up ) / along ) * fade * h / d2;
}
float ht2GroundBeam( vec3 center, vec3 axis, vec3 right, vec3 ground, vec3 p ) {
  vec3 d = p - center;
  float along = dot( d, axis );
  if ( along <= 0.0 || along > ${g(GROUND_L)} ) return 0.0;
  float side = abs( dot( d, right ) );
  if ( side > ${g(GROUND_W / 2)} ) return 0.0;
  vec3 up = cross( right, axis );
  vec3 o = right * ${g(PAIR_HALF)};
  float e = ht2LampOnGround( center - o, axis, right, up, ground, p ) + ht2LampOnGround( center + o, axis, right, up, ground, p );
  float win = smoothstep( 0.0, ${g(GROUND_W * 0.2)}, ${g(GROUND_W / 2)} - side ) * smoothstep( 0.0, ${g(GROUND_L * 0.25)}, ${g(GROUND_L)} - along );
  return ( 1.0 - exp( - 0.5 * e / ${g(GROUND_REF)} ) ) * win;
}`;

const SPOT_INFO = 'getSpotLightInfo( spotLight, geometryPosition, directLight );';

/**
 * The low beam in every lit material: a headlight (a spot light of HEADLIGHT_DECAY) is shaped by lowBeamPattern
 * worked out in the shader, not by a cookie texture - a shader takes 16 textures at most (an Iris Xe), and a cookie
 * took one per lamp (three.js projects it only for lamps casting shadows, whose shadow map takes another). Patches
 * three's shader chunks once, before anything is drawn; throws if they changed (a three.js update) rather than
 * lighting round on the quiet.
 */
export function installLowBeamShader(): void {
  const C = THREE.ShaderChunk as Record<string, string>;
  if (C.lights_pars_begin.includes('ht2LowBeam')) return;
  if (!C.lights_fragment_begin.includes(SPOT_INFO)) throw new Error('installLowBeamShader: three.js spot light code changed');
  C.lights_pars_begin += LOW_BEAM_GLSL + GROUND_BEAM_GLSL;
  const isLamp = `abs( spotLight.decay - ${HEADLIGHT_DECAY.toFixed(4)} ) < 0.01`; // (a headlight: the player's, or a rival's)
  const isRival = `abs( spotLight.decay - ${RIVAL_DECAY.toFixed(4)} ) < 1e-4`;
  C.lights_fragment_begin = C.lights_fragment_begin.replace(
    SPOT_INFO,
    `${SPOT_INFO}
		if ( ${isLamp} ) directLight.color *= ht2LowBeam( spotLight.position, spotLight.direction, geometryPosition );
		#ifdef HT2_GROUND
		// The ground (npcBeams' materials): a rival's lamp lights it as the traffic's pair does, its shadow on it.
		// (Its reach the ground beam's own, softly faded, not the spot's narrower cone: that cut it off hard by the nose.)
		if ( ${isRival} ) {
			vec3 ht2Up = ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz;
			vec3 ht2Axis = - spotLight.direction;
			vec3 ht2Right = normalize( cross( ht2Axis, ht2Up ) );
			float ht2NL = max( dot( geometryNormal, directLight.direction ), 0.05 ); // (RE_Direct puts it back)
			directLight.color = ht2GroundTint * ht2GroundBeam( spotLight.position, ht2Axis, ht2Right, ht2Up, geometryPosition ) / ht2NL;
			directLight.visible = directLight.color != vec3( 0.0 );
		}
		#endif`,
  );
  // A spot light lighting nothing here (out of its cone, or a parked pool lamp: rivalLights) costs no shading.
  const from = C.lights_fragment_begin.indexOf('#if ( NUM_SPOT_LIGHTS > 0 )');
  const to = C.lights_fragment_begin.indexOf('#pragma unroll_loop_end', from);
  const call = 'RE_Direct( directLight, geometryPosition';
  const at = C.lights_fragment_begin.indexOf(call, from);
  if (from < 0 || at < 0 || at > to) throw new Error('installLowBeamShader: three.js spot light loop changed');
  C.lights_fragment_begin = `${C.lights_fragment_begin.slice(0, at)}if ( directLight.visible ) ${C.lights_fragment_begin.slice(at)}`;
}
installLowBeamShader(); // (on import: before any lit material is compiled)

/** The pattern as a texture (the tyre smoke's shader takes it: tireSmoke). Canvas top = up in the light's view, left = car's left. */
export function lowBeamCookie(size = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const half = size / 2;
  const pxPerTan = half / TAN_HALF;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.round(255 * lowBeamPattern((x - half) / pxPerTan, (half - y) / pxPerTan));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/**
 * One low-beam headlamp: a spot light shaped as a low beam in the shaders (its decay HEADLIGHT_DECAY:
 * installLowBeamShader), casting shadows - the car ahead throws a shadow into your beam (a rival's lamp casts
 * them only near the player: Rivals.headlights).
 */
export function createHeadlight(intensity: number): THREE.SpotLight {
  const l = new THREE.SpotLight(0xfff4e6, intensity, 120, HALF_ANGLE, PENUMBRA, HEADLIGHT_DECAY);
  l.castShadow = true;
  l.shadow.mapSize.set(1024, 1024);
  l.shadow.camera.near = 0.3;
  l.shadow.camera.far = 120;
  l.shadow.bias = -0.0004;
  l.shadow.normalBias = 0.02;
  return l;
}
