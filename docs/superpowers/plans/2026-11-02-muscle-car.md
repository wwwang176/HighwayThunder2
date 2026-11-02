# 肌肉車＋賽前選車 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增肌肉車（自己的物理、外型與訓練好的 AI），並讓玩家在賽前設定頁替自己和 5 個對手各選車種。

**Architecture:** 車種全部是 `CarSpec`（`src/vehicles/cars/`），物理、外型與 AI 資料跟著 spec 走。`PlayerCar`／`Rivals` 可以拆掉重建；`Game` 開賽時依選擇重建玩家車與對手。訓練與跑分工具用 `CAR` 環境變數選車種，方向盤網路權重每台車一個檔案。設定頁是 HUD 裡的新面板，選擇存在 `localStorage`。

**Tech Stack:** TypeScript 5.9、three 0.187、@dimforge/rapier3d-compat 0.21、lil-gui、vitest（`training/` 另有 `training/vitest.config.ts`）。

**Spec:** `docs/superpowers/specs/2026-11-02-muscle-car-design.md`（草圖：`docs/superpowers/specs/2026-11-02-muscle-car-setup-mockup.png`）

## Global Constraints

- 肌肉車 `id` 為 `muscle-car`，顯示名稱「肌肉車」。超跑 `id` 維持 `street-racer`，顯示名稱改為「超跑」。
- 超跑的 `params`、`ai` 一個數字都不改；`planSpeed` 預設指紋必須維持 `641162.136`。
- 肌肉車碰撞尺寸與超跑相同（`PLAYER_W` 1.86、`PLAYER_L` 4.4）。
- 翹頭：全油門強力加速時車頭明顯上抬、前輪仍著地。調教方向，不寫測試、不設驗收數字。
- 手感優先於 AI 成績：不為 AI 削弱肌肉車的個性。
- AI 極速 = min(車子自己的 `maxSpeed`, AI 上限)。
- 改裝車只在設定頁佔位（灰色、不可選）。
- 單元測試只測數學／純邏輯；需要大量模擬的放 `training/*.train.ts`，用 `npx vitest run --config training/vitest.config.ts training/<file>` 執行。
- 同時跑的跑分程序不超過 4 個（記憶體）。
- 檔案用 Edit 工具直接改，不用腳本整檔重寫。
- 提交訊息結尾：`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 與 `Claude-Session: https://claude.ai/code/session_014MRszPo9yvxTW3h5EWLgE3`。

## Review Focus

1. 兩場比賽之間換車：舊的玩家車／對手的剛體、碰撞體、模型、燈光要從物理世界和場景移除，不可殘留（Task 5 測試：重建兩次後剛體數量不變）。
2. `localStorage` 裡是不存在的車種 id、改裝車 id、長度不對或壞掉的 JSON：要回到合法的預設值，不可當機（Task 6 測試）。
3. 橡皮筋加強（`applyBoost`）要以每個對手自己車種的基礎數值為準，不可用到別台車的 `power`（Task 5 測試）。
4. 肌肉車對手在橡皮筋 +25% 抓地下，高速換道不可翻車（Task 2 驗證：`maneuvers` 加 `muPeak` ×1.25 變體）。
5. 標題畫面按 Enter 要進設定頁，不可跳過設定直接開賽（Task 6 瀏覽器驗證）。

---

### Task 1: 車種登錄、肌肉車 spec 骨架與外型

**Files:**
- Create: `src/vehicles/cars/muscleCar.ts`、`src/vehicles/cars/muscleCarTracker.ts`
- Modify: `src/vehicles/cars/types.ts`（`CarSpec.style`）、`src/vehicles/cars/index.ts`、`src/vehicles/cars/streetRacer.ts`（`name: '超跑'`、`style: 'super'`）、`src/vehicles/models.ts`（`buildCar` 款式）、`src/vehicles/playerCar.ts`（傳款式）
- Test: `tests/cars.test.ts`

