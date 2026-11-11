import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { MAX_FRAME_DT, PHYSICS_DT } from '../config';
import { serializeDriver } from '../ai/driverFile';
import { Trainer } from '../ai/trainer';
import { CameraRig } from '../render/cameraRig';
import { LightFlares, updateFlareScale } from '../render/lightFlares';
import { NpcBeams } from '../render/npcBeams';
import { BodyInstances } from '../render/bodyInstances';
import { RoadScene } from '../world/roadScene';
import { GhostView } from './ghostView';
import { TrainPanel } from './trainPanel';

/** Longest a frame may spend simulating (ms), so the page stays responsive at any speed. */
const SIM_BUDGET_MS = 25;
/** Validation of past generations uses what is left of this per frame (ms). */
const FRAME_BUDGET_MS = 32;

async function boot() {
  await RAPIER.init();
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  document.getElementById('app')!.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 3000);
  const rig = new CameraRig(camera);
  const road = new RoadScene(scene, renderer);
  const flares = new LightFlares(scene);
  const beams = new NpcBeams();
  for (const m of road.groundMaterials) beams.patch(m);
  const bodies = new BodyInstances(scene);
  const ghosts = new GhostView(scene);

  let trainer = Trainer.load(localStorage) ?? new Trainer({ seed: (Math.random() * 2 ** 31) >>> 0, storage: localStorage });
  (window as unknown as { __trainer: Trainer }).__trainer = trainer;

  const state = { running: true, speed: 4, actualSpeed: 0, message: trainer.generation > 1 ? `已載入上次的訓練進度（第 ${trainer.generation} 代）` : '' };
  const panel = new TrainPanel({
    onToggleRun: () => (state.running = !state.running),
    onSpeed: (x) => (state.speed = x),
    onReset: () => {
      if (!confirm('確定要從頭訓練？目前的訓練進度會被清除。')) return;
      trainer.reset((Math.random() * 2 ** 31) >>> 0);
      rig.snap();
      state.message = '已從頭開始訓練';
    },
    onSave: () => void save(),
  });

  async function save() {
    const best = trainer.best;
    if (!best) {
      state.message = '還沒有通過驗證的網路，請再訓練幾代';
      return;
    }
    const file = serializeDriver(best.brain, { gen: best.gen, score: best.score, finishes: best.finishes, runs: best.runs, savedAt: new Date().toISOString() });
    const json = JSON.stringify(file);
    try {
      const res = await fetch('/__ai/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json });
      if (!res.ok) throw new Error(await res.text());
      state.message = `已存到 public/ai/driver.json（第 ${best.gen} 代，驗證完賽 ${best.finishes}/${best.runs}）`;
    } catch {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = 'driver.json';
      a.click();
      state.message = '開發伺服器無法寫檔，已改為下載 driver.json';
    }
  }

  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);

  let last = performance.now();
  let carry = 0;
  let gen = trainer.generation;
  const frame = (now: number) => {
    const dt = Math.min(MAX_FRAME_DT, (now - last) / 1000);
    last = now;
    const t0 = performance.now();
    if (state.running) {
      carry += (state.speed * dt) / PHYSICS_DT;
      let steps = 0;
      while (carry >= 1 && performance.now() - t0 < SIM_BUDGET_MS) {
        trainer.tick(1);
        carry -= 1;
        steps++;
      }
      if (carry >= 1) carry = 0; // couldn't keep up: drop the backlog rather than spiral
      const actual = dt > 0 ? (steps * PHYSICS_DT) / dt : 0;
      state.actualSpeed += (actual - state.actualSpeed) * 0.1;
      while (trainer.validating && performance.now() - t0 < FRAME_BUDGET_MS) trainer.validateTick(30);
    } else state.actualSpeed = 0;
    if (trainer.generation !== gen) {
      gen = trainer.generation;
      rig.snap();
    }
    render(dt);
    panel.update(trainer, state);
    requestAnimationFrame(frame);
  };

  function render(dt: number) {
    const sim = trainer.sim;
    const leader = sim.leader();
    ghosts.update(sim.ghosts, leader);
    flares.begin();
    beams.begin();
    const lp = leader ? leader.car.body.translation() : { x: 0, y: 0, z: 0 };
    for (const npc of sim.traffic.npcs.values()) {
      npc.render(1, flares);
      for (const part of npc.parts) beams.add(part.mesh, lp.x, lp.z);
    }
    flares.end();
    beams.end();
    if (leader) {
      const car = leader.car;
      road.update(car.s);
      rig.update(dt, new THREE.Vector3(lp.x, lp.y, lp.z), car.yaw, car.body.linvel(), car.speed, 83.3);
    }
    bodies.begin(camera);
    for (const npc of sim.traffic.npcs.values()) npc.addBodies(bodies);
    bodies.end();
    const h = renderer.domElement.height;
    updateFlareScale(flares.material, camera, h);
    updateFlareScale(road.lampFlareMaterial, camera, h);
    renderer.render(scene, camera);
  }

  requestAnimationFrame(frame);
}

boot();
