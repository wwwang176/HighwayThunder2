# Mountain Road Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A playable mountain-road race mode (`?mountain`): random two-lane road with tight bends, hairpins, climbs and descents, a rock wall on one side and a railed cliff on the other, the player plus 3 rivals driven by a racing-line AI.

**Architecture:** The road stays a `Centerline` (plan curve) that gains an optional height profile and may turn back on itself (no plan overlap). Physics swaps the ground half-space for a trimesh of the road surface; walls/rails stay per-car planes. A new scenery class, a new driver (racing line + speed profile + pure pursuit), and a mode flag fixed at Game construction; every highway path is left as it is.

**Tech Stack:** TypeScript, three.js 0.187, Rapier 3D compat 0.21, Vitest 5 (unit tests: `npx vitest run`; heavy sims: `npx vitest run --config training/vitest.config.ts training/<x>.train.ts`).

**Spec:** `docs/superpowers/specs/2026-11-15-mountain-road-design.md` (§6.1 holds the decisions taken after the builder check).

## Global Constraints

- Highway mode (straight `?straight` and curved default) must behave exactly as before: its records keys `highwayThunder2.bestTime.5km` / `…5km-curve` unchanged; baseline before work: 64 test files, 474 tests pass, `tsc --noEmit` clean.
- Mountain record key: `highwayThunder2.bestTime.mountain`.
- Mountain road: 2 lanes × `LANE_WIDTH` (3.75 m), d ∈ [-3.75, 3.75] is asphalt; wall / rail plane at |d| = 4.75; course length 3500 m; start and finish straights level; no traffic; 3 rivals; rivals' grip boost 0.
- Hairpins R 15–25 m turning 150–180°; tight bends R 30–150 m; grades within ±10 %; plan-view separation ≥ 24 m between parts of the road more than 70 m apart along it.
- Unit tests only for math models (road, profile, generator, line, speed profile, driver decisions); physics runs go under `training/`.
- Edit files with the Edit tool; commit after each task; commit messages end with the Co-Authored-By line.

## Review Focus

1. Projection with no hint on a road that turns back (a reset, a new body) must find the right leg — test in Task 1 (hairpin round-trip without hint).
2. A car going under/through the trimesh (or dropped by a reset) must be put back, not fall forever — fall check in Task 7, asserted in Task 10's headless run.
3. Rivals and the post-finish autopilot must never use the 4-lane `PlannerDriver` in mountain mode — Task 9 wires both; Task 10 runs the finish.
4. Course length ≠ `ROAD_LENGTH`: finish detection (player, rivals, gate, HUD remaining distance) all on the mountain length — Task 7 threads it; Task 10 asserts finish at 3500 m.
5. The camera must not swing through the rock wall in hairpins — clamp in Task 7.

---

### Task 1: Centerline height profile and turn-back

**Files:**
- Modify: `src/road/centerline.ts`
- Test: `tests/centerline.test.ts`

**Interfaces:**
- Produces: `interface GradePiece { len: number; g: number }` (grade going linearly from the last piece's end to `g`, a parabolic vertical curve; constant: a uniform slope); `new Centerline(pieces, opts?: { grades?: GradePiece[]; turnBack?: boolean })`; `height(s): number` (0 without grades; level before 0 and past the grades' end); `grade(s): number`; `readonly hilly: boolean`.
- With `turnBack`, the `-z` monotonic check is skipped and `project` without a hint seeds from the nearest precomputed sample (brute force over `xs/zs`).

- [ ] Step 1: tests — `height` of grades `[{len:100,g:0},{len:50,g:0.1},{len:200,g:0.1},{len:50,g:0}]` at s=100 → 0, s=350 → 0.1·25 + 0.1·200 = 22.5 (±1e-6), past the end stays 25; `grade(250)` = 0.1. Hairpin road `[...straight(100), ...bend(18, 180, 15), ...straight(200)]` with `turnBack: true` builds; for s in {50, 120, 150, 250} and d in {-4.7, 0, 4.7}: `project(toWorld(s,d))` with hint s and without hint returns s, d within 1e-3. Without `turnBack` the same pieces still throw.
- [ ] Step 2: run, see them fail.
- [ ] Step 3: implement (grades integrated like the heading: piecewise quadratic height, closed form per piece; nearest-sample seed).
- [ ] Step 4: run the whole suite (474 + new pass), `npx tsc --noEmit`.
- [ ] Step 5: commit.