**Interfaces:**
- Produces: `CarSpec.style: 'super' | 'muscle'`；`MUSCLE_CAR: CarSpec`（`id: 'muscle-car'`）；`CARS` 含兩台；`MUSCLE_CAR_TRACKER: number[]`（先空陣列）；`buildCar(w, h, l, color, style: CarStyle | boolean, withWheels?, beam?)`，其中 `true` 等同 `'super'`、`false` 為一般轎車，NPC 呼叫不變。

- [ ] **Step 1: 寫失敗測試** `tests/cars.test.ts`：
  - `CARS['street-racer'].name === '超跑'`、`CARS['muscle-car'].name === '肌肉車'`；
  - 兩台的 `ai.accel`／`ai.latAccel` 皆為依 km/h 遞增的表；
  - 肌肉車 `params.maxSpeed < STREET_RACER.params.maxSpeed`、`engineTorque >` 超跑。
- [ ] **Step 2:** `npx vitest run tests/cars.test.ts`。Expected：FAIL（沒有 `muscle-car`）。
- [ ] **Step 3: 實作。**
  - `muscleCar.ts`：先以超跑 `params` 展開，再覆寫 §3.1 的方向，作為起點：
    - `engineTorque` 850、`maxDriveForce` 19000、`maxSpeed` 72（約 260 km/h）、`dragK` 0.5；
    - `springK` 24000、`damperBump` 2200、`damperRebound` 3200、`antiRollFront` 5000、`antiRollRear` 2000；
    - `muPeak` 1.2、`rearGrip` 0.98、`aeroGrip` 0.4、`lsd` 300、`escGain` 4000；
    - `comY` -0.2、`mass` 1550。
  - `ai` 先放超跑的表，Task 4 會重量；`tracker: MUSCLE_CAR_TRACKER`；`color` 0x2b2f3a 或使用者偏好的深色；`style: 'muscle'`。
  - `buildCar` 的 `'muscle'` 款式：車身較高、車頂座艙較短且偏後、長引擎蓋、引擎蓋進氣隆起、兩條賽車條紋；`'super'` 維持現狀。
- [ ] **Step 4:** `npx vitest run`。Expected：全部通過。
- [ ] **Step 5:** 瀏覽器看一眼：在 console 建一台 `buildCar(..., 'muscle')` 擺在玩家旁，截圖確認外型可辨識。
- [ ] **Step 6:** Commit `feat(cars): muscle car spec and body style; the street racer is now called 超跑`。

### Task 2: 肌肉車手感調教

**Files:**
- Modify: `src/vehicles/cars/muscleCar.ts`（參數）
- Modify: `training/cornering.train.ts`（各測試接受 `CAR` 環境變數選車，預設 `street-racer`）

**Interfaces:**
- Consumes: Task 1 的 `CARS`、`MUSCLE_CAR`。

- [ ] **Step 1:** `cornering.train.ts` 的 `cornering`／`turnIn`／`maneuvers` 改為用 `CARS[process.env.CAR ?? 'street-racer']` 的 spec 建車（目前寫死 `STREET_RACER`）。
- [ ] **Step 2:** 量兩台車並比較。依 §5 驗收逐條對照，並記錄全油門起步的最大俯仰角（只看，不設門檻）：
  - `CAR=... npx vitest run --config training/vitest.config.ts training/cornering.train.ts`
  - `CAR=... npx vitest run --config training/vitest.config.ts training/measureCar.train.ts`
- [ ] **Step 3:** 調參數直到：
  - 0–100、0–200 km/h 比超跑快；
  - 極速較低；
  - 全舵側向 g 較低；
  - 換道側傾較大；
  - `maneuvers` 不翻車，`TURN_JSON='{"grip":{"muPeak":1.5}}'` 這種 +25% 抓地變體也不翻（Review Focus 4）；
  - 全油門起步車頭明顯上抬。
