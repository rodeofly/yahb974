import * as THREE from './vendor/three.module.js';

// « Les îlets »: a rudimentary camp at each stage of the trail, in the spirit
// of the maroon camps of the cirques: a wooden case under a red corrugated
// tin roof, a thatched ajoupa, a three-log fire with its benches, banana
// plants, a woodpile, and the treasure container in front of the fire (a
// wooden crate, or La Buse's pirate chest at the trail's end), shown open
// with its goodies once the stage is solved.
// Everything static is merged into one geometry and drawn instanced: one draw
// call for all the îlets of a trail, one for the flames, one per container.
// Metres, front (facing the trail) towards -Z, ground at y = 0; the walls go
// down to -1.5 m so a case on a slope never floats.

const TAU = Math.PI * 2;
const hash = (a, b = 0) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
const scratch = new THREE.Color(), shade = new THREE.Color();

// A tiny geometry kit: each part is painted per triangle (from its local
// coordinates), placed, then everything is merged; no addon needed.
function part(geometry, colour, { at = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], paint = null } = {}) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const position = g.getAttribute('position'), colours = new Float32Array(position.count * 3), base = new THREE.Color(colour);
  for (let i = 0; i < position.count; i += 3) {
    const cx = (position.getX(i) + position.getX(i + 1) + position.getX(i + 2)) / 3;
    const cy = (position.getY(i) + position.getY(i + 1) + position.getY(i + 2)) / 3;
    const cz = (position.getZ(i) + position.getZ(i + 1) + position.getZ(i + 2)) / 3;
    scratch.copy(base); paint?.(scratch, cx, cy, cz);
    for (let k = 0; k < 3; k++) colours.set([scratch.r, scratch.g, scratch.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale)));
  return g;
}
function merge(parts) {
  const count = parts.reduce((n, g) => n + g.getAttribute('position').count, 0);
  const position = new Float32Array(count * 3), normal = new Float32Array(count * 3), color = new Float32Array(count * 3);
  let offset = 0;
  for (const g of parts) {
    position.set(g.getAttribute('position').array, offset * 3); normal.set(g.getAttribute('normal').array, offset * 3); color.set(g.getAttribute('color').array, offset * 3);
    offset += g.getAttribute('position').count; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setAttribute('color', new THREE.BufferAttribute(color, 3));
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}
const at = (matrix, parts) => parts.map(g => g.applyMatrix4(matrix));
const place = (x, z, turn) => new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn), new THREE.Vector3(1, 1, 1));
function triangle(width, height) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-width / 2, 0, 0, width / 2, 0, 0, 0, height, 0], 3));
  g.computeVertexNormals();
  return g;
}
// Painters: planks in bands across one local axis, corrugated tin, thatch.
const planks = (axis, width, dark = .84) => (c, x, y, z) => {
  const band = Math.floor(({ x, y, z })[axis] / width + 1000);
  c.multiplyScalar((band % 2 ? dark : 1) * (.92 + .16 * hash(band)));
};
const tin = seed => (c, x, y, z) => {
  const band = Math.floor(x / .15 + 1000), patch = hash(Math.floor(x / .55) + seed, Math.floor(z / .45));
  if (patch > .8) c.lerp(shade.set('#7a3a1c'), .75);
  else if (patch < .12) c.lerp(shade.set('#9aa1a4'), .7);
  c.multiplyScalar(band % 2 ? .82 : 1);
};
const thatch = (c, x, y, z) => { const row = Math.floor(z / .26 + 1000); c.multiplyScalar((row % 2 ? .86 : 1) * (.9 + .2 * hash(row, Math.floor(x / .4)))); };
const vary = (amount, seed) => c => c.multiplyScalar(1 - amount + 2 * amount * hash(seed));

