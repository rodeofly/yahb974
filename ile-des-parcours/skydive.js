import * as THREE from './vendor/three.module.js';
import { createTenrecAvatar } from './tenrec-avatar.js';
import { createRocketPack } from './rocket-pack.js';

// « Le grand saut »: the opening sequence. The tangue hovers in an endless
// free fall high above the island (no wingsuit yet), drifting down so slowly
// that one only feels the island coming closer, while the visitor picks a
// trail. Then: the wingsuit opens and the tangue glides past the camera
// towards the chosen door for a few seconds, dives, and lands at the trail's
// start on two retro-rockets. Positions are world units (100 m); game
// timings, not physics.

const SCALE = 4;           // visual exaggeration of the diver, like the troop
const GLIDE_TIME = 2.6, DIVE_TIME = 3.2, RETRO_HEIGHT = 1.6, RETRO_TIME = 2.4, LANDED_TIME = .7;
const APPROACH = .003;     // share of the height lost per second while hovering
const TILT = 1.22;         // the trails seen 70° below the horizon from the diver

function wingsuit() {
  // Membranes between fore and hind legs, and between the hind legs (metres,
  // tangue model space: +Z forward, y up).
  const points = [];
  for (const side of [-1, 1]) {
    const a = [side * .12, .36, .3], b = [side * .62, .3, .14], c = [side * .6, .3, -.22], d = [side * .12, .34, -.32];
    points.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  points.push(-.12, .34, -.32, .12, .34, -.32, 0, .3, -.62);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const colours = [];
  for (let i = 0; i < points.length / 3; i++) { const tip = Math.abs(points[i * 3]) > .4 || points[i * 3 + 2] < -.5; colours.push(...(tip ? [.17, .72, .7] : [1, .48, .1])); }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}

export function createSkydive({ source, heightAt }) {
  const mpu = source.metersPerUnit;
  const group = new THREE.Group(); group.name = 'Le grand saut'; group.visible = false;
  const tangue = createTenrecAvatar();
  const suit = wingsuit(); tangue.group.add(suit);
  // The retro-rockets and their smoke: the same pack as the glider's throttle.
  const pack = createRocketPack({ metersPerUnit: mpu, puffMeters: 1.6 * SCALE }); tangue.group.add(pack.group);
  group.add(tangue.group, pack.smoke);
  const pos = new THREE.Vector3(), centre = new THREE.Vector3(), target = new THREE.Vector3(), landing = new THREE.Vector3(), from = new THREE.Vector3(), glideDir = new THREE.Vector3();
  let phase = 'idle', t = 0, heading = 0, pitch = 0, bank = 0, rate = 1, angle = 0, held = null, drawn = null;

  const ground = (x, z) => Math.max(0, heightAt(x, z));
  const ease = u => u * u * (3 - 2 * u);

  // Hovering: on the line that drops 70° to the trails' centre, facing it,
  // circling it very slowly.
  function hoverAt(height) {
    const reach = height / Math.tan(TILT);
    pos.set(centre.x + Math.sin(angle) * reach, centre.y + height, centre.z + Math.cos(angle) * reach);
    heading = Math.atan2(centre.x - pos.x, -(centre.z - pos.z));
  }
  /** Hover high over the trails, in free fall, until a trail is picked. */
  function start({ x, z }, { altitude = 870, angle: from = .5 } = {}) {
    centre.set(x, ground(x, z), z); angle = from; held = null;
    hoverAt(altitude);
    phase = 'hover'; t = 0; pitch = -TILT; bank = 0; tangue.group.visible = true; drawn = null;
    suit.visible = false; pack.setVisible(false); pack.reset(); group.visible = true;
  }
  /** While hovering, the camera may hold the diver where the picture wants it. */
  function holdAt(position, facing, tilt) { if (phase === 'hover') held = { position: position.clone(), facing, tilt }; }
  /** Hidden while the camera looks through the tangue's eyes. */
  function setDiverVisible(value) { tangue.group.visible = !!value; }
  /** Drawn size near the ground: the troop's own unit scale, so the diver and
   * the troop's tangue are one size when they swap (null: the jump's size). */
  function setDrawnScale(value) { drawn = Number.isFinite(value) && value > 0 ? value : null; }
  /** The visitor picked a trail: the wingsuit opens and the tangue sets off towards it. */
  function choose({ x, z }) {
    if (phase !== 'hover') return false;
    target.set(x, ground(x, z), z);
    // It touches down exactly where the troop's own tangue stands (hidden
    // meanwhile), so the two swap places without a jump.
    landing.set(x, 0, z); landing.y = ground(landing.x, landing.z);
    from.copy(pos); glideDir.copy(target).sub(pos).normalize();
    phase = 'glide'; t = 0; suit.visible = true;
    return true;
  }
  function update(dt) {
    if (phase === 'idle' || phase === 'done') return getPose();
    t += dt;
    // The relief under the landing spot refines as it nears (it was chosen
    // from very high, on coarse tiles): keep its height current.
    if (phase !== 'hover') { target.y = ground(target.x, target.z); landing.y = ground(landing.x, landing.z); }
    if (phase === 'hover') {
      // Head down, eyes on the island, paws spread, turning slowly round it;
      // the island barely nears.
      const floor = 30;
      if (held) { pos.copy(held.position); heading = held.facing; pitch = held.tilt + .05 * Math.sin(t * .8); }
      else { angle += .03 * dt; hoverAt(floor + (pos.y - centre.y - floor) * Math.exp(-APPROACH * dt)); pitch = -TILT + .05 * Math.sin(t * .8); }
      bank = .1 * Math.sin(t * .6);
    } else if (phase === 'glide') {
      // Wingsuit open: it glides past the camera towards the chosen door,
      // gathering speed, rolling from one wing to the other.
      const u = Math.min(1, t / GLIDE_TIME), speed = .3 + 2.4 * u * u;
      pos.addScaledVector(glideDir, speed * dt);
      pos.y = Math.max(pos.y, ground(pos.x, pos.z) + RETRO_HEIGHT);
      heading = Math.atan2(glideDir.x, -glideDir.z); pitch = -Math.asin(Math.min(1, -glideDir.y)) * .85; bank = .35 * Math.sin(t * 2.2) * (1 - u * .5);
      if (t >= GLIDE_TIME) {
        from.copy(pos);
        // An exponential approach: most of the height goes in the first
        // second, ending 60 m above the rockets' height.
        rate = Math.log(Math.max(2, (from.y - target.y - RETRO_HEIGHT) / .6)) / DIVE_TIME;
        phase = 'dive'; t = 0;
      }
    } else if (phase === 'dive') {
      const f = Math.exp(-rate * Math.min(t, DIVE_TIME)), dx = target.x - pos.x, dz = target.z - pos.z;
      if (Math.hypot(dx, dz) > 1e-4) heading = Math.atan2(dx, -dz);
      pos.x = target.x + (from.x - target.x) * f; pos.z = target.z + (from.z - target.z) * f;
      pos.y = Math.max(target.y + RETRO_HEIGHT + (from.y - target.y - RETRO_HEIGHT) * f, ground(pos.x, pos.z) + 1);
      // Head down at first, flattening out above the trail.
      pitch = -1.2 * f - .4 * (1 - f); bank *= Math.exp(-dt * 3);
      if (t >= DIVE_TIME) { phase = 'retro'; t = 0; from.copy(pos); suit.visible = false; pack.setVisible(true); }
    } else if (phase === 'retro') {
      // Retro-rockets: a braking descent onto the landing spot, level, flames
      // flickering and smoke trailing.
      const u = Math.min(1, t / RETRO_TIME), e = ease(u);
      pos.x = from.x + (landing.x - from.x) * e; pos.z = from.z + (landing.z - from.z) * e;
      pos.y = Math.max(landing.y + (from.y - landing.y) * (1 - e), ground(pos.x, pos.z));
      const dx = landing.x - from.x, dz = landing.z - from.z;
      if (Math.hypot(dx, dz) > 1e-4) heading = Math.atan2(dx, -dz);
      pitch += (0 - pitch) * Math.min(1, dt * 5); bank *= Math.exp(-dt * 5);
      pack.setThrust(1.25 - u * .55);
      if (u >= 1) {
        pos.y = ground(pos.x, pos.z); phase = 'landed'; t = 0;
        // A burst of dust on touching down.
        pack.burst(pos);
      }
    } else if (phase === 'landed') {
      // Touch down; the flames die out.
      pack.setThrust(t < .25 ? Math.max(.01, 1 - t * 4) : 0);
      pos.y = ground(pos.x, pos.z); pitch = 0; bank *= .8;
      if (t > LANDED_TIME) { phase = 'done'; pack.setVisible(false); }
    }
    tangue.group.position.copy(pos);
    tangue.group.rotation.set(0, 0, 0); tangue.group.rotateY(Math.PI - heading); tangue.group.rotateX(-pitch); tangue.group.rotateZ(bank * .8);
    tangue.group.scale.setScalar((drawn ?? SCALE) / mpu);
    const flying = phase === 'hover' || phase === 'glide' || phase === 'dive';
    tangue.update(dt, { flight: { active: flying, bank, pitch }, speedMetersPerSecond: flying ? 20 : 0, moving: flying, onGround: !flying, mode: 'glide' });
    tangue.group.updateMatrixWorld(true); pack.update(dt);
    return getPose();
  }
  function getPose() { return { phase, t, position: pos.clone(), heading, pitch, centre: centre.clone(), target: target.clone(), landing: landing.clone(), altitudeM: (pos.y - ground(pos.x, pos.z)) * mpu, scale: SCALE, glideTime: GLIDE_TIME, diveTime: DIVE_TIME }; }
  function hide() { group.visible = false; phase = 'idle'; }
  function dispose() { pack.dispose(); tangue.dispose(); group.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); group.clear(); }
  return { group, start, choose, update, getPose, holdAt, setDiverVisible, setDrawnScale, hide, dispose, get phase() { return phase; } };
}
