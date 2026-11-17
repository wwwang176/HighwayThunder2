import { describe, expect, it } from 'vitest';
import { applyDriftNet, DRIFT_NET_INPUTS, DRIFT_NET_LAYERS, driftNetFrom, driftNetInputs, type DriftView, quietDriftNet } from '../src/ai/mountainDriftNet';
import { weightCount } from '../src/ai/brain';
import { mulberry32 } from '../src/ai/rng';

const view: DriftView = { miss: 1.5, missRate: -2, roomIn: 1.2, roomOut: 3.4, slide: 0.55, yawRate: 1.1, vIn: -0.8, v: 19, through: 0.4, kappa: 1 / 18, sinceKick: 0.9 };
const base = { throttle: 0.9, brake: 0, steer: 0.4, handbrake: false };

/** A drift network whose outputs are tanh(bias) alone (all its weights 0 but its output biases). */
function biased(steer: number, throttle: number, hb: number) {
  const b = quietDriftNet(mulberry32(1));
  b.weights.fill(0);
  const hidden = DRIFT_NET_LAYERS[1];
  const last = b.weights.length - (hidden + 1) * 3;
  [steer, throttle, hb].forEach((x, o) => (b.weights[last + o * (hidden + 1) + hidden] = Math.atanh(x)));
  return b;
}

describe('mountainDriftNet', () => {
  it('its inputs: one per DRIFT_NET_INPUTS, all within ±3, the handbrake as 0 / 1', () => {
    const out = driftNetInputs({ ...view, miss: 1e6, missRate: Number.NaN }, { ...base, handbrake: true }, new Float32Array(DRIFT_NET_INPUTS));
    expect(out.length).toBe(DRIFT_NET_INPUTS);
    for (const x of out) expect(Math.abs(x)).toBeLessThanOrEqual(3);
    expect(out[0]).toBe(3);
    expect(out[1]).toBe(0);
    expect(out[DRIFT_NET_INPUTS - 1]).toBe(1);
  });

  it('a quiet network (its start) changes nothing - the handbrake either way as the driver had it', () => {
    const q = quietDriftNet(mulberry32(7));
    const inputs = driftNetInputs(view, base, new Float32Array(DRIFT_NET_INPUTS));
    expect(applyDriftNet(q, inputs, base)).toEqual(base);
    expect(applyDriftNet(q, inputs, { ...base, handbrake: true })).toEqual({ ...base, handbrake: true });
    expect(applyDriftNet(null, inputs, base)).toBe(base);
  });

  it('its outputs: the wheel added to, the throttle moved either way (0..1), the handbrake pulled past 0.5 and let go under -0.5', () => {
    const inputs = driftNetInputs(view, base, new Float32Array(DRIFT_NET_INPUTS));
    const a = applyDriftNet(biased(0.3, -0.5, 0.8), inputs, base);
    expect(a.steer).toBeCloseTo(0.7, 5);
    expect(a.throttle).toBeCloseTo(0.4, 5);
    expect(a.handbrake).toBe(true);
    const b = applyDriftNet(biased(0.9, 0.5, -0.8), inputs, { ...base, handbrake: true });
    expect(b.steer).toBe(1);
    expect(b.throttle).toBe(1);
    expect(b.handbrake).toBe(false);
    expect(applyDriftNet(biased(0, 0, 0.3), inputs, { ...base, handbrake: true }).handbrake).toBe(true);
  });

  it('a car\'s weights: of its layout a network, else none', () => {
    expect(driftNetFrom(new Array(weightCount(DRIFT_NET_LAYERS)).fill(0.1))?.layers).toEqual(DRIFT_NET_LAYERS);
    expect(driftNetFrom([1, 2, 3])).toBeNull();
    expect(driftNetFrom(undefined)).toBeNull();
  });
});