function caseGeometry() {
  // The case: 3.4 × 2.6 m, walls of weathered planks, blue door, green
  // shutters. Walls go 3 m into the ground, for a case set on a slope.
  const parts = [], W = 3.4, D = 2.6, top = 2.1, low = -3, h = top - low, wood = '#9b7148';
  const wall = (width, x, z, turn) => parts.push(part(new THREE.PlaneGeometry(width, h, Math.round(width / .2), 1), wood, { at: [x, (top + low) / 2, z], rot: [0, turn, 0], paint: planks('x', .2) }));
  wall(W, 0, -D / 2, Math.PI); wall(W, 0, D / 2, 0); wall(D, -W / 2, 0, -Math.PI / 2); wall(D, W / 2, 0, Math.PI / 2);
  for (const side of [-1, 1]) parts.push(part(triangle(D, .95), '#8a6440', { at: [side * W / 2, top, 0], rot: [0, side * Math.PI / 2, 0] }));
  // Red corrugated tin, worn grey in places and rusty in others, with the
  // gables' pitch, resting on the walls, 35 cm of overhang.
  const run = D / 2 + .35, slope = Math.atan2(.95, D / 2), drop = run * Math.tan(slope), ridge = top + .98;
  for (const side of [-1, 1]) {
    parts.push(part(new THREE.BoxGeometry(W + .5, .05, run / Math.cos(slope), 26, 1, 1), '#b8442c', { at: [0, ridge - drop / 2, side * run / 2], rot: [side * slope, 0, 0], paint: tin(side * 7) }));
  }
  parts.push(part(new THREE.BoxGeometry(W + .5, .07, .26), '#8e969a', { at: [0, ridge + .01, 0] }));
  // Door, shutters, a stone step.
  parts.push(part(new THREE.PlaneGeometry(.8, 1.7, 4, 1), '#2f6f8f', { at: [-.55, .85, -D / 2 - .012], rot: [0, Math.PI, 0], paint: planks('x', .2, .88) }));
  for (const side of [-1, 1]) parts.push(part(new THREE.PlaneGeometry(.34, .6, 2, 1), '#2f8f6f', { at: [.85 + side * .2, 1.35, -D / 2 - .012], rot: [0, Math.PI, 0], paint: planks('x', .17, .86) }));
  parts.push(part(new THREE.BoxGeometry(1.0, .6, .42), '#7c766c', { at: [-.55, -.14, -D / 2 - .22] }));
  return parts;
}
function ajoupaGeometry() {
  // The maroons' lean-to: two posts, a ridge pole, vacoa thatch down to the ground.
  const parts = [];
  for (const x of [-1, 1]) parts.push(part(new THREE.CylinderGeometry(.06, .07, 2.75, 6), '#5d4630', { at: [x, .37, -.6] }));
  parts.push(part(new THREE.CylinderGeometry(.05, .05, 2.4, 6), '#5d4630', { at: [0, 1.7, -.6], rot: [0, 0, Math.PI / 2] }));
  const run = 1.6, rise = 1.7, slope = Math.atan2(rise, run);
  parts.push(part(new THREE.BoxGeometry(2.6, .12, Math.hypot(run, rise) + .3, 1, 1, 9), '#b39a5b', { at: [0, rise / 2 - .11, -.6 + run / 2 + .1], rot: [slope, 0, 0], paint: thatch }));
  parts.push(part(new THREE.PlaneGeometry(1.7, 1.1), '#c9b27a', { at: [0, .03, .1], rot: [-Math.PI / 2, 0, 0] }));
  return parts;
}
function foyerGeometry() {
  // A three-log fire in a ring of stones, with two log benches.
  const parts = [part(new THREE.CylinderGeometry(.44, .5, .4, 12), '#3d3833', { at: [0, -.18, 0] })];
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * TAU + hash(i) * .3, r = .52;
    parts.push(part(new THREE.IcosahedronGeometry(.15, 0), '#7f7b74', { at: [Math.cos(a) * r, .06, Math.sin(a) * r], rot: [hash(i, 1) * 3, a, 0], scale: [1, .7 + .3 * hash(i, 2), 1], paint: vary(.12, i) }));
  }
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * TAU + .4;
    parts.push(part(new THREE.CylinderGeometry(.055, .055, .72, 6), '#4a3424', { at: [Math.cos(a) * .3, .07, -Math.sin(a) * .3], rot: [0, a, Math.PI / 2], paint: (c, x, y) => { if (y > .22) c.set('#1f1814'); } }));
  }
  for (const side of [-1, 1]) parts.push(part(new THREE.CylinderGeometry(.13, .14, 1.15, 8), '#6b4e33', { at: [side * 1.15, .11, .15], rot: [0, side * .35, Math.PI / 2] }));
  return parts;
}
function bananaGeometry(seed) {
  const parts = [part(new THREE.CylinderGeometry(.07, .11, 2.6, 6), '#7d8a46', { at: [0, .3, 0] })];
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU + hash(seed, i), droop = .25 + .3 * hash(i, seed);
    parts.push(part(new THREE.BoxGeometry(1.3, .02, .34), '#4f9b3a', { at: [Math.cos(a) * .58, 1.52 - droop * .5, -Math.sin(a) * .58], rot: [0, a, -droop], paint: vary(.12, seed + i) }));
  }
  return parts;
}
function woodpileGeometry() {
  const parts = [];
  [[-.19, .08], [0, .08], [.19, .08], [-.095, .25], [.095, .25], [0, .42]].forEach(([x, y], i) => parts.push(part(new THREE.CylinderGeometry(.09, .09, 1.0, 7), '#6b4a2e', { at: [x, y, 0], rot: [Math.PI / 2, 0, 0], paint: vary(.1, i) })));
  return parts;
}
// The camp's layout (metres, front towards the trail at -Z). Each piece
// stands on the ground at its own place: `footprint` (m) for the large ones,
// set halfway down a slope; `tilt` for the small flat ones, laid on it.
export const LAYOUT = [
  { id: 'case', at: [1.5, 1.1], turn: 0, footprint: 1.9, build: caseGeometry },
  { id: 'ajoupa', at: [-2.7, 1.0], turn: .35, footprint: 1.3, build: ajoupaGeometry },
  { id: 'foyer', at: [-.3, -1.0], turn: 0, tilt: true, build: foyerGeometry },
  { id: 'bananier', at: [4.0, -.2], turn: 1.1, build: () => bananaGeometry(3) },
  { id: 'bananier-2', at: [-4.3, -.5], turn: 4.2, build: () => bananaGeometry(8) },
  { id: 'bois', at: [3.55, 1.7], turn: 0, tilt: true, build: woodpileGeometry },
];
/** One piece of the îlet as a merged geometry (or the whole camp, for tests and previews). */
export function iletGeometry(id = null) {
  if (id) return merge(LAYOUT.find(piece => piece.id === id).build());
  return merge(LAYOUT.flatMap(piece => at(place(piece.at[0], piece.at[1], piece.turn), piece.build())));
}

