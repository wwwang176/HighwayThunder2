import GUI from 'lil-gui';
import type { CarParams } from '../vehicles/handling';
import type { CameraParams } from '../render/cameraRig';

/** Developer tuning panel, toggled with the ` key. Hidden by default. */
export function createTuningPanel(car: CarParams, camera: CameraParams, traffic: { spacing: number }): GUI {
  const gui = new GUI({ title: '調校面板（` 切換）' });
  const d = gui.addFolder('動力 / 轉向');
  d.add(car, 'power', 100_000, 800_000, 10_000).name('馬力 W');
  d.add(car, 'maxDriveForce', 3_000, 20_000, 100).name('最大驅動力 N');
  d.add(car, 'maxSpeed', 40, 110, 0.5).name('極速 m/s');
  d.add(car, 'throttleRise', 1, 30, 0.5).name('油門踩下速度');
  d.add(car, 'brakeForceMax', 5_000, 40_000, 500).name('煞車力 N');
  d.add(car, 'brakeFrontBias', 0.3, 0.9, 0.01).name('前輪煞車比例');
  d.add(car, 'dragK', 0, 2, 0.01).name('風阻係數');
  d.add(car, 'downforceK', 0, 2, 0.01).name('下壓力係數');
  d.add(car, 'maxSteer', 0.1, 0.8, 0.01).name('前輪最大轉角');
  d.add(car, 'latAccelLimit', 5, 60, 0.5).name('高速轉向極限');
  d.add(car, 'steerRise', 1, 20, 0.5).name('轉向上升速度');
  d.add(car, 'steerFall', 1, 30, 0.5).name('轉向回正速度');
  const s = gui.addFolder('懸吊 / 輪胎');
  s.add(car, 'suspensionRest', 0.1, 0.6, 0.01).name('懸吊長度');
  s.add(car, 'suspensionTravel', 0.05, 0.4, 0.01).name('懸吊行程');
  s.add(car, 'springK', 10_000, 120_000, 1_000).name('彈簧 N/m');
  s.add(car, 'damperBump', 500, 12_000, 100).name('壓縮阻尼');
  s.add(car, 'damperRebound', 500, 12_000, 100).name('回彈阻尼');
  s.add(car, 'antiRollFront', 0, 60_000, 1_000).name('前防傾桿');
  s.add(car, 'antiRollRear', 0, 60_000, 1_000).name('後防傾桿');
  s.add(car, 'rearGrip', 0.7, 1.5, 0.01).name('後輪抓地倍率');
  s.add(car, 'muPeak', 0.5, 2, 0.01).name('輪胎抓地（臨界）');
  s.add(car, 'muSlide', 0.3, 1.5, 0.01).name('輪胎抓地（滑動）');
  s.add(car, 'slipAnglePeak', 0.04, 0.3, 0.005).name('側滑角臨界 rad');
  s.add(car, 'wheelInertia', 0.3, 5, 0.1).name('輪子慣量');
  const c = gui.addFolder('鏡頭');
  c.add(camera, 'distance', 4, 16, 0.1).name('距離');
  c.add(camera, 'height', 1, 8, 0.1).name('高度');
  c.add(camera, 'lookAhead', 4, 40, 1).name('前視距離');
  c.add(camera, 'fovMin', 40, 90, 1).name('FOV 最小');
  c.add(camera, 'fovMax', 50, 110, 1).name('FOV 最大');
  c.add(camera, 'yawTau', 0.02, 1, 0.01).name('轉向跟隨延遲 s');
  const t = gui.addFolder('車流');
  t.add(traffic, 'spacing', 30, 250, 1).name('同車道平均間距 m');
  gui.hide();
  return gui;
}
