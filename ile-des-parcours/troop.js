import * as THREE from './vendor/three.module.js';
import { createTenrecAvatar } from './tenrec-avatar.js';

// The troop of the Fil d'Ariane: the heroes of the collection « Le cerveau
// expliqué aux petits explorateurs », after its character bible (edition/
// personnages.md): 18th-century Hauts, unbleached cloth and fibres, barefoot,
// no modern object. Each walker is ONE skinned mesh (one draw call) on a
// small rig: pelvis, spine, head, arms and legs with elbows and knees, a cape
// and a hand prop. Low-poly primitives are merged per bone with vertex colours.
// The tangue walks first: it is the guide and the narrator of the trail.
// Two glowing fireflies, Koko and Zéklèr (vol. 2), fly around it.
// Placeholder until the selected 0 A.D. models (CC BY-SA 3.0) are approved.

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const BONES = ['root', 'pelvis', 'spine', 'head', 'upperL', 'foreL', 'upperR', 'foreR', 'thighL', 'shinL', 'thighR', 'shinR', 'prop', 'cape'];
const B = Object.fromEntries(BONES.map((name, i) => [name, i]));

export const TROOP_CAST = Object.freeze([
  // Old man of vol. 2 and 4 (name still to be settled by the author).
  { id: 'grand-pere', label: 'Le grand-père', height: 1.7, child: false, skin: '#5a3a26', hair: 'curly', hairColour: '#e8e4dc', beard: '#ece8e0', hat: 'straw', hatBand: '#3f7d3a', top: '#7a5534', sleeves: 'long', bottom: '#6b4a2e', legs: 'long', cape: '#2f5d9e', prop: 'staff', pennant: true, stride: 1.25 },
  { id: 'cimendef', label: 'Cimendef', height: 1.38, child: true, skin: '#5b3a25', hair: 'curly', hairColour: '#17110d', bandana: '#e0562b', top: '#e9dfc7', sleeves: 'short', bottom: '#7a5232', legs: 'shorts', satchel: '#7a4a26', stride: 1.0 },
  { id: 'asma', label: 'Asma', height: 1.32, child: true, skin: '#a8703f', hair: 'big', hairColour: '#3b2416', headband: '#c4322b', top: '#efe6cf', sleeves: 'short', skirt: '#7a5232', necklace: true, satchel: '#cdb88f', stride: .95 },
  { id: 'sarlave', label: 'Sarlave', height: 1.26, child: true, skin: '#4f3121', hair: 'twoBraids', hairColour: '#1d1410', top: '#e6dcc2', sleeves: 'short', skirt: '#e6dcc2', belt: '#4d6b2a', necklace: true, stride: .9 },
  { id: 'raharianne', label: 'Raharianne', height: 1.48, child: true, skin: '#7a4f30', hair: 'longBraids', hairColour: '#22170f', vines: '#4f7a2c', top: '#6e4a2c', sleeves: 'short', skirt: '#6e4a2c', satchel: '#c9ab6a', woven: true, stride: 1.05 },
  { id: 'laverdure', label: 'Nanan Laverdure', height: 1.66, child: false, skin: '#4a2f20', hair: 'curly', hairColour: '#e4e0d8', beard: '#e9e5dc', top: '#8a6a48', sleeves: 'short', bottom: '#5e4a36', legs: 'rolled', necklace: true, prop: 'stick', stride: 1.2 },
]);

// Geometry accumulator: every primitive is rigidly bound to one bone.
function createBuilder() {
  const positions = [], normals = [], colours = [], skinIndex = [], skinWeight = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), t = new THREE.Vector3();
  const n = new THREE.Matrix3(), p = new THREE.Vector3(), v = new THREE.Vector3(), c = new THREE.Color();
  function add(geometry, bone, colour, { at = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], shade = null } = {}) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    m.compose(t.fromArray(at), q.setFromEuler(e.set(...rot)), s.fromArray(scale)); n.getNormalMatrix(m);
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i); const local = p.clone();
      p.applyMatrix4(m); v.fromBufferAttribute(nor, i).applyMatrix3(n).normalize();
      positions.push(p.x, p.y, p.z); normals.push(v.x, v.y, v.z);
      c.set(typeof shade === 'function' ? shade(local, colour) : colour);
      colours.push(c.r, c.g, c.b); skinIndex.push(bone, 0, 0, 0); skinWeight.push(1, 0, 0, 0);
    }
    if (g !== geometry) g.dispose(); geometry.dispose();
  }
  function build() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    geometry.computeBoundingSphere();
    return geometry;
  }
  return { add, build };
}
const cyl = (rt, rb, h, seg = 8, open = false, start = 0, len = TAU) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open, start, len);
const ball = (r, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);