// On a steep slope the camp stands on a raised platform: a plank deck (top at
// y = 0) edged with basalt dry-stone walls going down to the ground, a coping
// round the edge. Big enough for the troop gathered at the chest. (Steps down
// to the trail were removed: on a steep slope they hung in the air.)
export const DECK = Object.freeze({ x0: -5.7, x1: 5.7, z0: -4.8, z1: 3.0, lift: .25, slope: .8 });
function platformGeometry() {
  const { x0, x1, z0, z1 } = DECK, W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, wall = 12;
  const parts = [part(new THREE.BoxGeometry(W, .18, D, Math.round(W / .3), 1, 1), '#8a6a44', { at: [cx, -.09, cz], paint: planks('x', .3, .86) })];
  // Dry-stone courses of basalt, a little irregular.
  const stones = (c, x, y) => {
    const row = Math.floor(y / .42 + 100), col = Math.floor(x / .7 + (row % 2) * .5 + 100);
    c.multiplyScalar(.8 + .32 * hash(row, col));
  };
  const face = (width, x, z, turn) => parts.push(part(new THREE.PlaneGeometry(width, wall, Math.round(width / .35), Math.round(wall / .42)), '#626560', { at: [x, -.18 - wall / 2, z], rot: [0, turn, 0], paint: stones }));
  face(W, cx, z0, Math.PI); face(W, cx, z1, 0); face(D, x0, cz, -Math.PI / 2); face(D, x1, cz, Math.PI / 2);
  for (const [w, d, x, z] of [[W + .1, .32, cx, z0 + .1], [W + .1, .32, cx, z1 - .1], [.32, D, x0 + .1, cz], [.32, D, x1 - .1, cz]]) parts.push(part(new THREE.BoxGeometry(w, .16, d), '#4e514d', { at: [x, .02, z], paint: vary(.08, x + z) }));
  return merge(parts);
}

