# Highway Thunder 2

網頁 3D 高速公路穿梭賽車：在 4 線道直線高速公路上閃避一般車輛、貨車、貨櫃車，以最短時間跑完 10 公里。

## 執行

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 單元測試（vitest）
npm run build    # 型別檢查 + 正式版建置到 dist/
```

## 操作

| 按鍵 | 功能 |
|---|---|
| W / ↑ | 油門 |
| S / ↓ | 煞車 / 倒車 |
| A D / ← → | 轉向 |
| C | 按住看正後方 |
| R | 重置回車道（只會往後、冷卻 3 秒） |
| Esc | 暫停 |
| M | 靜音 |
| Enter | 開始 / 再玩一次 |
| ` | 開發用調校面板（操控、鏡頭、車流密度） |

## 架構

- `src/traffic/` — 純邏輯交通模擬：IDM 跟車、MOBIL 換道（含方向燈預告）、生成 / 回收
- `src/game/` — 遊戲流程、計時、最佳成績、R 重置位置、險過判定、主迴圈 `game.ts`
- `src/vehicles/` — 玩家街機操控（`handling.ts` 純函式）、NPC 剛體與事故、程式產生的車輛模型
- `src/physics/` — Rapier 世界與碰撞群組（行駛中 NPC 彼此不碰撞，連環車禍只經由事故車傳遞）
- `src/world/`、`src/render/`、`src/ui/`、`src/audio/` — 場景、追尾鏡頭、HUD、Web Audio 音效

設計文件：`docs/superpowers/specs/2026-10-31-highway-thunder-design.md`

除錯：瀏覽器主控台可用 `__game.simulate(秒數, 輸入)` 同步推進模擬。
