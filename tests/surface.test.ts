import { describe, it, expect } from 'vitest';
import { MOUNTAIN, mountainRoad } from '../src/road/mountain';
import { surfaceMesh } from '../src/road/surface';
import { mulberry32 } from '../src/ai/rng';

const road = mountainRoad(mulberry32(3));
const from = -MOUNTAIN.before;
const to = MOUNTAIN.length + MOUNTAIN.after;
const mesh = surfaceMesh(road, from, to, 6);

describe('surfaceMesh', () => {
  it('lies on the road: each vertex where the road is at its (s, d), at its height', () => {
    const n = mesh.positions.length / 3;
    for (let i = 0; i < n; i += 7) {
      const s = mesh.s[i];
      const d = mesh.d[i];
      const w = road.toWorld(s, d);
      expect(mesh.positions[3 * i]).toBeCloseTo(w.x, 3);
      expect(mesh.positions[3 * i + 1]).toBeCloseTo(road.surfaceHeight(s, d), 3); // (its bends banked)
      expect(mesh.positions[3 * i + 2]).toBeCloseTo(w.z, 3);
      expect(Math.abs(d)).toBeCloseTo(6, 6);
    }
  });

  it('runs from `from` to `to`, rows close together where it bends hard', () => {
    expect(mesh.s[0]).toBeCloseTo(from, 6);
    expect(mesh.s[mesh.s.length - 1]).toBeCloseTo(to, 6);
    for (let i = 2; i < mesh.s.length; i += 2) {
      const ds = mesh.s[i] - mesh.s[i - 2];
      expect(ds).toBeGreaterThan(0);
      const k = Math.abs(road.curvature(mesh.s[i - 2] + ds / 2));
      if (k > 1 / 25) expect(ds).toBeLessThanOrEqual(1.5 + 1e-6);
      expect(ds).toBeLessThanOrEqual(3 + 1e-6);
    }
  });

  it('faces up, and stays small', () => {
    const tri = mesh.indices.length / 3;
    expect(tri).toBeLessThan(20000);
    const p = mesh.positions;
    for (let t = 0; t < tri; t += 11) {
      const [a, b, c] = [mesh.indices[3 * t], mesh.indices[3 * t + 1], mesh.indices[3 * t + 2]];
      const ux = p[3 * b] - p[3 * a], uy = p[3 * b + 1] - p[3 * a + 1], uz = p[3 * b + 2] - p[3 * a + 2];
      const vx = p[3 * c] - p[3 * a], vy = p[3 * c + 1] - p[3 * a + 1], vz = p[3 * c + 2] - p[3 * a + 2];
      const ny = uz * vx - ux * vz; // (u x v).y
      void uy; void vy;
      expect(ny).toBeGreaterThan(0);
    }
  });
});
