# 神經網路 AI 駕駛 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `lab/train.html` 用神經演化訓練駕駛網路（整代幽靈車同場、即時可見），把成果存成 `public/ai/driver.json`，並在遊戲中按 `I` 讓 AI 開玩家車。

**Architecture:** 純邏輯（網路、感測、評分、演化、亂數）放在 `src/ai/`，全部可在 Node 單元測試。車流管理從 `Game` 抽成 `src/sim/trafficWorld.ts`，遊戲與訓練共用同一份。`TrainingSim` 是一代的模擬：一個新的 `PhysicsWorld`、共用車流、N 台幽靈 `PlayerCar`；`Trainer` 管理世代、驗證、存檔。訓練頁只負責畫面與面板。

**Tech Stack:** TypeScript 5.9、Vite 8、three 0.187、@dimforge/rapier3d-compat 0.21、vitest 5。不加任何新依賴。

**Spec:** `docs/superpowers/specs/2026-11-01-neural-ai-driver-design.md`

## Global Constraints

- 不加入機器學習套件或任何新 npm 依賴。
- 網路前向計算、感測輸入、評分、車輛物理：訓練頁與遊戲 **同一份程式碼**；不得複製另改。
- 既有 126 個測試持續通過；`npx tsc --noEmit` 無錯。
- 遊戲本體效能不下降（AI 每幀推論一次）；未載入 `driver.json` 時遊戲行為與現在完全相同。
- 模擬固定步長 `PHYSICS_DT = 1/120`；結果不受每幀跑幾步影響（同分頁、同種子可重現）。
- 數值：族群 80、時間上限 240 s、雷達前 300 m 後 50 m、訓練時每代最高時速上限隨機 150–300 km/h、驗證前 3 名、成果目標「5 套沒看過的車流中至少 3 套不撞車跑完 10 km」。
- 撞車定義：碰到車流車輛（含事故車）外框；或車身任一角越出我方路面 `d ∈ [MEDIAN_NEAR_X, RAIL_D]`（= [-10, 10]）。
- 回覆與 UI 文字用繁體中文；以 Edit 工具直接改檔，不用腳本整檔覆寫。

## Review Focus

1. `driver.json` 不存在、格式錯、或輸入版本不符 → 遊戲照常可玩，按 `I` 只顯示提示，不丟例外（Task 11 測試 `parseDriver` 拒絕不符檔案）。
2. 幽靈車與車流/事故車：車流不把幽靈車當障礙；幽靈車不推動車流（碰撞群組），撞到即淘汰（Task 7 測試）。
3. 落後的幽靈車仍有車流：despawn 以「最後一台存活幽靈車」為準，spawn 以領先者為準（Task 5 測試 `maintain` 範圍）。
4. 重構後的遊戲：玩家撞 NPC、NPC 互撞成事故車、事故車清除、重置避車，都要和重構前一樣（Task 5 以瀏覽器煙霧測試驗證）。
5. 快轉跟不上 CPU 時畫面不卡死：每幀模擬時間預算上限，面板顯示實際倍率（Task 9）。

---

### Task 1: 亂數與神經網路核心

**Files:**
- Create: `src/ai/rng.ts`、`src/ai/brain.ts`
- Test: `tests/brain.test.ts`

**Interfaces:**
- Produces:
  - `type Rng = () => number`
  - `mulberry32(seed: number): Rng`
  - `gaussian(rng: Rng): number`
  - `interface Brain { layers: number[]; weights: Float32Array }`：權重逐層排列，每層 `(in + 1) * out`，最後一個為偏置
  - `weightCount(layers: number[]): number`
  - `createBrain(layers: number[], rng: Rng): Brain`：均勻分布 ±1/√in
  - `forward(b: Brain, input: ArrayLike<number>, out?: Float32Array): Float32Array`：每層 tanh
  - `mutate(b: Brain, rng: Rng, sigma: number, rate: number): Brain`：回傳新 Brain；每個權重以機率 `rate` 加上 `sigma * gaussian`
  - `cloneBrain(b: Brain): Brain`

- [ ] **Step 1: 寫失敗測試** `tests/brain.test.ts`
  - `mulberry32(42)` 兩次產生相同的前 5 個數；值落在 [0, 1)。
  - `weightCount([3, 4, 2]) === (3+1)*4 + (4+1)*2 === 26`。
  - `forward` 輸出長度為最後一層大小；所有值在 (-1, 1)；權重全 0 時輸出全 0。
  - 手算案例：layers [1,1]，weights [2, 0.5]（w, bias），input [1] → `tanh(2.5)`。
  - `mutate` 不改動原 Brain；`rate=0` 時權重相同；同種子 rng 兩次結果相同。
