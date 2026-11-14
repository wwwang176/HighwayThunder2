import { describe, expect, it } from 'vitest';
import { FINISH_SLOW, finishTimeScale, slowedSeconds } from '../src/game/finishShow';

const PANEL = 5;

describe('finishTimeScale', () => {
  it('eases down from full speed at the line to the slow motion, held till the panel', () => {
    expect(finishTimeScale(0, PANEL)).toBeCloseTo(1);
    expect(finishTimeScale(FINISH_SLOW.ease, PANEL)).toBeCloseTo(FINISH_SLOW.scale);
    expect(finishTimeScale(PANEL - 0.01, PANEL)).toBeCloseTo(FINISH_SLOW.scale);
  });

  it('only ever slows down before the panel', () => {
    let last = Infinity;
    for (let t = 0; t < PANEL; t += 0.05) {
      const k = finishTimeScale(t, PANEL);
      expect(k).toBeLessThanOrEqual(last + 1e-9);
      last = k;
    }
  });

  it('eases to the slow motion behind the panel once it is in, and stays there', () => {
    expect(finishTimeScale(PANEL, PANEL)).toBeCloseTo(FINISH_SLOW.scale);
    expect(finishTimeScale(PANEL + FINISH_SLOW.settle, PANEL)).toBeCloseTo(FINISH_SLOW.panel);
    expect(finishTimeScale(PANEL + 60, PANEL)).toBeCloseTo(FINISH_SLOW.panel);
    const mid = finishTimeScale(PANEL + FINISH_SLOW.settle / 2, PANEL);
    expect(mid).toBeGreaterThan(FINISH_SLOW.scale);
    expect(mid).toBeLessThan(FINISH_SLOW.panel);
  });

  it('skipped, eases to it from the speed it was skipped at', () => {
    expect(finishTimeScale(PANEL, PANEL, 0.6)).toBeCloseTo(0.6);
    expect(finishTimeScale(PANEL + FINISH_SLOW.settle, PANEL, 0.6)).toBeCloseTo(FINISH_SLOW.panel);
  });
});

describe('slowedSeconds', () => {
  it('is the race time that passes in the first real seconds past the line', () => {
    // Held slow after the ease: each later second is `scale` of one.
    const a = slowedSeconds(1);
    const b = slowedSeconds(2);
    expect(b - a).toBeCloseTo(FINISH_SLOW.scale, 3);
    // Over the ease, between all slow and all full.
    const e = slowedSeconds(FINISH_SLOW.ease);
    expect(e).toBeGreaterThan(FINISH_SLOW.ease * FINISH_SLOW.scale);
    expect(e).toBeLessThan(FINISH_SLOW.ease);
  });
});

describe('the finish show on a road up a hill', () => {
  it('films the car from over the road where it is, not from the height 0', async () => {
    const THREE = await import('three');
    const { FinishShow } = await import('../src/game/finishShow');
    const { Centerline, straight } = await import('../src/road/centerline');
    const road = new Centerline([...straight(600)], { grades: [{ len: 1, g: 0.1 }, { len: 400, g: 0.1 }, { len: 50, g: 0 }] });
    const s = 500;
    const h = road.height(s); // (~42.5 m up)
    const mesh = new THREE.Object3D();
    const at = road.toWorld(s, 1.9);
    mesh.position.set(at.x, h + 0.55, at.z);
    const car = { road, s, d: 1.9, speed: 25, mesh } as unknown as ConstructorParameters<typeof FinishShow>[1];
    const camera = new THREE.PerspectiveCamera();
    const show = new FinishShow(camera, car, [4, -4]);
    for (let t = 0; t < 12; t += 0.25) {
      show.placeCamera();
      expect(camera.position.y).toBeGreaterThan(h);
      expect(camera.position.y).toBeLessThan(h + 8);
      show.step(0.25);
    }
  });
});
