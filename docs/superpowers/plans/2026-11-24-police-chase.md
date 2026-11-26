# 警察追緝 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 高速公路上的警用 SUV：路肩待命、玩家經過觸發；在賽車前面守預估路線、在後面追撞；撞飛玩家就慢動作特寫、3 秒後放回賽道。

**Architecture:** 警車是用對手 AI（`PlannerDriver`）開的 `PlayerCar`，由新的 `Police` 類別（`src/game/police.ts`）管理一生（待命 / 前段 / 後段 /
收工）；所有判斷是 `src/game/policeLogic.ts` 的純函式（有單元測試）。規劃器只加選填的「偏好橫向位置」與「可上路肩」，不給就完全照舊。
撞飛的慢動作是新的 `BustShow`（照 `FinishShow` 的做法），由 `game.ts` 的 `frame` 用它的 `timeScale`。

**Tech Stack:** TypeScript、Three.js、Rapier（`@dimforge/rapier3d-compat`）、Vitest、Web Audio。

**Spec:** `docs/superpowers/specs/2026-11-24-police-chase-design.md`（實作前兩份都要讀）。

## Global Constraints

- 回覆使用者用繁體中文；程式註解、commit 訊息用英文（照 repo 現有風格）。
- 改檔用 Edit/Write 或 scratchpad 的 .cjs/.mjs；不用 Python；不跑 prettier。
- `git add` 只加明確路徑；不加 `bash.exe.stackdump`、`.claude/`、training 那幾支未追蹤的暫存腳本。
- commit 結尾附 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 與 `Claude-Session: https://claude.ai/code/session_014MRszPo9yvxTW3h5EWLgE3`。
- 分支 `feat/police-chase`；說「合併」才 `--no-ff` 合併，說「推」才推。
- `src/` 裡不用 `process.env`。
- 單元測試只測數學；重的模擬放 `training/`。
- 警笛用程式合成，不用錄音；repo 裡任何地方不寫音效來源。
- 警車塗裝通用、自創：不用任何真實警局的徽章、字樣、配色規範。
- 效果動畫用比賽時間 `play`（暫停時為 0）。
- 瀏覽器測試：先印 localStorage；不完賽；`ht2.cars` 的玩家車保持 street-racer、tuning `{}`；最後停在 about:blank。
- 跑完 training / vitest 後殺掉殘留的 node 程序（留 vite 和 MCP）。
- 視覺、聲音的微調：改完 commit，讓使用者自己看。
- 數值（spec 已定）：撞飛門檻 `closingSpeed` ≥ 15 km/h；慢動作 3 秒（現實時間）後放回；放回速度 `RESET_SPEED`（60 km/h）；放回後 2 秒不判撞飛；
  同時 3 台；啟動距離約 250 m；追丟距離約 300 m；重新待命在所有賽車前方約 500 m 的路肩。
- 驗證不變：警察關掉時，高速公路逐幀比對（`training/out/audit/hwTrace.train.ts`，3 台車 × 種子 7001、7002）與山路逐幀比對
  （`training/out/audit/mtSeeded.train.ts`，DRIVER=new SEEDS=2 JSON）必須跟這個分支起點一樣。

## Review Focus

1. 完賽後（`flow.phase === 'finished'`）被 SUV 撞到：不該觸發撞飛（完賽動畫已在跑）。→ Task 5 `bustAllowed` 的測試。
2. 撞飛慢動作時按 Esc 暫停：3 秒倒數要跟著停，繼續後才放回賽道。→ Task 8 的瀏覽器檢查。
3. 撞飛慢動作時重新開始比賽或回車庫：慢動作清掉，不會在新比賽裡突然放回一次。→ Task 8 的瀏覽器檢查。
4. 在車庫關掉警察、或換到山路：舊的 SUV 車體、燈、警笛全部拿掉，比賽裡一台都沒有。→ Task 7 的瀏覽器檢查。
5. 按 I 讓 AI 開車時被撞飛，或慢動作中按 I：放回後 AI 照常接手、不會兩邊都在開。→ Task 8 的瀏覽器檢查。

---

## 第一階段：先試玩手感（Task 1–10）