- [ ] **Step 2:** `npx vitest run tests/brain.test.ts` → FAIL（模組不存在）
- [ ] **Step 3:** 實作 `rng.ts`、`brain.ts`
- [ ] **Step 4:** 測試 PASS
- [ ] **Step 5:** Commit `feat(ai): seeded rng and small MLP brain`

### Task 2: 感測輸入（AI 的眼睛）

**Files:**
- Create: `src/ai/sensors.ts`
- Test: `tests/sensors.test.ts`

**Interfaces:**
- Consumes：`laneCenter`、`LANE_COUNT`、`LANE_WIDTH`、`RAIL_D`、`MEDIAN_NEAR_X`（config / coords）
- Produces:
  - `interface SelfState { s: number; d: number; yaw: number; vLong: number; vLat: number; yawRate: number; speedCap: number }`：speedCap 單位 m/s
  - `interface TrafficBox { s: number; dMin: number; dMax: number; v: number; length: number }`：我方道路座標
  - `SENSOR_COUNT = 24`
  - `SENSOR_LAYOUT = 'lane-radar-v1'`
  - `readSensors(self: SelfState, traffic: TrafficBox[], out?: Float32Array): Float32Array`

  輸入依序如下：
  1. 4 條車道 × 4 個值：
     - 前方間距 `clamp((gap)/300, 0, 1)`，gap 為車尾到車頭的淨距；前方沒車時為 1
     - 前方接近速度 `clamp((self.vLong - other.v)/50, -1, 1)`，沒車為 0
     - 後方間距 `clamp(gap/50, 0, 1)`
     - 後方接近速度 `clamp((other.v - self.vLong)/50, -1, 1)`

     一台車只要外框 `[dMin, dMax]` 與該車道重疊（用 `lanesOccupied`）就算在該車道。
  2. 8 個自身狀態：
     - `vLong/83.3`
     - `clamp(vLat/10)`
     - `clamp(yaw/0.5)`
     - `clamp(yawRate/2)`
     - `d/RAIL_D`
     - 右緣餘裕 `clamp((RAIL_D - (d + 0.93))/10, -1, 1)`
     - 左緣餘裕 `clamp(((d - 0.93) - MEDIAN_NEAR_X)/10, -1, 1)`
     - `speedCap/83.3`

  上面未註明範圍的 `clamp` 都是 [-1, 1]。

- [ ] **Step 1: 寫失敗測試**
  - 空車流：長度 24；每條車道前方 = 1、後方 = 1、接近速度 = 0。
  - 在 lane 2 前方 150 m 放一台車（`length 4.6`，自身 s=0、v=30、車 v=20）：index `2*4+0` ≈ (150-2.3-2.2)/300；index `2*4+1` = 10/50 = 0.2。
  - 一台橫跨 lane 1 與 lane 2 的車：兩條車道都看得到。
  - 超出範圍（前方 400 m）的車：前方間距 = 1。
  - `d = 9` 時右緣餘裕 ≈ (10-9.93)/10。
- [ ] **Step 2:** 跑測試 → FAIL
- [ ] **Step 3:** 實作
- [ ] **Step 4:** PASS
- [ ] **Step 5:** Commit `feat(ai): lane-radar sensors`

### Task 3: 撞車判定與評分

**Files:**
- Create: `src/ai/fitness.ts`
- Test: `tests/fitness.test.ts`

**Interfaces:**
- Consumes：`TrafficBox`（Task 2）、`ROAD_LENGTH`、`RAIL_D`、`MEDIAN_NEAR_X`
- Produces:
  - `FITNESS = { timeLimit: 240, finishBonus: 4000, crashPenalty: 1000, stallWindow: 10, stallMinProgress: 5 }`（可變物件，可調）
  - `interface RunResult { distance: number; crashed: boolean; finishTime: number | null }`
  - `fitness(r: RunResult): number`：
    - 完賽：`ROAD_LENGTH + finishBonus * (timeLimit - finishTime) / timeLimit`
    - 撞車：`distance - crashPenalty`
    - 其餘：`distance`
  - `carCorners(s, d, yaw, w = 1.86, l = 4.4): {s, d}[]`
  - `isOffRoad(s, d, yaw): boolean`：任一角 `d` 超出 [MEDIAN_NEAR_X, RAIL_D]
  - `hitsTraffic(s, d, yaw, traffic: TrafficBox[]): boolean`：用車身角點算出的 AABB 與車流外框重疊

