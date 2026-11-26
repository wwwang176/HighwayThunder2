import * as THREE from 'three';

/**
 * A turning rotor drawn as a disc of blurred blades (its solid blades not drawn): each pixel by how far it is from
 * the nearest blade's centre line - the blade itself solid (`bladeWidth` of the radius across, as wide at the tip
 * as at the root: a strip, not a wedge), a trail fading off to either side of it (`rootSmear` of the radius long at
 * the root to `tipSmear` at the tip, `smearCurve` how late it lengthens), `rootAlpha` thick at the root to `tipAlpha`
 * at the tip (`fadeCurve`: how soon it thins), and a faint haze over the whole disc (`base` at the hub, thinning
 * out by `baseCurve`); its rim soft (the disc a polygon). Lit as a dark matt part (`shade` its grey).
 * The pattern turns `spin` rad/s - not the rotor's own pace: that, beating with the frame rate, reads as a slow
 * turn, standing still or turning back (the wagon wheel); with `blades` blades it must stay well under half a gap
 * (PI / blades) a frame at the lowest frame rate.
 */
export interface RotorBlur {
  blades: number;
  radius: number;
  bladeWidth: number;
  rootSmear: number;
  tipSmear: number;
  smearCurve: number;
  rootAlpha: number;
  tipAlpha: number;
  fadeCurve: number;
  base: number;
  baseCurve: number;
  shade: number;
  spin: number;
}

/**
 * A rotor's blurred disc: in its own xy plane, centred on its axis (z) - turned about z by the caller (the pattern
 * symmetrical: either way round looks the same). Both faces (seen from under it as much as over); translucent, not
 * written into depth; in one pass (flat: a back pass would draw the same pixels).
 */
export function rotorBlurMesh(p: RotorBlur): THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial> {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setScalar(p.shade),
    roughness: 0.7,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.rb = { value: [p.blades, p.radius, p.bladeWidth, p.rootSmear, p.tipSmear, p.smearCurve, p.rootAlpha, p.tipAlpha, p.fadeCurve, p.base, p.baseCurve] };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRotor;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRotor = position.xy;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRotor;\nuniform float rb[11];')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        float blades = rb[0];
        float rr = clamp(length(vRotor) / rb[1], 0.0, 1.0);
        // (off the nearest blade's centre: as a share of the gap between blades, 0 on it, 0.5 midway; as a distance
        // across, so the blade is a strip)
        float off = abs(fract(atan(vRotor.y, vRotor.x) / 6.28318530718 * blades + 0.5) - 0.5);
        float dist = rr * sin(off * 6.28318530718 / blades);
        float smear = mix(rb[3], rb[4], pow(rr, rb[5]));
        float core = rb[2] * 0.5;
        float trail = dist < core ? 1.0 : exp(-(dist - core) / max(smear, 1e-3));
        float dens = mix(rb[6], rb[7], 1.0 - pow(1.0 - rr, rb[8]));
        float haze = rb[9] * pow(max(1.0 - rr, 1e-4), rb[10]);
        float rim = 1.0 - smoothstep(0.94, 1.0, rr);
        gl_FragColor.a = clamp(trail * dens + haze, 0.0, 1.0) * rim;`,
      );
  };
  m.customProgramCacheKey = () => 'rotorBlur';
  return new THREE.Mesh(new THREE.CircleGeometry(p.radius, 64), m);
}
