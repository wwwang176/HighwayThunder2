import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { AIM_DOWN, BEAM_LAMP_H, createHeadlight, groundBeam, HALF_ANGLE, HEADLIGHT_DECAY, lowBeamPattern, PENUMBRA } from '../src/vehicles/headlight';

/** The traffic's beam as its painted texture had it (a level pair BEAM_LAMP_H up, `x` right, `z` ahead of it). */
function paintedBeam(x: number, z: number): number {
  const sa = Math.sin(AIM_DOWN);
  const ca = Math.cos(AIM_DOWN);
  const cosOuter = Math.cos(HALF_ANGLE + 0.1);
  const cosInner = Math.cos(HALF_ANGLE * (1 - PENUMBRA) - 0.1);
  const illum = (gx: number, gz: number) => {
    let e = 0;
    for (const lx of [-0.55, 0.55]) {
      const dx = gx - lx;
      const d2 = dx * dx + BEAM_LAMP_H ** 2 + gz * gz;
      const f = BEAM_LAMP_H * sa + gz * ca;
      if (f <= 0) continue;
      e += (lowBeamPattern(dx / f, (-BEAM_LAMP_H * ca + gz * sa) / f) * THREE.MathUtils.smoothstep(f / Math.sqrt(d2), cosOuter, cosInner) * BEAM_LAMP_H) / d2;
    }
    return e;
  };
  const win = THREE.MathUtils.smoothstep(16 - Math.abs(x), 0, 6.4) * THREE.MathUtils.smoothstep(64 - z, 0, 16);
  return (1 - Math.exp((-0.5 * illum(x, z)) / illum(0, 8))) * win;
}

/** A pair of lamps BEAM_LAMP_H up at the origin on a car facing -z, the car rolled by `roll` (rad, about its long axis). */
function pair(roll: number) {
  const c = Math.cos(AIM_DOWN);
  const s = Math.sin(AIM_DOWN);
  const turn = (v: { x: number; y: number; z: number }) => ({
    x: v.x * Math.cos(roll) - v.y * Math.sin(roll),
    y: v.x * Math.sin(roll) + v.y * Math.cos(roll),
    z: v.z,
  });
  return { center: { x: 0, y: BEAM_LAMP_H, z: 0 }, axis: turn({ x: 0, y: -s, z: -c }), right: turn({ x: 1, y: 0, z: 0 }) };
}
const UP = { x: 0, y: 1, z: 0 };

describe('headlights', () => {
  it('the lit shaders shape every headlight as a low beam (worked out there: no cookie texture)', () => {
    const C = THREE.ShaderChunk as Record<string, string>;
    expect(C.lights_pars_begin).toContain('float ht2LowBeam(');
    expect(C.lights_fragment_begin).toMatch(/getSpotLightInfo\( spotLight, geometryPosition, directLight \);\s*if \( abs\( spotLight\.decay - 1\.0000 \) < 0\.01 \) directLight\.color \*= ht2LowBeam\(/);
  });

  it('on the ground, a rival\'s lamp lights as the traffic\'s pair, before its shadow is put on it', () => {
    const C = THREE.ShaderChunk as Record<string, string>;
    const f = C.lights_fragment_begin;
    const ground = f.indexOf('ht2GroundBeam( spotLight.position');
    expect(f).toContain('#ifdef HT2_GROUND');
    expect(f).toContain('abs( spotLight.decay - 1.0010 ) < 1e-4');
    expect(ground).toBeGreaterThan(0);
    expect(ground).toBeLessThan(f.indexOf('getShadow( spotShadowMap'));
  });

  it('a spot light lighting nothing at a point (a parked pool lamp, out of its cone) costs no shading there', () => {
    const C = THREE.ShaderChunk as Record<string, string>;
    const spot = C.lights_fragment_begin.slice(C.lights_fragment_begin.indexOf('#if ( NUM_SPOT_LIGHTS > 0 )'));
    expect(spot).toMatch(/if \( directLight\.visible \) RE_Direct\( directLight, geometryPosition/);
  });

  it('a level pair lights the ground as the traffic\'s painted beam did', () => {
    const b = pair(0);
    for (const [x, z] of [[0, 8], [0, 3], [2, 15], [-4, 30], [6, 50], [0, 62]]) {
      expect(groundBeam(b.center, b.axis, b.right, UP, { x, y: 0, z: -z }), `${x}, ${z}`).toBeCloseTo(paintedBeam(x, z), 3);
    }
    expect(groundBeam(b.center, b.axis, b.right, UP, { x: 0, y: 0, z: -8 })).toBeCloseTo(1 - Math.exp(-0.5), 4);
    expect(groundBeam(b.center, b.axis, b.right, UP, { x: 0, y: 0, z: 5 })).toBe(0); // (behind it)
  });

  it('a car on its roof lights no road ahead; on its side, the cut-off stands upright: one side of the road lit, the other not', () => {
    const level = pair(0);
    const ahead = { x: 0, y: 0, z: -10 };
    expect(groundBeam(level.center, level.axis, level.right, UP, ahead)).toBeGreaterThan(0.2);
    const roof = pair(Math.PI);
    expect(groundBeam(roof.center, roof.axis, roof.right, UP, ahead)).toBe(0);
    const side = pair(Math.PI / 2); // (on its left side: its right lamp up)
    expect(groundBeam(side.center, side.axis, side.right, UP, { x: 2, y: 0, z: -10 })).toBeGreaterThan(0.05);
    expect(groundBeam(side.center, side.axis, side.right, UP, { x: -2, y: 0, z: -10 })).toBe(0);
  });

  it('a headlight is told by its decay, and takes no texture of its own but its shadow map', () => {
    const l = createHeadlight(100);
    expect(l.decay).toBe(HEADLIGHT_DECAY);
    expect(l.map).toBeNull();
    expect(l.castShadow).toBe(true);
  });
});