// Body proportions in metres; children keep a larger head and shorter legs.
export function proportions(spec) {
  const h = spec.height, k = h / 1.72;
  const hip = h * (spec.child ? .47 : .51), torso = h * (spec.child ? .27 : .29);
  return {
    h, k, hip, torso, shoulder: hip + torso, thigh: hip * .5, shin: hip * .5 - .03,
    head: (spec.child ? .134 : .118) * Math.pow(k, .3), shoulderW: h * (spec.child ? .1 : .108), hipW: h * .052,
    upper: h * .17, fore: h * .145,
  };
}

function buildCharacter(spec) {
  const P = proportions(spec), { k, hip, torso, shoulder, thigh, shin, head: r, shoulderW, hipW, upper, fore } = P;
  const b = createBuilder();
  const headY = shoulder + .05 * k + r;
  const legSkin = spec.skirt || spec.legs === 'shorts';
  // Legs, from hip joints: thigh, knee, shin and bare feet (sandal soles for adults).
  for (const side of [-1, 1]) {
    const thighBone = side < 0 ? B.thighL : B.thighR, shinBone = side < 0 ? B.shinL : B.shinR, x = side * hipW;
    b.add(cyl(.078 * k, .062 * k, thigh, 8), thighBone, legSkin ? spec.skin : spec.bottom, { at: [x, hip - .02 - thigh / 2, 0] });
    if (spec.legs === 'shorts') b.add(cyl(.088 * k, .08 * k, thigh * .5, 8), thighBone, spec.bottom, { at: [x, hip - .02 - thigh * .25, 0] });
    const shinTop = hip - .02 - thigh;
    if (spec.legs === 'long') b.add(cyl(.06 * k, .05 * k, shin, 8), shinBone, spec.bottom, { at: [x, shinTop - shin / 2, 0] });
    else if (spec.legs === 'rolled') {
      b.add(cyl(.054 * k, .05 * k, shin * .45, 8), shinBone, spec.bottom, { at: [x, shinTop - shin * .225, 0] });
      b.add(cyl(.062 * k, .062 * k, .05 * k, 8), shinBone, spec.bottom, { at: [x, shinTop - shin * .45, 0], shade: () => '#6e5a44' });
      b.add(cyl(.047 * k, .042 * k, shin * .55, 8), shinBone, spec.skin, { at: [x, shinTop - shin * .725, 0] });
    } else b.add(cyl(.056 * k, .045 * k, shin, 8), shinBone, spec.skin, { at: [x, shinTop - shin / 2, 0] });
    b.add(box(.085 * k, .05 * k, .19 * k), shinBone, spec.skin, { at: [x, .03, -.04 * k] });
    if (!spec.child) b.add(box(.09 * k, .014, .2 * k), shinBone, '#6b5236', { at: [x, .007, -.04 * k] });
  }
  // Hips, then skirt or dress flaring from the waist.
  b.add(cyl(.15 * k, .155 * k, .15 * k, 10), B.pelvis, spec.skirt || spec.bottom, { at: [0, hip + .03, 0], scale: [1, 1, .72] });
  if (spec.skirt) b.add(cyl(.152 * k, .25 * k, hip * .52, 12), B.pelvis, spec.skirt, { at: [0, hip + .04 - hip * .26, 0], scale: [1, 1, .82], shade: (p, col) => p.y < -hip * .2 ? new THREE.Color(col).multiplyScalar(.86) : col });
  // Torso: a tapered, flattened trunk; chest slightly forward.
  b.add(cyl(shoulderW * .98, .145 * k, torso, 10), B.spine, spec.top, { at: [0, hip + .02 + torso / 2, 0], scale: [1, 1, .62] });
  b.add(ball(shoulderW * .95, 10, 6), B.spine, spec.top, { at: [0, shoulder - .02 * k, 0], scale: [1, .38, .62] });
  if (spec.belt) b.add(new THREE.TorusGeometry(.148 * k, .014 * k, 5, 14), B.spine, spec.belt, { at: [0, hip + .07 * k, 0], rot: [Math.PI / 2, 0, 0], scale: [1, .72, 1] });
  if (spec.necklace) b.add(new THREE.TorusGeometry(.075 * k, .012 * k, 4, 16), B.spine, '#a3201c', { at: [0, shoulder - .015, -.02 * k], rot: [Math.PI / 2.4, 0, 0], shade: p => Math.atan2(p.y, p.x) * 8 % 2 > 1 ? '#a3201c' : '#1c1612' });
  // Crossbody satchel: bag on the right hip, strap over the left shoulder.
  if (spec.satchel) {
    const strapLength = Math.hypot(shoulderW * 1.7, torso * .9), angle = Math.atan2(shoulderW * 1.7, torso * .9);
    b.add(box(.17 * k, .15 * k, .07 * k), B.spine, spec.satchel, { at: [shoulderW * .95, hip + .06 * k, .02], shade: spec.woven ? (p, col) => Math.floor((p.y + 1) * 60) % 2 ? col : '#9c7f45' : null });
    for (const z of [-.098 * k, .098 * k]) b.add(box(.035 * k, strapLength, .012), B.spine, spec.satchel, { at: [0, hip + .06 * k + torso * .45, z], rot: [0, 0, -angle] });
  }
  // Arms: sleeve at the top, skin below, a hand at the end.
  for (const side of [-1, 1]) {
    const upperBone = side < 0 ? B.upperL : B.upperR, foreBone = side < 0 ? B.foreL : B.foreR, x = side * shoulderW, y = shoulder - .04 * k;
    b.add(cyl(.047 * k, .041 * k, upper, 7), upperBone, spec.sleeves === 'long' ? spec.top : spec.skin, { at: [x, y - upper / 2, 0] });
    if (spec.sleeves === 'short') b.add(cyl(.056 * k, .052 * k, upper * .4, 7), upperBone, spec.top, { at: [x, y - upper * .18, 0] });
    b.add(cyl(.04 * k, .033 * k, fore, 7), foreBone, spec.sleeves === 'long' ? spec.top : spec.skin, { at: [x, y - upper - fore / 2, 0] });
    b.add(ball(.042 * k, 7, 5), foreBone, spec.skin, { at: [x, y - upper - fore - .03 * k, 0], scale: [.8, 1.15, .9] });
  }
  // Head: neck, face (nose, ears, eyes), then hair and headwear.
  b.add(cyl(.045 * k, .05 * k, .08 * k, 7), B.head, spec.skin, { at: [0, shoulder + .02 * k, 0] });
  b.add(ball(r, 12, 10), B.head, spec.skin, { at: [0, headY, 0], scale: [.94, 1.06, 1] });
  b.add(ball(r * .2, 6, 4), B.head, spec.skin, { at: [0, headY - r * .12, -r * .97], scale: [1, .9, 1] });
  for (const side of [-1, 1]) {
    b.add(ball(r * .22, 6, 4), B.head, spec.skin, { at: [side * r * .93, headY, 0], scale: [.5, 1, .8] });
    b.add(ball(r * .12, 6, 4), B.head, '#16110d', { at: [side * r * .36, headY + r * .12, -r * .9] });
    b.add(ball(r * .055, 5, 3), B.head, '#f4efe4', { at: [side * r * .33, headY + r * .16, -r * 1.0] });
  }
  const cap = (scale, colour, offset = [0, 0, 0]) => b.add(new THREE.SphereGeometry(r, 12, 7, 0, TAU, 0, Math.PI * .56), B.head, colour, { at: [offset[0], headY + offset[1], offset[2]], scale });
  if (spec.hair === 'cap') cap([1.03, 1.06, 1.05], spec.hairColour, [0, .01 * k, .012]);
  if (spec.hair === 'curly') b.add(new THREE.IcosahedronGeometry(r * 1.02, 1), B.head, spec.hairColour, { at: [0, headY + r * .3, r * .1], scale: [.98, .62, .98] });
  if (spec.hair === 'big') b.add(new THREE.IcosahedronGeometry(r * 1.42, 1), B.head, spec.hairColour, { at: [0, headY + r * .2, r * .3], scale: [1.08, .95, 1] });
  if (spec.hair === 'twoBraids' || spec.hair === 'longBraids') {
    cap([1.04, 1.06, 1.06], spec.hairColour, [0, .01 * k, .015]);
    const braids = spec.hair === 'twoBraids' ? [[-1, 0], [1, 0]] : [[-.55, .7], [0, .85], [.55, .7]];
    for (const [sx, back] of braids) for (let i = 0; i < (spec.hair === 'twoBraids' ? 4 : 5); i++) {
      const two = spec.hair === 'twoBraids', y = headY - r * (two ? .05 + i * .42 : .15 + i * .38), size = r * (two ? .36 - i * .04 : .2);
      b.add(ball(size, 6, 4), B.head, spec.hairColour, { at: [sx * r * (two ? 1.05 + i * .05 : .95), y, r * (.15 + back)] });
      if (spec.vines && i % 2) b.add(ball(size * .6, 5, 3), B.head, spec.vines, { at: [sx * r * .95 + .015, y, r * (.15 + back) + size * .8], scale: [1.4, .6, .8] });
    }
  }
  if (spec.beard) b.add(ball(r * .62, 8, 6), B.head, spec.beard, { at: [0, headY - r * .62, -r * .5], scale: [1.1, .9, .75] });
  if (spec.bandana) {
    cap([1.1, 1.0, 1.1], spec.bandana, [0, r * .1, .01]);
    b.add(ball(r * .22, 6, 4), B.head, spec.bandana, { at: [r * 1.02, headY + r * .2, r * .35] });
    b.add(box(r * .14, r * .5, r * .1), B.head, spec.bandana, { at: [r * 1.05, headY - r * .1, r * .45], rot: [.3, 0, -.25] });
  }
  if (spec.headband) b.add(new THREE.TorusGeometry(r * 1.03, r * .1, 5, 16), B.head, spec.headband, { at: [0, headY + r * .38, 0], rot: [Math.PI / 2 + .25, 0, 0], shade: p => Math.atan2(p.y, p.x) * 6 % 2 > 1.6 ? '#f0d8a0' : spec.headband });
  if (spec.hat === 'straw') {
    const straw = (p, col) => Math.floor(Math.atan2(p.z, p.x) * 9 + p.y * 300) % 2 ? col : '#c9a457';
    b.add(cyl(r * 2.4, r * 2.45, .018, 18), B.head, '#dcbc70', { at: [0, headY + r * .62, 0], shade: straw });
    b.add(cyl(r * .92, r * 1.06, r * .78, 12), B.head, '#dcbc70', { at: [0, headY + r * 1.0, 0], shade: straw });
    b.add(cyl(r * 1.08, r * 1.08, r * .2, 12), B.head, spec.hatBand, { at: [0, headY + r * .72, 0] });
  }
  // Cape: an open, flared shell hung from the shoulders, on its own bone.
  if (spec.cape) {
    const length = shoulder - hip * .42;
    b.add(cyl(shoulderW * 1.12, shoulderW * 1.75, length, 12, true, -Math.PI * .62, Math.PI * 1.24), B.cape, spec.cape, { at: [0, shoulder + .01 - length / 2, .015], scale: [1, 1, .8], shade: (p, col) => p.y < -length * .3 ? new THREE.Color(col).multiplyScalar(.82) : col });
  }
  // Hand prop: a long wooden staff (a gnarled stick for Laverdure).
  const propLength = spec.prop === 'staff' ? 1.55 * k : 1.05 * k;
  if (spec.prop) {
    b.add(cyl(.022 * k, .026 * k, propLength, 6), B.prop, '#6b4a2b', { at: [shoulderW + .06 * k, shoulder - .04 * k - upper - fore - .03 * k + propLength * .32, 0] });
    if (spec.prop === 'stick') for (const y of [.25, .55, .8]) b.add(ball(.032 * k, 5, 3), B.prop, '#5a3c22', { at: [shoulderW + .07 * k, shoulder - .04 * k - upper - fore + propLength * (y - .45), 0] });
  }
  const geometry = b.build();

  // Rig at rest: bone positions match the geometry above.
  const bones = BONES.map(name => { const bone = new THREE.Bone(); bone.name = name; return bone; });
  const place = (name, parent, x, y, z) => { bones[B[name]].position.set(x, y, z); if (parent) bones[B[parent]].add(bones[B[name]]); };
  place('root', null, 0, 0, 0);
  place('pelvis', 'root', 0, hip, 0);
  place('spine', 'pelvis', 0, .02, 0);
  place('head', 'spine', 0, torso - .02, 0);
  place('upperL', 'spine', -shoulderW, torso - .06 * k, 0); place('foreL', 'upperL', 0, -upper, 0);
  place('upperR', 'spine', shoulderW, torso - .06 * k, 0); place('foreR', 'upperR', 0, -upper, 0);
  place('thighL', 'pelvis', -hipW, -.02, 0); place('shinL', 'thighL', 0, -thigh, 0);
  place('thighR', 'pelvis', hipW, -.02, 0); place('shinR', 'thighR', 0, -thigh, 0);
  place('prop', 'foreR', 0, -fore - .03 * k, 0);
  place('cape', 'spine', 0, torso, .03);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: spec.cape ? THREE.DoubleSide : THREE.FrontSide });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = `Troupe — ${spec.label}`; mesh.frustumCulled = false;
  mesh.add(bones[B.root]); mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
  return { mesh, bones, spec, P, triangles: geometry.getAttribute('position').count / 3 };
}

