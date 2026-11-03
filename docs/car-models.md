# 車輛模型製作流程

做肌肉車（2026-11）時摸索出來、確定可行的做法。下一台車照這份走。
相關：`docs/ai-car-tuning.md`（新車進遊戲後量車、訓練 AI）。

## 0. 先記住的結論

- **不要用程式手刻車身。** 肌肉車先用 Blender 腳本從零放樣，修了十幾輪仍越改越糟。改成「AI 生成車身＋腳本後處理」後，一次就比手刻好。
- **車身交給 Tripo3D，細節交給後處理腳本。** 輪子、燈具、玻璃、塗裝、對稱、尺寸都在腳本裡做，結果可重現，可以一直改。
- **判斷什麼都要看圖。** 每一步都渲染出來看，不要只看數字。檢查玻璃時，把玻璃材質換成藍色渲染最清楚。

## 1. 授權

- 送給 Tripo 的只能是**我們自己的圖**（`docs/art/<car>/` 的概念圖）。
- 別人的模型（例如 Sketchfab 下載的）只能拿來參考比例，**不能**送進 Tripo，不能放進 repo，不能在程式、註解、commit 裡提到。
- Tripo 免費方案的產出是 CC BY 4.0，依其條款權利歸 Tripo；**付費方案**才是權利歸我們、可商用、不用署名。

## 2. 概念圖

- 用 grok 產生三張：前斜角 `front34.jpg`、側面 `side.jpg`（車頭朝左）、後斜角 `rear34.jpg`。提示詞存在 `grok-prompt.txt`。
- 風格：low-poly、單色車漆加條紋、素色灰背景、整台車入鏡。

## 3. 用 Tripo 生成

工具：`tools/models/tripo.py`（只用 Python 標準庫）。

```sh
python tools/models/tripo.py balance
python tools/models/tripo.py multiview docs/art/<car>/front34.jpg docs/art/<car>/side.jpg docs/art/<car>/rear34.jpg -
python tools/models/tripo.py wait <task_id> <scratch 資料夾>
```

- **金鑰**：環境變數 `TRIPO_API_KEY`，Windows 用 `setx` 設定，腳本會從登錄檔讀。這把是 `api.tripo3d.ai` 的 v2 金鑰，新的 v3 網址（`openapi.tripo3d.com`）不收。
- **參數**（寫在腳本裡）：`v3.1-20260211`、`smart_low_poly`、`face_limit 5000`（實際約 5800 面）、`texture` 開、`pbr` 關。每次 40 點。
- **多視角比單張好**：只給 `front34` 時車頭很好，但車尾靠猜，尾燈陽春。三張一起給，順序是前、左、後（右留空），車尾就對了。斜角圖放在「前」「後」的位置也能用。
- 挑一個結果，把 `model.glb` 存成 `tools/models/src/<car>-tripo.glb`（進 repo）。

## 4. 後處理腳本（`tools/models/muscle_car.py` 是範本）

```sh
blender -b --factory-startup -P tools/models/<car>.py -- --out public/models/<car>.glb --preview <scratch 資料夾>
```

腳本依序做這些事，每一步都有做法和踩過的坑：

1. **匯入**：`import_scene.gltf(merge_vertices=True)`。不加的話，glTF 會在 UV 接縫把頂點拆開，整台車會變成幾百個碎塊。
2. **轉向和尺寸**：Tripo 輸出約 1 m 長，車頭朝 +x。先轉成車頭朝 +y、輪胎底在 z=0、原點在前後軸中點。**先在固定尺寸下處理**（肌肉車用 4.25 m 長），最後再整體等比放大到目標寬度。這樣所有量好的常數都不用跟著尺寸改。
3. **左右對稱**：`bmesh.ops.symmetrize(direction="X")`，右半鏡射到左半，中線自動焊接。
4. **拆掉輪胎**：在原始模型上量出四個輪胎的圓柱範圍（軸心、半徑、內外側），把頂點全在範圍內的面刪掉。接著：
   - 刪掉輪胎接地處留下的小碎塊（頂點少於 20 的獨立塊）。
   - 用 `holes_fill` 補輪拱上的洞，新面的 UV 取自旁邊的頂點。
5. **焊掉穿插**（`unfold`）：生成的表面偶爾會摺到自己身上。把每對互相穿插的面裡最近的兩個頂點焊在中點，重複到沒有穿插為止。
6. **修局部造型**（肌肉車是下巴的缺口，用 `build_apron`）：沿著保險桿輪廓做一塊實心補塊，用 exact boolean（`use_hole_tolerant`）合併。
   - **補塊的貼圖要「每個面一個 texel」**，取自離它最近的車身面的顏色。如果每個頂點各取 UV，貼圖會橫跨不同的 UV 島，變成一團花紋。
