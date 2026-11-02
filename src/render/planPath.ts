import * as THREE from 'three';
import { KMH } from '../config';
import { Plan, planAt } from '../ai/planner';
import { roadToWorld } from '../road/coords';

/** s between ribbon samples along the plan. */
const SAMPLE = 0.1;
const MAX_SAMPLES = 128;
const HALF_WIDTH = 0.3; // m: the ribbon is 60 cm wide
const LIFT = 0.04; // m above the road, so it is not lost in it
const DOT_RADIUS = 0.7;
const MAX_DOTS = 32;

/** Speed colour: green at 100 km/h and below, through yellow, to red at 250 and above. */
function speedColor(v: number, out: THREE.Color): THREE.Color {
  const u = Math.min(1, Math.max(0, (v / KMH - 100) / 150));
  return out.setHSL((1 - u) / 3, 1, 0.55);
}

/**
 * The AI's current plan drawn on the road: a glowing ribbon along the path,
 * and a dot at every plan point coloured by the speed planned there.
 */
export class PlanPath {
  private readonly ribbon: THREE.Mesh;
  private readonly positions = new Float32Array(MAX_SAMPLES * 2 * 3);
  private readonly dots: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const index: number[] = [];
    for (let i = 0; i + 1 < MAX_SAMPLES; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(index);
    this.ribbon = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x40e0ff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    this.ribbon.frustumCulled = false;
    this.ribbon.renderOrder = 2;
    const dotGeom = new THREE.CircleGeometry(DOT_RADIUS, 16).rotateX(-Math.PI / 2);
    this.dots = new THREE.InstancedMesh(dotGeom, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }), MAX_DOTS);
    this.dots.frustumCulled = false;
    this.dots.renderOrder = 3;
    scene.add(this.ribbon, this.dots);
    this.hide();
  }

  hide(): void {
    this.ribbon.visible = false;
    this.dots.visible = false;
  }

  /** Draw `plan`, made `age` s ago (the part already driven is left out). */
  show(plan: Plan, age: number): void {
    const end = plan.points[plan.points.length - 1].t;
    const n = Math.max(2, Math.min(MAX_SAMPLES, Math.floor((end - age) / SAMPLE) + 1));
    const pos = this.positions;
    for (let i = 0; i < n; i++) {
      const t = Math.min(end, age + i * SAMPLE);
      const a = planAt(plan, t);
      const b = planAt(plan, Math.min(end, t + SAMPLE));
      // Sideways across the direction of travel (road coordinates: s forward, d right).
      const ds = b.s - a.s || 1e-3;
      const dd = b.d - a.d;
      const len = Math.hypot(ds, dd);
      const ns = (-dd / len) * HALF_WIDTH;
      const nd = (ds / len) * HALF_WIDTH;
      const l = roadToWorld(a.s + ns, a.d - nd);
      const r = roadToWorld(a.s - ns, a.d + nd);
      pos.set([l.x, LIFT, l.z, r.x, LIFT, r.z], i * 6);
    }
    const g = this.ribbon.geometry;
    g.setDrawRange(0, (n - 1) * 6);
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.ribbon.visible = true;

    let k = 0;
    for (const p of plan.points) {
      if (p.t < age || k >= MAX_DOTS) continue;
      const w = roadToWorld(p.s, p.d);
      this.m.makeTranslation(w.x, LIFT + 0.01, w.z);
      this.dots.setMatrixAt(k, this.m);
      this.dots.setColorAt(k, speedColor(p.v, this.c));
      k++;
    }
    this.dots.count = k;
    this.dots.instanceMatrix.needsUpdate = true;
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
    this.dots.visible = k > 0;
  }
}