// Shared walk/rest animation of a human rig; w holds the gait state.
function poseCharacter(c, w) {
  const bone = c.bones, swing = w.swing, still = 1 - swing, phi = w.phase, sin = Math.sin(phi), cos = Math.cos(phi), child = c.spec.child;
  const stride = child ? .6 : .5, breathe = Math.sin(w.idle * 1.7) * .012;
  // Legs: hip swing; knees fold during the forward swing, lightly at contact.
  bone[B.thighL].rotation.set(stride * sin * swing, 0, 0);
  bone[B.thighR].rotation.set(-stride * sin * swing, 0, 0);
  bone[B.shinL].rotation.set(-(.08 + .95 * Math.max(0, cos) ** 1.4) * swing, 0, 0);
  bone[B.shinR].rotation.set(-(.08 + .95 * Math.max(0, -cos) ** 1.4) * swing, 0, 0);
  // Pelvis bobs twice per stride, sways and leans into the slope.
  bone[B.pelvis].position.y = c.P.hip + (Math.abs(cos) * .035 - .02) * swing * c.P.k;
  bone[B.pelvis].rotation.set(0, sin * .1 * swing, cos * .035 * swing);
  bone[B.spine].rotation.set(-w.lean - .04 * swing + breathe * still, -sin * .16 * swing, -cos * .02 * swing);
  // Arms swing against the legs; elbows bend a little more going forward.
  const armL = -.42 * sin * swing, armR = .42 * sin * swing;
  bone[B.upperL].rotation.set(armL, 0, -.08 - .03 * still);
  bone[B.foreL].rotation.set(.22 + Math.max(0, armL) * .6 + .05 * still, 0, 0);
  if (c.spec.prop) {
    // The staff hand stays forward; the prop bone keeps the staff upright.
    const upperAngle = .32 + .12 * sin * swing, foreAngle = .85;
    bone[B.upperR].rotation.set(upperAngle, 0, .1);
    bone[B.foreR].rotation.set(foreAngle, 0, 0);
    bone[B.prop].rotation.set(-(upperAngle + foreAngle) + .08 * sin * swing, 0, -.1);
  } else {
    bone[B.upperR].rotation.set(armR, 0, .08 + .03 * still);
    bone[B.foreR].rotation.set(.22 + Math.max(0, armR) * .6 + .05 * still, 0, 0);
  }
  // Head: a small nod when walking, a slow look around when resting.
  const look = Math.sin(w.idle * .45 + c.P.h * 7) * .55 * still;
  bone[B.head].rotation.set(.04 * Math.sin(phi * 2) * swing + w.lean * .5, look - (-sin * .16 * swing) * .6, 0);
  // The cape flows back while walking.
  bone[B.cape].rotation.set(.06 + .14 * swing + .04 * Math.sin(phi * 2) * swing, 0, 0);
}
function stepGait(w, spec, { moving, distance = 0, dt = 0, strideScale = 1, slope = 0 }) {
  // Gait phase advances with distance walked, not time: feet do not slide.
  if (moving) w.phase = (w.phase + Math.abs(distance) / (spec.stride * strideScale) * TAU) % TAU;
  w.swing += ((moving ? 1 : 0) - w.swing) * Math.min(1, dt * 6);
  w.lean += (clamp(slope, -.9, .9) * .32 - w.lean) * Math.min(1, dt * 4);
  w.idle += dt;
}