### Task 1: 設定「警察：開／關」

**Files:**
- Modify: `src/game/carSelection.ts`（`CarSelection` 加 `police: boolean`；`defaultSelection` 為 `true`；`sanitize` 缺欄位或非布林 → `true`）
- Modify: `src/ui/garage.ts`（`rowKeys()` 在 `course === 'highway'` 時於 `'difficulty'` 後加 `'police'`；`setupAdjust` 的 `'police'` 用 `d` 切換；比賽設定畫面加一行兩個按鈕）
- Modify: `src/ui/i18n.ts`（`setup.police`、`police.on`、`police.off`，中英文）
- Test: `tests/carSelection.test.ts`

**Interfaces:**
- Produces: `CarSelection.police: boolean`

- [ ] **Step 1: 寫失敗的測試**

```ts
it('police on by default, kept off when saved off', () => {
  expect(defaultSelection().police).toBe(true);
  expect(sanitize({}).police).toBe(true);
  expect(sanitize({ police: 'yes' }).police).toBe(true);
  expect(sanitize({ police: false }).police).toBe(false);
});
```

- [ ] **Step 2:** `npx vitest run tests/carSelection.test.ts` → FAIL（`police` undefined）
- [ ] **Step 3:** 實作上面三個檔案。
- [ ] **Step 4:** `npx vitest run tests/carSelection.test.ts` → PASS；`npx tsc --noEmit -p .` 無錯誤
- [ ] **Step 5:** Commit：`feat(garage): police on / off in the race setup (highway only, on by default)`

### Task 2: 警用 SUV 車種與模型

**Files:**
- Create: `src/vehicles/cars/policeSuv.ts`（`export const POLICE_SUV: CarSpec`，`id: 'police-suv'`，`style: 'suv'`）
- Modify: `src/vehicles/cars/types.ts`（`CarStyle` 加 `'suv'`）
- Modify: `src/vehicles/cars/index.ts`（匯出 `POLICE_SUV`，**不放進 `CARS`**；加 `export function specById(id: string): CarSpec | undefined`：`CARS[id]`，或 `id === POLICE_SUV.id` 時 `POLICE_SUV`）
- Modify: `src/vehicles/models.ts`（`buildCar` 的 `'suv'`：方正車身、車頂燈條；燈條兩塊 mesh 命名 `lightbar-red`、`lightbar-blue`，`MeshStandardMaterial` 有 emissive）
- Modify: `training/measureCar.train.ts`、`training/cornering.train.ts`（用 `specById`）
- Test: `tests/cars.test.ts`

**Interfaces:**
- Produces: `POLICE_SUV: CarSpec`、`specById(id)`；模型裡 `getObjectByName('lightbar-red' | 'lightbar-blue')`

- [ ] **Step 1: 寫失敗的測試**

```ts
it('the police SUV: heavy, strong, not a car to pick', () => {
  expect(POLICE_SUV.params.mass).toBeGreaterThanOrEqual(2500);
  expect(POLICE_SUV.params.power).toBeGreaterThan(STREET_RACER.params.power);
  expect(PICKABLE).not.toContain(POLICE_SUV.id);
  expect(CARS[POLICE_SUV.id]).toBeUndefined();
  expect(specById(POLICE_SUV.id)).toBe(POLICE_SUV);
});
```

- [ ] **Step 2:** `npx vitest run tests/cars.test.ts` → FAIL
- [ ] **Step 3:** 寫 `POLICE_SUV`：以 `MUSCLE_CAR` 的 params 為底，質量約 2800 kg、寬約 2.0 m、長約 5.0 m、馬力大到追得上 street-racer 的極速；`ai` 表先抄 muscle。
- [ ] **Step 4:** `npx vitest run tests/cars.test.ts` → PASS
- [ ] **Step 5:** 量表：`CAR=police-suv npx vitest run --config training/vitest.config.ts training/measureCar.train.ts` 與 `training/cornering.train.ts`，把輸出的 accel / brake / latAccel 填回 `POLICE_SUV.ai`。
- [ ] **Step 6:** Commit：`feat(cars): the police SUV - heavy, strong, its AI tables measured; not in the garage`