### Task 2: Mountain road generator

**Files:**
- Create: `src/road/mountain.ts`
- Test: `tests/mountain.test.ts`

**Interfaces:**
- Produces: `MOUNTAIN` settings object (`length: 3500, halfWidth: 3.75, edge: 4.75, startStraight: 60, endStraight: 80, hairpinR: [15, 25], hairpinAngle: [150, 180], bendR: [30, 150], bendAngle: [25, 110], ease: [10, 40], straight: [0, 120], grade: [0.04, 0.10], vcurve: [40, 100], minSep: 24, sepArc: 70`, plus how often hairpins come, in switchback pairs); `mountainRoad(rand: () => number): Centerline` (turnBack, with grades; level start at height 0); `wallSide(road: Centerline, s: number): 1 | -1` (+1: wall on +d side; inside of the bend, kept through straights, switching at inflections).
- Elements are appended one at a time; one that brings the road within `minSep` of itself (5 m samples, parts > `sepArc` apart along it) is redrawn (up to 20 tries, then the whole road restarts). The last element is a straight filling to `length - endStraight`, then the end straight.

- [ ] Step 1: tests over 40 seeds (`mulberry32`-style seeded rand from `src/ai/rng.ts` if it has one): `length` = 3500 ± 1; ≥ 2 hairpins (a run with radius ≤ 25 turning ≥ 150°); `minRadius` ≥ 15; no two samples > 70 m apart along it closer than 24 m; `curvature` 0 and `grade` 0 over [0, 60] and [3420, 3500]; |grade| ≤ 0.10 everywhere; `wallSide` on a right bend's apex = +1.
- [ ] Step 2–4: fail, implement, pass (+ suite, tsc).
- [ ] Step 5: commit.

### Task 3: Road surface mesh

**Files:**
- Create: `src/road/surface.ts`
- Test: `tests/surface.test.ts`

**Interfaces:**
- Produces: `surfaceMesh(road: Centerline, from: number, to: number, halfWidth: number): { positions: Float32Array; indices: Uint32Array; s: Float32Array; d: Float32Array }` — rows across the road (2 vertices: d = ±halfWidth) at a spacing of `clamp(0.08 / |κ|, 0.5, 3)` m, each vertex at `height(s)`; `s`/`d` per vertex for texturing.

- [ ] Step 1: tests — on a mountain road, every vertex's y equals `height(s)` (1e-4); rows at an apex of R 18 are ≤ 1.5 m apart; triangle count for the 3500 m road + 400 m extensions < 20 000.
- [ ] Step 2–5: fail, implement, pass, commit.

### Task 4: Physics on the mountain road

**Files:**
- Modify: `src/physics/physicsWorld.ts` (ground swap, rail offsets), `src/vehicles/playerCar.ts` (`resetAt(s, d, speed)`: height + pitch; `resetTo` calls it)
- Create: `training/mountainPhysics.train.ts`

**Interfaces:**
- Produces: `PhysicsWorld.setRoad(road, opts?: { rails?: { left: number; right: number }; ground?: { positions: Float32Array; indices: Uint32Array } })` — `ground` replaces the `y = 0` half-space by a trimesh (`TriMeshFlags.FIX_INTERNAL_EDGES`, `STATIC_GROUPS`, friction 0.9); without it the half-space is back. `updateRails` uses the rail offsets (defaults `RAIL_D`, `LEFT_RAIL_X`). `PlayerCar.resetAt(s: number, d: number, speed: number)`: on the road surface (`height(s) + RIDE_Y + 0.02`), yawed to the heading and pitched to `atan(grade)`, velocity along the slope.
- The trimesh runs from s = -100 to length + 300.

