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
  d.add(car, 'brakeDecel', 3, 20, 0.5).name('煞車減速度');
  d.add(car, 'dragK', 0, 2, 0.01).name('風阻係數');
  d.add(car, 'downforceK', 0, 2, 0.01).name('下壓力係數');
  d.add(car, 'maxSteer', 0.1, 0.8, 0.01).name('前輪最大轉角');
  d.add(car, 'latAccelLimit', 5, 50, 0.5).name('高速轉向極限（側向加速度）');
  d.add(car, 'steerRise', 1, 20, 0.5).name('轉向上升速度');
  d.add(car, 'steerFall', 1, 30, 0.5).name('轉向回正速度');
  const s = gui.addFolder('懸吊 / 輪胎');
  s.add(car, 'suspensionRest', 0.1, 0.6, 0.01).name('懸吊長度');
  s.add(car, 'suspensionTravel', 0.05, 0.4, 0.01).name('懸吊行程');
  s.add(car, 'suspensionStiffness', 5, 100, 1).name('彈簧剛性');
  s.add(car, 'suspensionCompression', 0.1, 10, 0.1).name('壓縮阻尼');
  s.add(car, 'suspensionRelaxation', 0.1, 10, 0.1).name('回彈阻尼');
  s.add(car, 'frictionSlip', 0.5, 10, 0.1).name('輪胎抓地');
  s.add(car, 'sideFrictionStiffness', 0.1, 3, 0.05).name('側向剛性');
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