- [ ] **Step 4:** 用 `measureCar` 量出 `ai.accel`／`brake`／`latAccel` 貼進 `muscleCar.ts`。
- [ ] **Step 5:** `npx vitest run`（含 Task 1 的測試）。Expected：通過。
- [ ] **Step 6:** Commit `feat(cars): muscle car handling - fastest off the line, soft, tail-happy` 。提交訊息附兩台車的對照數字。

### Task 3: 訓練與跑分工具可指定車種

**Files:**
- Modify: `src/ai/trainingSim.ts`（`TrainingSimOptions.spec?: CarSpec`）
- Modify: `training/planner.train.ts`（`CAR` → sim 的 spec 與 driver 的 `accel`／`latAccel`／`tracker`）
- Modify: `training/tracker.train.ts`（`CAR` → 訓練用車；`CONTINUE` 讀該車的 tracker；存檔到 `src/vehicles/cars/<camelId>Tracker.ts` 並寫出該檔匯出名稱 `<CONST_ID>_TRACKER`）
- Create: `src/ai/aiTopSpeed.ts`
- Test: `tests/aiTopSpeed.test.ts`

**Interfaces:**
- Produces: `aiTopSpeed(cap: number, spec: CarSpec): number`，回傳 `Math.min(cap, spec.params.maxSpeed)`（m/s）；`TrainingSimOptions.spec` 預設 `STREET_RACER`；`trackerFile(spec: CarSpec): { path: string; exportName: string }`（`street-racer` → `streetRacerTracker.ts`／`STREET_RACER_TRACKER`，`muscle-car` → `muscleCarTracker.ts`／`MUSCLE_CAR_TRACKER`）。

- [ ] **Step 1: 寫失敗測試** `tests/aiTopSpeed.test.ts`：
  - `aiTopSpeed(300 * KMH, MUSCLE_CAR)` 等於 `MUSCLE_CAR.params.maxSpeed`；
  - `aiTopSpeed(200 * KMH, MUSCLE_CAR)` 等於 `200 * KMH`；
  - `trackerFile(MUSCLE_CAR)` 等於 `{ path: 'src/vehicles/cars/muscleCarTracker.ts', exportName: 'MUSCLE_CAR_TRACKER' }`。
- [ ] **Step 2:** `npx vitest run tests/aiTopSpeed.test.ts`。Expected：FAIL（沒有該模組）。
- [ ] **Step 3: 實作。**
  - `aiTopSpeed`、`trackerFile`（放 `src/ai/aiTopSpeed.ts`）。
  - `TrainingSim` 依 `opts.spec` 建車，`car.params.maxSpeed = aiTopSpeed(opts.speedCap, spec)`。
  - `planner.train.ts`、`tracker.train.ts` 依 `CAR` 選車。
- [ ] **Step 4:** `npx vitest run` 全過。再跑 `PLANNER_JSON='{}' npx vitest run --config training/vitest.config.ts training/planSpeed.train.ts`。Expected：指紋 `641162.136`。
- [ ] **Step 5:** 超跑跑分沒有變：`EVAL_SEEDS=7001,7002 RESET_ON_CRASH=60 npx vitest run --config training/vitest.config.ts training/planner.train.ts` 兩場的結果行，與改動前同一指令的輸出逐字相同（先在改動前跑一次存下）。
- [ ] **Step 6:** Commit `feat(ai): training and benchmark tools take CAR; AI top speed is the car's own when lower`。

### Task 4: 肌肉車 AI（量車、訓練、跑分）

**Files:**
- Modify: `src/vehicles/cars/muscleCar.ts`（`ai` 表，若 Task 2 後又改過參數則重量）
- Modify: `src/vehicles/cars/muscleCarTracker.ts`（由訓練寫入）
- Modify: `docs/ai-car-tuning.md`（基準表加肌肉車一列；「新增車種時目前要手動改的地方」改寫為已支援 `CAR`）

**Interfaces:**
- Consumes: Task 3 的 `CAR` 支援、Task 2 定案的參數。

