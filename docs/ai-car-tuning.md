# 新增或調整車輛時，AI 要做的事

AI 對手開車靠兩部分：

- **規劃器**（`src/ai/planner.ts`）：搜尋最快又不撞的路線。它要知道「這台車做得到多少」：加速度、煞車力、側向抓地力。
- **方向盤神經網路**（`src/ai/netTracker.ts`）：照著路線開，在原本的方向盤公式上加修正。它是**針對單一車種訓練**的，學的是那台車的轉向反應。

這些資料都放在車輛設定 `CarSpec.ai` 裡（街頭跑車：`src/vehicles/cars/streetRacer.ts`）：

| 欄位 | 內容 | 來源 |
|---|---|---|
| `accel` | 各車速的全油門加速度（m/s²） | 量車（步驟 A） |
| `brake` | 全煞車減速度（m/s²） | 量車（步驟 A） |
| `latAccel` | 各車速的全舵側向加速度（m/s²），規劃器的橫移極限 | 量車（步驟 A） |
| `tracker` | 方向盤神經網路的權重 | 訓練（步驟 B），存在 `streetRacerTracker.ts` |

沒有 `tracker` 的車，方向盤自動改用原本的公式（Stanley）。能開，只是大幅橫移後外拋比較多。

## 什麼時候要做什麼

| 改了什麼 | A 量車 | B 訓練網路 | C 跑分驗收 |
|---|---|---|---|
| 新增車種 | 要 | 要 | 要 |
| 轉向手感：抓地力、輪胎、方向盤反應速度（`steerRise` 等）、懸吊、防傾桿、重心、下壓力 | 要 | 要 | 要 |
| 馬力、扭力、極速、煞車力 | 要 | 不用 | 建議 |
| 外觀、顏色、音效、燈光 | 不用 | 不用 | 不用 |
| 規劃器設定：格子 `step`、`cellsPerLane`、`latGrip` | 不用 | 建議（網路是用這種路線形狀練的） | 要 |

不確定的話就三步都做：A 約 1 秒，B 約 20 分鐘，C 約 15～20 分鐘。

## 步驟 A：量車

```bash
CAR=street-racer npx vitest run --config training/vitest.config.ts training/measureCar.train.ts
```

- `CAR` 是車輛的 `id`（`src/vehicles/cars/index.ts` 的 `CARS` 清單）。
- 會印出一段 `ai: { accel: [...], brake: ..., latAccel: [...] }`，貼進該車的 `CarSpec.ai`，取代舊的數字。保留 `tracker` 那一行。
- `latAccel` 是在沒有護欄的空地上全舵 1.5 秒量出來的，表格要包含 0 km/h 那一列（用 50 km/h 的值）。
- 加速度每次量會有 ±0.5 m/s² 左右的差異。街頭跑車目前的 `accel` 刻意保留了舊值，因為跑分比較好（見 `streetRacer.ts` 的註解）。差異小時可以不換。

## 步驟 B：訓練方向盤神經網路

```bash
GENS=40 POP=60 SCENARIOS=8 SIGMA=0.15 SAVE=1 npx vitest run --config training/vitest.config.ts training/tracker.train.ts
```

- **一定要加 `SAVE=1`**，否則跑完不會留下任何結果。
- 每 5 代用固定的 8 個驗證情境評分。分數比之前最好的低（越低越好）就**立刻存檔**到 `src/vehicles/cars/streetRacerTracker.ts`，所以中途停掉也不會白跑。
- 輸出怎麼看：
  - 第一行 `plain tracker on validation: cost 0.5841, rms 0.260 m, p95 0.55, max 1.23`：原本公式的成績，用來對照。
  - `validation 0.4098 (rms 0.21 m, p95 0.48 ...) saved`：神經網路的成績，`saved` 表示這次有存檔。
  - 街頭跑車大約 30 代就到頂（0.584 → 0.410）。若 40 代後明顯沒比原本公式好，代表訓練設定有問題，不要拿去用。