### Task 3: 碰撞系統認得警車

**Files:**
- Modify: `src/physics/physicsWorld.ts:6`（`EntityRef` 加 `{ type: 'police'; id: number }`）
- Modify: `src/vehicles/playerCar.ts`（`PlayerCarOptions.entity` 接受 `'police'`；碰撞群組用 `RIVAL_GROUPS`）
- Modify: 其他以 `a.type === 'rival'` 判斷的地方只在需要時加（`src/game/game.ts` 的 `onContact` 留到 Task 7 / 8）

**Interfaces:**
- Produces: `EntityRef` 的 `{ type: 'police'; id: number }`

- [ ] **Step 1:** 實作。
- [ ] **Step 2:** `npx tsc --noEmit -p . --noUnusedLocals --noUnusedParameters` 無錯誤；`npx vitest run` 全過（596+）。
- [ ] **Step 3:** Commit：`feat(physics): a police entity, colliding as a rival does`

### Task 4: 規劃器的「偏好橫向位置」與「可上路肩」（選填）

**Files:**
- Modify: `src/ai/coursePlanner.ts`（`PlanEgo` 加 `preferD?: number`、`preferCost?: number`（m of progress per step per m off，預設 1）、`shoulder?: boolean`；
  `shoulder` 為真時 `edge = RAIL_D - hw`（跟已在路外時相同）；`preferD` 有值時每步 `score -= preferCost * |d - preferD| * w`）
- Modify: `src/ai/plannerDriver.ts`（`PlannerDriver` 加 `preferD: number | null = null`、`shoulder = false`，由 `egoOf` 帶進 ego）
- Test: `training/plannerDriverSim.train.ts`（新增一項）

**Interfaces:**
- Produces: `PlannerDriver.preferD`、`PlannerDriver.shoulder`；`PlanEgo.preferD / preferCost / shoulder`

- [ ] **Step 1: 寫失敗的 training 檢查**

```ts
it('pulled over: preferD on the shoulder, shoulder allowed, speed cap 0 - stops there', () => {
  // street racer at 100 km/h in lane 3, no traffic; driver.preferD = (ROAD_HALF_WIDTH + RAIL_D) / 2, driver.shoulder = true, speedCap 0
  // after 10 s: |car.d - preferD| < 0.6 and car.speed < 1
});
```

- [ ] **Step 2:** `npx vitest run --config training/vitest.config.ts training/plannerDriverSim.train.ts -t "pulled over"` → FAIL
- [ ] **Step 3:** 實作。
- [ ] **Step 4:** 該項 PASS。
- [ ] **Step 5:** 不變驗證：hwTrace 輸出跟 `training/out/audit/hw-nitro-a.txt` 完全一樣（`Compare-Object` 無差異）；mtSeeded 的 JSON 雜湊跟這個分支起點跑出來的一樣（先在起點跑一次存起來）。
- [ ] **Step 6:** Commit：`feat(ai): the planner's optional preferred line and shoulder (unset: as before, traces identical)`

### Task 5: 警車的判斷（純函式）

**Files:**
- Create: `src/game/policeLogic.ts`
- Test: `tests/policeLogic.test.ts`

**Interfaces:**
- Produces（全部是純函式）：
  - `POLICE_TUNING = { count: 3, wake: 250, lost: 300, parkAhead: 500, bustKmh: 15, grace: 2, bustSeconds: 3, laneWidth: 2.2, clearAhead: 80 }`
  - `type Racer = { s: number; d: number; v: number; isPlayer: boolean }`
  - `pickTarget(suvS: number, racers: Racer[], range: number): Racer | null` — 玩家在 `|s - suvS| <= range` 內就是玩家；不然最近的賽車；都超過 `range`：null
  - `phaseOf(suvS: number, target: Racer): 'front' | 'behind'` — `suvS > target.s` 為 front
  - `lineClear(from: { s: number; d: number }, to: { s: number; d: number }, boxes: TrafficBox[], halfWidth: number): boolean` — 兩點之間、沿路方向、寬 `2 * halfWidth` 的通道內沒有 box
  - `isLost(suvS: number, racers: Racer[], lost: number): boolean` — 離每台賽車都超過 `lost`
  - `parkSpot(racers: Racer[], ahead: number): { s: number; d: number }` — `s` = 最前面賽車的 `s + ahead`，`d` = `(ROAD_HALF_WIDTH + RAIL_D) / 2`
  - `bustAllowed(phase: string, closingKmh: number, sinceReset: number): boolean` — `phase === 'racing'`、`closingKmh >= bustKmh`、`sinceReset >= grace`
  - `ramInput(self: SelfState, aim: { s: number; d: number }): DriveInput` — 朝 `aim` 打方向（對準角度的比例控制，夾在 ±1）、油門 1、煞車 0

