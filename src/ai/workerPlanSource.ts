import { Plan, PlanEgo, PLANNER, PreviousPlan } from './planner';
import { DRIVER_TUNING, type PlanSource } from './plannerDriver';
import type { TrafficBox } from './sensors';

export interface PlanRequest {
  stamp: number;
  ego: PlanEgo;
  traffic: TrafficBox[];
  previous: PreviousPlan | null;
  settings: typeof PLANNER;
  /** Plan by direction of travel (DRIVER_TUNING.coursePlanner). */
  course: boolean;
}

export interface PlanAnswer {
  stamp: number;
  plan: Plan;
}

/** Plans worked out in a Web Worker, so a plan (10-30 ms) never holds up a frame. */
export class WorkerPlanSource implements PlanSource {
  private readonly worker = new Worker(new URL('./planWorker.ts', import.meta.url), { type: 'module' });
  private waiting = false;
  private answer: PlanAnswer | null = null;

  constructor() {
    this.worker.onmessage = (e: MessageEvent<PlanAnswer>) => {
      this.waiting = false;
      this.answer = e.data;
    };
    this.worker.onerror = (e) => {
      this.waiting = false;
      console.error('AI 規劃 worker 出錯：', e.message);
    };
  }

  get busy(): boolean {
    return this.waiting;
  }

  request(stamp: number, ego: PlanEgo, traffic: TrafficBox[], previous: PreviousPlan | null): void {
    this.waiting = true;
    const msg: PlanRequest = { stamp, ego, traffic, previous, settings: { ...PLANNER }, course: DRIVER_TUNING.coursePlanner };
    this.worker.postMessage(msg);
  }

  dispose(): void {
    this.worker.terminate();
  }

  take(): PlanAnswer | null {
    const a = this.answer;
    this.answer = null;
    return a;
  }
}
