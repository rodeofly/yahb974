import * as THREE from './vendor/three.module.js';

// Two little rockets strapped to the tangue's flanks, nozzles down, with a
// double flame each and a trail of smoke. The retro-rockets of the big jump
// and the glider's throttle share this one pack. The rockets live in tangue
// model space (metres, +Z forward, y up); the smoke is a world-space cloud
// that the caller adds to the scene.

const SMOKE = 48;          // puffs, recycled
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// A soft round puff (without it, points are drawn as squares).
function puffTexture() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d'), gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)'); gradient.addColorStop(.45, 'rgba(255,255,255,.55)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient; g.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

function rockets() {
  const group = new THREE.Group(), flames = [];
  group.name = 'Fusées du tangue';
  const shell = new THREE.MeshLambertMaterial({ color: '#f4f1ea' }), stripe = new THREE.MeshLambertMaterial({ color: '#d23b2a' }), steel = new THREE.MeshLambertMaterial({ color: '#3b4248' });
  const outer = new THREE.MeshBasicMaterial({ color: '#ff8a1f', transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false });
  const inner = new THREE.MeshBasicMaterial({ color: '#fff3a0', transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false });
  const strap = new THREE.Mesh(new THREE.BoxGeometry(.66, .05, .12), steel); strap.position.set(0, .42, -.02); group.add(strap);
  for (const side of [-1, 1]) {
    const rocket = new THREE.Group(); rocket.position.set(side * .3, .36, -.02); group.add(rocket);
    rocket.add(new THREE.Mesh(new THREE.CylinderGeometry(.065, .065, .34, 10), shell));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(.068, .068, .07, 10), stripe); band.position.y = .05; rocket.add(band);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(.065, .12, 10), stripe); nose.position.y = .23; rocket.add(nose);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(.05, .075, .07, 10, 1, true), steel); nozzle.position.y = -.2; rocket.add(nozzle);
    // Flames hang below the nozzle: apex down.
    const flame = new THREE.Group(); flame.position.y = -.24; rocket.add(flame);
    const big = new THREE.Mesh(new THREE.ConeGeometry(.07, .7, 10, 1, true).rotateX(Math.PI).translate(0, -.35, 0), outer);
    const core = new THREE.Mesh(new THREE.ConeGeometry(.04, .38, 8, 1, true).rotateX(Math.PI).translate(0, -.19, 0), inner);
    flame.add(big, core); flame.visible = false; flames.push(flame);
  }
  return { group, flames };
}

/** The pack: `group` goes on the tangue, `smoke` in the scene. `puffMeters`
 * is the size of one puff of smoke, in metres. */
export function createRocketPack({ metersPerUnit, puffMeters = 6.4 }) {
  const mpu = metersPerUnit;
  const { group, flames } = rockets(); group.visible = false;
  const positions = new Float32Array(SMOKE * 3), colours = new Float32Array(SMOKE * 4), puffs = Array.from({ length: SMOKE }, () => ({ life: 0, vx: 0, vy: 0, vz: 0 }));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 4));
  const smoke = new THREE.Points(geometry, new THREE.PointsMaterial({ size: puffMeters / mpu, map: puffTexture(), vertexColors: true, transparent: true, depthWrite: false }));
  smoke.frustumCulled = false; smoke.name = 'Fumée des fusées';
  const nozzle = new THREE.Vector3();
  let next = 0, thrust = 0, time = 0;
  function puff(x, y, z, vx, vy, vz) { const i = next; next = (next + 1) % SMOKE; Object.assign(puffs[i], { life: 1, vx, vy, vz }); positions.set([x, y, z], i * 3); }
  /** Flames' strength: 0 off, 1 full, up to 2 for a launch. */
  function setThrust(value) { thrust = clamp(Number(value) || 0, 0, 2); }
  function setVisible(value) { group.visible = !!value; }
  /** A ring of dust where the tangue touches down (world units). */
  function burst(position, count = 14) {
    for (let k = 0; k < count; k++) { const a = k / count * Math.PI * 2; puff(position.x, position.y + .02, position.z, Math.cos(a) * .9, .15 + Math.random() * .2, Math.sin(a) * .9); }
  }
  function reset() { thrust = 0; puffs.forEach(p => { p.life = 0; }); flames.forEach(f => { f.visible = false; }); }
  function update(dt) {
    time += dt;
    const on = group.visible && thrust > .02;
    const flicker = 1 + .18 * Math.sin(time * 47) + .1 * Math.sin(time * 83);
    flames.forEach(flame => {
      flame.visible = on;
      if (!on) return;
      flame.scale.set(1, thrust * flicker, 1);
      if (Math.random() < dt * 14 * Math.min(1.5, thrust)) {
        nozzle.set(0, 0, 0); flame.localToWorld(nozzle);
        const v = .4 + Math.random() * .4;
        puff(nozzle.x, nozzle.y, nozzle.z, (Math.random() - .5) * .3, -v, (Math.random() - .5) * .3);
      }
    });
    // Puffs drift, slow down, swell and fade.
    for (let i = 0; i < SMOKE; i++) {
      const p = puffs[i];
      if (p.life <= 0) { colours[i * 4 + 3] = 0; continue; }
      p.life -= dt * .55; p.vx *= Math.exp(-dt * 2); p.vz *= Math.exp(-dt * 2); p.vy = p.vy * Math.exp(-dt * 2) + .08 * dt;
      positions[i * 3] += p.vx * dt; positions[i * 3 + 1] += p.vy * dt; positions[i * 3 + 2] += p.vz * dt;
      colours.set([.86, .84, .8, Math.max(0, p.life) * .55], i * 4);
    }
    geometry.getAttribute('position').needsUpdate = true; geometry.getAttribute('color').needsUpdate = true;
  }
  function dispose() {
    group.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
    smoke.material.map?.dispose(); smoke.material.dispose(); geometry.dispose();
    group.removeFromParent(); smoke.removeFromParent();
  }
  return { group, smoke, flames, setThrust, setVisible, burst, reset, update, dispose, get thrust() { return thrust; } };
}