- [ ] **Step 1: 寫失敗的測試**

```ts
const P = (s: number, isPlayer = false): Racer => ({ s, d: 0, v: 50, isPlayer });
it('target: the player in range first, else the nearest racer', () => {
  expect(pickTarget(1000, [P(1100), P(900, true)], 300)!.isPlayer).toBe(true);
  expect(pickTarget(1000, [P(1100), P(1500, true)], 300)!.s).toBe(1100);
  expect(pickTarget(1000, [P(1400), P(1500, true)], 300)).toBeNull();
});
it('front or behind by s against the target', () => {
  expect(phaseOf(1000, P(900))).toBe('front');
  expect(phaseOf(1000, P(1100))).toBe('behind');
});
it('a line is clear only with no box in the corridor between', () => {
  const box = { s: 1050, dMin: -1, dMax: 1, length: 4.5, v: 30 };
  expect(lineClear({ s: 1000, d: 0 }, { s: 1100, d: 0 }, [box], 1.1)).toBe(false);
  expect(lineClear({ s: 1000, d: 0 }, { s: 1100, d: 0 }, [{ ...box, dMin: 4, dMax: 6 }], 1.1)).toBe(true);
  expect(lineClear({ s: 1000, d: 0 }, { s: 1100, d: 0 }, [{ ...box, s: 1200 }], 1.1)).toBe(true);
});
it('lost only when far from every racer', () => {
  expect(isLost(1000, [P(1350), P(1500, true)], 300)).toBe(true);
  expect(isLost(1000, [P(1250), P(1500, true)], 300)).toBe(false);
});
it('parked on the shoulder ahead of the leader', () => {
  expect(parkSpot([P(900), P(1200, true)], 500)).toEqual({ s: 1700, d: (ROAD_HALF_WIDTH + RAIL_D) / 2 });
});
it('a bust: racing, a hit (not a scrape), not just after a put-back', () => {
  expect(bustAllowed('racing', 20, 5)).toBe(true);
  expect(bustAllowed('racing', 10, 5)).toBe(false);
  expect(bustAllowed('racing', 20, 1)).toBe(false);
  expect(bustAllowed('finished', 40, 5)).toBe(false); // Review Focus 1
});
it('ramming: full throttle, steering toward the aim', () => {
  const self = { s: 1000, d: 0, yaw: 0, vLong: 40 } as SelfState;
  const left = ramInput(self, { s: 1030, d: -3 });
  expect(left.throttle).toBe(1);
  expect(left.brake).toBe(0);
  expect(Math.sign(left.steer)).toBe(Math.sign(ramInput(self, { s: 1030, d: -6 }).steer));
  expect(ramInput(self, { s: 1030, d: 3 }).steer).toBe(-left.steer);
});
```

- [ ] **Step 2:** `npx vitest run tests/policeLogic.test.ts` → FAIL
- [ ] **Step 3:** 實作（`ramInput` 的打方向方向照 `src/ai/netTracker.ts` 的 `trackSteer` 慣例：d 增加的一側為正的 yaw）。
- [ ] **Step 4:** PASS
- [ ] **Step 5:** Commit：`feat(police): its decisions - target, front or behind, a clear line, lost, where to park, a bust`

### Task 6: `Police` 類別（警車的一生）

**Files:**
- Create: `src/game/police.ts`