- [ ] **Step 1:** `CAR=muscle-car GENS=40 POP=60 SCENARIOS=8 SIGMA=0.15 SAVE=1 npx vitest run --config training/vitest.config.ts training/tracker.train.ts`。Expected：驗證分數低於原本公式，且 `muscleCarTracker.ts` 已寫入。
- [ ] **Step 2:** 跑分 30 場（4 組種子、最多 4 個程序）：`CAR=muscle-car` 網路版與 `CAR=muscle-car NET_TRACKER=0` 公式版。Expected：網路版 30 場全部完賽，撞車比公式版少。
- [ ] **Step 3:** 更新 `docs/ai-car-tuning.md` 的基準表與工具說明。
- [ ] **Step 4:** Commit `feat(ai): the muscle car's own steering network` 。提交訊息附跑分數字：平均時間、撞車次數、輕擦、橫移 p95；與超跑對照。

### Task 5: 遊戲中每個對手自己的車種，車可換

**Files:**
- Modify: `src/vehicles/playerCar.ts`（`dispose(physics: PhysicsWorld, scene: THREE.Scene | null): void`）
- Modify: `src/game/rivals.ts`（建構子收 `specs: CarSpec[]`；每個 `Rival` 存 `spec`；`applyBoost` 用 `r.spec.params`；`drive` 的上限用 `aiTopSpeed`；`dispose()`）
- Modify: `src/game/game.ts`（`player` 可替換；`applyCars(selection: CarSelection): void` 在選擇改變時重建玩家車與對手並重建調校面板；`startRace(selection?)`）
- Test: `tests/rivals.test.ts`（加測試）

**Interfaces:**
- Consumes: Task 3 `aiTopSpeed`；Task 6 的 `CarSelection` 型別（Task 5 先在 `src/game/carSelection.ts` 定義型別 `CarSelection = { player: string; rivals: string[] }`，Task 6 補函式）。
- Produces: `new Rivals(physics, scene, makeSource, specs: CarSpec[])`（數量 = `specs.length`）；`Rival.spec: CarSpec`；`Rivals.dispose(): void`；`PlayerCar.dispose(...)`；`Game.applyCars(sel)`。

- [ ] **Step 1: 寫失敗測試**（`tests/rivals.test.ts`，需 `RAPIER.init()`、`PhysicsWorld.createSync()`、`makeSource: () => null`）：
  - `rivals use their own car's tables`：`new Rivals(physics, null, () => null, [MUSCLE_CAR, STREET_RACER])`，`list[0].driver.latAccel === MUSCLE_CAR.ai.latAccel`、`list[1].driver.latAccel === STREET_RACER.ai.latAccel`。
  - `the rubber band boosts each car from its own base`：設 `list[0].boost = 0.25` 後套用加強，`list[0].car.params.power` 等於 `MUSCLE_CAR.params.power * 1.25`（Review Focus 3）。
  - `a rival never exceeds its own top speed`：`drive(dt, view)` 後 `list[0].car.params.maxSpeed <= MUSCLE_CAR.params.maxSpeed`，其中 `view.speedCap = 300 * KMH`（spec §3.4 的 AI 極速）。
  - `dispose leaves nothing in the world`：建立前記下 `physics.world.bodies.len()`，建立後 `dispose()`，數量回到原值（Review Focus 1）。
- [ ] **Step 2:** `npx vitest run tests/rivals.test.ts`。Expected：FAIL。
- [ ] **Step 3: 實作。**
  - `PlayerCar.dispose`：移除剛體（連同碰撞體）、`physics.unregister`、從場景移除模型與燈光。
  - `Rivals` 改為逐台 spec。
  - `Game.applyCars`：玩家或任一對手的車種與目前不同時才重建；重建後重新建立 `createTuningPanel(this.player.params, ...)`（舊的 `gui.destroy()`）；`aiDriver` 的表換成玩家車的。
