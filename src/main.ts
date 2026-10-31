import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

async function boot() {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), body);
  world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.1, 10));
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  document.getElementById('app')!.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
  cam.position.set(0, 3, 8);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshNormalMaterial());
  scene.add(mesh);
  const loop = () => {
    world.step();
    const t = body.translation();
    mesh.position.set(t.x, t.y, t.z);
    (window as any).__y = t.y;
    renderer.render(scene, cam);
    requestAnimationFrame(loop);
  };
  loop();
}
boot();