- [ ] **Step 1: 寫失敗測試**
  - 完賽 150 s 的分數 > 完賽 200 s > 未完賽 9999 m。
  - 不撞車 5000 m 的分數 > 撞車 5800 m；撞車 7000 m 的分數 > 不撞車 5000 m。
  - `isOffRoad(0, 9, 0) === true`（右角在 9.93）；`isOffRoad(0, 8, 0) === false`；車頭偏 0.5 rad 時在 `d = 7.5` 越界。
  - `hitsTraffic`：前方 3 m 同車道有車 → true；前方 10 m → false；隔壁車道 → false。
- [ ] **Step 2:** FAIL → **Step 3:** 實作 → **Step 4:** PASS
- [ ] **Step 5:** Commit `feat(ai): crash rules and fitness`

### Task 4: 演化與駕駛檔案格式

**Files:**
- Create: `src/ai/evolution.ts`、`src/ai/driverFile.ts`
- Test: `tests/evolution.test.ts`、`tests/driverFile.test.ts`

**Interfaces:**
- Consumes：Task 1、`SENSOR_COUNT`、`SENSOR_LAYOUT`
- Produces:
  - `BRAIN_LAYERS = [SENSOR_COUNT, 16, 16, 3]`
  - `interface EvoParams { population: number; elite: number; parentPool: number; sigma: number; rate: number }`
  - `DEFAULT_EVO: EvoParams = { population: 80, elite: 4, parentPool: 0.25, sigma: 0.15, rate: 0.1 }`
  - `nextGeneration(pop: Brain[], scores: number[], rng: Rng, p: EvoParams): Brain[]`：
    - 依分數排序。
    - 前 `elite` 名原樣複製（clone）。
    - 其餘從前 `parentPool` 比例中隨機挑一個父代，`mutate` 產生。
  - `interface DriverFile { format: 'ht2-driver'; version: 1; sensors: string; layers: number[]; weights: number[]; meta: Record<string, unknown> }`
  - `serializeDriver(b: Brain, meta = {}): DriverFile`
  - `parseDriver(json: unknown): Brain`：以下情況丟 `Error`，訊息為中文、說明原因：
    - format 不符
    - version 不符
    - sensors 不等於 `SENSOR_LAYOUT`
    - layers 不等於 `BRAIN_LAYERS`
    - weights 長度不符

- [ ] **Step 1: 寫失敗測試**
  - 族群大小不變。
  - 分數最高的 4 個權重與輸出前 4 個相同（順序依分數）。
  - 第 5 個之後至少有一個與所有父代都不同。
  - 同種子兩次結果相同。
  - `parseDriver(serializeDriver(b))` 權重相同。
  - 改 `sensors`、`layers` 或 `weights` 長度後，`parseDriver` 會丟錯。
- [ ] **Step 2–4:** FAIL → 實作 → PASS
- [ ] **Step 5:** Commit `feat(ai): evolution step and driver file format`

### Task 5: 抽出車流世界（遊戲重構）

**Files:**
- Create: `src/sim/trafficWorld.ts`
- Modify: `src/game/game.ts`（改用 TrafficWorld；`sides`、`npcs`、`spawn`、`cullVehicles`、`wreckNpc`、`removeNpc` 搬走）
- Test: `tests/trafficWorld.test.ts`（Node 下初始化 Rapier）