// Containers in front of the fire: a wooden crate, or La Buse's chest.
function crateParts(open) {
  const parts = [part(new THREE.BoxGeometry(.9, .55, .6, 1, 4, 1), '#9a7444', { at: [0, .275, 0], paint: planks('y', .1375, .86) })];
  for (const x of [-.44, .44]) for (const z of [-.29, .29]) parts.push(part(new THREE.BoxGeometry(.05, .57, .05), '#3a3430', { at: [x, .285, z] }));
  if (!open) parts.push(part(new THREE.BoxGeometry(.92, .06, .62, 1, 1, 4), '#8a663b', { at: [0, .58, 0], paint: planks('z', .155, .86) }));
  else {
    parts.push(part(new THREE.PlaneGeometry(.84, .54), '#2b1d12', { at: [0, .5, 0], rot: [-Math.PI / 2, 0, 0] }));
    parts.push(part(new THREE.BoxGeometry(.92, .06, .62, 1, 1, 4), '#8a663b', { at: [-.72, .26, -.05], rot: [0, .3, 1.25], paint: planks('z', .155, .86) }));
    parts.push(...goodies(.52, .3));
  }
  return parts;
}
function chestParts(open) {
  const parts = [part(new THREE.BoxGeometry(1.0, .5, .66, 1, 4, 1), '#7a4a24', { at: [0, .25, 0], paint: planks('y', .125, .85) })];
  for (const x of [-.4, .4]) parts.push(part(new THREE.BoxGeometry(.08, .52, .68), '#f2c14e', { at: [x, .26, 0] }));
  const lid = new THREE.CylinderGeometry(.33, .33, 1.0, 12, 1, false, 0, Math.PI);
  lid.rotateZ(Math.PI / 2); lid.rotateX(Math.PI / 2);
  if (!open) {
    parts.push(part(lid, '#6e4120', { at: [0, .5, 0] }));
    parts.push(part(new THREE.BoxGeometry(.16, .2, .04), '#f2c14e', { at: [0, .44, -.34] }));
  } else {
    // Lid thrown back on its hinge, a heap of gold and gems inside.
    parts.push(part(lid, '#6e4120', { at: [0, .56, .5], rot: [-1.9, 0, 0] }));
    parts.push(part(new THREE.SphereGeometry(.42, 12, 6, 0, TAU, 0, Math.PI / 2), '#f2c14e', { at: [0, .44, 0], scale: [1.05, .32, .7], paint: vary(.1, 5) }));
    parts.push(...goodies(.56, .45));
  }
  return parts;
}
function goodies(y, spread) {
  // Gold coins, gems and a rolled map: the explorers' loot.
  const parts = [];
  for (let i = 0; i < 9; i++) parts.push(part(new THREE.CylinderGeometry(.055, .055, .018, 8), '#ffd34d', { at: [(hash(i, 3) - .5) * spread, y + hash(i, 4) * .06, (hash(i, 5) - .5) * spread * .6], rot: [hash(i, 6) * .8, 0, hash(i, 7) * .8] }));
  ['#d6283c', '#2bb673', '#3a7bd5'].forEach((colour, i) => parts.push(part(new THREE.OctahedronGeometry(.06, 0), colour, { at: [(i - 1) * spread * .3, y + .06, (hash(i, 9) - .5) * .12] })));
  parts.push(part(new THREE.CylinderGeometry(.04, .04, .4, 8), '#efe0b6', { at: [spread * .15, y + .05, .1], rot: [0, .5, Math.PI / 2] }));
  return parts;
}
export const CONTAINERS = {
  crate: () => merge(crateParts(false)), crateOpen: () => merge(crateParts(true)),
  chest: () => merge(chestParts(false)), chestOpen: () => merge(chestParts(true)),
};
function flameGeometry() {
  return merge([
    part(new THREE.ConeGeometry(.2, .6, 7, 1, true), '#ff7a1f', { at: [0, .34, 0] }),
    part(new THREE.ConeGeometry(.11, .4, 6, 1, true), '#ffd75a', { at: [0, .26, 0] }),
    part(new THREE.SphereGeometry(.2, 8, 4), '#ff4a12', { at: [0, .06, 0], scale: [1, .3, 1] }),
  ]);
}

