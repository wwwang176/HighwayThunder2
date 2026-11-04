import GUI from 'lil-gui';
import type { CarParams } from '../vehicles/handling';
import type { CameraParams } from '../render/cameraRig';
import { WRECK_TRIP } from '../vehicles/npcVehicle';
import { NIGHT } from '../world/roadScene';
import { NPC_BEAM } from '../render/npcBeams';
import { HEADLIGHTS } from '../vehicles/headlight';
import { POST } from '../render/postFx';
import { PLANNER } from '../ai/planner';
import { DRIVER_TUNING } from '../ai/plannerDriver';
import { RIVAL_TUNING } from '../game/rivals';
import { RIVAL_LIGHTS } from '../game/rivalLights';
import { HUD_SHAKE, RESET_HINT } from '../ui/hudMath';
import { CONTACT_TUNING } from '../game/contact';

/** Developer tuning panel, toggled with the ` key. Hidden by default. */
export function createTuningPanel(car: CarParams, camera: CameraParams, traffic: { spacing: number }, ai: { speedCapKmh: number }): GUI {
  const gui = new GUI({ title: '調校面板（` 切換）' });
  const d = gui.addFolder('動力 / 轉向');
  d.add(car, 'power', 100_000, 800_000, 10_000).name('馬力 W');
  d.add(car, 'maxDriveForce', 3_000, 20_000, 100).name('最大驅動力 N');
  d.add(car, 'maxSpeed', 40, 110, 0.5).name('極速 m/s');
  d.add(car, 'throttleRise', 1, 30, 0.5).name('油門踩下速度');
  d.add(car, 'brakeForceMax', 5_000, 40_000, 500).name('煞車力 N');
  d.add(car, 'brakeFrontBias', 0.3, 0.9, 0.01).name('前輪煞車比例');
  d.add(car, 'frontBrakeApart').name('重踩煞車前輪仍可轉向');  d.add(car, 'dragK', 0, 2, 0.01).name('風阻係數');
  d.add(car, 'downforceK', 0, 2, 0.01).name('下壓力係數');
  d.add(car, 'maxSteer', 0.1, 0.8, 0.01).name('前輪最大轉角');
  d.add(car, 'steerRise', 1, 20, 0.5).name('轉向上升速度');
  d.add(car, 'steerFall', 1, 30, 0.5).name('轉向回正速度');
  d.add(car, 'counterSteer', 0, 1, 0.05).name('放開方向鍵時跟隨滑行方向');
  d.add(car, 'escGain', 0, 30000, 500).name('車身穩定控制 ESC（0 = 關）');
  const s = gui.addFolder('懸吊 / 輪胎');
  s.add(car, 'suspensionRest', 0.1, 0.6, 0.01).name('懸吊長度');
  s.add(car, 'suspensionTravel', 0.05, 0.4, 0.01).name('懸吊行程');
  s.add(car, 'springProgressFrom', 0.3, 1, 0.01).name('彈簧從行程幾成開始變硬（1 = 線性）');
  s.add(car, 'springProgressMult', 1, 10, 0.1).name('行程到底時硬幾倍');
  s.add(car, 'springK', 10_000, 120_000, 1_000).name('彈簧 N/m');
  s.add(car, 'damperBump', 500, 12_000, 100).name('壓縮阻尼');
  s.add(car, 'damperRebound', 500, 12_000, 100).name('回彈阻尼');
  s.add(car, 'antiRollFront', 0, 60_000, 1_000).name('前防傾桿');
  s.add(car, 'antiRollRear', 0, 60_000, 1_000).name('後防傾桿');
  s.add(car, 'rearGrip', 0.7, 1.5, 0.01).name('後輪抓地倍率');
  s.add(car, 'aeroGrip', 0, 1.5, 0.01).name('氣動抓地（飽和時多幾成）');
  s.add(car, 'aeroGripTo', 100, 300, 1).name('氣動抓地飽和速度 km/h');
  s.add(car, 'rollRefKmh', 50, 300, 1).name('此速度以上側傾隨抓地減少 km/h');
  s.add(car, 'rollInfluence', 0, 1, 0.01).name('車身傾斜（翻滾力矩比例）');
  s.add(car, 'muPeak', 0.5, 2, 0.01).name('輪胎抓地（臨界）');
  s.add(car, 'muSlide', 0.3, 1.5, 0.01).name('輪胎抓地（滑動）');
  s.add(car, 'slipAnglePeak', 0.04, 0.3, 0.005).name('側滑角臨界 rad');
  s.add(car, 'wheelInertia', 0.3, 5, 0.1).name('輪子慣量');
  s.add(car, 'slipFalloff', 1, 30, 0.5).name('滑動摩擦衰減 m/s');
  s.add(car, 'lsd', 0, 600, 10).name('限滑差速器');
  d.add(car, 'engineTorque', 150, 900, 5).name('引擎扭力 N·m');
  const c = gui.addFolder('鏡頭');
  c.add(camera, 'distance', 4, 16, 0.1).name('距離');
  c.add(camera, 'height', 1, 8, 0.1).name('高度');
  c.add(camera, 'lookAhead', 4, 40, 1).name('前視距離');
  c.add(camera, 'fovMin', 40, 90, 1).name('FOV 最小');
  c.add(camera, 'fovMax', 50, 110, 1).name('FOV 最大');
  c.add(camera, 'yawTau', 0.02, 1, 0.01).name('轉向跟隨延遲 s');
  c.add(camera, 'bob', 0, 0.05, 0.0005).name('路面上下震動 m');
  c.add(camera, 'bobFrom', 0, 1, 0.01).name('路面震動：最高速的幾成開始');
  c.add(camera, 'bobFull', 0, 1, 0.01).name('路面震動：最高速的幾成最大');
  c.add(camera, 'bobHz', 0, 20, 0.5).name('路面震動頻率：起始');
  c.add(camera, 'bobHzPerKmh', 0, 0.5, 0.01).name('路面震動頻率：每 km/h 增加');
  c.add(camera, 'bobHzMax', 1, 40, 1).name('路面震動頻率：上限');
  const n = gui.addFolder('夜晚燈光');
  n.add(NIGHT, 'lampIntensity', 0, 3000, 10).name('路燈亮度（近處真實光源）');
  n.add(NIGHT, 'poolStrength', 0, 2, 0.05).name('路燈光區亮度（遠處）');
  n.add(NPC_BEAM, 'intensity', 0, 20, 0.1).name('NPC 車燈照地亮度');
  n.add(NIGHT, 'wetness', 0, 1, 0.05).name('路面濕區（0 = 乾）');
  n.add(NIGHT, 'rim', 0, 2, 0.05).name('前方城市背光');
  n.add(POST, 'antialias', { 'FXAA（最省）': 'fxaa', 'SMAA（較銳利）': 'smaa', 'MSAA 4 倍（最慢）': 'msaa', '關': 'none' }).name('抗鋸齒');
  n.add(POST, 'bloom').name('光暈');
  n.add(POST, 'strength', 0, 2, 0.05).name('光暈強度');
  n.add(POST, 'radius', 0, 1, 0.05).name('光暈範圍');
  n.add(POST, 'threshold', 0, 3, 0.05).name('光暈門檻（亮過多少才發光）');
  n.add(POST, 'speedBlur').name('速度模糊');
  n.add(POST, 'blurFrom', 0, 300, 5).name('速度模糊：從幾 km/h 開始');
  n.add(POST, 'blurFull', 100, 400, 5).name('速度模糊：幾 km/h 最強');
  n.add(POST, 'blurStrength', 0, 0.2, 0.005).name('速度模糊：強度');
  n.add(POST, 'blurNitro', 1, 3, 0.1).name('速度模糊：氮氣時倍率');
  n.add(POST, 'blurTurn', 0, 3, 0.1).name('速度模糊：鏡頭轉動拖曳倍率');
  n.add(POST, 'bloomScale', { '原本（1）': 1, '一半（0.5，省）': 0.5, '四分之一（0.25）': 0.25 }).name('光暈內部解析度');
  const t = gui.addFolder('車流');
  t.add(traffic, 'spacing', 30, 250, 1).name('同車道平均間距 m');
  t.add(WRECK_TRIP, 'car', 1, 6, 0.1).name('事故轎車橫滑翻車摩擦');
  t.add(WRECK_TRIP, 'truck', 0.8, 4, 0.1).name('事故貨車橫滑翻車摩擦');
  const a = gui.addFolder('AI 駕駛');
  a.add(ai, 'speedCapKmh', 150, 300, 5).name('AI 最高時速 km/h（強度）');
  a.add(PLANNER, 'gapAhead', 0, 10, 0.5).name('跟車：保險桿距離 m');
  a.add(PLANNER, 'headway', 0, 1.5, 0.05).name('跟車：再加車速 × 秒');
  a.add(PLANNER, 'gapBehind', 0, 15, 0.5).name('切入：留給後車距離 m');
  // How finely the plan is cut: S-lines and gaps against swinging past (all the AI cars, from their next plan).
  // Each with the side room it was measured with (30 x 5 km, a crash putting it back at 60 km/h;
  // hits judged by closing speed along the contact). maxLateralChange only counts with maxLateral > 1.
  const old = { cellsPerLane: 4, latGrip: 0 };
  const grids: Record<string, [Partial<typeof PLANNER>, boolean]> = {
    '物理極限＋神經網路控制': [{ step: 0.25, cellsPerLane: 8, latGrip: 1, maxLateral: 6, sideMargin: 0.15, swingMargin: 0.1 }, true], // 98.3 s, 10 resets
    '物理極限＋原本控制': [{ step: 0.25, cellsPerLane: 8, latGrip: 1, maxLateral: 6, sideMargin: 0.15, swingMargin: 0.1 }, false], // 100.2 s, 15
    '細 0.25 秒・衝一半＋多留側距': [{ ...old, step: 0.25, maxLateral: 1, maxLateralChange: 2, sideMargin: 0.15, swingMargin: 0.1 }, false], // 101.8 s, 25
    '細 0.25 秒・衝一半': [{ ...old, step: 0.25, maxLateral: 1, maxLateralChange: 2, sideMargin: 0.05, swingMargin: 0.05 }, false], // 102.6 s, 42
    '細 0.25 秒＋猛（很衝）': [{ ...old, step: 0.25, maxLateral: 2, maxLateralChange: 2, sideMargin: 0.05, swingMargin: 0.05 }, false], // 108.4 s, 153 (old rule: any 15 km/h)
    '標準 0.5 秒（穩）': [{ ...old, step: 0.5, maxLateral: 3, maxLateralChange: 2, sideMargin: 0.05, swingMargin: 0.1 }, false], // 101.1 s, 2
  };
  const grid = { choice: Object.keys(grids)[0] };
  a.add(grid, 'choice', Object.keys(grids))
    .name('規劃格子')
    .onChange((k: string) => {
      Object.assign(PLANNER, grids[k][0]);
      DRIVER_TUNING.netTracker = grids[k][1];
      a.controllersRecursive().forEach((c) => c.updateDisplay());
    });
  a.add(DRIVER_TUNING, 'netTracker').name('方向盤用神經網路（關：原本的公式）');
  a.add(PLANNER, 'lookBehind').name('換道看後方（關：完全不管後車）');
  a.add(PLANNER, 'diagonal').name('斜線換道（關：換道整步佔滿橫向寬度）');
  a.add(PLANNER, 'steerClear').name('閃開前車（開：靠轉向不靠煞車）');
  a.add(PLANNER, 'cutInTime', 0, 1.5, 0.05).name('切入：再加後車追近速度 × 秒');
  a.add(PLANNER, 'sideMargin', 0, 1, 0.05).name('並行：側向留距 m');
  a.add(PLANNER, 'swingMargin', 0, 1, 0.05).name('橫移時往移動側再多留 m');
  a.add(PLANNER, 'hardBrake', 4, 12, 0.5).name('規劃最大煞車 m/s²');
  a.add(PLANNER, 'brakeCost', 0, 10, 0.1).name('不愛煞車（每減 1 m/s 扣 m）');
  a.add(DRIVER_TUNING, 'emergencyFrom', 2, 12, 0.5).name('緊急煞車介入：需減速 m/s² 以上');
  const rl = gui.addFolder('對手車燈');
  rl.add(RIVAL_LIGHTS, 'real').name('真的車燈（關：全部畫在路面）');
  rl.add(RIVAL_LIGHTS, 'shadowRange', 0, 100, 5).name('幾 m 內有陰影');
  rl.add(RIVAL_LIGHTS, 'fade', 1, 50, 1).name('超出後幾 m 淡出');
  rl.add(HEADLIGHTS, 'pair', 0, 1200, 10).name('車燈亮度 cd（玩家與對手；216 ≈ 路人車）');
  const r = gui.addFolder('電腦對手（橡皮筋）');
  r.add(RIVAL_TUNING, 'boostFrom', 0, 300, 10).name('落後幾 m 開始加強');
  r.add(RIVAL_TUNING, 'boostFull', 50, 800, 10).name('落後幾 m 加到最強');
  r.add(RIVAL_TUNING, 'maxBoost', 0, 1, 0.05).name('最多加強（抓地＋引擎）');
  r.add(RIVAL_TUNING, 'waitFrom', 50, 600, 10).name('領先幾 m 開始等');
  r.add(RIVAL_TUNING, 'waitFull', 100, 1000, 10).name('領先幾 m 等到最慢');
  r.add(RIVAL_TUNING, 'waitSpeed', 0.5, 1, 0.05).name('等待時速度 × 玩家車速');
  r.add(RIVAL_TUNING, 'teleportBehind', 100, 2000, 50).name('落後幾 m 拉回玩家附近');
  r.add(RIVAL_TUNING, 'placeBehind', 10, 200, 5).name('拉回到玩家後方幾 m（玩家車速）');
  r.add(RIVAL_TUNING, 'teleportAhead', 200, 2000, 50).name('領先幾 m 拉回玩家前方');
  r.add(RIVAL_TUNING, 'placeAhead', 30, 300, 10).name('拉回到玩家前方幾 m（玩家車速）');
  r.add(RIVAL_TUNING, 'resetClear', 0, 500, 10).name('卡住／打轉離玩家幾 m 外才重置');
  const h = gui.addFolder('R 重置提示');
  h.add(RESET_HINT, 'stoppedKmh', 0, 30, 1).name('低於幾 km/h 算停住');
  h.add(RESET_HINT, 'stoppedSeconds', 0, 10, 0.5).name('停住幾秒後出現');
  h.add(RESET_HINT, 'flippedUpY', -1, 1, 0.05).name('車頂朝上低於多少算翻車（1 正、0 側、-1 倒）');
  h.add(RESET_HINT, 'flippedSeconds', 0, 5, 0.25).name('翻車幾秒後出現');
  const hs = gui.addFolder('HUD 震動');
  hs.add(HUD_SHAKE, 'move', 0, 40, 1).name('跟鏡頭位移（vw / m）');
  hs.add(HUD_SHAKE, 'tilt', 0, 1, 0.05).name('跟鏡頭傾斜（比例）');
  hs.add(HUD_SHAKE, 'maxMove', 0, 4, 0.1).name('最多位移 vw');
  hs.add(HUD_SHAKE, 'maxTilt', 0, 5, 0.1).name('最多傾斜（度）');
  const k = gui.addFolder('碰撞');
  k.add(CONTACT_TUNING, 'npcWreckSpeed', 0, 30, 0.5).name('撞進 NPC 多快才失控（m/s，只算撞擊方向，側擦不算超車速度）');
  gui.hide();
  return gui;
}
