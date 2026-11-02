# 車庫＋新 HUD 套用到遊戲 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 `lab/ui-garage.html`、`lab/ui-hud.html` 的草案（使用者已確認）做進遊戲：車庫取代標題畫面與賽前設定頁，比賽 HUD 換新，難易度與對手 0～5 台接上 AI。

**Architecture:** 車庫是 `src/ui/garage.ts`（DOM＋自己的小 three.js 預覽），在 `title` 階段蓋在遊戲上，開著時遊戲本身不渲染。比賽設定（對手、難易度、天氣）在 `src/game/carSelection.ts` 一個純資料模型裡，存在 `localStorage`。難易度是 `src/game/difficulty.ts` 的一張表，開賽時套到 AI。HUD 仍是 `src/ui/hud.ts`，版面照草案重寫，計算放純函式。

**Tech Stack:** TypeScript、three、@floating-ui/dom、vitest。

**Spec:** 使用者在對話中確認的草案：`lab/ui-garage.html`、`lab/ui-hud.html`（commit f6c8d80）。

## Global Constraints

- 沒有說明性文字：只留遊戲名稱、車名、數值與單位、名次、「開始比賽」與事件提示（例如「超車！」）。說明用圖示加 hover／focus 提示（`data-tip`）。
- 能力只有三項：加速、極速、操控（不顯示「穩定」）。HUD 不顯示與最佳紀錄的差距（每局獨立）。
- 對手 0～5 台，靠左排列，只有一個「＋」；全部隨機／全部同我只換車種、不改台數。
- 天氣只有晴夜可選；雨夜、霧夜顯示但不可按，提示「即將推出」。
- 對手欄：顏色＝哪個對手（頂端色條＋編號），車種＝白色剪影＋車名；摘要卡依車種統計（剪影 ×數量）。
- 圖示一律白色透明 PNG（`icons_to_png.py` 處理過），用 mask 上色。
- 單元測試只測純邏輯；檔案用 Edit 修改。

## 我的決定（回報給使用者）

- 難易度表（「普通」＝目前的遊戲，預設值）：

  | 難易度 | AI 最高時速 | 橡皮筋最多加強 | 領先時等待速度 |
  |---|---|---|---|
  | 簡單 | 240 km/h | 10 % | 0.8 × 玩家 |
  | 普通 | 300 km/h | 25 % | 0.9 × 玩家 |
  | 困難 | 300 km/h | 40 % | 1.0 × 玩家 |
  | 極限 | 300 km/h | 60 % | 不等（1.1 × 玩家） |

- 結算畫面按鈕改為「再一場」（同樣設定直接開賽）與「回車庫」；不再顯示最佳成績。暫停畫面「回標題」改「回車庫」。
- 舊標題畫面上的操作鍵說明，改成車庫右上角的鍵盤圖示，點開才顯示（說明藏進彈出視窗）。
- 車庫開著時遊戲世界不渲染（只渲染車庫預覽），省顯示卡。

## Tasks

1. **資料模型與難易度**（`carSelection.ts`、`difficulty.ts`）：`CarSelection { player, rivals (0–5), difficulty (0–3), weather: 'clear' }`，`sanitize` 處理舊存檔（5 台對手、無難易度）；`addRival`、`removeRival`、`allRandom`、`allSameAsPlayer`；`DIFFICULTIES` 與 `applyDifficulty(level, aiSettings, rivalTuning)`。測試先行。
2. **素材與提示**：`lab/ui-assets/*.png` 與 `garage-bg.jpg` 移到 `public/ui/`；`lab/tooltip.ts` 移到 `src/ui/tooltip.ts`；grok 生成鍵盤圖示。
3. **車庫**（`src/ui/garage.ts`＋樣式）：照草案；3D 預覽用 `buildCar`；比賽設定彈出視窗；操作說明彈出視窗；Enter 開賽、Esc 關視窗、←→ 換車。取代 `SetupPanel` 與標題面板；`Game` 在 `title` 階段顯示車庫並停止渲染世界。結算與暫停按鈕照上表。瀏覽器實測。
4. **HUD**：時間、賽道進度（每台車一個點）、名次＋終點旗＋剩餘距離、險過、轉速錶＋換檔燈＋速度＋檔位、超車提示、後方逼近箭頭。純函式（換檔燈數、超車判斷、後方最近對手）測試先行。瀏覽器實測。
5. **收尾**：移除 `setupPanel.ts`、舊標題與舊 HUD 樣式；全部測試；FPS 比較；整體審查。