**Interfaces:**
- Consumes: Task 2 `POLICE_SUV`、Task 3 entity、Task 4 `preferD / shoulder`、Task 5 全部。
- Produces:
  - `type PoliceState = 'parked' | 'front' | 'behind' | 'pullover'`
  - `class Police`：`constructor(physics: PhysicsWorld, scene: THREE.Scene | null, makeSource: () => PlanSource | null)`；
    `readonly list: { index: number; car: PlayerCar; driver: PlannerDriver; state: PoliceState; target: Racer | null }[]`；
    `triggered: boolean`；
    `place(): void`（比賽開始：3 台停在 800、1300、1800 m 的路肩，`triggered = false`）；
    `drive(dt: number, racers: Racer[], traffic: TrafficBox[], others: TrafficBox[]): void`（物理步之前）；
    `pullOver(index: number): void`；
    `boxes(out?: TrafficBox[]): TrafficBox[]`、`obstacles(frame: RoadFrame): Obstacle[]`、`occupants(frame: RoadFrame): Occupant[]`、`blockers(): Blocker[]`（照 `Rivals` 同名方法）；
    `render(alpha: number, play: number): void`（燈條閃爍留到 Task 9）；`dispose(): void`
- 行為：
  - `parked`：煞住不動（`hold: true`）；玩家 `s` 超過任何一台 `parked` → `triggered = true`；`triggered` 後，`pickTarget(..., wake)` 有目標就進 `front` 或 `behind`（`phaseOf`）。
  - `front`（第一階段的簡化版）：`PlannerDriver` 照常開，速度上限 = 目標速度 − 20 km/h；`shoulder = true`（從路肩開出來）。Task 11 才換成守線。
  - `behind`：`PlannerDriver` 照常開，速度上限 = `min(POLICE_SUV.params.maxSpeed, 目標速度 + 40 km/h)`；`lineClear` 為真時改用 `ramInput`（瞄目標 0.3 s 後的位置）；
    追趕：離目標越遠引擎越強（照 `Rivals.applyBoost` 的做法，倍率上限 1.5）。
  - `pullover`：`preferD = parkSpot` 的 `d`、`shoulder = true`、速度上限 0；不再選目標。
  - 每步：`isLost(..., lost)` 為真的非 `parked` 警車 → 移到 `parkSpot(racers, parkAhead)`（`resetAt`，速度 0），狀態 `parked`、清掉 `preferD`。
  - 只在 `triggered` 後才有警車離開 `parked`。

- [ ] **Step 1:** 實作。
- [ ] **Step 2:** `npx tsc --noEmit -p . --noUnusedLocals --noUnusedParameters` 無錯誤。
- [ ] **Step 3:** Commit：`feat(police): the police cars' lives - parked, ahead, behind, pulled over, lost and parked again`

### Task 7: 接進遊戲

**Files:**
- Modify: `src/game/game.ts`
- Modify: `src/game/rivals.ts`（`RaceView` 加 `police?: TrafficBox[]`；`othersAsBoxes` 也推進去）

**Interfaces:**
- Consumes: Task 6 `Police`、Task 1 `CarSelection.police`

- [ ] **Step 1:** 實作：
  - 高速公路且 `cars.police` 為真才建 `Police`（換賽道、關掉警察、`dispose` 時拿掉）；比賽開始呼叫 `place()`。
  - `fixedStep`：`racing` 時在 `rivals.drive` 後呼叫 `police.drive`；警車接觸前的速度存起來（跟 `racerVelBefore` 一樣）。
  - 對手看得到警車（`RaceView.police`）；玩家 AI（`aiDrive` 的 `seen`）看得到；交通車讓警車（`stepAI` 的 obstacles 加 `police.obstacles`）；新交通車不生在警車上（`playerOccupants` 加 `police.occupants`）；
    `tryReset` 的 blockers 加 `police.blockers()`。
  - `onContact`：警車撞交通車 → 照對手的規則（`knocksOut` 才報廢）。
  - `render`：`police.render(alpha, play)`。
