import type * as THREE from 'three';
import type { BlurMask } from '../render/speedBlur';

/**
 * Debug: the speed blur's mask marked over the picture (POST.blurMaskShow, with the shader's green tint): the point
 * everything streams out from (a red dot), the tube's points joined up with their circles (the first, ahead of the
 * car's nose, bold), and the ellipse when there is one.
 */
export class BlurMaskView {
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;

  constructor() {
    this.canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:19';
    this.canvas.hidden = true;
    document.body.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
  }

  draw(on: boolean, mask: BlurMask, focus: THREE.Vector2): void {
    this.canvas.hidden = !on;
    if (!on) return;
    const w = innerWidth, h = innerHeight, r = devicePixelRatio;
    if (this.canvas.width !== Math.round(w * r) || this.canvas.height !== Math.round(h * r)) {
      this.canvas.width = Math.round(w * r);
      this.canvas.height = Math.round(h * r);
    }
    const g = this.g;
    g.setTransform(r, 0, 0, r, 0, 0);
    g.clearRect(0, 0, w, h);
    const X = (u: number) => u * w, Y = (v: number) => (1 - v) * h; // (0..1, y up -> the page's pixels)
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(120,255,160,0.9)';
    g.fillStyle = 'rgba(120,255,160,0.9)';
    if (mask.count >= 2) {
      // Its line, and each point's circle (the first, ahead of the nose, bold).
      g.beginPath();
      for (let i = 0; i < mask.count; i++) (i ? g.lineTo : g.moveTo).call(g, X(mask.path[i].x), Y(mask.path[i].y));
      g.stroke();
      for (let i = 0; i < mask.count; i++) {
        const x = X(mask.path[i].x), y = Y(mask.path[i].y);
        g.lineWidth = i === 0 ? 3 : 1.5;
        g.beginPath();
        g.arc(x, y, mask.width[i] * h, 0, Math.PI * 2); // (its radius, in the screen's heights)
        g.stroke();
        g.beginPath();
        g.arc(x, y, 3, 0, Math.PI * 2);
        g.fill();
      }
      g.lineWidth = 1.5;
    }
    if (mask.radius.x > 0) {
      g.beginPath();
      g.ellipse(X(mask.center.x), Y(mask.center.y), mask.radius.x * w, mask.radius.y * h, 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = 'rgba(255,90,90,0.95)';
    g.beginPath();
    g.arc(X(focus.x), Y(focus.y), 6, 0, Math.PI * 2);
    g.fill();
  }
}
