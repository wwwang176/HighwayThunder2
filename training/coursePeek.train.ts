import { it } from 'vitest';
import { coursePlan, COURSE, COURSE_STATS } from '../src/ai/coursePlanner';
import { plan } from '../src/ai/planner';
import { CARS } from '../src/vehicles/cars';
import { KMH } from '../src/config';
import { laneCenter } from '../src/road/coords';
import type { TrafficBox } from '../src/ai/sensors';

// One plan in the gap that must be crossed (flickGap A2=40 A2V=150 RF=40,150): the course planner's against the lattice one's.
const LEN = 4.6, V = 150 * KMH, AT = 30;
const box = (s: number, lane: number, v: number): TrafficBox => ({ s, dMin: laneCenter(lane) - 0.9, dMax: laneCenter(lane) + 0.9, v, length: LEN });
function scene(gap: number, lane3: 'rf' | 'wall'): TrafficBox[] {
  const R = box(AT - gap / 2 - LEN / 2, 1, V), F = box(AT + gap / 2 + LEN / 2, 1, V);
  const out = [R, F];
  for (let k = 1; k <= 40; k++) out.push(box(R.s - k * (LEN + 2), 1, V), box(F.s + k * (LEN + 2), 1, V));
  if (lane3 === 'rf') out.push(box(40, 3, V));
  else for (let s = -100; s <= 600; s += 5) out.push(box(s, 3, V));
  out.push(box(40, 2, V));
  return out;
}
it('peek', () => {
  if (process.env.BEAM) COURSE.beam = Number(process.env.BEAM);
  if (process.env.COURSE_JSON) Object.assign(COURSE, JSON.parse(process.env.COURSE_JSON));
  const id = process.env.CAR ?? 'muscle-car';
  const spec = CARS[id];
  const ego = { s: 0, d: laneCenter(2), v: Number(process.env.V0 ?? 150) * KMH, speedCap: spec.params.maxSpeed, vD: 0, yaw: 0, vLat: 0, accel: spec.ai.accel, latAccel: spec.ai.latAccel, turnMax: Math.tan(spec.params.maxSteer) / spec.params.wheelbase, halfWidth: spec.params.width / 2, halfLength: spec.params.length / 2 };
  for (const gap of [10, 15]) for (const l3 of ['rf', 'wall'] as const) {
    const boxes = scene(gap, l3);
    for (const [name, p] of [['course', coursePlan(ego, boxes)], ['lattice', plan(ego, boxes)]] as const) {
      const pts = p.points;
      const end = pts[pts.length - 1];
      const across = pts.find((q) => q.d < laneCenter(1) - 0.5);
      process.stdout.write(`P ${id} gap ${gap} lane3 ${l3} ${name.padEnd(7)}: end s ${end.s.toFixed(0)} d ${end.d.toFixed(1)} v ${(end.v / KMH).toFixed(0)}${across ? `, across lane 1 at t ${across.t} (rel gap ${(across.s - AT - V * across.t).toFixed(1)})` : ', not across'} | ${pts.filter((_, i) => i % 4 === 0).map((q) => `${q.t}:${(q.s - AT - V * q.t).toFixed(0)}/${q.d.toFixed(1)}`).join(' ')}\n`);
    }
  }
  const n = COURSE_STATS.normal + COURSE_STATS.relaxed + COURSE_STATS.fallback;
  process.stdout.write(`P beam ${COURSE.beam}: ${(COURSE_STATS.ms / n).toFixed(0)} ms a plan\n`);
});