export const TANGUE = Object.freeze({ id: 'tangue', label: 'Le tangue', tenrec: true, height: .65, eye: .55, stride: 1.8 });

// The zarboutans: elders waiting at their îlets, built like the troop but
// standing by the fire. Women (Granmèr, Tantine, Nénène, Héva) wear a skirt
// and a headscarf; men a straw hat or nothing, a beard, a stick. Colours vary
// with the number, from the same 18th-century cloths as the troop.
const ELDER_CLOTH = ['#7a5534', '#8a6a48', '#6e4a2c', '#9b7a50', '#5e4a36', '#a0623a', '#6b5a3a', '#836146'];
const ELDER_SCARF = ['#c4322b', '#2f5d9e', '#4d6b2a', '#d08a2b', '#7d3c8c', '#1f7a72'];
export function elderSpec(numero, female) {
  const n = Math.max(1, numero | 0), pick = (list, salt) => list[(n * 7 + salt) % list.length];
  const base = { id: `zarboutan-${n}`, label: 'Zarboutan', child: false, skin: ['#5a3a26', '#4a2f20', '#7a4f30', '#a8703f', '#6b4428'][n % 5], top: pick(ELDER_CLOTH, 2), necklace: n % 3 === 0 };
  if (female) return { ...base, height: 1.58, hair: 'big', hairColour: '#e8e4dc', headband: pick(ELDER_SCARF, 1), sleeves: 'long', skirt: pick(ELDER_CLOTH, 5), prop: n % 2 ? 'stick' : null, stride: 1.1 };
  return { ...base, height: 1.66, hair: 'curly', hairColour: '#e4e0d8', beard: n % 2 ? '#ece8e0' : null, hat: n % 3 === 1 ? 'straw' : null, hatBand: pick(ELDER_SCARF, 3), sleeves: n % 2 ? 'long' : 'short', bottom: pick(ELDER_CLOTH, 6), legs: n % 2 ? 'rolled' : 'long', prop: 'stick', cape: n % 5 === 0 ? '#2f5d9e' : null, stride: 1.2 };
}
/** One elder, still, breathing and looking around: `mesh` is in metres, facing −Z like the troop. */
export function createElder(spec) {
  const c = buildCharacter(spec), w = { phase: 0, swing: 0, lean: 0, idle: spec.height * 3 };
  return {
    mesh: c.mesh, spec,
    update(dt) { stepGait(w, spec, { moving: false, dt }); poseCharacter(c, w); },
    dispose() { c.mesh.geometry.dispose(); c.mesh.material.dispose(); c.mesh.skeleton.dispose(); c.mesh.removeFromParent(); },
  };
}
/** Eye height in metres, for first-person views of a member. */
export const eyeHeightOf = spec => spec.tenrec ? spec.eye : proportions(spec).shoulder + .05 * proportions(spec).k + proportions(spec).head * 1.1;

