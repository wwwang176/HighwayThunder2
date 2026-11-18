import { it } from 'vitest';
import { writeFileSync } from 'fs';
import { mulberry32 } from '../src/ai/rng';
import { hairpinRuns } from '../src/ai/mountainDriver';
import { MOUNTAIN, mountainRoad } from '../src/road/mountain';
import { terrainOf } from '../src/road/terrain';

/**
 * The mountain road's ground (terrainOf) on 10 random roads, by what the player saw wrong in the old one: ground between
 * two legs of the road far under the lower (a canyon), a hairpin's middle under both (a pit), ground far over all the
 * road near it (a lone rock); and basins and knobs (lower / higher than all the ground 15 m round by 2 m), slopes past
 * 56°, its build time.
 *   OUT=terrain.txt npx vitest run --config training/vitest.config.ts training/mountainTerrain.train.ts
 */
it('new terrain vs the same yardsticks', () => {
  const out: string[] = [];
  const all = { pitPts: 0, pit5: 0, pit15: 0, pitMax: 0, ridge8: 0, cells: 0, ridgeMax: 0, steep: 0, ms: 0, basin: 0, knob: 0 };
  const pins: number[] = [];
  for (let seed = 1; seed <= 10; seed++) {
    const road = mountainRoad(mulberry32(seed));
    const t0 = performance.now();
    const T = terrainOf(road);
    const ms = performance.now() - t0;
    all.ms += ms;
    const S: { s: number; x: number; z: number; y: number }[] = [];
    for (let s = -MOUNTAIN.before; s <= road.length + MOUNTAIN.after; s += 2) {
      const c = road.toWorld(s, 0);
      S.push({ s, x: c.x, z: c.z, y: road.height(s) });
    }
    const st = { pitPts: 0, pit5: 0, pit15: 0, pitMax: 0, ridge8: 0, cells: 0, ridgeMax: 0, steep: 0, basin: 0, knob: 0 };
    for (let j = 1; j < T.nz - 1; j += 1)
      for (let i = 1; i < T.nx - 1; i += 1) {
        const k = j * T.nx + i;
        if (T.past[k] <= 0 || !Number.isFinite(T.past[k])) continue; // (on the road, or far from it)
        const x = T.x0 + i * T.step, z = T.z0 + j * T.step;
        st.cells++;
        const h = T.h[k];
        // (a basin or a knob: lower / higher than all the ground 15 m round by 2 m)
        if (i > 5 && j > 5 && i < T.nx - 6 && j < T.nz - 6) {
          let lo = Infinity, hi = -Infinity;
          for (let a = 0; a < 16; a++) {
            const v = T.height(x + 15 * Math.cos((a * Math.PI) / 8), z + 15 * Math.sin((a * Math.PI) / 8));
            lo = Math.min(lo, v); hi = Math.max(hi, v);
          }
          if (h < lo - 2) st.basin++;
          if (h > hi + 2) st.knob++;
        }
        const sl = Math.hypot(T.h[k + 1] - T.h[k - 1], T.h[k + T.nx] - T.h[k - T.nx]) / (2 * T.step);
        if (sl > 1.5) st.steep++; // (past ~56°)
        const near = S.map((p) => ({ ...p, dist: Math.hypot(x - p.x, z - p.z) })).filter((p) => p.dist < 70).sort((a, b) => a.dist - b.dist);
        const legs: typeof near = [];
        for (const p of near) if (legs.every((l) => Math.abs(l.s - p.s) > 60)) legs.push(p);
        if (legs.length >= 2) {
          st.pitPts++;
          const depth = Math.min(...legs.map((l) => l.y)) - h;
          if (depth > 5) st.pit5++;
          if (depth > 15) st.pit15++;
          st.pitMax = Math.max(st.pitMax, depth);
        }
        const n60 = near.filter((p) => p.dist < 60);
        if (n60.length) {
          const above = h - Math.max(...n60.map((p) => p.y));
          if (above > 8) st.ridge8++;
          st.ridgeMax = Math.max(st.ridgeMax, above);
        }
      }
    for (const h of hairpinRuns(road, 26)) {
      const mid = (h.from + h.to) / 2;
      const c = road.toWorld(mid, 1 / road.curvature(mid));
      pins.push(Math.min(road.height(h.from), road.height(h.to)) - T.height(c.x, c.z));
    }
    out.push(`seed ${seed}: ${ms.toFixed(0)} ms, grid ${T.nx}x${T.nz}; near-road cells ${st.cells}; between two legs ${st.pitPts}: >5 m under the lower leg ${st.pit5} (${((100 * st.pit5) / Math.max(1, st.pitPts)).toFixed(0)}%), >15 m ${st.pit15}, deepest ${st.pitMax.toFixed(0)} m; >8 m over all road within 60 m ${(100 * st.ridge8 / st.cells).toFixed(1)}%, highest ${st.ridgeMax.toFixed(0)} m; steeper than 56° ${(100 * st.steep / st.cells).toFixed(1)}%; basins ${st.basin}, knobs ${st.knob}`);
    for (const key of Object.keys(st) as (keyof typeof st)[]) (all as Record<string, number>)[key] = key.endsWith('Max') ? Math.max(all[key], st[key]) : all[key] + st[key];
  }
  const pc = pins.slice().sort((a, b) => a - b);
  out.push(`ALL: ${(all.ms / 10).toFixed(0)} ms a road; between legs ${all.pitPts}: >5 m pit ${((100 * all.pit5) / all.pitPts).toFixed(1)}%, >15 m ${((100 * all.pit15) / all.pitPts).toFixed(1)}%, deepest ${all.pitMax.toFixed(0)} m; ridges >8 m ${((100 * all.ridge8) / all.cells).toFixed(1)}%, highest ${all.ridgeMax.toFixed(0)} m; steeper than 56° ${((100 * all.steep) / all.cells).toFixed(1)}%; basins ${all.basin} (${((100 * all.basin) / all.cells).toFixed(2)}%), knobs ${all.knob} (${((100 * all.knob) / all.cells).toFixed(2)}%)`);
  out.push(`hairpin centres (${pc.length}): ground under the lower leg by median ${pc[pc.length >> 1].toFixed(1)} m, 90th pct ${pc[Math.floor(pc.length * 0.9)].toFixed(1)} m, max ${pc[pc.length - 1].toFixed(1)} m (negative: above it); >5 m ${pc.filter((d) => d > 5).length}`);
  writeFileSync(process.env.OUT ?? 'terrain-new.txt', out.join('\n'));
}, 900_000);