- [ ] **Step 2:** 不變驗證：hwTrace、mtSeeded 跟起點一樣；`npx vitest run` 全過。
- [ ] **Step 3:** 瀏覽器檢查（Playwright）：高速公路，看到路肩待命的 SUV；玩家經過後，SUV 開上路追；關掉警察 → 一台都沒有；換山路 → 沒有（Review Focus 4）。主控台無錯誤。
- [ ] **Step 4:** Commit：`feat(police): on the highway - seen by the rivals, the player's AI and the traffic; off in the garage, none`

### Task 8: 撞飛：慢動作、特寫、放回

**Files:**
- Create: `src/game/bustShow.ts`
- Modify: `src/game/game.ts`
- Test: `tests/bustShow.test.ts`

**Interfaces:**
- Produces:
  - `bustTimeScale(t: number): number` — 0 → 1，0.4 s 內緩到 0.15，維持到 3 s
  - `class BustShow`：`constructor(camera, car: PlayerCar)`；`step(dt: number): void`（現實時間）；`get timeScale(): number`；`get done(): boolean`（`elapsed >= POLICE_TUNING.bustSeconds`）；`placeCamera(): void`（繞車環繞，照 `FinishShow` 最後一段的 orbit）

- [ ] **Step 1: 寫失敗的測試**

```ts
it('the bust slows the race to 0.15 in 0.4 s and holds it', () => {
  expect(bustTimeScale(0)).toBe(1);
  expect(bustTimeScale(0.4)).toBeCloseTo(0.15);
  expect(bustTimeScale(2.9)).toBeCloseTo(0.15);
});
```

- [ ] **Step 2:** `npx vitest run tests/bustShow.test.ts` → FAIL
- [ ] **Step 3:** 實作 `bustShow.ts`。
- [ ] **Step 4:** PASS
- [ ] **Step 5:** 接進 `game.ts`：
  - `onContact` 玩家碰警車：`closingSpeed(玩家接觸前速度, 警車接觸前速度, normal)`，`bustAllowed(phase, kmh, 距上次放回秒數)` 為真 → `this.bust = new BustShow(...)`、`police.pullOver(那台)`。
  - `frame`：`bust` 存在時 `play = dt * bust.timeScale`（暫停時 `dt` 照遊戲暫停規則為 0，倒數跟著停：Review Focus 2）；鏡頭用 `bust.placeCamera()`。
  - `currentInput`：`bust` 期間回 `HOLD`（AI 開車時也一樣）。
  - `bust.done` → `putBackAfterBust()`：跟 `tryReset` 相同的找位置與放回（不檢查 `flow.canReset()`），`rig.snap()`，記下放回時間，`bust = null`。
  - 重新開始、回車庫、`resetWorld`：`bust = null`（Review Focus 3）。
- [ ] **Step 6:** 瀏覽器檢查：被撞飛 → 慢動作環繞 → 3 秒後放回、以 60 km/h 起步；擦撞不觸發；慢動作中 Esc 暫停，倒數停住（Review Focus 2）；慢動作中重新開始（Review Focus 3）；按 I 時被撞、慢動作中按 I（Review Focus 5）；撞人的 SUV 開到路肩停下。主控台無錯誤；不完賽。
- [ ] **Step 7:** Commit：`feat(police): busted - slow motion round the car, back on the road at 60 after 3 s; the SUV pulls over`

### Task 9: 警示燈與警笛

**Files:**
- Modify: `src/game/police.ts`（`render`：`triggered` 且不在 `parked` / `pullover` 時，`lightbar-red` / `lightbar-blue` 的 emissive 依比賽時間交替閃）
- Create: `src/audio/siren.ts`（`class Siren`：兩個振盪器做出高低起伏的鳴笛聲，`setPosition`、`setActive`；遠近與都卜勒照 `src/audio/earMotion.ts`）
- Modify: `src/audio/sound.ts`（`setSirens(sources: readonly { x: number; y: number; z: number; vx: number; vz: number }[], ear: EarPose, active: boolean): void`）
- Modify: `src/game/game.ts`（每幀把追緝中的警車交給 `setSirens`；警車引擎聲經 `setOtherEngines`，用 muscle car 的引擎組）

