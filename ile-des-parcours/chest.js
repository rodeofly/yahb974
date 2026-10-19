import * as THREE from './vendor/three.module.js';

// « Le coffre de La Buse »: the container that holds each riddle, in front of
// the îlet's fire: a wooden crate for a riddle ('caisse'), the pirate's chest
// at the trail's end ('coffre'). It waits glowing and humming with sparkles,
// like a game chest; a click opens the lid in a burst of golden light, shows
// the loot, and a parchment rises out of it. Metres, front towards -Z, base
// at y = 0.
const TAU = Math.PI * 2;

function woodGeometry(width, height, depth, planks = 5) {
  const geometry = new THREE.BoxGeometry(width, height, depth, 1, planks, 1);
  const position = geometry.getAttribute('position'), colours = [];
  for (let i = 0; i < position.count; i++) {
    const band = Math.floor((position.getY(i) / height + .5) * planks - 1e-6);
    const shade = band % 2 ? .82 : 1;
    colours.push(.47 * shade, .28 * shade, .14 * shade);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  return geometry;
}

export function createChest() {
  const group = new THREE.Group(); group.name = 'Coffre de La Buse'; group.visible = false;
  const wood = new THREE.MeshLambertMaterial({ vertexColors: true });
  const gold = new THREE.MeshLambertMaterial({ color: '#f2c14e', emissive: '#6b4b08' });
  const glowMaterial = new THREE.MeshBasicMaterial({ color: '#ffd66b', transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false });
  const add = (parent, geometry, material, position, rotation = [0, 0, 0]) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position); mesh.rotation.set(...rotation); parent.add(mesh); return mesh; };
  // The pirate chest: body, gold bands, lock, and a half-barrel lid hinged
  // at the back edge.
  const coffre = new THREE.Group(); group.add(coffre);
  add(coffre, woodGeometry(1.25, .62, .82), wood, [0, .31, 0]);
  for (const x of [-.5, .5]) add(coffre, new THREE.BoxGeometry(.09, .64, .86), gold, [x, .31, 0]);
  add(coffre, new THREE.BoxGeometry(1.29, .08, .86), gold, [0, .6, 0]);
  add(coffre, new THREE.BoxGeometry(.2, .24, .05), gold, [0, .48, -.43]);
  const coffreHinge = new THREE.Group(); coffreHinge.position.set(0, .62, .41); coffre.add(coffreHinge);
  const lidShape = new THREE.CylinderGeometry(.41, .41, 1.25, 16, 1, false, 0, Math.PI);
  lidShape.rotateZ(Math.PI / 2); lidShape.rotateX(Math.PI / 2);
  add(coffreHinge, lidShape, new THREE.MeshLambertMaterial({ color: '#7a4a24' }), [0, 0, -.41]);
  for (const x of [-.5, .5]) {
    const band = new THREE.CylinderGeometry(.425, .425, .09, 16, 1, true, 0, Math.PI); band.rotateZ(Math.PI / 2); band.rotateX(Math.PI / 2);
    add(coffreHinge, band, new THREE.MeshLambertMaterial({ color: '#f2c14e', emissive: '#6b4b08', side: THREE.DoubleSide }), [x, 0, -.41]);
  }
  // The explorers' crate: planks, iron corners, a flat lid hinged at the back.
  const caisse = new THREE.Group(); group.add(caisse);
  const iron = new THREE.MeshLambertMaterial({ color: '#3a3430' });
  add(caisse, woodGeometry(1.1, .62, .72, 4), wood, [0, .31, 0]);
  for (const x of [-.54, .54]) for (const z of [-.35, .35]) add(caisse, new THREE.BoxGeometry(.06, .64, .06), iron, [x, .32, z]);
  add(caisse, new THREE.BoxGeometry(.18, .16, .04), iron, [0, .5, -.37]);
  const caisseHinge = new THREE.Group(); caisseHinge.position.set(0, .62, .36); caisse.add(caisseHinge);
  add(caisseHinge, woodGeometry(1.14, .07, .76, 1), wood, [0, .035, -.38]);
  for (const x of [-.4, .4]) add(caisseHinge, new THREE.BoxGeometry(.06, .08, .78), iron, [x, .04, -.38]);
  // Treasure glow and the loot inside, seen once the lid is open.
  const inner = add(group, new THREE.PlaneGeometry(1.0, .62), glowMaterial, [0, .58, 0], [-Math.PI / 2, 0, 0]);
  const loot = new THREE.Group(); loot.visible = false; group.add(loot);
  const coin = new THREE.CylinderGeometry(.07, .07, .02, 10), coinMaterial = new THREE.MeshLambertMaterial({ color: '#ffd34d', emissive: '#7a5a10' });
  for (let i = 0; i < 14; i++) add(loot, coin, coinMaterial, [Math.sin(i * 2.4) * .32, .6 + (i % 4) * .025, Math.cos(i * 1.7) * .2], [Math.sin(i) * .6, 0, Math.cos(i * 3) * .6]);
  ['#e0304a', '#2bc47f', '#4a8ff0'].forEach((colour, i) => add(loot, new THREE.OctahedronGeometry(.08, 0), new THREE.MeshLambertMaterial({ color: colour, emissive: colour, emissiveIntensity: .35 }), [(i - 1) * .3, .68, .05 * i]));
  let hinge = coffreHinge, style = 'coffre';
  // A beam of light and sparkles.
  const beam = add(group, new THREE.CylinderGeometry(.25, .7, 4, 18, 1, true), new THREE.MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), [0, 2.6, 0]);
  const halo = add(group, new THREE.RingGeometry(.7, 1.15, 32), new THREE.MeshBasicMaterial({ color: '#ffd66b', transparent: true, opacity: .45, blending: THREE.AdditiveBlending, depthWrite: false }), [0, .03, 0], [-Math.PI / 2, 0, 0]);
  const count = 70, sparkPositions = new Float32Array(count * 3), seeds = Array.from({ length: count }, (_, i) => ({ a: Math.random() * TAU, r: .2 + Math.random() * .6, speed: .3 + Math.random() * .7, phase: Math.random() }));
  const sparkGeometry = new THREE.BufferGeometry(); sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  const sparks = new THREE.Points(sparkGeometry, new THREE.PointsMaterial({ color: '#fff1b0', size: .09, transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false }));
  group.add(sparks);
  // The parchment that rises with the riddle.
  const scroll = new THREE.Group(); scroll.visible = false; group.add(scroll);
  const paper = new THREE.MeshLambertMaterial({ color: '#f3e3b8', side: THREE.DoubleSide });
  add(scroll, new THREE.PlaneGeometry(.62, .78), paper, [0, 0, 0]);
  for (const y of [.4, -.4]) add(scroll, new THREE.CylinderGeometry(.05, .05, .72, 10), new THREE.MeshLambertMaterial({ color: '#c9a061' }), [0, y, 0], [0, 0, Math.PI / 2]);
  scroll.add(new THREE.Mesh(new THREE.CircleGeometry(.08, 16), new THREE.MeshLambertMaterial({ color: '#a3201c' })));
  scroll.children.at(-1).position.set(0, -.15, .01);

  let time = 0, state = 'closed', openT = 0, onOpened = null;
  const easeOutBack = t => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;
  function show(kind = 'coffre') {
    style = kind === 'caisse' ? 'caisse' : 'coffre'; hinge = style === 'caisse' ? caisseHinge : coffreHinge;
    coffre.visible = style === 'coffre'; caisse.visible = style === 'caisse';
    group.visible = true; state = 'closed'; openT = 0; coffreHinge.rotation.x = caisseHinge.rotation.x = 0; scroll.visible = false; loot.visible = false; beam.material.opacity = 0;
  }
  function hide() { group.visible = false; state = 'closed'; onOpened = null; }
  function open(callback) {
    if (state !== 'closed') return false;
    state = 'opening'; openT = 0; onOpened = callback || null; scroll.visible = true; loot.visible = true;
    return true;
  }
  function update(dt) {
    if (!group.visible) return;
    time += dt;
    const hum = .5 + .5 * Math.sin(time * 4);
    if (state === 'opening' || state === 'open') openT += dt;
    const lid = state === 'closed' ? .04 * Math.sin(time * 6) * hum : (style === 'caisse' ? -1.75 : -1.95) * easeOutBack(Math.min(1, openT / .7));
    hinge.rotation.x = lid;
    const burst = state === 'closed' ? 0 : Math.max(0, 1 - openT / 1.6);
    beam.material.opacity = state === 'closed' ? 0 : .25 + .55 * burst;
    beam.scale.set(1 + burst, 1 + burst * .6, 1 + burst);
    inner.material.opacity = state === 'closed' ? .15 + .2 * hum : .95;
    halo.material.opacity = .25 + .3 * hum + burst * .5; halo.scale.setScalar(1 + .08 * hum + burst * .8);
    // Sparkles spiral up; faster and higher in the burst.
    seeds.forEach((s, i) => {
      const u = (s.phase + time * s.speed * (1 + burst * 3)) % 1, radius = s.r * (1 + burst * 1.5) * (1 - u * .3);
      sparkPositions[i * 3] = Math.cos(s.a + u * 4) * radius;
      sparkPositions[i * 3 + 1] = .3 + u * (state === 'closed' ? 1.3 : 3.2);
      sparkPositions[i * 3 + 2] = Math.sin(s.a + u * 4) * radius;
    });
    sparkGeometry.getAttribute('position').needsUpdate = true;
    if (scroll.visible) {
      const rise = Math.min(1, Math.max(0, (openT - .35) / 1.1));
      scroll.position.set(0, .5 + rise * 1.6, 0); scroll.rotation.set(0, time * 1.4, 0); scroll.scale.setScalar(.3 + .7 * rise);
    }
    if (state === 'opening' && openT > 1.5) { state = 'open'; const callback = onOpened; onOpened = null; callback?.(); }
  }
  // Point sizes are in world units: they shrink and grow with the chest.
  function setScale(scale) { group.scale.setScalar(scale); sparks.material.size = .09 * scale; }
  function dispose() { group.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); group.clear(); }
  return { group, show, hide, open, update, setScale, dispose, get state() { return state; }, get style() { return style; } };
}
