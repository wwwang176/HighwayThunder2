import type { HandlingInput } from '../vehicles/handling';

export class Keyboard {
  private down = new Set<string>();
  private handlers = new Map<string, () => void>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.handlers.get(e.code)?.();
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  /** Fire once per physical key press. */
  onPress(code: string, fn: () => void): void {
    this.handlers.set(code, fn);
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  driving(): HandlingInput {
    const right = this.isDown('KeyD', 'ArrowRight') ? 1 : 0;
    const left = this.isDown('KeyA', 'ArrowLeft') ? 1 : 0;
    return {
      throttle: this.isDown('KeyW', 'ArrowUp') ? 1 : 0,
      brake: this.isDown('KeyS', 'ArrowDown') ? 1 : 0,
      steer: right - left,
      handbrake: this.isDown('Space'),
      nitro: this.isDown('ShiftLeft', 'ShiftRight'),
    };
  }
}
