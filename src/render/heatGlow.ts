import * as THREE from 'three';

/**
 * Hot brakes drawn instanced (BodyInstances): a part marked `userData.glow` - 'disc' (glowing red hot on its friction
 * ring, the slots darker) or 'caliper' (only lit a little by the disc beside it) - drawn in a copy of its material
 * that adds the glow of each instance's `instanceGlow` (0 cold to 1 full: vehicles/brakeHeat discGlow) to its
 * emissive light. At full the disc's light is a little over white: it blooms a little (render/postFx).
 */
export type GlowKind = 'disc' | 'caliper';

/** The attribute each instance's glow is in. */
export const GLOW_ATTRIBUTE = 'instanceGlow';

/** The friction ring from this share of the disc's radius (inside it the hat: brakeDisc HAT 0.56). */
const RING_FROM = 0.54;
/** The caliper's light from the disc beside it, of the disc's own. */
const CALIPER_SHARE = 0.12;

const copies = new Map<string, THREE.Material>();

/** `material` as a glowing part of `kind` (a copy, made once). */
export function glowMaterial(material: THREE.Material, kind: GlowKind): THREE.Material {
  const key = `${material.uuid}|${kind}`;
  let m = copies.get(key);
  if (m) return m;
  m = material.clone();
  m.customProgramCacheKey = () => `heatGlow-${kind}`;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float ${GLOW_ATTRIBUTE};\nvarying float vGlow;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvGlow = ${GLOW_ATTRIBUTE};`);
    // dull red just hot, brightening to a bright red (a touch of orange; past white, a little, at full)
    const heat = `
      float g = vGlow;
      vec3 hot = mix(vec3(0.5, 0.015, 0.0), vec3(1.0, 0.15, 0.02), g) * (0.25 + 2.6 * g * g) * smoothstep(0.0, 0.2, g);`;
    const disc = `
      #ifdef USE_MAP
        float rho = length(vMapUv - 0.5) * 2.0;
        float ring = smoothstep(${RING_FROM.toFixed(2)}, ${(RING_FROM + 0.06).toFixed(2)}, rho);
        hot *= ring * (0.4 + 0.6 * texture2D(map, vMapUv).g); // (the slots darker)
      #endif`;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {${heat}${kind === 'disc' ? disc : `\n      hot *= ${CALIPER_SHARE.toFixed(2)};`}
          totalEmissiveRadiance += hot;
        }`,
      );
  };
  copies.set(key, m);
  return m;
}