/** One member as the explorer's own avatar, in metres, facing +Z like the
 * tangue (the player controller's convention). update() reads player info. */
export function createCharacterAvatar(id) {
  const spec = TROOP_CAST.find(c => c.id === id); if (!spec) return null;
  const c = buildCharacter(spec), group = new THREE.Group(); group.name = `Avatar — ${spec.label}`;
  c.mesh.rotation.y = Math.PI; group.add(c.mesh);
  const w = { phase: 0, swing: 0, lean: 0, idle: 0 }, eye = eyeHeightOf(spec);
  return {
    group, spec,
    morphology: { eyeHeightMeters: eye, thirdPersonFocusMeters: eye * .82, followDistanceMeters: spec.child ? 3.6 : 4.3 },
    update(dt, info = {}) {
      const speed = Number.isFinite(info.speedMetersPerSecond) ? info.speedMetersPerSecond : 0;
      const moving = info.mode !== 'orbit' && info.onGround !== false && !info.flight?.active && info.moving !== false && speed > .05;
      stepGait(w, spec, { moving, distance: speed * dt, dt });
      poseCharacter(c, w);
    },
    dispose() { c.mesh.geometry.dispose(); c.mesh.material.dispose(); c.mesh.skeleton.dispose(); group.removeFromParent(); },
  };
}

