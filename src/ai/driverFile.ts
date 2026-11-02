import { Brain, weightCount } from './brain';
import { BRAIN_LAYERS } from './evolution';
import { SENSOR_LAYOUT } from './sensors';

/** A trained driver on disk (public/ai/driver.json). */
export interface DriverFile {
  format: 'ht2-driver';
  version: 1;
  /** Which sensor layout the network was trained on. */
  sensors: string;
  layers: number[];
  weights: number[];
  meta: Record<string, unknown>;
}

export function serializeDriver(b: Brain, meta: Record<string, unknown> = {}): DriverFile {
  return { format: 'ht2-driver', version: 1, sensors: SENSOR_LAYOUT, layers: b.layers.slice(), weights: Array.from(b.weights), meta };
}

/** Load a driver, refusing anything that would not match the current code. */
export function parseDriver(json: unknown): Brain {
  const f = json as Partial<DriverFile> | null;
  if (!f || typeof f !== 'object' || f.format !== 'ht2-driver') throw new Error('不是 AI 駕駛檔（format 不符）');
  if (f.version !== 1) throw new Error(`AI 駕駛檔版本 ${String(f.version)} 不支援`);
  if (f.sensors !== SENSOR_LAYOUT) throw new Error(`AI 駕駛檔的感測輸入（${String(f.sensors)}）與目前程式（${SENSOR_LAYOUT}）不符，需要重新訓練`);
  const layers = f.layers;
  if (!Array.isArray(layers) || layers.length !== BRAIN_LAYERS.length || layers.some((n, i) => n !== BRAIN_LAYERS[i]))
    throw new Error(`AI 駕駛檔的網路大小 ${JSON.stringify(layers)} 與目前程式 ${JSON.stringify(BRAIN_LAYERS)} 不符`);
  if (!Array.isArray(f.weights) || f.weights.length !== weightCount(layers) || f.weights.some((w) => typeof w !== 'number' || !Number.isFinite(w)))
    throw new Error('AI 駕駛檔的權重數量或內容不正確');
  return { layers: layers.slice(), weights: Float32Array.from(f.weights) };
}