export function createIlets({ heightAt, capacity = 12 } = {}) {
  const group = new THREE.Group(); group.name = 'Îlets'; group.visible = false;
  const lambert = new THREE.MeshLambertMaterial({ vertexColors: true });
  const make = (geometry, material = lambert) => { const mesh = new THREE.InstancedMesh(geometry, material, capacity); mesh.count = 0; mesh.frustumCulled = false; group.add(mesh); return mesh; };
  const pieces = LAYOUT.map(piece => ({ ...piece, mesh: make(iletGeometry(piece.id)) }));
  const platforms = make(platformGeometry());
  const flames = make(flameGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false }));
  const containers = Object.fromEntries(Object.entries(CONTAINERS).map(([kind, build]) => [kind, make(build())]));
  // Where the container stands in front of the fire.
  const containerSpot = new THREE.Vector3(.95, 0, -1.8), fire = LAYOUT.find(piece => piece.id === 'foyer');
  const up = new THREE.Vector3(0, 1, 0), m = new THREE.Matrix4(), local = new THREE.Matrix4(), q = new THREE.Quaternion(), yaw = new THREE.Quaternion(), normal = new THREE.Vector3(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  let placed = [], time = 0;

  // Ground under a piece: its height, and the slope to lay small things on (at most 25°).
  function ground(x, z, r, { footprint = false, tilt = false } = {}) {
    const h = heightAt(x, z), e = heightAt(x + r, z), w = heightAt(x - r, z), s = heightAt(x, z + r), n = heightAt(x, z - r);
    const y = footprint ? h - .5 * (h - Math.min(h, e, w, s, n)) : h;
    if (!tilt) return { y, q: null };
    normal.set(w - e, 2 * r, n - s).normalize();
    const angle = Math.acos(Math.min(1, normal.y)), full = new THREE.Quaternion().setFromUnitVectors(up, normal);
    return { y, q: angle > .44 ? new THREE.Quaternion().slerp(full, .44 / angle) : full };
  }
  // Where the ground under the deck varies by more than 80 cm, a platform:
  // its top just above the highest ground, everything on it level.
  function platformFor(camp) {
    const c = Math.cos(camp.turn), s = Math.sin(camp.turn);
    let lo = Infinity, hi = -Infinity;
    for (const ax of [DECK.x0, 0, DECK.x1]) for (const az of [DECK.z0, (DECK.z0 + DECK.z1) / 2, DECK.z1]) {
      const h = heightAt(camp.x + (ax * c + az * s) * camp.scale, camp.z + (-ax * s + az * c) * camp.scale);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    return hi - lo > DECK.slope * camp.scale ? hi + DECK.lift * camp.scale : null;
  }
  function frame(camp, [ax, az], turn, scale, options, out) {
    const c = Math.cos(camp.turn), s = Math.sin(camp.turn);
    // Model -Z faces the trail: rotate the anchor by the camp's turn.
    const x = camp.x + (ax * c + az * s) * scale, z = camp.z + (-ax * s + az * c) * scale;
    const g = camp.platform != null ? { y: camp.platform, q: null } : ground(x, z, (options.footprint || .8) * scale, options);
    yaw.setFromAxisAngle(up, camp.turn + turn);
    q.copy(g.q ? g.q.multiply(yaw) : yaw);
    out.compose(v.set(x, g.y, z), q, sc.setScalar(scale));
    return out;
  }
  /** camps: [{ x, z, turn, scale, container: 'crate'|'chest', open, hideContainer }] (world units). */
  function set(list) {
    placed = list.slice(0, capacity).map(camp => ({ ...camp, fire: new THREE.Matrix4(), box: new THREE.Matrix4() }));
    placed.forEach(camp => { camp.platform = platformFor(camp); });
    let decks = 0;
    for (const camp of placed) if (camp.platform != null) platforms.setMatrixAt(decks++, m.compose(v.set(camp.x, camp.platform, camp.z), q.setFromAxisAngle(up, camp.turn), sc.setScalar(camp.scale)));
    platforms.count = decks; platforms.instanceMatrix.needsUpdate = true;
    for (const piece of pieces) {
      piece.mesh.count = placed.length;
      placed.forEach((camp, i) => piece.mesh.setMatrixAt(i, frame(camp, piece.at, piece.turn, camp.scale, piece, m)));
      piece.mesh.instanceMatrix.needsUpdate = true;
    }
    const counts = Object.fromEntries(Object.keys(containers).map(kind => [kind, 0]));
    for (const camp of placed) {
      frame(camp, fire.at, 0, camp.scale, { tilt: true }, camp.fire);
      frame(camp, [containerSpot.x, containerSpot.z], 0, camp.scale, { tilt: true, footprint: false }, camp.box);
      if (camp.hideContainer) continue;
      const kind = (camp.container === 'chest' ? 'chest' : 'crate') + (camp.open ? 'Open' : ''), mesh = containers[kind];
      mesh.setMatrixAt(counts[kind]++, camp.box);
    }
    for (const [kind, mesh] of Object.entries(containers)) { mesh.count = counts[kind]; mesh.instanceMatrix.needsUpdate = true; }
    flames.count = placed.length;
    group.visible = placed.length > 0;
    update(0);
  }
  /** Height of a platform's deck at (x, z), or null where there is none (for the troop's feet). */
  function standHeight(x, z) {
    for (const camp of placed) {
      if (camp.platform == null) continue;
      const c = Math.cos(camp.turn), s = Math.sin(camp.turn), dx = (x - camp.x) / camp.scale, dz = (z - camp.z) / camp.scale;
      const ax = dx * c - dz * s, az = dx * s + dz * c;
      if (ax >= DECK.x0 && ax <= DECK.x1 && az >= DECK.z0 && az <= DECK.z1) return camp.platform;
    }
    return null;
  }
  /** World transform of the container spot of camp i (for La Buse's live chest). */
  function containerTransform(i, position, quaternion) {
    const camp = placed[i]; if (!camp) return false;
    camp.box.decompose(position, quaternion, sc);
    return true;
  }
  function update(dt) {
    if (!group.visible) return;
    time += dt;
    // The flames flicker and sway, each camp at its own pace.
    placed.forEach((camp, i) => {
      const flick = 1 + .18 * Math.sin(time * 13 + i * 2.1) + .1 * Math.sin(time * 23.7 + i);
      local.compose(v.set(0, 0, 0), q.setFromAxisAngle(up, time * 1.5 + i), sc.set(1 + .08 * Math.sin(time * 9 + i), flick, 1 + .08 * Math.cos(time * 8 + i)));
      flames.setMatrixAt(i, m.multiplyMatrices(camp.fire, local));
    });
    flames.instanceMatrix.needsUpdate = true;
  }
  function dispose() { group.traverse(o => { o.geometry?.dispose(); }); lambert.dispose(); flames.material.dispose(); group.clear(); }
  return { group, set, update, containerTransform, containerSpot, standHeight, dispose, get count() { return placed.length; }, get platforms() { return placed.filter(camp => camp.platform != null).length; } };
}
