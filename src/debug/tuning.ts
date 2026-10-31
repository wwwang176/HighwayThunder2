import GUI from 'lil-gui';
import type { HandlingParams } from '../vehicles/handling';
import type { CameraParams } from '../render/cameraRig';

/** Developer tuning panel, toggled with the ` key. Hidden by default. */
export function createTuningPanel(handling: HandlingParams, camera: CameraParams, traffic: { spacing: number }): GUI {
  const gui = new GUI({ title: '調校面板（` 切換）' });
  const h = gui.addFolder('操控');
  h.add(handling, 'accel', 3, 25, 0.5).name('加速度');
  h.add(handling, 'maxSpeed', 40, 110, 0.5).name('極速 m/s');
  h.add(handling, 'brake', 5, 40, 1).name('煞車');
  h.add(handling, 'grip', 2, 80, 1).name('抓地（側滑衰減）');
  h.add(handling, 'latAccelMax', 5, 50, 0.5).name('高速轉向（側向加速度）');
  h.add(handling, 'maxYawRate', 0.3, 3, 0.05).name('低速轉向角速度');
  h.add(handling, 'steerRise', 1, 20, 0.5).name('轉向上升速度');
  h.add(handling, 'steerFall', 1, 30, 0.5).name('轉向回正速度');
  h.add(handling, 'headingAssist', 0, 10, 0.1).name('自動回正');
  h.add(handling, 'yawResponse', 2, 40, 1).name('偏航反應');
  h.add(handling, 'stunGrip', 0.1, 10, 0.1).name('撞擊後抓地');
  const c = gui.addFolder('鏡頭');
  c.add(camera, 'distance', 4, 16, 0.1).name('距離');
  c.add(camera, 'height', 1, 8, 0.1).name('高度');
  c.add(camera, 'lookAhead', 4, 40, 1).name('前視距離');
  c.add(camera, 'fovMin', 40, 90, 1).name('FOV 最小');
  c.add(camera, 'fovMax', 50, 110, 1).name('FOV 最大');
  c.add(camera, 'lateralTau', 0.01, 0.5, 0.01).name('橫向平滑');
  c.add(camera, 'yawFollow', 0, 1, 0.05).name('跟隨車身轉向');
  const t = gui.addFolder('車流');
  t.add(traffic, 'spacing', 30, 250, 1).name('同車道平均間距 m');
  gui.hide();
  return gui;
}