- [ ] **Step 4:** `npx vitest run`。Expected：全過。
- [ ] **Step 5:** Commit `feat(game): each rival on its own car; cars can be swapped between races`。

### Task 6: 賽前設定頁

**Files:**
- Modify: `src/game/carSelection.ts`（函式）
- Modify: `src/ui/hud.ts`（`#setup` 面板、`HudHandlers.onStart(sel)`、`onSetup()`）
- Modify: `src/game/game.ts`（標題的「開始比賽」與 Enter → 開設定頁；設定頁「開始比賽」與 Enter → `startRace(sel)`；結束畫面「再玩一次」→ 設定頁）
- Modify: `src/styles.css`
- Test: `tests/carSelection.test.ts`

**Interfaces:**
- Produces（`src/game/carSelection.ts`）：
  - `PICKABLE: string[]`（`['street-racer', 'muscle-car']`）
  - `defaultSelection(): CarSelection`（玩家與 5 對手皆 `street-racer`）
  - `sanitize(x: unknown): CarSelection`（不認得的 id → `street-racer`；對手數補齊或截到 5；非物件 → 預設值）
  - `loadSelection(storage: Pick<Storage, 'getItem'>): CarSelection`、`saveSelection(storage: Pick<Storage, 'setItem'>, s: CarSelection): void`（key `ht2.cars`）
  - `allRandom(s: CarSelection, rng: () => number): CarSelection`、`allSameAsPlayer(s: CarSelection): CarSelection`
  - `CAR_CARDS`：三張卡的顯示資料（名稱、一句定位、四條能力條 0..1、是否可選），改裝車 `pickable: false`。

- [ ] **Step 1: 寫失敗測試** `tests/carSelection.test.ts`：
  - `sanitize` 遇到 `{ player: 'jdm', rivals: ['muscle-car'] }` 回 `{ player: 'street-racer', rivals: ['muscle-car', 'street-racer' ×4] }`；
  - `sanitize('garbage')` 等於 `defaultSelection()`；
  - `loadSelection` 讀到壞 JSON 回預設值；
  - save → load 往返相同；
  - `allSameAsPlayer` 讓 5 個對手等於玩家車；
  - `allRandom` 只產生 `PICKABLE` 裡的 id（Review Focus 2）。
- [ ] **Step 2:** `npx vitest run tests/carSelection.test.ts`。Expected：FAIL。
- [ ] **Step 3: 實作。**
  - 函式與 `CAR_CARDS`。
  - HUD 設定面板照草圖：三張車卡可點選（改裝車灰色）、5 個對手下拉選單（顏色點用 `RIVAL_COLORS`）、兩個快捷鈕、開始比賽。
  - 開啟時載入選擇，開賽時存檔。
  - 流程接線：標題 → 設定 → `startRace(sel)`；`finished` 的「再玩一次」→ 設定。
- [ ] **Step 4:** `npx vitest run`。Expected：全過。
- [ ] **Step 5: 瀏覽器驗證。**
  - 標題按 Enter 出現設定頁，不會直接開賽（Review Focus 5）；
  - 選玩家肌肉車、對手混搭 → 開始 → 遊戲中玩家與對手是對應車種（截圖）；
  - 重新整理後選擇保留；
  - 跑完一場「再玩一次」回到設定頁並保留選擇；
  - console 沒有錯誤。
- [ ] **Step 6:** Commit `feat(ui): pick your car and each rival's before the race`。

### Task 7: 收尾驗證與文件

**Files:**
- Modify: `docs/superpowers/specs/2026-11-02-muscle-car-design.md`（如有實作中的決定，補在 §4）

- [ ] **Step 1:** 全部單元測試、`tsc --noEmit`、`planSpeed` 指紋 `641162.136`。
- [ ] **Step 2:** 遊戲中玩家肌肉車實開檢查（`simulate` 全油門起步、換道），截圖起步翹頭與換道側傾給使用者看。
- [ ] **Step 3:** 整條分支的最終審查（executing-plans 的 Final Review）。