export function createTroop({ flagColor = '#f2c14e' } = {}) {
  const group = new THREE.Group(); group.name = 'Troupe du Fil d’Ariane';
  const humans = TROOP_CAST.map(buildCharacter);
  // The tangue leads: an independent instance of the explorer's tenrec rig.
  const tangue = createTenrecAvatar();
  const members = [{ spec: TANGUE, tenrec: tangue, object: tangue.group }, ...humans.map(c => ({ spec: c.spec, human: c, object: c.mesh }))];
  const roots = members.map(member => { const root = new THREE.Group(); root.add(member.object); group.add(root); return root; });
  // The grand-father's pennant in the trail colour, tied to the top of his staff.
  const guide = humans[0], P0 = guide.P;
  const pennant = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -.32, 0), new THREE.Vector3(.5, -.15, .04)]), new THREE.MeshBasicMaterial({ color: flagColor, side: THREE.DoubleSide }));
  pennant.position.set(P0.shoulderW + .06 * P0.k, P0.shoulder - .04 * P0.k - P0.upper - P0.fore - .03 * P0.k + 1.55 * P0.k * .82, 0);
  // The pennant hangs from the prop bone, so it follows the staff.
  const propBone = guide.bones[B.prop]; propBone.updateMatrixWorld(true);
  pennant.position.sub(new THREE.Vector3().setFromMatrixPosition(propBone.matrixWorld)); propBone.add(pennant);
  // Koko (golden) and Zéklèr (blue-green), the fireflies of vol. 2.
  const fireflies = [['#ffd34d', 0], ['#53e3c9', Math.PI]].map(([colour, phase]) => {
    const fly = new THREE.Group();
    fly.add(new THREE.Mesh(new THREE.SphereGeometry(.07, 8, 6), new THREE.MeshBasicMaterial({ color: colour })));
    fly.add(new THREE.Mesh(new THREE.SphereGeometry(.19, 10, 8), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: .32, depthWrite: false, blending: THREE.AdditiveBlending })));
    fly.userData.phase = phase; group.add(fly); return fly;
  });
  const marks = (colour, opacity, inner, outer) => {
    const mesh = new THREE.InstancedMesh(inner ? new THREE.RingGeometry(inner, outer, 24).rotateX(-Math.PI / 2) : new THREE.CircleGeometry(outer, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false }), members.length);
    mesh.frustumCulled = false; mesh.renderOrder = 2; group.add(mesh); return mesh;
  };
  const ring = marks('#8df07a', .85, .36, .47), shadow = marks('#1d2a20', .3, 0, .4);
  const walkers = members.map((member, i) => ({ phase: i * 1.9, swing: 0, x: 0, y: 0, z: 0, heading: 0, lean: 0, moving: false, idle: i * 2.3, speed: 0, hidden: false }));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  let scale = 1, selected = true, time = 0, placed = false, bubble = null;

  function setWalker(i, { x, y, z, heading, moving, strideScale = 1, dt = 0, distance = 0, slope = 0 }) {
    const w = walkers[i]; if (!w) return;
    w.x = x; w.y = y; w.z = z; w.moving = moving;
    // Turn smoothly along hairpin bends instead of snapping at each vertex.
    const turn = Math.atan2(Math.sin(heading - w.heading), Math.cos(heading - w.heading));
    w.heading = placed ? w.heading + turn * Math.min(1, dt * 7) : heading;
    stepGait(w, members[i].spec, { moving, distance, dt, strideScale, slope });
    w.speed = dt > 0 ? distance / dt / Math.max(strideScale, 1e-6) : 0;
  }
  function commit(unitsPerMeter) {
    const k = scale * unitsPerMeter;
    walkers.forEach((w, i) => {
      const member = members[i], root = roots[i];
      // Members brushing past a close camera are hidden so they never fill the frame.
      const inBubble = bubble && Math.hypot(w.x - bubble.x, w.y - bubble.y, w.z - bubble.z) < bubble.radius;
      root.visible = !w.hidden && !inBubble;
      root.position.set(w.x, w.y, w.z); root.scale.setScalar(k);
      if (member.tenrec) {
        // The tenrec model faces +Z: turn it to the trail heading.
        root.rotation.set(0, Math.PI - w.heading, 0);
        member.tenrec.update(w.dt || 0, { speedMetersPerSecond: w.moving ? w.speed : 0, moving: w.moving, onGround: true, mode: 'third' });
      } else { root.rotation.set(0, -w.heading, 0); poseCharacter(member.human, w); }
      const foot = member.tenrec ? .9 : member.human.P.k * 1.1;
      m.compose(v.set(w.x, w.y + .1 * k, w.z), q.identity(), s.set(k * foot, k, k * foot));
      ring.setMatrixAt(i, w.hidden ? hiddenMatrix : m); shadow.setMatrixAt(i, w.hidden ? hiddenMatrix : m);
    });
    ring.instanceMatrix.needsUpdate = shadow.instanceMatrix.needsUpdate = true;
    ring.visible = selected; shadow.visible = !selected;
    // Fireflies loop around the tangue, in figure-of-eight paths.
    const g = walkers[0];
    fireflies.forEach(fly => {
      const a = time * 1.6 + fly.userData.phase;
      fly.position.set(g.x + Math.sin(a) * .8 * k, g.y + (1.35 + .2 * Math.sin(a * 2.3)) * k, g.z + Math.sin(a * 2) * .5 * k);
      fly.scale.setScalar(k * (1 + .12 * Math.sin(time * 9 + fly.userData.phase)));
    });
    placed = true;
  }
  function tick(dt) { time += dt; for (const w of walkers) w.dt = dt; }
  function setScale(value) { scale = Math.max(.5, value); }
  function setSelected(value) { selected = !!value; }
  function setFlagColor(value) { pennant.material.color.set(value); }
  function setHidden(i, value) { if (walkers[i]) walkers[i].hidden = !!value; }
  function setCameraBubble(position, radius) { bubble = position && radius > 0 ? { x: position.x, y: position.y, z: position.z, radius } : null; }
  function getLeader() { return walkers[0]; }
  function getWalker(i) { const w = walkers[i]; return w && { x: w.x, y: w.y, z: w.z, heading: w.heading, moving: w.moving, spec: members[i].spec, eye: eyeHeightOf(members[i].spec), phase: w.phase, swing: w.swing }; }
  function getInfo() { return { walkers: members.map(member => member.spec.label), drawCalls: humans.length + 14 + fireflies.length * 2 + 3, triangles: Math.round(humans.reduce((n, c) => n + c.triangles, 0) + tangue.getInfo().triangles), bones: BONES.length }; }
  function dispose() {
    tangue.dispose();
    group.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); if (o.isSkinnedMesh) o.skeleton.dispose(); });
    group.clear();
  }
  return { group, count: members.length, cast: members.map(member => member.spec), setWalker, commit, tick, setScale, setSelected, setFlagColor, setHidden, setCameraBubble, getLeader, getWalker, getInfo, dispose };
}
