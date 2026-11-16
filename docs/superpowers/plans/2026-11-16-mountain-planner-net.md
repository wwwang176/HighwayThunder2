# Mountain Planner + Driving Network Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mountain-road rivals (and the player's I-key AI) plan around every other car and pass as the highway AI does. With no traffic they drive the line computed today, and a per-car residual network sits on top of the current line-following control. Hairpin drifts stay with the current drift code.

**Architecture:**
- `MountainPlannerDriver` wraps today's `MountainDriver`.
- Every 0.25 s a new `planMountain()` searches lateral offsets *relative to the reference line* (today's `pathAt` without the passing offset) over the whole road width.
- With no cars, the zero-offset path costs nothing, so the plan *is* the reference.
- The wrapped driver follows reference + plan offset with its own Stanley control. In line mode, a small tanh network (`mountainNet.ts`) adds a steer correction and a throttle scale.
- Drift, settle and align run unchanged inside `MountainDriver`.

**Tech Stack:** TypeScript, vitest, Rapier (headless training), node worker_threads + rolldown (training pool), existing `Brain`/`nextGeneration`.

**Spec:** `docs/superpowers/specs/2026-11-16-mountain-planner-net-design.md`

## Global Constraints

- Highway AI untouched: `planner.ts`, `coursePlanner.ts`, `netTracker.ts`, `plannerDriver.ts`, highway tracker/recovery weights and their behaviour. `training/trackerPool.ts` may only gain an optional worker-name parameter (default unchanged).
- The drift code inside `MountainDriver` keeps its behaviour. Everything from `pin` detection to the end of settle/align is unchanged.
- `racingLine` and `speedProfile` are unchanged.
- The network is residual, like the highway's: steer = base + out0, throttle = plan throttle × clamp01(1 + out1). Zero output = today's line control exactly. The only exceptions are the §6.6 low-speed changes, which both old and new drivers get.
- Car-to-car contacts are recorded, never a pass/fail gate.
- Gates:
  - Solo runs never touch walls or rails.
  - The solo plan equals the computed no-traffic path.
  - The solo driven deviation is no worse than `MountainDriver`'s.
  - Solo time is within ±1 %.
  - Drift stats are comparable.
  - Passes happen (> 0 per race).
  - All cars finish in ≥ 90 % of races.
  - No NaN, no falls.
- Unit tests cover math models only. Heavy simulation goes in `training/*.train.ts` (run with `--config training/vitest.config.ts`).
- Commits end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014MRszQfDGQq3yeSsfjsva7
  ```
- Never commit `bash.exe.stackdump`. Kill leftover vitest/node training processes after runs (keep vite on 5180 and MCP).
- Long runs (training, benches): set the process priority above normal (trackerPool does), one car's bench at a time.

## Review Focus

1. A rival put back by `Rivals` (stuck, fell, R) calls `driver.reset(d)`. The old plan must be dropped, not followed from the old place. Test in Task 3.
2. The grid starts at s = −3 / −11 (before 0) and the road runs past its length after the finish. The planner must clamp, not NaN. Test in Task 2.
3. A car already overlapping it (side by side, touching) must not make every path infeasible. Overlap at the first station is ignored. Test in Task 2.
4. At the start, the car ahead is standing (v = 0). It must be predicted to speed up, so the cars behind don't swerve into the gap. Test in Task 2 (start case) and Task 4 (STALL bench).
5. Right after a drift the car is metres off the reference and turned. The plan must start from where the car is and come back gradually (slope-limited), not snap. Test in Task 2.

---

### Task 1: MountainDriver: reference access, external offsets, low-speed fixes

**Files:**
- Modify: `src/ai/mountainDriver.ts`
- Test: `tests/mountainDriver.test.ts`

**Interfaces:**
- Produces, on `MountainDriver`:
  - `external: { offsetAt(s: number): number; vAt(s: number): number } | null` (default `null`). When non-null:
    - the passing logic (:387-409) and the drift-approach `want` (:417-420) are skipped and `this.offset` stays 0;
    - `pathAt` uses `base + external.offsetAt(x)` instead of `base` + `this.offset` (`base` = clamped line d blended with `toPin`, as now);
    - `aimD` uses the same;
    - `target = Math.min(target, external.vAt(self.s + Math.max(T.leadMin, T.lead * v)))` after the existing caps;
    - after a drift (:453-458) `this.offset` is not set (recover/settling still are).
  - `refAt(s: number): number` — today's `pathAt(s).d` with offset 0 (clamped line d + `toPin` blend, using the `toPin` of the last `drive`).
  - `refSpeed(s: number, v: number): number` — `speedAt(s + max(leadMin, lead·v))` capped by the hairpin braking caps of :475-483 (same math, moved into this method and called from `driveRaw`).
  - `refKappa(s: number): number` — curvature of `refAt` (finite difference, h = 1 m, as `pathAt`'s psi).
  - `kickAhead(s: number, v: number): number | null` — the next hairpin's kick point `h.from − v·kickEarly` (h ≠ done, h.to > s) or null.
  - `inDrift(): boolean` — `mode !== 'line'` (kick/drift/catch/danger/exit/settle/pull/ease).
  - `lastLine: HandlingInput | null` — the input of the last step if it came from line mode (null otherwise), for the net wrapper.
- Low-speed changes (spec §6.6, apply always):
  - `gasMost` (:665) applies only when `v >= D.minSpeed`.
  - In the Stanley offset term, `T.offsetSoft` becomes `T.offsetSoft + T.lowSoft * Math.max(0, 1 - v / D.minSpeed)`, with new `MOUNTAIN_DRIVER.lowSoft = 4`.

- [ ] **Step 1: Write failing tests** in `tests/mountainDriver.test.ts`:
  - `'external offsets of 0 and no cap: the same inputs as without (no cars, 200 steps along the bend)'`: two drivers, one with `external = { offsetAt: () => 0, vAt: () => 1e9 }`; feed both the same `onLine` states s = 380..440. Expect each `steer`/`throttle`/`brake` to be equal (toBe).
  - `'external offset steers toward it: +1.5 m at 120 → aimD ≈ refAt(look) + 1.5'`.
  - `'refAt(s) is pathAt with no passing offset: on a straight, the line\'s d'`: `expect(m.refAt(150)).toBeCloseTo(lineAt(m.line!, 150).d, 9)`.
  - `'standing start sliding sideways (vLat 0.5, vLong 1): the throttle is not cut (gasMost only past minSpeed)'`: target well above v, so `throttle > 0.9`.
  - `'standing start 1.5 m off its line: the wheel not on full lock (low-speed soft)'`: `Math.abs(steer) < 0.6` after 60 steps at v = 0.5.
- [ ] **Step 2: Run** `npx vitest run tests/mountainDriver.test.ts`. Expected: the new tests FAIL (`external`/`refAt` undefined, the throttle cut, full lock).
- [ ] **Step 3: Implement** the interfaces above in `mountainDriver.ts`. Move the hairpin-cap loop into `refSpeed` and call it from `driveRaw`, so the targets are the same.
- [ ] **Step 4: Run** `npx vitest run tests/mountainDriver.test.ts tests/mountainLine.test.ts`. Expected: all PASS, including the old ones.
- [ ] **Step 5: Bench guard:** `SEEDS=4 npx vitest run --config training/vitest.config.ts training/mountainRace.train.ts`. Expected: all home 4/4, the drift lines comparable to before (seed 1: P ~106 s, d10).
- [ ] **Step 6: Commit** `feat(mountain-ai): the mountain driver's line open to a planner - its reference, offsets set from outside; its wheel and throttle at a standstill as a start wants`.

### Task 2: The planner

**Files:**
- Create: `src/ai/mountainPlanner.ts`
- Test: `tests/mountainPlanner.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 directly (it takes functions).
- Produces:
```ts
export interface PlanRef { d(s: number): number; v(s: number): number; kappa(s: number): number; room(s: number): number }
export interface PlanOther { s: number; dMin: number; dMax: number; v: number; length: number; vAhead: number } // vAhead: the speed it is predicted to reach (≥ v)
export interface PlanInput {
  s: number; d: number; v: number;          // the car now (road coords)
  startOffset: number;                       // d − ref.d(s) to start from (continuity: see Task 3)
  halfWidth: number; halfLength: number;
  ref: PlanRef; others: PlanOther[];
  stopAt: number | null;                     // kick point: the plan ends there, its offset pulled to 0
  roadEnd: number;                           // plan no further than this s
}
export interface MountainPlan { s0: number; step: number; offsets: Float64Array; vCap: Float64Array;
  offsetAt(s: number): number; vAt(s: number): number; blocked: boolean }
export const MOUNTAIN_PLAN: { step: number; horizonTime: number; horizonMin: number; grid: number; slope: number;
  gapS: number; gapD: number; wRef: number; wSlow: number; wTurn: number; wEnd: number; accelOthers: number;
  followGap: number; followGain: number };
export function planMountain(input: PlanInput): MountainPlan;
```
- Algorithm (decided here):
  - Stations every `step` = 4 m from `s0 = max(0, s)` over `max(horizonMin 60, horizonTime 4 × v)` m. End at `stopAt` or `roadEnd` if sooner.
  - Candidate offsets at each station: `k·grid` (grid 0.25 m), with |ref.d + k·grid| ≤ room(s).
  - Station 0 is `startOffset` exactly.
  - Transitions: |Δoffset| ≤ `slope`·step (slope 0.3).
  - Dynamic programming over (station, k), each state keeping its predecessor.
  - Cost per station:
    - `wRef·off²`;
    - `wTurn·(Δoffset/step)²`;
    - path-curvature speed: κ_path ≈ κ_ref + Δ²offset/step² (using the predecessor chain); `vPath = |κ_path| > |κ_ref| ? v_ref·√(|κ_ref|/|κ_path|) : v_ref` (κ_ref floored at 1e-4 inside the ratio); cost `wSlow·(v_ref − vPath)`.
  - Time at a station is accumulated from `vPath` (floored at max(v, 3)).
  - Others:
    - Predicted position `s_b(t) = b.s + b.v·t + ½·a·t²` with a = `accelOthers` (4 m/s²) until it reaches `vAhead`, then constant.
    - A station where |s_b(t) − s_i| < (b.length/2 + halfLength + gapS) and the d-ranges overlap within `gapD` is infeasible (+∞), except station 0 and cars behind it now (`b.s + b.length/2 < s − halfLength`).
  - End cost `wEnd·off²` at the last station when `stopAt` set.
  - If no feasible path: `blocked = true`, offsets = startOffset easing to 0 at slope.
    - vCap = follow speed `b.v + followGain·max(0, gap − followGap)` for the nearest car ahead overlapping the zero-offset path; `vAt` returns min(that, vPath).
  - `offsetAt(s)` interpolates linearly between stations, and holds the last offset past the end (0 when stopAt was the end).
  - `vAt(s)` returns vCap, or `Infinity` when `vCap` equals ref (no constraint) so the driver's own target rules.
- [ ] **Step 1: Write failing tests** (`tests/mountainPlanner.test.ts`), on a synthetic `PlanRef` (a straight: d = 0.8, v = 30, κ = 0, room 3.2; and a bend: d(s) = 1.5·sin(s/40), κ from it):
  - `'no cars: every offset 0 and no speed cap - the plan is its reference'`: `offsets.every(o => o === 0)`, `vAt(s) === Infinity` for all s.
  - `'a standing car on its line 30 m ahead: the plan goes round it, within the road, and clears its width'`: some station near s+30 has |ref.d + off − carCentre| ≥ carHalf + halfWidth; `max |ref.d + off| ≤ 3.2`.
  - `'no room either side: blocked, following its speed'`: car spanning ±3.2 → `blocked === true`, `vAt(s+10) < 30`.
  - `'the start: a car standing just ahead (v 0, vAhead 30) while it stands too - no swerve'`: offsets all 0.
  - `'starting 2 m off its reference (after a drift): back to it no faster than the slope'`: offsets[0] = 2, |offsets[i+1] − offsets[i]| ≤ 0.3·4 + 1e-9, last offset < 2.
  - `'stopAt: the plan ends at the kick point, its offset pulled to 0'`: with a slow car forcing an offset earlier, last station s ≈ stopAt and |last offset| < first nonzero offset.
  - `'a car beside it already touching does not block every path'`: overlapping at station 0 → `blocked === false`.
  - `'s before 0 (the grid) and past the road\'s end: finite'`: s = −11 → `s0 = 0`, all finite; s = roadEnd − 10 → one or two stations, finite.
- [ ] **Step 2: Run** `npx vitest run tests/mountainPlanner.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `planMountain` as above.
- [ ] **Step 4: Run** the same. Expected: PASS. Also time 1000 plans on the bend with 3 cars, printed: aim < 1 ms each (log only).
- [ ] **Step 5: Commit** `feat(mountain-ai): the mountain planner - every car seen, round them on either side over the whole road; alone, the line it drives now`.

### Task 3: The driver: planner + net + drift hand-over

**Files:**
- Create: `src/ai/mountainNet.ts`, `src/ai/mountainPlannerDriver.ts`
- Test: `tests/mountainPlannerDriver.test.ts`

**Interfaces:**
- Consumes: Task 1's `MountainDriver.external/refAt/refSpeed/refKappa/kickAhead/inDrift/lastLine/roomAt`; Task 2's `planMountain`, `MountainPlan`.
- Produces:
```ts
// mountainNet.ts
export const MOUNTAIN_NET_LAYERS: number[]; // [INPUTS, 12, 12, 2]
export const MOUNTAIN_NET_INPUTS: number;   // count, see list
export function mountainNetInputs(self: SelfState, plan: { d(s: number): number; kappa(s: number): number }, road: Centerline,
  room: (s: number) => number, base: HandlingInput, baseSteer: number, out: Float32Array): Float32Array;
export function quietMountainNet(rng: Rng): Brain;          // random hidden layers, output layer all 0
export function mountainNetFrom(weights: number[] | undefined): Brain | null;
export function applyMountainNet(brain: Brain | null, inputs: Float32Array, base: HandlingInput): HandlingInput;
// mountainPlannerDriver.ts
export class MountainPlannerDriver implements RivalDriver {
  readonly inner: MountainDriver; net: Brain | null; plan: never; // (no `plan`: the game draws a driver's plan)
  accelScale: number; push: number; budget: number; mode: string; aimD: number; mplan: MountainPlan | null;
  setRoad(road: Centerline, ai: CarSpec['ai']): void;   // inner.setRoad + net = mountainNetFrom(ai.mountainTracker)
  drive(self: SelfState, others: TrafficBox[], p?: CarParams): HandlingInput;
  reset(d?: number): void;                              // inner.reset, mplan = null, replan now
  dispose(): void;
}
export const MOUNTAIN_REPLAN = 0.25; // s
```
- Net inputs (all /scale, clamped ±3):
  - (plan d − d)/2 and Δd/Δs·5 at plan look-aheads 0, 0.15, 0.3, 0.5 s;
  - plan κ ×20 at those points;
  - road κ ×20, grade ×5, crossSlope ×5;
  - room left/right − |d| (/3);
  - vLong/40, vLat/5, slip/0.3, yaw/0.3, yawRate/1;
  - wheel, base steer, base throttle;
  - aLong/10, aLat/10 (0 if absent).
- Outputs: steer += out0, throttle *= clamp01(1 + out1); brake as base.
- Driver behaviour:
  - Every `MOUNTAIN_REPLAN` s, when `!inner.inDrift()`, call `planMountain` with:
    - `ref` = `{ d: inner.refAt, v: (s) => inner.refSpeed(s, 0), kappa: inner.refKappa, room: inner.roomAt }`;
    - `startOffset` = the previous plan's `offsetAt(self.s)` if it exists and |self.d − (refAt + that)| < 1 m, else `self.d − refAt(self.s)`;
    - `stopAt = inner.kickAhead(self.s, v)`;
    - others from `TrafficBox`, with `vAhead = max(b.v, inner.refSpeed(b.s, 0))`.
  - Set `inner.external = mplan`, or null while in drift.
  - After `inner.drive`, if `inner.lastLine` and `net`: apply the net to it.
  - On the first non-drift step after a drift: replan at once (fresh start from the car).
- [ ] **Step 1: Write failing tests** (`tests/mountainPlannerDriver.test.ts`, the ROAD of mountainDriver.test.ts):
  - `'no cars, no net: the same inputs as MountainDriver step by step (on its line, s 380..440)'`.
  - `'a quiet net (output layer 0) changes nothing'`: same as above with `net = quietMountainNet(rng)`.
  - `'a standing car on its line ahead: within 2 s of steps it aims beside it (|aimD − refAt| > 1)'`.
  - `'reset drops the plan'`: after reset, `mplan === null` until the next drive.
  - `'mountainNetInputs: finite and the right length for a car at s = −11 (the grid)'`.
- [ ] **Step 2: Run** `npx vitest run tests/mountainPlannerDriver.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `mountainNet.ts` and `mountainPlannerDriver.ts`. Add `mountainTracker?: number[]` to `CarSpec.ai` in `src/vehicles/cars/types.ts` (doc comment: the mountain road's residual driving network, training/mountainNet.train.ts).
- [ ] **Step 4: Run** `npx vitest run tests/mountainPlannerDriver.test.ts tests/mountainDriver.test.ts tests/mountainPlanner.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mountain-ai): the mountain planner driver - the plan every 0.25 s, its residual network on the line, the drift as it is`.

### Task 4: Bench: old vs new, solo, stall, passes

**Files:**
- Modify: `training/mountainRace.train.ts`

**Interfaces:**
- Env:
  - `DRIVER=old|new` (default old) picks `MountainDriver` or `MountainPlannerDriver` for all four cars.
  - `SOLO=1`: each of the three cars runs alone (no rivals), seed by seed. It reports:
    - wall contacts;
    - time;
    - drift stats;
    - lateral deviation from the computed path: |car.d − (refAt(s) + 0)| sampled every 0.1 s, excluding `inDrift()` steps and the steps after a drift until the car is first within 0.3 m of the reference; median and p95.
  - `STALL=1`: the player's car is held at standstill with `{throttle:0, brake:1}` for the first 5 s.
- Counters (all modes): car-contact *events* (a pair's contact starting after ≥ 0.5 s apart counts once), start contacts (events in the first 5 s after t = 0), passes (car A going from behind B to ahead of B with |Δs| < 10 m at the moment B was behind, A then staying ahead ≥ 2 s), per race and totals.
- [ ] **Step 1:** Implement the env switches and counters. Keep the existing output lines and asserts.
- [ ] **Step 2: Run** baselines (one at a time):
  - `SOLO=1 SEEDS=10 DRIVER=old`
  - `SOLO=1 SEEDS=10 DRIVER=new`
  - `SEEDS=10 DRIVER=old`
  - `SEEDS=10 DRIVER=new`
  - `STALL=1 SEEDS=10 DRIVER=old`
  - `STALL=1 SEEDS=10 DRIVER=new`

  Save the logs in the scratchpad. Expected for new (net-less):
  - solo deviation ≤ old's;
  - solo walls 0, or the same as old (if old has wall touches solo, stop and report to the user: inherited from the drift);
  - solo time ±1 %;
  - passes > 0;
  - STALL start contacts fewer than old.
- [ ] **Step 3:** If a gate fails, fix in Task 1–3 code (rule and ledger it) and re-run the failing bench.
- [ ] **Step 4: Commit** `test(mountain-ai): the mountain races bench old and new drivers - alone (off the line, walls), stalled starts, passes and contacts counted`.

### Task 5: In the game

**Files:**
- Modify: `src/game/game.ts` (makeRivals :921-931, mountainBudget :939-942, aiDriver setRoad :866), `src/main.ts:50`

**Interfaces:**
- Consumes: `MountainPlannerDriver` (Task 3).
- [ ] **Step 1:** Make these changes:
  - `makeDriver: () => new MountainPlannerDriver()`.
  - `mountainBudget()` sets `budget` on `MountainDriver` or `MountainPlannerDriver`.
  - `main.ts`: `mountain ? new MountainPlannerDriver() : …`.
  - game.ts:866: setRoad for either.
- [ ] **Step 2:** `npx tsc --noEmit -p .` and `npx vitest run`. Expected: clean, all pass.
- [ ] **Step 3: Playtest in the browser** (vite 5180, `?mountain`, back up localStorage first, never cross the finish by teleport). Check:
  - the start (no pile-up, cars launch straight);
  - a pass happening;
  - a hairpin drift unchanged.
  Take screenshots (night; devtools).
- [ ] **Step 4: Commit** `feat(mountain): the rivals and the I-key AI on the mountain planner driver`.

### Task 6: Training infrastructure

**Files:**
- Modify: `training/trackerPool.ts` (`start(threads, worker = 'trackerWorker')`, the bundle path from it)
- Create: `training/mountainNetEval.ts`, `training/mountainNetWorker.ts`, `training/mountainNet.train.ts`

**Interfaces:**
- `mountainNetEval.ts`:
  - `soloCost(brains: (Brain|null)[], car: string, seeds: number[], seconds: number): number[]`. Each brain drives the car alone from the start on each seed for `seconds` (headless physics as mountainRace).
  - Cost per brain = Σ:
    - lag² × 0.25 every 0.25 s, where lag = car.d − the plan made 0.75 s earlier `refAt + offsetAt`, outside drift;
    - +5 per wall-contact event;
    - −0.01 per metre covered;
    - +20 if it fell or NaN.
  - `raceCost(brains, car, seed, seconds)`: the brain's car plus 3 rivals on the new driver (no net), from the grid. Cost = the same terms, car contacts not counted, +5 per reset.
  - `initEval(): Promise<void>` (RAPIER.init).
- `mountainNetWorker.ts`: as `trackerWorker.ts`, ops `solo` and `race`.
- `mountainNet.train.ts` env:
  - `CAR`, `GENS` (30), `POP` (40), `SIGMA` (0.1), `SEED`, `THREADS` (12), `SOLO_SEEDS` (3 per gen, fresh each gen from 20000+gen·10), `SOLO_S` (60), `RACE_S` (40), `CONTINUE`, `SAVE`, `ARCHIVE`.
  - Each gen:
    - population = elite + `nextGeneration` (DEFAULT_EVO), gen 0 from `quietMountainNet`;
    - every brain gets `soloCost` + `raceCost` on the same seeds;
    - the start brain is included, and the guard adds 20 × max(0, cost − startCost − 0.05).
  - Validation every 5 gens:
    - fixed seeds 9001–9005 solo (full race) for the best;
    - save only if solo walls 0, time ≤ start's × 1.0, deviation p50 ≤ start's;
    - archive every validated candidate to `training/out/mountainNet/<car>-g<gen>.json`.
  - `SAVE=1` writes `src/vehicles/cars/<camel>MountainNet.ts` exporting `<ID>_MOUNTAIN_NET: number[]`, and the car spec gets `mountainTracker: <ID>_MOUNTAIN_NET`.
- [ ] **Step 1:** Implement. Smoke: `CAR=street-racer GENS=1 POP=6 THREADS=3 npx vitest run --config training/vitest.config.ts training/mountainNet.train.ts`. Expected: one generation printed with costs, finite; the start brain's cost is printed.
- [ ] **Step 2: Commit** `feat(training): the mountain driving network's training - alone on random mountain roads and racing three, lagging its plan, the walls, the way it got`.

### Task 7: Train the three cars

- [ ] **Step 1:** Run the street racer in the background (`run_in_background`, log in the scratchpad): `CAR=street-racer GENS=30 POP=40 SAVE=1`. Then muscle-car and jdm (one at a time, or two in parallel with THREADS split if memory allows).
- [ ] **Step 2:** For each saved car, bench: `SOLO=1 SEEDS=10 DRIVER=new` and `SEEDS=10 DRIVER=new`, against the net-less numbers from Task 4. Adopt only if the solo gates hold (walls 0, deviation ≤, time ±1 %). Otherwise revert that car's weights file and ledger it.
- [ ] **Step 3: Commit** the adopted weights: `feat(mountain-ai): <car>'s mountain driving network, trained (<summary>)`.

### Task 8: Final check and hand-over

- [ ] **Step 1:** `npx tsc --noEmit -p .` and `npx vitest run`, all green. Final bench `SEEDS=10 DRIVER=new` and `STALL=1`. Numbers into `docs/ai-experiments.md` (a new mountain section).
- [ ] **Step 2:** Final whole-branch review (subagent, most capable model), fix Critical/Important.
- [ ] **Step 3:** Playtest in the browser and send screenshots. Update memory (`mountain-road-branch.md`). Hand over to the user to play.