- [ ] Step 1: headless script: a street racer on a mountain road (seed 1) held at 80 km/h along d = 1.9 by a simple steering-to-centre controller for 60 s; and runs into the wall/rail at a hairpin at 60 km/h. Prints: min wheel contact share, max |y - height(s)| of the body, max along-road deceleration spike (g), NaN or not, ended on the road.
- [ ] Step 2: implement; run the script; expect contact share ~1 on slopes, no spikes > 3 g from seams, no NaN.
- [ ] Step 3: full suite + tsc (highway unchanged), commit.

### Task 5: Tyres on slopes (gated)

**Files:**
- Modify: `src/vehicles/tyreChassis.ts`

**Interfaces:**
- Consumes: `PhysicsWorld` knows whether its ground is a trimesh (`physics.sloped: boolean`).
- With `sloped`, the wheel ray uses `castRayAndGetNormal`; tyre forward/right are projected onto the contact plane and slip velocities include `v.y`. Without it, the code path is the old one exactly.

- [ ] Step 1: implement behind `this.physics.sloped`.
- [ ] Step 2: `training/mountainPhysics.train.ts` again: on a 10 % climb at constant throttle the car's steady speed / on a descent braking distance from 100 km/h, before vs after (expect braking downhill longer than uphill).
- [ ] Step 3: full suite + tsc, commit.

### Task 6: Mountain scenery

**Files:**
- Create: `src/world/mountainScene.ts`
- Modify: `src/world/roadScene.ts` (export a `Scenery` interface: `setRoad(line)`, `update(playerS)`, `groundMaterials`, `activeLights()`, `lampFlareMaterial`)

**Interfaces:**
- Produces: `class MountainScene implements Scenery` — built per road in `setRoad`: asphalt with a centre double yellow line and white edge lines (canvas texture), shoulders, a rock wall rising 8–14 m on `wallSide`, a guardrail with reflectors every 4 m on the other side and the ground falling away below it, chevron signs outside bends of R < 60, night sky, moon, far ridges, fog. No street lamps (`activeLights()` → []).

- [ ] Step 1: implement; meshes built once per race (whole course).
- [ ] Step 2: tsc; commit. (Look is checked by the user in play.)

### Task 7: Game mode wiring (solo drivable)

**Files:**
- Modify: `src/main.ts` (`?mountain`), `src/config.ts` (`MOUNTAIN_BEST_TIME_KEY`), `src/game/game.ts`, `src/game/gameState.ts` (finish length), `src/ui/hud.ts`, `src/ui/hudMath.ts`, `src/world/finishGate.ts` (length + height), `src/game/rivals.ts` (course length)

**Interfaces:**
- `Game` opts `{ curved?: boolean; mountain?: boolean }`; `readonly courseLength` (ROAD_LENGTH or `MOUNTAIN.length`) handed to `GameFlow`, the HUD, the gate and `Rivals`. Mountain: `mountainRoad` each race, `physics.setRoad(road, { rails: { left: -4.75, right: 4.75 }, ground: surfaceMesh(...) })`, MountainScene, traffic never spawned or stepped, surface grip 1, player starts at (s -3, d +1.875), R puts it back on the road behind where it was (clear of rivals), fall check (body y < height(s) - 5 → put back), chase camera clamped to |d| ≤ 4.2 and above the road, record key `MOUNTAIN_BEST_TIME_KEY`, rivals 0 until Task 9.

- [ ] Step 1: implement; full suite + tsc.
- [ ] Step 2: browser: `npm run dev`, open `/?mountain`, drive a race to the finish (devtools input override if needed); print localStorage first.
- [ ] Step 3: commit — solo checkpoint; tell the user.

### Task 8: Racing line and speed profile

**Files:**
- Create: `src/ai/mountainLine.ts`
- Test: `tests/mountainLine.test.ts`