7. **燈具**：從貼圖找位置。在車頭、車尾打一格一格的射線，每條射線命中處讀貼圖顏色：
   - 大燈：白色命中點分成左右各兩群，每群做一顆圓燈（面積換算半徑）。
   - 尾燈：取「紅色比例高的連續列」裡最長的一段當燈條，不要用百分位數，否則會把上下零星的紅線算進去。做成貼著車身的燈片。
   - 方向燈：前面放在霧燈（白色、較低處）上，後面放在燈條兩端。
   - 燈要比車身表面高一點：先浮起 3 mm，再用 `clear_of` 逐步外推，直到完全不碰車身為止（曲面在兩個取樣點之間會鼓起來）。
   - 燈條尾燈加上自訂屬性 `bar`（匯出要開 `export_extras`），遊戲讀到就不放光暈。
8. **玻璃**（`split_glass`）：
   - 只認貼圖的「玻璃灰」：亮度 0.13～0.25、幾乎沒彩度。**條紋的黑比玻璃更黑（約 0.11）**，絕對不能用「黑色」判斷玻璃，否則會把條紋抓進來。
   - 從面積最大的候選面開始往外長，只接受法線跟它相差 12° 以內的鄰面。這樣車頂、引擎蓋、行李箱上被條紋邊緣弄成灰色的面，就不會黏進窗戶。
   - 驗證方法：把玻璃材質換成藍色，從前、後、側面渲染。
9. **塗裝**（`LIVERIES`、`livery_textures`）：每款塗裝一張完整貼圖。
   - 車漆像素（含它跟黑色之間的過渡）換成該款漆色，純色、不帶 Tripo 的假光影。
   - 朝上的面（引擎蓋、車頂、行李箱、鴨尾翹）上的黑色是條紋，換成條紋色；純色款就換成漆色。
   - 其他部位（水箱罩、燈座、輪拱內側）保留原貼圖。
   - 存成 JPEG，每張約 100～200 KB；PNG 壓不小，因為保留的部位有顆粒。檔案放在 `public/models/<car>/`，另外輸出 `liveries.json`。
10. **著色**：
    - `shade_smooth_by_angle(30°)`，再套 `WEIGHTED_NORMAL`（依面積加權）。不加權的話，生成的細長三角形會把法線拉歪，條紋上出現 X 形亮紋。
    - 每扇窗共用一個法線（`flat_windows`），否則鏡射的左右兩半在中線會有一道亮線。
11. **輪子**：用腳本自己建的輪子（`build_wheel`），不要用生成的，因為遊戲要能轉動。
12. **檢查**（腳本會印出來）：穿插面、破邊、燈具和車身有沒有相碰、車身尺寸、三角形數。

## 5. 比對與驗收

- 預覽圖：前斜角、側面、後斜角跟概念圖並排比，另外看正面、俯視、正側（正交）。
- 修東西時做「修正前｜修正後」的並排圖。也可以逐像素比對渲染，確認只有該改的地方變了。
- 局部問題用特寫加線框：開 WIREFRAME modifier，搭配亮的打光。

## 6. 雜項地雷

- Blender 的 `render.filepath` 要給**絕對路徑**；相對路徑會寫到 `C:\` 根目錄。
- 匯出時 Blender 的 +Y（車頭）會變成 three.js 的 −Z。用 `import_scene.gltf` 讀回 GLB 時，車頭又回到 Blender 的 +Y。
- 用 Blender 讀 8-bit 圖時，`image.pixels` 拿到的是 sRGB 編碼的值。寫貼圖時直接用 0x 色碼除以 255，不要先轉線性。
- 腳本被其他 scratch 腳本 `import` 會產生 `tools/models/__pycache__/`，記得刪。

## 7. 新車清單

1. grok 概念圖三張 → `docs/art/<car>/`
2. `tripo.py multiview` → 挑結果 → `tools/models/src/<car>-tripo.glb`
3. 複製 `muscle_car.py` 成 `<car>.py`，重量 `SRC_TYRES`（輪胎）、`SRC_GROUND`、`WIDTH`、`LIVERIES`；看情況改局部修補（`build_apron`）
4. 跑腳本 → 看預覽 → 修 → commit（`tools/models/`、`public/models/<car>.glb`、`public/models/<car>/`）
5. 遊戲端：`src/vehicles/carModels.ts` 的 `FILES` 加一行，再依 `docs/ai-car-tuning.md` 調物理、訓練 AI
