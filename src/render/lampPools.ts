import * as THREE from 'three';

/** A street light's pool of light on the ground: its radius (m) and its brightness across it (centre to edge). */
const POOL_RADIUS = 14;
/** Irradiance at full poolStrength (the pools were once painted on, added: this matches them on the road). */
export const POOL_GAIN = 50;

/** One column of lamps along the road: where its pools lie across it, and whether real lights take its place near the player. */
export interface PoolColumn {
  x: number;
  /** Over our carriageway: near the player a real light shines instead (its pool fades as the light comes on). */
  ours: boolean;
}

/**
 * The street lights' pools of light, as light in the ground's shaders (not painted over it): the ground's own
 * colour lit by them, so grass under a lamp stays green (painted on, added, they turned it grey). The lamps
 * stand in rows every `spacing` m along the world (rows at z = phase + k spacing), the same columns in each;
 * a fragment only looks at the nearest row (the pools don't reach the next). Near the player, the pools of the
 * columns over our carriageway give way to the real lights (the same fade as RoadScene.update's).
 */
export class LampPools {
  private readonly uniforms = {
    poolX: { value: new THREE.Vector4() },
    poolOurs: { value: new THREE.Vector4() },
    poolPlayerS: { value: 0 },
    poolColor: { value: new THREE.Color() },
  };

  constructor(
    columns: PoolColumn[],
    private readonly spacing: number,
    private readonly phase: number,
    private readonly realWindow: { behind: number; ahead: number; fade: number },
  ) {
    if (columns.length !== 4) throw new Error(`LampPools: 4 columns, not ${columns.length}`);
    this.uniforms.poolX.value.fromArray(columns.map((c) => c.x));
    this.uniforms.poolOurs.value.fromArray(columns.map((c) => (c.ours ? 1 : 0)));
  }

  /** Make a ground material lit by the pools (on top of its own shader changes). */
  patch(mat: THREE.MeshStandardMaterial): void {
    const own = mat.onBeforeCompile.bind(mat);
    const ownKey = mat.customProgramCacheKey.bind(mat)();
    mat.customProgramCacheKey = () => `${ownKey}|pools`;
    const w = this.realWindow;
    mat.onBeforeCompile = (shader, renderer) => {
      own(shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      // (where on the road, not the world: the road may bend; d across, -s along as the old world z)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 roadPos;\nvarying vec2 vPool;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvPool = roadPos;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec2 vPool;
uniform vec4 poolX;
uniform vec4 poolOurs;
uniform float poolPlayerS;
uniform vec3 poolColor;
float poolFall(float r) {
  r = clamp(r, 0.0, 1.0);
  return r < 0.35 ? mix(0.95, 0.55, r / 0.35) : r < 0.7 ? mix(0.55, 0.15, (r - 0.35) / 0.35) : mix(0.15, 0.0, (r - 0.7) / 0.3);
}
vec3 poolLight(vec2 p) {
  float rz = ${this.phase.toFixed(1)} + floor((p.y - ${this.phase.toFixed(1)}) / ${this.spacing.toFixed(1)} + 0.5) * ${this.spacing.toFixed(1)};
  float ds = -rz - poolPlayerS; // the row ahead of the player by (s = -z)
  float real = (ds > -${w.behind.toFixed(1)} && ds < ${w.ahead.toFixed(1)})
    ? clamp(min((ds + ${w.behind.toFixed(1)}) / ${w.fade.toFixed(1)}, (${w.ahead.toFixed(1)} - ds) / ${w.fade.toFixed(1)}), 0.0, 1.0) : 0.0;
  float dz = p.y - rz;
  float e = 0.0;
  for (int i = 0; i < 4; i++) {
    float dx = p.x - poolX[i];
    e += poolFall(sqrt(dx * dx + dz * dz) / ${POOL_RADIUS.toFixed(1)}) * (1.0 - poolOurs[i] * real);
  }
  return e * poolColor;
}`,
        )
        .replace(
          '#include <lights_fragment_end>',
          '#include <lights_fragment_end>\nreflectedLight.directDiffuse += BRDF_Lambert(diffuseColor.rgb) * poolLight(vPool);',
        );
    };
    mat.needsUpdate = true;
  }

  /** Each frame: where the player is (s), the lamps' colour and the pools' strength. */
  update(playerS: number, color: THREE.ColorRepresentation, strength: number): void {
    this.uniforms.poolPlayerS.value = playerS;
    this.uniforms.poolColor.value.set(color).multiplyScalar(strength * POOL_GAIN);
  }
}
