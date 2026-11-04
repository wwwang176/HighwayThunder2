import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createHeadlight, HEADLIGHT_DECAY } from '../src/vehicles/headlight';

describe('headlights', () => {
  it('the lit shaders shape every headlight as a low beam (worked out there: no cookie texture)', () => {
    const C = THREE.ShaderChunk as Record<string, string>;
    expect(C.lights_pars_begin).toContain('float ht2LowBeam(');
    expect(C.lights_fragment_begin).toMatch(/getSpotLightInfo\( spotLight, geometryPosition, directLight \);\s*if \( abs\( spotLight\.decay - 1\.0000 \) < 1e-4 \) directLight\.color \*= ht2LowBeam\(/);
  });

  it('a spot light lighting nothing at a point (a parked pool lamp, out of its cone) costs no shading there', () => {
    const C = THREE.ShaderChunk as Record<string, string>;
    const spot = C.lights_fragment_begin.slice(C.lights_fragment_begin.indexOf('#if ( NUM_SPOT_LIGHTS > 0 )'));
    expect(spot).toMatch(/if \( directLight\.visible \) RE_Direct\( directLight, geometryPosition/);
  });

  it('a headlight is told by its decay, and takes no texture of its own but its shadow map', () => {
    const l = createHeadlight(100);
    expect(l.decay).toBe(HEADLIGHT_DECAY);
    expect(l.map).toBeNull();
    expect(l.castShadow).toBe(true);
  });
});