**Interfaces:**
- Produces: `interface RaceLine { step: number; d: Float64Array; v: Float64Array; kappa: Float64Array }` (per sample along s, from 0 to length + 100); `racingLine(road: Centerline, room: number, step = 2): Float64Array` (elastic-band smoothing of the offset, clamped to ±room); `speedProfile(road, d, ai: { accel; brake; latAccel }, budget: number, vMax: number): RaceLine` (v ≤ √(budget·latAccel(v)/|κ|), forward pass with accel − g·grade, backward pass with brake·budget + g·grade); `lineAt(line, s): { d; v; kappa }` (interpolated).

- [ ] Step 1: tests — on a hairpin road the line stays within ±room and its peak |κ| is below the centreline's; at the apex v ≈ √(budget·latAccel/κ) (5 %); between any two samples the drop in v² ≤ 2·step·(brake·budget + g·grade)+ε; on a straight→R 40 bend, the braking starts earlier on a −8 % road than on a +8 % one.
- [ ] Step 2–5: fail, implement, pass, commit.

### Task 9: Mountain driver, rivals and autopilot

**Files:**
- Create: `src/ai/mountainDriver.ts`
- Modify: `src/game/rivals.ts` (driver factory, grid, grip boost, put-back for 2 lanes), `src/game/game.ts`, `src/main.ts`
- Test: `tests/mountainDriver.test.ts`

**Interfaces:**
- Produces: `interface RivalDriver extends Driver { accelScale: number; push?: number; dispose(): void }` (PlannerDriver already fits); `class MountainDriver implements RivalDriver` with `setRoad(road: Centerline, ai: CarSpec['ai'])`, `budget` (0.8–0.97, raised to 1 by `push`); `drive(self, others)`: pure pursuit to the line point `4 + 0.35·v` m ahead (+ passing offset), pedals by `speedPedals` toward `min(lineAt(s + 0.3·v).v, self.speedCap)`, a slower car ahead within 40 m overlapping its path → pass on the side with more room, else follow at its speed.
- `Rivals` constructor takes `opts?: { makeDriver?: (spec) => RivalDriver; grid?: [number, number][]; gripBoost?: number; edge?: number; length?: number }`; mountain grid (d, s): (-1.875, -3), (1.875, -11), (-1.875, -11) with the player at (1.875, -3); `needsReset` 'off-road' beyond `edge`; put-back on the road's own lanes.
- Game in mountain: 3 rivals with MountainDrivers; difficulty's `topShare` mapped to `budget`; the player's autopilot (I key, after the finish) is a MountainDriver too.

- [ ] Step 1: driver tests — car on the line at the profile speed: steer ≈ 0 on a straight, brake > 0 when 20 km/h over the profile, throttle when under; slower car ahead on the line → target offset to the side with more room.
- [ ] Step 2–4: fail, implement, pass (+ suite, tsc).
- [ ] Step 5: commit.

### Task 10: Headless race check

**Files:**
- Create: `training/mountainRace.train.ts`

- [ ] Step 1: 30 seeds: a race of the player car (MountainDriver) + 3 rivals on `mountainRoad(seed)`, physics as the game's. Per seed: finished (all 4), time, wall contacts per car, put-backs, max fall below road, NaN. Assert none fell through, no NaN, ≥ 90 % finish without a put-back.
- [ ] Step 2: run; tune the driver / generator until the asserts hold; commit with the numbers in the message.

### Task 11: Garage choice, difficulty, HUD

**Files:**
- Modify: `src/game/carSelection.ts` (`course: 'highway' | 'mountain'`, old saves → highway), `src/ui/garage.ts` (a course switch: saving the choice and reloading with/without `?mountain`), `src/ui/i18n.ts` (labels), `src/main.ts` (no URL flag → the saved course)
- Test: `tests/carSelection.test.ts`

- [ ] Step 1: test — a save without `course` reads as highway; `course: 'mountain'` round-trips.
- [ ] Step 2–4: fail, implement, pass (+ suite, tsc).
- [ ] Step 5: browser check of the switch; commit.

### Task 12: Playable check

- [ ] Browser race on `?mountain` with rivals to the finish; console clean; record saved under the mountain key; highway still loads and races. Kill leftover node processes (keep vite + MCP). Report to the user.