- [ ] **Step 1:** 實作。
- [ ] **Step 2:** `npx tsc --noEmit -p .`；`npx vitest run` 全過。
- [ ] **Step 3:** 暫停時燈停在當下、警笛靜音（照現有暫停規則）：瀏覽器檢查。
- [ ] **Step 4:** Commit：`feat(police): their light bars and sirens (synthesized)` → 請使用者自己看、聽。

### Task 10: 追緝模擬與調數值

**Files:**
- Create: `training/policeChase.train.ts`（物理世界 + `TrafficWorld` + 玩家 AI 車 + `Rivals` + `Police`，照 `training/rivalsRace.train.ts` 的組法；`SEEDS` 環境變數；輸出每場：第一次撞飛玩家的時間、撞飛玩家次數、撞到對手次數、警車追丟次數、每台警車的狀態時間比例）
- Modify: `src/game/policeLogic.ts`（`POLICE_TUNING` 依結果調整）

- [ ] **Step 1:** 寫模擬並跑 `SEEDS=7001,7002,7003`，結果記在 commit 訊息。
- [ ] **Step 2:** 調 `POLICE_TUNING`（和 Task 6 的速度差、追趕倍率），目標：一場 5 km 裡玩家 AI 被撞飛 1–3 次、警車不會整場都追不到。
- [ ] **Step 3:** 量 fps：瀏覽器在最前面，開跟不開警察各量 20 秒；差太多就把 `count` 降到 2。
- [ ] **Step 4:** Commit：`feat(police): tuned on a chase sim - busts per race, catches`
- [ ] **Step 5:** 交給使用者試玩第一階段，等回饋再做第二階段。

## 第二階段：前段守線（Task 11–12）

### Task 11: 守在預估路線上

**Files:**
- Modify: `src/game/policeLogic.ts`（加 `guardD(predicted: Plan, suvS: number, target: Racer): number` — 在預估路線上、目標到達 SUV 所在 `s` 的那一刻的 `d`；目標速度 ≤ 1 m/s 時回目標目前的 `d`）
- Modify: `src/game/police.ts`（`front`：每 0.3 s 用 `coursePlan(目標的 PlanEgo, 交通車, null)` 同步算一次預估路線；`driver.preferD = guardD(...)`；速度上限照 Task 6）
- Test: `tests/policeLogic.test.ts`

- [ ] **Step 1: 寫失敗的測試**

```ts
it('guarding: the predicted line\'s d where the target gets to the SUV', () => {
  const plan = { points: [{ t: 0, s: 900, d: 0 }, { t: 2, s: 1000, d: 3.75 }] } as unknown as Plan;
  expect(guardD(plan, 1000, { s: 900, d: 0, v: 50, isPlayer: true })).toBeCloseTo(3.75);
  expect(guardD(plan, 1000, { s: 900, d: 1, v: 0, isPlayer: true })).toBe(1);
});
```

（`Plan` 的實際欄位照 `src/ai/planner.ts`；測試用的計畫照那個型別建。）

- [ ] **Step 2:** FAIL → 實作 → PASS
- [ ] **Step 3:** 量 `coursePlan` 一次的時間（`COURSE_STATS.ms`）；超過 3 ms 就改成每 0.5 s。
- [ ] **Step 4:** 瀏覽器檢查：前方 SUV 開到玩家正在走的車道、平行等著；玩家換車道，它跟著換；不停在交通車後面。
- [ ] **Step 5:** Commit：`feat(police): ahead, on the line the racer will take`

### Task 12: 收尾驗證

- [ ] **Step 1:** hwTrace、mtSeeded 跟起點一樣（警察不影響現有 AI）。
- [ ] **Step 2:** `npx tsc --noEmit -p . --noUnusedLocals --noUnusedParameters`；`npx vitest run`；`npx vite build`。
- [ ] **Step 3:** Playwright 全流程（Review Focus 1–5 再走一次）；主控台無錯誤；不完賽；停在 about:blank。
- [ ] **Step 4:** 文件：`docs/ai-car-tuning.md` 加一節「警車」（狀態、數值、怎麼跑 `policeChase.train.ts`）。
- [ ] **Step 5:** Commit：`docs: the police cars` → 回報使用者，等「合併」。
