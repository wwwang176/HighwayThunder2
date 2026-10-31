# Highway Thunder 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 可在瀏覽器遊玩的 3D 高速公路穿梭賽車：4 線道直線 10 km、IDM/MOBIL 交通、物理碰撞與連環車禍、計時與最佳成績。

**Architecture:** 交通 AI、遊戲規則、操控計算全部寫成純 TypeScript 模組（道路座標 s/d，無 Three/Rapier 依賴），用 vitest 測試；`game.ts` 以固定步長（1/120 s）驅動 Rapier 物理與 AI，再同步到 Three.js 場景。NPC 是「AI 每步設定速度的動態剛體」，碰撞事件發生即轉為事故車。

**Tech Stack:** Vite 8、TypeScript 6、three 0.187、@dimforge/rapier3d-compat 0.21、lil-gui 0.21、vitest 4

**Spec:** `docs/superpowers/specs/2026-10-31-highway-thunder-design.md`

## Global Constraints

- 道路座標：`s` = 沿道路前進距離（m，起跑線 s=0，終點 s=10000），`d` = 橫向位移（m，右為正）。世界座標：`x = d`、`z = -s`、`y` 向上。
- 4 線道，車道寬 3.75 m；車道 0 = 最左（內側），車道 3 = 最右（外側）；車道中心 `d = (i - 1.5) * 3.75`。路肩各 2.5 m，護欄在 `d = ±10`。
- 靠右行駛；貨車只用車道 2–3，貨櫃車只用車道 2–3 且偏好車道 3。
- 關卡長度 10000 m；玩家最高速約 300 km/h（83.3 m/s）。
- 物理固定步長 1/120 s，每幀最多 8 個子步，幀 dt 上限 0.1 s；玩家車啟用 CCD。
- R 重置：GO 之後才能用、冷卻 3 s、只能原地或往後、重置速度 60 km/h（16.67 m/s）。
- 任何碰撞（含擦碰）→ NPC 變事故車：煞停、約 12 s 後消失；同時事故車上限 12。
- 開局只在玩家前方生成車流（最近 ≥ 60 m）；後方車流在比賽開始 5 s 後才生成。
- 險過：只計數與提示，不影響成績。
- UI 文字為繁體中文；最佳成績存 `localStorage` key `highwayThunder2.bestTime`。
- 非 git repo：不做 commit 步驟。

## Review Focus

1. 玩家停在原地 / 慢速時被後方 NPC 追撞 — NPC 應把玩家當成前車煞停（trafficAI 測試涵蓋）。
2. 事故車斜停跨兩車道 — 兩條車道的後方 NPC 都要煞車（occupancy 測試涵蓋）。
3. R 重置點被事故車或 NPC 佔住 — 往後找空位，且 s 不小於 0（reset 測試涵蓋）。
4. 分頁切到背景再回來 — 不得一次跑大量物理步（幀 dt 上限 + visibilitychange 自動暫停）。
5. 抵達終點後持續按鍵 / 按 R / Esc — 不得重啟計時或改變成績（gameState 測試涵蓋）。

## 補充修正（審閱後加入，優先於下方任務內容）

1. **碰撞群組**：STATIC / PLAYER / NPC_LIVE / WRECK。行駛中 NPC 的 filter = STATIC|PLAYER|WRECK（NPC 彼此不碰撞，避免無故連環車禍）；`wreck()` 時改成 WRECK 並碰撞全部。連環車禍只透過事故車傳遞。
2. **玩家操控狀態每步從剛體讀回**：`world.step()` 後由 `body.linvel()` 投影出 vLong/vLat、`angvel().y` 為 yawRate，再跑 stepHandling 寫回；撞擊衝量才不會被覆蓋。`resetTo` 同時清零剛體速度、操控狀態與 stun。
3. **偏航符號**：yaw > 0 = 車頭偏向 +d（右）；Three 中 `mesh.rotation.y = -yaw`；前進向量 = `(sin yaw, 0, -cos yaw)`。Task 1 加測試。
4. **工具鏈先驗證**：Task 1 後先在瀏覽器啟動最小 Rapier + Three；`vite.config.ts` 設 `optimizeDeps.exclude: ['@dimforge/rapier3d-compat']`；版本在 package.json 釘死。
5. **順序**：1 → 5 → 6 → 2/3/4 → 7 → 8 → 9（先讓手感可在瀏覽器調）。
6. **NPC 對玩家的感知**：玩家的安全檢查範圍 = `max(mirrorRange, 2.5 s × 接近速度)`；`move` 期間也持續檢查，不安全就退回原車道。
7. 後方生成條件 `playerV < 25` 是刻意的（正常比賽中慢車追不上玩家）。鏡頭沿 s 方向不平滑（直接跟隨），只平滑橫向 / 偏航（~0.08 s）。護欄碰撞體半厚 ≥ 0.5 m。幀 dt 上限在 Task 6 的迴圈就加上。

