import type { MountainDriver } from '../src/ai/mountainDriver';

/**
 * A drifting driver's paths this step, for the trajectory dumps (JSON), in world metres as flat x, z lists: `pred` where
 * it is going (turning on as it turns now), `need` the arc it wants and `at` the point it aims at (0: not aiming); 0
 * when it is not drifting round a hairpin. Turns the driver's recording on (from its next step).
 */
export function aimDump(drv: MountainDriver, road: { toWorld(s: number, d: number): { x: number; z: number } }): 0 | { pred: number[]; need: number[] | 0; at: number[] | 0 } {
  drv.record = true;
  const a = drv.aimPath;
  if (!a) return 0;
  const w = (s: number, d: number) => {
    const p = road.toWorld(s, d);
    return [+p.x.toFixed(2), +p.z.toFixed(2)];
  };
  const flat = (pts: [number, number][]) => pts.flatMap(([s, d]) => w(s, d));
  return { pred: flat(a.pred), need: a.need ? flat(a.need) : 0, at: a.at ? w(a.at[0], a.at[1]) : 0 };
}