- 想從目前的網路接著練（例如手感只微調）：加 `CONTINUE=1`。
- 訓練用的路線形狀照目前的 `PLANNER` 設定（0.25 秒、1/8 車道、`latGrip` 1）。若規劃器設定改過，用 `PLANNER_JSON='{...}'` 帶入同樣的設定再訓練。
- 時間：單獨跑約 20 分鐘；同時有其他跑分在搶 CPU 時會慢到約 2 倍。

## 步驟 C：跑分驗收

30 場 × 5 km，撞車就以 60 km/h 放回路上繼續跑。這台電腦記憶體有限，**最多同時 4 個程序**：

```bash
for seeds in 7001,7002,7003,7004,7005,7006,7007 7008,7009,7010,7011,7012,7013,7014,7015 \
             7016,7017,7018,7019,7020,7021,7022 7023,7024,7025,7026,7027,7028,7029,7030; do
  EVAL_SEEDS=$seeds RESET_ON_CRASH=60 npx vitest run --config training/vitest.config.ts training/planner.train.ts > bench.$seeds.log 2>&1 &
done; wait
```

- 每場一行：`FINISH 98s ... light contacts N, resets N`。
- 要比較的數字：
  - 30 場平均完賽時間；
  - `resets` 總和（撞車次數）；
  - `light contacts` 總和（輕擦）；
  - `tracker alone ... moving` 的 p95（方向盤跟路線的偏離，越小越好）。
- 想跟原本的公式比：加 `NET_TRACKER=0` 會關掉網路。要試其他規劃設定：`PLANNER_JSON='{"sideMargin":0.05}'`。
- 街頭跑車目前的基準（2026-11-02）：

| 設定 | 平均完賽 | 撞車重置 | 輕擦 | 橫移時偏離 p95 |
|---|---|---|---|---|
| 物理極限規劃＋神經網路（預設） | 98.3 秒 | 10 | 6 | 0.27 m |
| 物理極限規劃＋原本公式 | 100.2 秒 | 15 | 18 | 0.40 m |
| 標準 0.5 秒格子（穩） | 101.1 秒 | 2 | 1 | － |

新數字明顯比預設那一列差（例如撞車多出一倍），就回頭檢查步驟 A 的數字有沒有貼對，再重新訓練。

## 步驟 D：遊戲中確認

1. 重新整理遊戲（http://localhost:5199），按 ` 打開調校面板。
2. 在「AI 駕駛」資料夾裡：
   - 「規劃格子」選單切換整組設定（含方向盤用網路或公式）；
   - 「方向盤用神經網路」勾選框可以單獨開關，用來對照。
3. 觀察鑽縫後會不會外拋、大幅換道時車身穩不穩，以及畫面順不順（規劃每次約 60 ms，在背景執行緒計算）。

## 新增車種時目前要手動改的地方

現在只有街頭跑車一台車，下面幾處都是寫死給它用的。加第二台車時要一起改：

- `training/tracker.train.ts`：
  - 訓練用的車是 `new PlayerCar(physics, null)`，也就是預設的街頭跑車。要改成依 `CAR` 參數選車。
  - 存檔路徑寫死為 `src/vehicles/cars/streetRacerTracker.ts`。要改成每台車各自一個權重檔，例如 `<車名>Tracker.ts`。
  - `CONTINUE=1` 讀的是 `STREET_RACER.ai.tracker`。
- `src/ai/trainingSim.ts`（步驟 C 跑分用）：建立車輛時用預設車種，要能指定車種。
- `src/game/rivals.ts`：對手的車種是建構時傳入的 `spec`（預設街頭跑車）。換車種時，`accel`、`latAccel`、`tracker` 會跟著那台車的 `CarSpec.ai` 走，不用另外改。
- `src/ai/plannerDriver.ts`：`PlannerDriver` 的預設值是街頭跑車的表格。新車要像 `rivals.ts` 一樣，在建立後把 `accel`、`latAccel`、`tracker` 設成該車的。

做法：先把新車加進 `src/vehicles/cars/index.ts` 的 `CARS`，把上面幾處改成依車種參數運作，再依序做 A → B → C → D。