---

## File Structure

```
index.html, src/styles.css
src/main.ts                 啟動：Rapier init → Game → loop
src/config.ts               所有常數與車種規格 VEHICLE_SPECS
src/road/coords.ts          laneCenter / laneAt / lanesOccupied / roadToWorld
src/traffic/idm.ts          idmAccel
src/traffic/mobil.ts        mobilIncentive / mobilSafe
src/traffic/trafficAI.ts    TrafficSim：agent 狀態、找前後車、換道狀態機
src/traffic/spawner.ts      spawn / despawn 決策
src/game/gameState.ts       GameFlow 狀態機 + 計時 + 最佳成績
src/game/reset.ts           computeResetSpot
src/game/nearMiss.ts        detectNearMiss
src/vehicles/handling.ts    純操控計算 stepHandling
src/vehicles/playerCar.ts   玩家剛體 + 操控套用
src/vehicles/models.ts      程式產生 low-poly 車模型（含方向燈 / 煞車燈）
src/vehicles/npcVehicle.ts  NPC 剛體、同步、事故轉換、拖車關節
src/physics/physicsWorld.ts Rapier world、靜態碰撞體、事件、collider→實體對照
src/world/roadScene.ts      路面、標線、護欄、燈桿、距離牌、起終點、天空、光
src/render/cameraRig.ts     追尾鏡頭
src/input/keyboard.ts       按鍵狀態
src/ui/hud.ts               DOM：標題 / 倒數 / HUD / 暫停 / 結算 / 險過提示
src/audio/sound.ts          Web Audio 引擎 / 碰撞 / 險過音
src/debug/tuning.ts         lil-gui 調校面板（` 鍵切換）
src/game/game.ts            主協調：固定步長、物理、AI、同步、流程
tests/*.test.ts
```

---

### Task 1: 專案骨架與道路座標

**Files:** Create `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/config.ts`, `src/road/coords.ts`, `tests/coords.test.ts`

**Interfaces — Produces:**
- `LANE_COUNT=4, LANE_WIDTH=3.75, RAIL_D=10, ROAD_LENGTH=10000, PHYSICS_DT=1/120`
- `laneCenter(lane: number): number`
- `laneAt(d: number): number`（最近車道，夾在 0..3）
- `lanesOccupied(dMin: number, dMax: number, margin = 0.3): number[]`（區間與車道 [center±1.875∓margin] 重疊者）
- `roadToWorld(s, d): {x, z}`、`worldToRoad(x, z): {s, d}`

- [ ] 寫測試：`laneCenter(0)=-5.625`、`laneCenter(3)=5.625`；`laneAt(-100)=0`、`laneAt(2)=2`；`lanesOccupied(-1,1)` = `[1,2]`；`lanesOccupied(4,7)` = `[3]`；`roadToWorld(100,2)` = `{x:2,z:-100}`
- [ ] `npx vitest run` → FAIL；實作；→ PASS

### Task 2: IDM 與 MOBIL

**Files:** Create `src/traffic/idm.ts`, `src/traffic/mobil.ts`, `tests/idm.test.ts`, `tests/mobil.test.ts`

**Interfaces — Produces:**
- `interface IdmParams { v0; T; s0; a; b }`
- `idmAccel(v: number, gap: number | null, dv: number, p: IdmParams): number` — `gap=null` 表示無前車；`dv = v - vLeader`；結果夾在 `[-9, p.a]`。
- `mobilIncentive(o: {selfNew, selfOld, newFollowerNew, newFollowerOld, oldFollowerNew, oldFollowerOld, politeness, bias}): number`（= selfNew−selfOld + p·(Δ新後車 + Δ舊後車) + bias）
- `mobilSafe(newFollowerNew: number, bSafe = 4): boolean`

- [ ] 測試：自由道路 v=0 → accel = a；v=v0 無前車 → ≈0；前車靜止 gap=10 v=30 → 等於 -9（下限）；gap 很大 dv=0 → 接近自由加速；mobilSafe(-5)=false、(-3)=true；incentive 範例數值。
- [ ] FAIL → 實作 → PASS

### Task 3: TrafficSim（純交通模擬）

**Files:** Create `src/traffic/trafficAI.ts`, `tests/trafficAI.test.ts`

**Interfaces:**
- Consumes: Task 1 coords、Task 2 IDM/MOBIL、`VEHICLE_SPECS`（config：`kind: 'car'|'truck'|'container'`、`length,width,height,mass, speedRange:[min,max] (m/s), laneChangeTime, allowedLanes, idm`)
- Produces:
  - `interface Agent { id; kind; s; d; v; lane; targetLane: number|null; lcState: 'none'|'signal'|'move'; lcTimer; lcFrom; desiredV; politeness; mirrorRange; cooldown; length; width; accel; yaw }`
  - `interface Obstacle { id; s; dMin; dMax; v; length }`（玩家、事故車）
  - `class TrafficSim { agents: Map<number, Agent>; addAgent(kind, s, lane, rng): Agent; removeAgent(id); step(dt: number, obstacles: Obstacle[], rng: () => number): void }`
  - 演算法：每台車在「自己佔用的每個車道」找最近前方物體（agent 或 obstacle，用 `lanesOccupied`），取 IDM 最小加速度；換道中同時考慮來源與目標車道。換道決策：冷卻結束且 `lcState='none'` 時對左右鄰道算 MOBIL；玩家 Obstacle 只在 `mirrorRange`（20–45 m，隨機）內才納入安全檢查。狀態：`signal`（1.0–1.5 s，期間持續檢查安全，不安全就取消）→ `move`（`laneChangeTime` 秒，d 以 smoothstep 由 lcFrom 移到目標車道中心）→ `none` 並設冷卻 4–9 s。`yaw = atan2(dd/dt, v)`。
- [ ] 測試：
  - `follows_leader`：同車道前車慢 → 後車減速且不追撞（模擬 30 s，間距始終 > 0）
  - `brakes_for_stationary_obstacle_across_two_lanes`：obstacle dMin=-2.5,dMax=2.5（跨車道 1、2）在 s=200，車道 1、2 各一台 v=30 的車 → 兩台都在 obstacle 前停下（s + length/2 < 200 − length/2）
  - `brakes_for_slow_player`：玩家 obstacle v=0 在同車道前方 → NPC 停下不穿越
  - `lane_change_signals_first`：被慢車擋住的車先進入 `signal` 至少 1 s，d 不變，之後才移動
  - `trucks_stay_right`：truck 永遠不會 targetLane < 2（模擬 60 s 多台）
  - `no_instant_cut`：任何一步 |Δd| ≤ 3.75 / laneChangeTime × 2 × dt（smoothstep 最大斜率 1.5×）
- [ ] FAIL → 實作 → PASS

### Task 4: Spawner

**Files:** Create `src/traffic/spawner.ts`, `tests/spawner.test.ts`

**Interfaces — Produces:**
- `interface SpawnRequest { kind; s; lane }`
- `pickKind(rng): VehicleKind`（car 70% / truck 18% / container 12%）
- `planSpawns(o: { playerS; playerV; raceTime; occupied: {s:number; lane:number; length:number}[]; rng; initial: boolean }): SpawnRequest[]`
  - 前方帶：`[playerS+60, playerS+700]`，目標每車道平均 1 台 / 85 m；`initial=true` 時填滿整個前方帶，否則只在 `playerS+600..700` 補車。
  - 後方帶：`raceTime ≥ 5` 且 `playerV < 25` 時，於 `playerS-220..-180` 補車（每車道 1 台 / 120 m）。
  - 與同車道既有車的頭尾淨距 ≥ 25 m；車種不允許該車道時換車道或改成 car。
- `shouldDespawn(agentS, playerS): boolean`（`agentS < playerS-260 || agentS > playerS+900`）
- [ ] 測試：initial 時沒有任何 `s < playerS+60`；raceTime<5 不生成後方車；同車道淨距 ≥ 25；truck/container 只在車道 2–3；initial 的總數 ≥ 20（確保開局有車流）
- [ ] FAIL → 實作 → PASS

### Task 5: 遊戲規則純模組

**Files:** Create `src/game/gameState.ts`, `src/game/reset.ts`, `src/game/nearMiss.ts`, `src/vehicles/handling.ts`, 對應 tests

**Interfaces — Produces:**
- `type Phase = 'title'|'countdown'|'racing'|'paused'|'finished'`
- `class GameFlow { phase; countdown; raceTime; finishTime: number|null; nearMisses; resetCooldown; best: number|null; constructor(storage: Pick<Storage,'getItem'|'setItem'>); start(); update(dt, playerS): void; togglePause(); canReset(): boolean; markReset(); addNearMiss(); isBest: boolean }` — countdown 3 s；`racing` 才累計 raceTime；`playerS ≥ 10000` → finished、寫入最佳成績（較小者）。
- `formatTime(sec): string` → `"m:ss.mmm"`
- `computeResetSpot(playerS, playerD, blockers: {s; dMin; dMax; length}[]): {s; lane}` — 車道 = `laneAt(playerD)`；從 `playerS` 開始每次往後 5 m，直到該車道 ±12 m（加對方半長）內無 blocker；`s` 不小於 0。
- `detectNearMiss(prevRelS, relS, lateralGap, playerSpeed): boolean` — relS = npcS − playerS 由 >0 變 ≤0，`lateralGap < 1.0` 且 `playerSpeed > 27.8`（100 km/h）。
- `interface HandlingParams { accel; maxSpeed; brake; reverseMax; coast; grip; stunGrip; latAccelMax; maxYawRate; steerRise; steerFall; headingAssist }`
- `stepHandling(st: {vLong; vLat; yaw; yawRate; steer; stun}, input: {throttle; brake; steer}, p, dt): {vLong; vLat; yawRate; steer}` — 縱向：`accel*(1-(v/max)^2)`；側向 `vLat *= exp(-grip*dt)`；目標偏航率 = `steer * min(maxYawRate, latAccelMax/|v|) * min(1,|v|/5)`；無轉向輸入時加上 `-headingAssist*yaw`（|yaw|<0.6）；stun>0 時抓地改 stunGrip、操控 ×0.3。
- [ ] 測試：
  - GameFlow：countdown 期間 raceTime=0；GO 後累計；finished 後 update/start 不改 finishTime；最佳成績只在更快時覆寫；finished 時 `canReset()=false`；冷卻 3 s 內 `canReset()=false`
  - reset：前方 3 m 有車 → 回傳 s ≤ playerS − 5 且淨空；playerS=2 → s ≥ 0；永遠 `s ≤ playerS`
  - nearMiss：越過且貼近 → true；距離 1.5 → false；速度 80 km/h → false；沒越過 → false
  - handling：全油門 5 s 速度 > 27 m/s 且永遠 ≤ maxSpeed；300 km/h 時 full steer 的 |yawRate| ≤ latAccelMax/83.3；放開方向後 yaw 往 0 收斂；側滑速度衰減
- [ ] FAIL → 實作 → PASS

### Task 6: 可駕駛 MVP（物理 + 道路 + 玩家車 + 鏡頭）

**Files:** Create `src/physics/physicsWorld.ts`, `src/world/roadScene.ts`, `src/vehicles/playerCar.ts`, `src/vehicles/models.ts`（玩家車部分）, `src/render/cameraRig.ts`, `src/input/keyboard.ts`, `src/game/game.ts`, `src/main.ts`, `src/styles.css`

**Interfaces — Produces:**
- `PhysicsWorld { world; eventQueue; ownerOf(colliderHandle): EntityRef | undefined; register(collider, ref); step(onContact: (a: EntityRef, b: EntityRef) => void) }`；`EntityRef = {type:'player'} | {type:'npc', id:number} | {type:'static'}`
- 靜態碰撞體：地面 cuboid（s −300..10600）、左右護欄 cuboid（高 1 m）。
- `PlayerCar { body; mesh; s; d; speed; yaw; update(dt, input, params); resetTo(s, lane, speed); stun(sec) }` — 只允許 Y 軸旋轉、friction 0 + CombineRule.Min、CCD、質量約 1300 kg。
- `CameraRig.update(dt, player)` — 追尾（後 8 m、高 3.2 m）、FOV 62→82 隨速度、`shake(amount)`。
- 路景用「以週期吸附位置」技巧：路面 / 草地 / 標線紋理以 20 m 週期吸附玩家位置；燈桿每 50 m、距離牌每 1 km；起跑線 s=0、終點門 s=10000；霧 300–900 m。
- [ ] `npm run dev` → 瀏覽器可開車：W 加速到 300 km/h、A/D 轉向、碰到護欄沿著滑、無 console error（以 chrome-devtools 驗證，用 evaluate_script 派送 keydown/keyup 並讀 `window.__game`）

### Task 7: NPC 車輛與事故

**Files:** Create `src/vehicles/npcVehicle.ts`；Modify `src/vehicles/models.ts`, `src/game/game.ts`

**Interfaces:**
- Consumes: TrafficSim、planSpawns、shouldDespawn、PhysicsWorld.onContact
- Produces: `NpcVehicle { id; kind; bodies; mesh; wrecked; wreckTime; syncFromAgent(agent, dt); wreck(); updateVisual(dt); dispose() }`
  - 行駛中：每步 `linvel = (目標位置 − 目前位置)/dt`（水平），`setRotation(yaw)`、angvel 0、低摩擦。
  - `wreck()`：停止 AI 控制、摩擦 0.9、linearDamping 1.2、angularDamping 1.5；貨櫃車建立 spherical joint（hitch）。從 TrafficSim 移除，改成 Obstacle（用 AABB 換算 dMin/dMax）。
  - 貨櫃車行駛中拖車：`trailerYaw += v/Lt * sin(cabYaw − trailerYaw) * dt`，拖車位置由 hitch 推算；車頭與拖車間隙 0.4 m。
  - 方向燈（signal/move 時 2 Hz 閃）、煞車燈（accel < −1 時亮）。
  - 事故車 12 s 後或落後玩家 260 m 移除；超過 12 台時移除最舊且不在玩家前方的。
- [ ] 瀏覽器驗證：開局前方有車流、NPC 會打方向燈換道、撞擊後 NPC 被撞飛並煞停、後車會煞停或繞過事故、12 s 後消失；60 FPS（performance trace 或 rAF 計數）

### Task 8: 遊戲流程、HUD、音效、調校面板

**Files:** Create `src/ui/hud.ts`, `src/audio/sound.ts`, `src/debug/tuning.ts`；Modify `src/game/game.ts`, `index.html`, `src/styles.css`

- 標題畫面（名稱、操作說明、最佳成績、開始按鈕 / Enter）→ 倒數 3-2-1-GO（倒數中油門無效）→ HUD（時速、時間、剩餘距離、險過次數、R 冷卻）→ 終點結算（時間、是否新紀錄、險過次數、再玩一次）→ Esc 暫停（繼續 / 回標題）。visibilitychange 隱藏時自動暫停。
- 「再玩一次」：清空所有 NPC 與事故車、玩家回起跑線、重新 initial spawn。
- 險過：畫面中央浮出「險過！」並播放提示音。
- 碰撞：碰撞音 + `camera.shake`（力道依相對速度，上限小）+ 玩家 `stun(0.5)`。
- 音效：引擎（鋸齒 + 方波 → lowpass，頻率依假 6 檔轉速）、碰撞（噪音爆發）、險過（濾波噪音掃頻）；AudioContext 在開始按鈕時 resume。
- 調校面板：lil-gui，` 鍵顯示 / 隱藏，含 HandlingParams 與車流密度。
- [ ] 瀏覽器驗證完整流程：標題 → 倒數 → 開到終點（用 `window.__game` 加速驗證：設定玩家 s=9990）→ 結算顯示 → 再玩一次 → 最佳成績保留

### Task 9: 試玩調校與最終驗證

- [ ] `npx vitest run` 全綠、`npx tsc --noEmit` 無錯、`npm run build` 成功
- [ ] 瀏覽器實測：截圖確認畫面、無 console error、一般筆電 60 FPS、穿梭時操控反應（300 km/h 換一個車道約 0.5–0.8 s）
- [ ] 依試玩結果調整預設參數（只改 config）