**Interfaces:**
- Produces:
  - `interface TrafficFocus { sLead: number; sTail: number; vLead: number; raceTime: number }`：我方道路 s
  - `class TrafficWorld`
    - 建構：`constructor(physics: PhysicsWorld, scene: THREE.Scene, wheelPool: WheelInstances, rng: Rng, opts: { oncoming: boolean })`
    - 欄位：`readonly npcs: Map<number, NpcVehicle>`、`spacing: number`
    - `readonly sides: TrafficSide[]`：`TrafficSide = { name: 'ours' | 'oncoming'; frame: RoadFrame; facing: 1 | -1; sim: TrafficSim }`
    - `reset(focus: TrafficFocus, occupants: (frame: RoadFrame) => Occupant[]): void`：清空、初始填充
    - `stepAI(dt: number, simTime: number, obstacles: (frame: RoadFrame) => Obstacle[]): void`：交通規劃 + NPC 驅動，含事故車更新
    - `afterPhysics(): void`：NPC capture
    - `maintain(dt: number, focus: TrafficFocus, occupants: (frame: RoadFrame) => Occupant[]): void`：
      - 清除：活車以 `sTail` 判 -260 m、以 `sLead` 判 +900 m；事故車同理；`MAX_WRECKS` 只移除 `s < sTail` 的
      - 每 0.25 s 用 `sLead` / `vLead` 呼叫 `planSpawns`
    - `onNpcContact(a: EntityRef, b: EntityRef): number | null`：NPC 互撞時處理成事故車並回傳 null；NPC 與他物相撞時回傳該 NPC id
    - `wreck(id: number): void`
    - `sideOf(id: number): TrafficSide | undefined`
    - `agentOf(id: number): Agent | undefined`
    - `ourBoxes(): TrafficBox[]`：我方活車（含換道中的目標車道外框）加上事故車在 OUR_FRAME 的外框
  - `PhysicsWorld.createSync(): PhysicsWorld`：RAPIER 已 init 時使用
  - `PhysicsWorld.free(): void`

- [ ] **Step 1: 寫失敗測試** `tests/trafficWorld.test.ts`
  - `beforeAll(await RAPIER.init())`；`new THREE.Scene()`；`new WheelInstances(scene)`。
  - `reset({sLead:0,sTail:0,vLead:0,raceTime:0}, () => [])` 之後，我方有車，且都在 s ∈ [60, 700]。
  - 以 sTail=0、sLead=800 呼叫 `maintain` 數次：s≈100 的車不被清除（在 sTail 後方 260 m 以內）。
  - `ourBoxes()` 長度 ≥ 我方活車數。
- [ ] **Step 2:** FAIL
- [ ] **Step 3:** 實作 TrafficWorld，並把 Game 改為使用它
  - Game 的 focus = 玩家 s（`sLead = sTail = playerS`）。
  - Game 的 obstacles = 玩家外框；occupants = 玩家所佔車道。
  - 玩家碰撞的震動與聲音仍在 Game。
  - `checkNearMisses` 改讀 `traffic.sides`。
  - `tryReset` 改用 `traffic.agentOf` / `sideOf`。
- [ ] **Step 4:** 全部測試 PASS；`npx tsc --noEmit` 無錯
- [ ] **Step 5:** 瀏覽器煙霧測試（`window.__game.simulate`）：
  - 開 20 秒車流正常（車數 > 20）。
  - 開車撞前車 → 該 NPC 變事故車並在 12 s 後消失。
  - `tryReset` 可用。
- [ ] **Step 6:** Commit `refactor: extract TrafficWorld from Game`

### Task 6: 幽靈車模式與 AI 駕駛器

**Files:**
- Modify: `src/physics/physicsWorld.ts`
  - 新增 `G_GHOST = 16`、`GHOST_GROUPS = groups(G_GHOST, G_STATIC)`
  - `STATIC_GROUPS` 的 filter 加入 G_GHOST（只有 static 會與幽靈車接觸）
- Modify: `src/vehicles/playerCar.ts`：建構子第二參數允許 `null`。
  - 傳 `null` 時為幽靈車：
    - 不建模型、不建大燈（`mesh` 為空 Group）
    - lights 為空的 VehicleLights
    - collider 用 `GHOST_GROUPS`，不註冊碰撞事件
  - 另新增 `get yawRate(): number`。
- Create: `src/ai/driver.ts`
- Test: `tests/driver.test.ts`

**Interfaces:**
- Consumes：Task 1、2、4
- Produces：`class AiDriver { constructor(brain: Brain); drive(self: SelfState, traffic: TrafficBox[]): HandlingInput }`
  - 方向盤 = out[0]
  - 油門 = `(out[1] + 1) / 2`
  - 煞車 = `max(0, out[2])`
  - 煞車 > 0.5 時油門歸 0
  - `selfStateOf(car: PlayerCar, speedCap: number): SelfState`

- [ ] **Step 1: 寫失敗測試**：權重全 0 的 Brain → `drive` 回傳 steer 0、throttle 0.5、brake 0；輸出值都在合法範圍。
- [ ] **Step 2–4:** FAIL → 實作 → PASS（含既有測試）
- [ ] **Step 5:** Commit `feat(ai): ghost car mode and AiDriver`

### Task 7: 一代的模擬 TrainingSim

**Files:**
- Create: `src/ai/trainingSim.ts`
- Test: `tests/trainingSim.test.ts`（Node + Rapier；只跑短時間）

**Interfaces:**
- Consumes：Task 3、5、6
- Produces：
  - `interface Ghost { car: PlayerCar; driver: AiDriver; alive: boolean; result: RunResult }`
  - `class TrainingSim`
    - `constructor(brains: Brain[], seed: number, opts: { speedCap: number; timeLimit?: number; scene?: THREE.Scene })`：自建 `PhysicsWorld.createSync()`，車流 `oncoming: false`，幽靈車從 s=0、lane 1、靜止出發
    - 欄位：`readonly ghosts: Ghost[]`、`time: number`
    - `step(): void`：
      1. 各幽靈車讀感測、輸出操作、`prePhysics`
      2. 車流規劃（障礙物為空陣列）
      3. `physics.step`
      4. 判定淘汰：撞車、越界、停滯、完賽
      5. 車流 `maintain`：`sLead` = 存活最遠者，`sTail` = 存活最後者
    - `get done(): boolean`：全部淘汰、全部完賽或時間到
    - `leader(): Ghost | null`：存活中 s 最大者；全滅時取 distance 最大者
    - `dispose(): void`：釋放 physics world 與 NPC 網格

- [ ] **Step 1: 寫失敗測試**
  - 3 個全 0 權重的 Brain（油門 0.5、直行）跑 5 秒：都存活，distance > 10 m。
  - 一個總是右轉打滿的 Brain（最後一層 steer 偏置設為 3）跑 10 秒 → `crashed` 為 true（越界）。
  - 同一 seed、同一批 Brain 跑兩次 5 秒 → distance 完全相同。
- [ ] **Step 2–4:** FAIL → 實作 → PASS
- [ ] **Step 5:** Commit `feat(ai): TrainingSim (one generation)`

### Task 8: Trainer（世代、驗證、存檔）

**Files:**
- Create: `src/ai/trainer.ts`
- Test: `tests/trainer.test.ts`

**Interfaces:**
- Consumes：Task 4、7
- Produces：
  - `class Trainer`
    - 建構：`constructor(opts: { seed: number; evo?: EvoParams; storage?: Storage | null; scene?: THREE.Scene; population?: number })`
    - 狀態欄位：`generation: number`、`sim: TrainingSim`
    - 歷史：`history: { gen: number; best: number; alive: number; validated?: { mean: number; finishes: number; runs: number } }[]`
    - 最佳：`best: { brain: Brain; score: number; finishes: number; runs: number } | null`
    - `tick(steps: number): void`：推進目前一代；`done` 時算分、排程驗證、`nextGeneration`、建新的 `TrainingSim`
      - 新一代的 seed = `hash(seed, generation)`
      - speedCap 由 rng 在 150–300 km/h 之間抽
    - `validateTick(steps: number): void`：分時推進驗證工作
      - 對本代前 3 名，在 `VALIDATION_SEEDS = [9101, 9202, 9303]` 上各跑一個 `TrainingSim`（不給 scene，speedCap 300 km/h）
      - 平均分數高於 `best.score` 時更新 best 並存檔
      - 若上一個驗證還沒做完就有新的請求，跳過新的
    - `save()` / `static load(storage, scene?)`：localStorage key `highwayThunder2.trainer.v1`，存種子、代數、族群、歷史、best
    - `reset(seed?: number): void`

- [ ] **Step 1: 寫失敗測試**
  - population 4、timeLimit 1 s 的 Trainer，tick 到第 2 代：`generation === 2`，history 長度為 1。
  - 驗證完成後 `best` 不為 null。
  - `save` 後用同一個 storage 再 `load`：代數與 best 分數相同（記憶體版 Storage 模擬）。
- [ ] **Step 2–4:** FAIL → 實作 → PASS
- [ ] **Step 5:** Commit `feat(ai): Trainer with validation and persistence`

### Task 9: 訓練頁 `lab/train.html`

**Files:**
- Create：
  - `lab/train.html`
  - `src/lab/train.ts`
  - `src/lab/ghostView.ts`：InstancedMesh 半透明車身，領先者不透明
  - `src/lab/trainPanel.ts`：DOM 面板加 canvas 折線圖
- Modify：
  - `vite.config.ts`：開發伺服器中介層 `POST /__ai/save`，把 body 寫到 `public/ai/driver.json`；正式建置只打包 `index.html`
  - `src/world/roadScene.ts`：若需要可重用場景設定
- Test：手動、瀏覽器

**Interfaces:**
- Consumes：Task 8、RoadScene、CameraRig、LightFlares、NpcBeams
- 畫面行為：
  - 鏡頭跟隨 `trainer.sim.leader()`。
  - 面板顯示：第幾代、存活/總數、本代最佳距離、歷代最佳（驗證完賽率）、每代最佳折線圖、實際倍率、本代最高時速上限、演化參數（族群、菁英數、突變幅度）。
  - 按鈕：開始／暫停、1× / 4× / 10×、從頭訓練、存檔。
    - 存檔先 POST `/__ai/save`；失敗時改為下載檔案。
- 快轉：
  - 每幀模擬步數 = `speed × frameDt / PHYSICS_DT`。
  - 每幀模擬時間超過 25 ms 就停止本幀的模擬。
  - 剩餘時間預算給 `validateTick`。
- 自動儲存：每代結束呼叫 `trainer.save()`；頁面載入時優先 `Trainer.load`。

- [ ] **Step 1:** 實作頁面
- [ ] **Step 2:** 瀏覽器驗證：
  - 打開 `http://localhost:5173/lab/train.html`，看得到半透明車群與面板。
  - 10× 時實際倍率有顯示，畫面仍能操作。
  - 跑完一代後折線圖多一點。
  - 重新整理頁面後代數保留。
  - 按存檔後 `public/ai/driver.json` 出現且 `parseDriver` 可讀。
- [ ] **Step 3:** `npx tsc --noEmit`、全部測試 PASS
- [ ] **Step 4:** Commit `feat(lab): training page`

### Task 10: 遊戲內 AI 接管

**Files:**
- Modify：
  - `src/main.ts`：fetch `/ai/driver.json`，用 `parseDriver` 讀取，失敗時 `console.warn`
  - `src/game/game.ts`：`aiDriver`、`aiActive`、`KeyI`；racing 時 aiActive 改用 AI 輸入；AI 駕駛時 `player.params.maxSpeed = aiSettings.speedCapKmh / 3.6`，關閉時恢復
  - `src/ui/hud.ts`：顯示「AI 駕駛中」，以及「沒有可用的 AI 駕駛」提示
  - `src/debug/tuning.ts`：「AI 最高時速 km/h」滑桿 150–300
- Test：`tests/driverFile.test.ts` 已涵蓋格式。本 Task 以瀏覽器驗證。

- [ ] **Step 1:** 實作
- [ ] **Step 2:** 瀏覽器驗證：
  - 無檔案時按 I 只出現提示，遊戲照常。
  - 有檔案時按 I，HUD 顯示「AI 駕駛中」且車子自己開。
  - 再按 I 拿回控制權。
- [ ] **Step 3:** 全部測試 + typecheck PASS
- [ ] **Step 4:** Commit `feat: AI can drive the player car (I key)`

### Task 11: 訓練出成果

**Files:**
- Create：`public/ai/driver.json`（訓練產物）
- 視需要 Create：`src/lab/evaluate.ts`，在訓練頁 `window.__evaluate(seeds)` 對指定種子跑不渲染的完整評估，回傳每套的距離、是否撞車、完賽時間

- [ ] **Step 1:** 在訓練頁訓練，必要時調整 `FITNESS` / `DEFAULT_EVO`，直到驗證完賽率穩定上升
  - 若瀏覽器內速度太慢，可以把同一份 `Trainer` 放進不渲染的迴圈全速跑（仍在訓練頁）。
- [ ] **Step 2:** 用 `__evaluate([7001, 7002, 7003, 7004, 7005])` 評估（訓練與驗證都沒用過的種子）。目標：至少 3/5 不撞車完賽。
- [ ] **Step 3:** 存檔到 `public/ai/driver.json`；在遊戲中按 I 確認能開
- [ ] **Step 4:** Commit `feat(ai): trained driver`，在訊息中記錄評估結果
  - 未達標時如實記錄完賽率與平均距離。
