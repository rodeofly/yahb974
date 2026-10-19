import * as THREE from './vendor/three.module.js';
import { prepareTrail, pointAtDistance, nearestOnTrail, resampleDistances, elevationProfile, nextStage, formation } from './trail-math.js';
import { createTroop, createElder, elderSpec } from './troop.js';
import { createHelicopter } from './helicopter.js';
import { createChest } from './chest.js';
import { createIlets } from './ilet.js';

// The Fil d'Ariane: eight real trails (OpenStreetMap) draped on the displayed
// IGN mesh, their stages, and a small troop walking them. Ribbons are widened
// in the vertex shader from the camera distance, so they stay readable from
// the whole-island map down to the strategy camera without rebuilding.

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const THEME_COLORS = Object.freeze({ mathematiques: '#4a78b5', logique: '#7a9e3d', informatique: '#3f8f8a', 'noir-marron': '#c8553d', cerveau: '#b0477a', cosmogonie: '#e0a43a', histoire: '#8a5a3b', depart: '#2f7d4f', arrivee: '#f2c14e' });
export const WALK_SPEEDS = Object.freeze({ reel: 1.5, lent: 6, normal: 18, rapide: 45 });
const SAMPLE_M = 10;

// Visual exaggeration of walkers and flags: they keep a near constant size on
// screen, as units do in strategy games.
export const unitScaleFor = distanceM => clamp(distanceM / 42, 2.2, 22);

function ribbonMaterial(color, shared) {
  const own = { uSelected: { value: 0 } };
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, shared, own);
    shader.vertexShader = 'attribute vec3 aSide;\nattribute float aDist;\nattribute float aEdge;\nuniform float uHalfWidth;\nuniform float uLift;\nuniform float uSelected;\nuniform float uNear;\nvarying float vDist;\nvarying float vEdge;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += aSide * uHalfWidth * mix(1.0, mix(1.7, 1.15, uNear), uSelected);\ntransformed.y += uLift * mix(1.0, 1.4, uSelected);\nvDist = aDist;\nvEdge = aEdge;');
    shader.fragmentShader = `uniform float uTime;
uniform float uSelected;
uniform float uDash;
uniform float uFlow;
uniform float uNear;
uniform float uHalfWidthM;
varying float vDist;
varying float vEdge;
float pathHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pathNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(pathHash(i), pathHash(i + vec2(1.0, 0.0)), f.x), mix(pathHash(i + vec2(0.0, 1.0)), pathHash(i + vec2(1.0, 1.0)), f.x), f.y); }
` + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
float edgeAbs = abs(vEdge);
// Neon chevrons flowing towards the destination on the current trail.
float flowPhase = (vDist - uTime * uFlow) / uDash;
float chevron = fract(flowPhase + edgeAbs * .55);
float chevronAa = max(fwidth(flowPhase) * 1.5, .01);
float chevronOn = smoothstep(.2 - chevronAa, .2 + chevronAa, chevron) * (1.0 - smoothstep(.55 - chevronAa, .55 + chevronAa, chevron));
vec3 neon = mix(vec3(1.0, .55, .0), vec3(1.0, .96, .42), 1.0 - smoothstep(.0, .45, edgeAbs)) * (.85 + .15 * sin(uTime * 6.0));
float chevronShadow = smoothstep(.55, .6, chevron) * (1.0 - smoothstep(.66, .74, chevron));
// Far away: a coloured band with an outline.
vec3 band = mix(diffuseColor.rgb, neon, uSelected * chevronOn * .45);
band *= 1.0 - .12 * uSelected * chevronShadow;
band = mix(band, band * .35, smoothstep(.62, .82, edgeAbs));
float bandAlpha = mix(.8, 1.0, uSelected) * (1.0 - smoothstep(.88, 1.0, edgeAbs));
// Close up: a hiking path in red-brown volcanic earth, in metres.
vec2 grain = vec2(vDist, vEdge * uHalfWidthM);
float n1 = pathNoise(grain * .7), n2 = pathNoise(grain * 2.3 + 5.0), n3 = pathNoise(grain * 9.0 + 11.0);
vec3 soil = mix(vec3(.47, .29, .18), vec3(.66, .47, .30), n1);
soil = mix(soil, vec3(.36, .24, .16), smoothstep(.55, .8, n2) * .55);
soil *= .9 + n3 * .2;
soil = mix(soil, soil * 1.12 + .03, (1.0 - smoothstep(.0, .45, edgeAbs)) * .5);
// Gravel, lit from the upper left.
vec2 gravelCell = grain * 7.0, gravelId = floor(gravelCell);
vec2 gravelLocal = fract(gravelCell) - .5 + (vec2(pathHash(gravelId + 1.3), pathHash(gravelId + 4.1)) - .5) * .5;
vec3 stone = mix(vec3(.42, .41, .40), vec3(.78, .75, .70), pathHash(gravelId + 9.0)) * (1.0 + .25 * clamp(-gravelLocal.x - gravelLocal.y, -1.0, 1.0));
soil = mix(soil, stone, step(.72, pathHash(gravelId)) * (1.0 - smoothstep(.16, .26, length(gravelLocal))));
// A few basalt blocks.
vec2 blockCell = grain * 1.4, blockId = floor(blockCell);
vec2 blockLocal = fract(blockCell) - .5 + (vec2(pathHash(blockId + 2.7), pathHash(blockId + 6.3)) - .5) * .4;
float block = step(.9, pathHash(blockId + 13.0)) * (1.0 - smoothstep(.18, .24, length(blockLocal * vec2(1.0, 1.4))));
soil = mix(soil, vec3(.25, .25, .26) * (1.0 + .4 * clamp(-blockLocal.x - blockLocal.y, -1.0, 1.0)), block);
// Roots crossing the path now and then.
float rootSlot = floor(vDist / 2.6);
float rootLine = abs(fract(vDist / 2.6) - pathHash(vec2(rootSlot, 3.0)) * .8 - .1 + .05 * sin(grain.y * 6.0));
soil = mix(soil, vec3(.27, .17, .1), step(.75, pathHash(vec2(rootSlot, 8.0))) * (1.0 - smoothstep(.01, .025, rootLine)));
// Ragged grass border with tufts.
float ragged = edgeAbs + (n2 - .5) * .45 + (n3 - .5) * .15;
soil = mix(soil, mix(vec3(.30, .52, .20), vec3(.45, .64, .26), n3), smoothstep(.6, .9, ragged));
// A watermark: the chevrons only tint the earth.
soil *= 1.0 - .12 * uSelected * chevronShadow * (1.0 - smoothstep(.7, .85, edgeAbs));
soil = mix(soil, neon, uSelected * chevronOn * (1.0 - smoothstep(.7, .85, edgeAbs)) * .3);
soil = mix(soil, diffuseColor.rgb, (1.0 - uSelected) * (1.0 - smoothstep(.04, .09, edgeAbs)) * .6);
float earthAlpha = 1.0 - smoothstep(.85, 1.05, ragged);
diffuseColor.rgb = mix(band, soil, uNear);
diffuseColor.a *= mix(bandAlpha, earthAlpha, uNear);`);
  };
  // Untouched by tone mapping: the neon chevrons keep their full brightness.
  material.toneMapped = false;
  material.customProgramCacheKey = () => 'fil-ariane-ribbon-v6';
  return { material, own };
}

// Stage markers: a disc with the theme emoji and the stage number, drawn once
// into a small canvas and shown as a constant-size sprite above a light pin.
// The title is drawn inside the marker, in a tag under the disc, so the name
// always stays with its post instead of floating apart on the ground.
// The wooden board at each trail's entrance, in the colours of the island's
// hiking signs: dark wood, yellow letters; a click on it opens the fiche.
function signTexture(trail) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = '#5a3a1e'; g.fillRect(0, 0, 512, 256);
  for (let y = 0; y < 256; y += 64) { g.fillStyle = y % 128 ? '#61401f' : '#56371c'; g.fillRect(0, y, 512, 62); g.fillStyle = '#3c2512'; g.fillRect(0, y + 62, 512, 2); }
  g.strokeStyle = 'rgba(30,18,8,.35)'; g.lineWidth = 2;
  for (let i = 0; i < 18; i++) { const y = (i * 37) % 256; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(170, y + 8, 340, y - 8, 512, y + 3); g.stroke(); }
  g.strokeStyle = '#ffd36b'; g.lineWidth = 6; g.strokeRect(14, 14, 484, 228);
  g.fillStyle = trail.couleur || '#ffd36b'; g.beginPath(); g.arc(64, 74, 34, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fffdf6'; g.font = 'bold 40px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(trail.numero), 64, 76);
  g.fillStyle = '#ffd36b'; g.textAlign = 'left'; g.font = 'bold 22px system-ui, sans-serif'; g.fillText('SENTIER', 112, 56);
  let size = 40; g.font = `bold ${size}px system-ui, sans-serif`;
  while (g.measureText(trail.titre).width > 370 && size > 22) { size -= 2; g.font = `bold ${size}px system-ui, sans-serif`; }
  g.fillText(trail.titre, 112, 96);
  g.font = '24px system-ui, sans-serif'; g.fillText(trail.depuis || '', 40, 150);
  g.fillStyle = '#ffd36b'; g.beginPath(); g.roundRect(40, 180, 220, 46, 23); g.fill();
  g.fillStyle = '#3c2512'; g.font = 'bold 24px system-ui, sans-serif'; g.fillText('▶ Lire la fiche', 60, 204);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

function markerTexture({ colour, emoji = '', number = '', done = false, plain = false, title = '' }) {
  if (typeof document === 'undefined') return null;
  const width = title ? 384 : 128, height = title ? 184 : 128, cx = width / 2;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const g = canvas.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (title) {
    g.font = 'bold 23px system-ui, sans-serif';
    let text = title;
    while (g.measureText(text).width > width - 40 && text.length > 4) text = text.slice(0, -2) + '…';
    const pill = Math.min(width - 8, g.measureText(text).width + 30);
    g.beginPath(); g.moveTo(cx - 12, 146); g.lineTo(cx + 12, 146); g.lineTo(cx, 183); g.fillStyle = done ? '#7d887d' : colour; g.fill();
    g.beginPath(); g.roundRect(cx - pill / 2, 110, pill, 38, 10); g.fillStyle = done ? '#7d887d' : colour; g.fill();
    g.lineWidth = 3; g.strokeStyle = 'rgba(255,253,246,.9)'; g.stroke();
    g.fillStyle = '#fffdf6'; g.fillText(text, cx, 130);
  } else { g.beginPath(); g.moveTo(cx - 18, 100); g.lineTo(cx + 18, 100); g.lineTo(cx, 127); g.fillStyle = colour; g.fill(); }
  const cy = title ? 54 : 58, r = title ? 46 : 50;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = plain ? colour : '#fffdf6'; g.fill();
  g.lineWidth = 8; g.strokeStyle = plain ? '#fffdf6' : colour; g.stroke();
  if (plain) { g.fillStyle = '#fffdf6'; g.font = 'bold 52px system-ui, sans-serif'; g.fillText(number, cx, cy + 3); }
  else {
    g.font = '50px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; g.fillStyle = '#163e3a'; g.fillText(emoji, cx, cy + 3);
    if (number !== '') { g.beginPath(); g.arc(cx + 40, cy - 36, 18, 0, Math.PI * 2); g.fillStyle = colour; g.fill(); g.fillStyle = '#fff'; g.font = 'bold 23px system-ui, sans-serif'; g.fillText(number, cx + 40, cy - 35); }
  }
  if (done) { g.beginPath(); g.arc(cx, cy, r - 4, 0, Math.PI * 2); g.fillStyle = 'rgba(255,253,246,.7)'; g.fill(); g.fillStyle = '#2f7d4f'; g.font = 'bold 58px system-ui, sans-serif'; g.fillText('✓', cx, cy + 4); }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 2;
  texture.userData.aspect = { w: width / 128, h: height / 128 };
  return texture;
}
const STAGE_EMOJI = { mathematiques: '📐', logique: '🧩', informatique: '💻', 'noir-marron': '🔥', cerveau: '🧠', cosmogonie: '🌋', histoire: '📜', depart: '⚑', arrivee: '🏁' };

export function createTrailLayer({ source, heightAt, emit = () => {} }) {
  const group = new THREE.Group(); group.name = 'fil-ariane';
  const mpu = source.metersPerUnit;
  const shared = { uHalfWidth: { value: .03 }, uHalfWidthM: { value: 3 }, uLift: { value: .01 }, uTime: { value: 0 }, uDash: { value: 40 }, uFlow: { value: 50 }, uNear: { value: 0 } };
  let data = null, trails = [], selected = null, viewDistanceM = 1000, visible = true, lastProgress = -Infinity, unitOverride = null;
  // Hidden trails (the zarboutans'): drawn only once their clue is found.
  let revealed = new Set(), elder = null;
  const walk = { s: 0, target: null, playing: false, speed: 'normal', stops: true, display: [], direction: 1 };
  const done = new Map();
  const troop = createTroop();
  // The helicopter that ferries the troop to a chosen stage.
  const heli = createHelicopter(); heli.group.visible = false;
  let transfer = null, kNow = 1;
  // La Buse's chest, waiting at a stage with its riddle.
  const chest = createChest(); let chestStage = null;
  // An îlet (rudimentary camp) at each stage of the selected trail.
  const ilets = createIlets({ heightAt }); let iletKey = '', terrainVersion = 0;
  troop.group.visible = false; group.add(troop.group, heli.group, chest.group, ilets.group);

  const pinGeometry = new THREE.CylinderGeometry(.05, .05, 1, 6).translate(0, .5, 0);
  const baseGeometry = new THREE.RingGeometry(1.1, 1.6, 28).rotateX(-Math.PI / 2);
  const PIN_M = 10;
  let pins = null, bases = null, stageSprites = [], startSprites = [], locator = null, signs = [], beckoning = new Set();
  // The camera and screen, for markers that must not overlap on screen.
  const view = { camera: null, width: 1, height: 1, pixel: .001 };
  const signPost = new THREE.CylinderGeometry(.07, .08, 2.5, 6).translate(0, 1.25, 0), signBoard = new THREE.BoxGeometry(1.5, .75, .07);
  const signWood = new THREE.MeshLambertMaterial({ color: '#5a3a1e' });

  function buildRibbon(trail) {
    const distances = resampleDistances(trail.prepared, SAMPLE_M), n = distances.length;
    const positions = new Float32Array(n * 6), sides = new Float32Array(n * 6), edges = new Float32Array(n * 2), dists = new Float32Array(n * 2);
    const xs = new Float32Array(n), zs = new Float32Array(n);
    for (let i = 0; i < n; i++) { const p = pointAtDistance(trail.prepared, distances[i]); xs[i] = p.x; zs[i] = p.z; }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let dx = xs[b] - xs[a], dz = zs[b] - zs[a]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      for (const k of [0, 1]) {
        const v = i * 2 + k, sign = k ? 1 : -1;
        positions.set([xs[i], 0, zs[i]], v * 3); sides.set([-dz * sign, 0, dx * sign], v * 3); edges[v] = sign; dists[v] = distances[i];
      }
    }
    const index = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 3));
    geometry.setAttribute('aEdge', new THREE.BufferAttribute(edges, 1));
    geometry.setAttribute('aDist', new THREE.BufferAttribute(dists, 1));
    geometry.setIndex(index);
    const { material, own } = ribbonMaterial(trail.couleur, shared);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.name = `sentier-${trail.id}`;
    trail.ribbon = { mesh, own, xs, zs, distances, positions: geometry.getAttribute('position') };
    drape(trail, null);
    group.add(mesh);
  }
  // Heights follow the mesh currently displayed, tile by tile, so the ribbon
  // neither floats above a coarse tile nor sinks under a refined one.
  function drape(trail, tiles) {
    const { xs, zs, positions } = trail.ribbon; let changed = false;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i], z = zs[i];
      if (tiles && !tiles.some(t => x >= t.x0 && x <= t.x1 && z >= t.z0 && z <= t.z1)) continue;
      const y = heightAt(x, z); positions.array[i * 6 + 1] = y; positions.array[i * 6 + 4] = y; changed = true;
    }
    if (changed) positions.needsUpdate = true;
  }
  // Height of the draped ribbon at s metres: walkers tread on the path itself.
  function ribbonHeight(trail, s) {
    const { distances, positions } = trail.ribbon;
    let lo = 0, hi = distances.length - 1;
    if (s <= distances[0]) return positions.array[1];
    if (s >= distances[hi]) return positions.array[hi * 6 + 1];
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (distances[mid] <= s) lo = mid; else hi = mid; }
    const t = (s - distances[lo]) / ((distances[hi] - distances[lo]) || 1);
    return positions.array[lo * 6 + 1] + (positions.array[hi * 6 + 1] - positions.array[lo * 6 + 1]) * t;
  }
  function onTerrainChanged(tiles) { for (const trail of trails) drape(trail, tiles?.length ? tiles : null); terrainVersion++; }

  function setData(next) {
    clear(); data = next; ribbonCells = null;
    trails = (next?.itineraires || []).filter(t => t.trace?.length > 1).map(t => {
      const prepared = prepareTrail(t.trace, source, { smooth: true });
      // Stage distances are measured on the OSM polyline: carry them onto the smoothed curve.
      const stages = t.etapes.map(stage => { const distanceM = prepared.remap(stage.distanceM); return { ...stage, distanceM, osmDistanceM: stage.distanceM, position: pointAtDistance(prepared, distanceM) }; });
      return { ...t, prepared, stages, profile: elevationProfile(prepared, source.sampleMeters) };
    });
    trails.forEach(buildRibbon); showRevealed();
    buildStartSprites(); buildSigns();
    return trails.map(summary);
  }
  function summary(t) { return { id: t.id, numero: t.numero, titre: t.titre, couleur: t.couleur, cache: !!t.cache, longueurM: Math.round(t.prepared.rawLength), profil: { gain: t.profile.gain, loss: t.profile.loss, min: t.profile.min, max: t.profile.max, start: t.profile.start, end: t.profile.end }, done: [...(done.get(t.id) || [])] }; }
  function clear() {
    for (const t of trails) { group.remove(t.ribbon.mesh); t.ribbon.mesh.geometry.dispose(); t.ribbon.mesh.material.dispose(); }
    startSprites.forEach(disposeSprite); startSprites = [];
    trails = []; selected = null; removeFlags(); troop.group.visible = false; walk.playing = false;
  }
  function disposeSprite(sprite) {
    group.remove(sprite);
    const textures = sprite.userData.textures ? Object.values(sprite.userData.textures) : [sprite.material.map];
    textures.forEach(texture => texture?.dispose()); sprite.material.dispose();
  }
  function makeSprite(texture, size, userData) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, sizeAttenuation: false, transparent: true, depthWrite: false }));
    sprite.center.set(.5, 0); sprite.renderOrder = 6; sprite.userData = { ...userData, size }; group.add(sprite);
    setSpriteTexture(sprite, texture);
    return sprite;
  }
  // The sprite keeps the texture's proportions, 128 texels = `size` of the screen.
  function setSpriteTexture(sprite, texture) {
    // Cached pairs (trail numbers) are kept; one-off textures are released.
    if (sprite.material.map && sprite.material.map !== texture && !sprite.userData.textures) sprite.material.map.dispose();
    sprite.material.map = texture; sprite.material.needsUpdate = true;
    const aspect = texture?.userData.aspect || { w: 1, h: 1 }, size = sprite.userData.size;
    sprite.scale.set(size * aspect.w, size * aspect.h, 1);
  }
  const themeName = id => data?.themes?.find(theme => theme.id === id)?.nom || id;
  function removeFlags() {
    for (const mesh of [pins, bases]) if (mesh) { group.remove(mesh); mesh.material.dispose(); mesh.dispose(); }
    pins = bases = null; stageSprites.forEach(disposeSprite); stageSprites = [];
  }
  function locatorTexture() {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 160;
    const g = canvas.getContext('2d'), gradient = g.createLinearGradient(0, 0, 0, 160);
    gradient.addColorStop(0, '#fff36b'); gradient.addColorStop(1, '#ff8a00');
    g.beginPath(); g.moveTo(40, 6); g.lineTo(88, 6); g.lineTo(88, 82); g.lineTo(120, 82); g.lineTo(64, 154); g.lineTo(8, 82); g.lineTo(40, 82); g.closePath();
    g.fillStyle = gradient; g.fill(); g.lineWidth = 7; g.strokeStyle = '#3a2408'; g.stroke();
    g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.75)'; g.beginPath(); g.moveTo(48, 14); g.lineTo(48, 88); g.stroke();
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
  }
  function buildSigns() {
    signs.forEach(sign => { group.remove(sign); sign.userData.face?.map?.dispose(); sign.userData.face?.dispose(); }); signs = [];
    if (typeof document === 'undefined') return;
    for (const t of trails.filter(trail => !trail.cache)) {
      const sign = new THREE.Group(); sign.name = `Pancarte ${t.numero}`; sign.userData = { type: 'sign', trailId: t.id, trail: t };
      for (const x of [-.6, .6]) { const post = new THREE.Mesh(signPost, signWood); post.position.x = x; sign.add(post); }
      const face = new THREE.MeshLambertMaterial({ map: signTexture(t) });
      const board = new THREE.Mesh(signBoard, [signWood, signWood, signWood, signWood, face, signWood]); board.position.y = 1.9; sign.add(board);
      sign.userData.face = face; sign.visible = false; group.add(sign); signs.push(sign);
    }
  }
  // Each board stands just before its trail's start, to the right of the
  // path, turned towards the camera so it can always be read.
  function placeSigns(k) {
    const overview = viewDistanceM > 20000;
    signs.forEach(sign => {
      const t = sign.userData.trail; sign.visible = visible && !overview && !!t; if (!sign.visible) return;
      const p = t.stages[0].position, h = p.heading, back = 4 * k / mpu, aside = 3 * k / mpu;
      const x = p.x - Math.sin(h) * back + Math.cos(h) * aside, z = p.z + Math.cos(h) * back + Math.sin(h) * aside;
      sign.position.set(x, heightAt(x, z), z); sign.scale.setScalar(k / mpu);
      if (view.camera) sign.rotation.set(0, Math.atan2(view.camera.position.x - x, view.camera.position.z - z), 0);
    });
  }
  // Markers that would overlap on screen are pushed apart (in pixels, turned
  // back into offsets at their distance), so every number stays readable.
  const projected = new THREE.Vector3(), screenRight = new THREE.Vector3(), screenUp = new THREE.Vector3(), screenForward = new THREE.Vector3();
  function declutter(sprites) {
    const cam = view.camera; if (!cam || sprites.length < 2) return;
    const halfW = view.width / 2, halfH = view.height / 2, gap = 46;
    const items = [];
    for (const sprite of sprites) {
      projected.copy(sprite.position).project(cam);
      if (projected.z < 1) items.push({ sprite, x: projected.x * halfW, y: projected.y * halfH, x0: projected.x * halfW, y0: projected.y * halfH });
    }
    for (let pass = 0; pass < 6; pass++) for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j]; let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy);
      if (d >= gap) continue;
      if (d < .01) { dx = Math.cos(i * 2.4 + j); dy = Math.sin(i * 2.4 + j); } else { dx /= d; dy /= d; }
      const push = (gap - d) / 2; a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push;
    }
    screenRight.set(1, 0, 0).applyQuaternion(cam.quaternion); screenUp.set(0, 1, 0).applyQuaternion(cam.quaternion); screenForward.set(0, 0, -1).applyQuaternion(cam.quaternion);
    for (const item of items) {
      const ox = item.x - item.x0, oy = item.y - item.y0; if (!ox && !oy) continue;
      const perPixel = projected.copy(item.sprite.position).sub(cam.position).dot(screenForward) * view.pixel;
      item.sprite.position.addScaledVector(screenRight, ox * perPixel).addScaledVector(screenUp, oy * perPixel);
    }
  }
  function buildStartSprites() {
    if (!locator && typeof document !== 'undefined') { locator = makeSprite(locatorTexture(), .07, { type: 'troop' }); locator.scale.set(.056, .07, 1); locator.visible = false; locator.renderOrder = 8; }
    startSprites.forEach(disposeSprite); startSprites = [];
    if (typeof document === 'undefined') return;
    for (const t of trails) {
      // Number only from the whole island; with the trail's name closer in.
      // A zarboutan's îlet: its element and its number in the guide.
      const textures = t.cache
        ? { far: markerTexture({ colour: t.couleur, emoji: t.emoji || '🧓', number: String(t.numero) }), near: markerTexture({ colour: t.couleur, emoji: t.emoji || '🧓', number: String(t.numero), title: t.titreCourt || t.titre }) }
        : { far: markerTexture({ colour: t.couleur, number: String(t.numero), plain: true }), near: markerTexture({ colour: t.couleur, number: String(t.numero), plain: true, title: t.titre }) };
      const sprite = makeSprite(textures.far, .042, { type: 'trail', trailId: t.id }); sprite.userData.textures = textures; sprite.userData.shown = 'far';
      startSprites.push(sprite);
    }
  }
  function buildFlags() {
    removeFlags(); if (!selected) return;
    const n = selected.stages.length;
    // Thin, translucent posts: their verticality is enough to stand out.
    pins = new THREE.InstancedMesh(pinGeometry, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .32, depthWrite: false }), n);
    bases = new THREE.InstancedMesh(baseGeometry, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .5, depthWrite: false }), n);
    for (const mesh of [pins, bases]) { mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.renderOrder = 5; group.add(mesh); }
    if (typeof document !== 'undefined') stageSprites = selected.stages.map(stage => makeSprite(null, .06, { type: 'stage', stageId: stage.id }));
    paintFlags();
  }
  function paintFlags() {
    if (!pins || !selected) return;
    const c = new THREE.Color(), finished = done.get(selected.id) || new Set();
    selected.stages.forEach((stage, i) => {
      const colour = THEME_COLORS[stage.theme || stage.type] || '#ffffff', isDone = finished.has(stage.id);
      pins.setColorAt(i, c.set(isDone ? '#9aa59a' : colour)); bases.setColorAt(i, c);
      const sprite = stageSprites[i];
      const title = stage.type === 'depart' ? 'Départ' : stage.type === 'arrivee' ? 'Arrivée' : themeName(stage.theme);
      if (sprite) setSpriteTexture(sprite, markerTexture({ colour, emoji: STAGE_EMOJI[stage.theme || stage.type], number: stage.type === 'enigme' ? String(i) : '', done: isDone, title }));
    });
    pins.instanceColor.needsUpdate = bases.instanceColor.needsUpdate = true;
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  function placeFlags(k) {
    const overview = viewDistanceM > 20000;
    if (locator) {
      // Seen from afar, a big bobbing arrow points at the troop.
      const leader = troop.getLeader();
      locator.visible = !!selected && visible && unitOverride == null && viewDistanceM > 700;
      // Above the stage marker when the troop stands at a stage, so they never overlap.
      const atStage = !!selected?.stages.some(stage => Math.hypot(stage.position.x - leader.x, stage.position.z - leader.z) * mpu < 12 * k);
      locator.position.set(leader.x, leader.y + ((atStage ? PIN_M * 1.9 : 3.4) + Math.sin(shared.uTime.value * 3) * .5) * k / mpu, leader.z);
    }
    for (const sprite of startSprites) {
      // A door is marked at its start; a zarboutan at its îlet, once revealed.
      const t = trails.find(trail => trail.id === sprite.userData.trailId), p = (t.cache ? t.stages.at(-1) : t.stages[0]).position;
      sprite.visible = (t !== selected || overview) && (!t.cache || revealed.has(t.id)); sprite.position.set(p.x, heightAt(p.x, p.z) + PIN_M * (t.cache ? 1.1 : .6) * k / mpu, p.z);
      const wanted = overview ? 'far' : 'near';
      if (sprite.userData.shown !== wanted) { setSpriteTexture(sprite, sprite.userData.textures[wanted]); sprite.userData.shown = wanted; }
      // The doors not yet walked through beckon, each on its own beat.
      const aspect = sprite.material.map?.userData.aspect || { w: 1, h: 1 }, size = sprite.userData.size;
      const pulse = beckoning.has(t.id) ? 1 + .2 * (.5 + .5 * Math.sin(shared.uTime.value * 4 + t.numero)) : 1;
      sprite.scale.set(size * aspect.w * pulse, size * aspect.h * pulse, 1);
    }
    if (!pins || !selected) return;
    // Seen from the whole island, stage discs would pile up: keep the door number only.
    for (const sprite of stageSprites) sprite.visible = !overview;
    pins.visible = bases.visible = !overview;
    selected.stages.forEach((stage, i) => {
      const p = stage.position, ground = heightAt(p.x, p.z);
      m.compose(v.set(p.x, ground, p.z), q.identity(), sc.set(k / mpu, PIN_M * k / mpu, k / mpu)); pins.setMatrixAt(i, m);
      m.compose(v.set(p.x, ground + .15 * k / mpu, p.z), q.identity(), sc.setScalar(k / mpu)); bases.setMatrixAt(i, m);
      stageSprites[i]?.position.set(p.x, ground + PIN_M * k / mpu, p.z);
    });
    pins.instanceMatrix.needsUpdate = bases.instanceMatrix.needsUpdate = true;
  }
  // Click on a marker sprite (stage disc or trail number).
  function pickSprite(raycaster) {
    const board = raycaster.intersectObjects(signs.filter(sign => sign.visible), true)[0];
    if (board) { let o = board.object; while (o && o.userData.type !== 'sign') o = o.parent; if (o) return { type: 'sign', trailId: o.userData.trailId }; }
    if (chest.group.visible && raycaster.intersectObject(chest.group, true).length) return { type: 'chest', trailId: selected?.id, stageId: chestStage?.id };
    const hit = raycaster.intersectObjects([...(locator?.visible ? [locator] : []), ...stageSprites.filter(sprite => sprite.visible), ...startSprites.filter(sprite => sprite.visible)], false)[0];
    if (!hit) return null;
    const data = hit.object.userData;
    if (data.type === 'troop') return { type: 'troop', trailId: selected?.id };
    if (data.type === 'stage') { const stage = selected?.stages.find(st => st.id === data.stageId); return stage ? { type: 'stage', trailId: selected.id, stage: stageInfo(stage) } : null; }
    return { type: 'trail', trailId: data.trailId };
  }

  /** `stage`: the stage where the troop then stands (the start by default). */
  function select(id, { stage = null } = {}) {
    cancelTransfer(); hideChest();
    const next = trails.find(t => t.id === id) || null;
    for (const t of trails) t.ribbon.own.uSelected.value = t === next ? 1 : 0;
    selected = next; walk.s = 0; walk.target = null; walk.playing = false; walk.direction = 1; walk.display = [];
    const at = stage && next?.stages.find(st => st.id === stage); if (at) walk.s = at.distanceM;
    troop.group.visible = !!next && visible; if (next) troop.setFlagColor(next.couleur);
    buildFlags(); showRevealed(); placeElder();
    return next ? describe(next) : null;
  }
  // Hidden trails: drawn once revealed, and while walked.
  function showRevealed() { for (const t of trails) if (t.cache) t.ribbon.mesh.visible = revealed.has(t.id) || t === selected; }
  function setRevealed(ids) { revealed = new Set(ids || []); showRevealed(); }
  // The zarboutan of the selected hidden trail stands by the fire of his îlet.
  function placeElder() {
    const want = selected?.cache && selected.zarboutan ? selected.zarboutan : null;
    if (elder && elder.forId !== selected?.id) { elder.dispose(); elder = null; }
    if (!want || elder) return;
    const female = /^(Granmèr|Tantine|Nénène|Héva)/.test(want.nom || '');
    elder = createElder(elderSpec(want.numero, female)); elder.forId = selected.id;
    elder.root = new THREE.Group(); elder.root.name = `Zarboutan — ${want.nom}`; elder.root.add(elder.mesh); group.add(elder.root);
  }
  function updateElder(dt, k) {
    if (!elder) return;
    const stage = selected.stages.at(-1), camp = campFor(stage, k), p = stage.position;
    elder.root.visible = visible && viewDistanceM < 20000;
    if (!elder.root.visible) return;
    // Between the fire and the path, turned towards the arriving troop.
    const dx = p.x - camp.x, dz = p.z - camp.z, l = Math.hypot(dx, dz) || 1;
    const x = camp.x + dx / l * 3 * k / mpu, z = camp.z + dz / l * 3 * k / mpu;
    elder.root.position.set(x, surfaceAt(x, z), z); elder.root.rotation.set(0, -Math.atan2(dx, -dz), 0); elder.root.scale.setScalar(k / mpu);
    elder.update(dt);
  }
  function describe(t) { return { ...summary(t), stages: t.stages.map(({ position, ...stage }) => ({ ...stage, heading: position.heading })) }; }

  // One walkable surface for everyone: the ground, the trail ribbons (they
  // float a little above the mesh so they never sink into it) and the îlets'
  // decks. The troop and the free explorer both stand on it.
  const CELL_M = 40;
  let ribbonCells = null;
  const cellOf = v => Math.floor(v * mpu / CELL_M);
  function indexRibbons() {
    ribbonCells = new Map();
    for (const t of trails) {
      const { xs, zs } = t.ribbon;
      for (let i = 0; i < xs.length - 1; i++) {
        for (const key of new Set([`${cellOf(xs[i])},${cellOf(zs[i])}`, `${cellOf(xs[i + 1])},${cellOf(zs[i + 1])}`])) {
          if (!ribbonCells.has(key)) ribbonCells.set(key, []);
          ribbonCells.get(key).push(t, i);
        }
      }
    }
  }
  function ribbonTopAt(x, z) {
    if (!visible || !trails.length) return null;
    if (!ribbonCells) indexRibbons();
    const cx = cellOf(x), cz = cellOf(z), near = shared.uNear.value;
    let best = null;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const list = ribbonCells.get(`${cx + dx},${cz + dz}`); if (!list) continue;
      for (let j = 0; j < list.length; j += 2) {
        const t = list[j], i = list[j + 1]; if (!t.ribbon.mesh.visible) continue;
        const { xs, zs, positions } = t.ribbon, chosen = t === selected;
        const half = shared.uHalfWidth.value * (chosen ? 1.7 + (1.15 - 1.7) * near : 1);
        const ax = xs[i], az = zs[i], sx = xs[i + 1] - ax, sz = zs[i + 1] - az, ll = sx * sx + sz * sz || 1e-12;
        const u = clamp(((x - ax) * sx + (z - az) * sz) / ll, 0, 1);
        if (Math.hypot(ax + sx * u - x, az + sz * u - z) > half) continue;
        const y = positions.array[i * 6 + 1] + (positions.array[(i + 1) * 6 + 1] - positions.array[i * 6 + 1]) * u + shared.uLift.value * (chosen ? 1.4 : 1);
        if (best === null || y > best) best = y;
      }
    }
    return best;
  }
  function surfaceAt(x, z) {
    let y = heightAt(x, z);
    const top = ribbonTopAt(x, z); if (top !== null && top > y) y = top;
    const deck = ilets.standHeight(x, z); if (deck != null && deck > y) y = deck;
    return y;
  }

  function update(dt, now, { distanceM, camera, width, height, pixel }) {
    viewDistanceM = distanceM;
    if (camera) Object.assign(view, { camera, width, height, pixel });
    shared.uTime.value = now / 1000;
    // About ten pixels wide at any distance (40° field of view).
    shared.uHalfWidth.value = Math.max(1.1, distanceM * .0052) / mpu; shared.uHalfWidthM.value = shared.uHalfWidth.value * mpu;
    shared.uLift.value = Math.max(.15, distanceM * .0022) / mpu;
    shared.uNear.value = 1 - THREE.MathUtils.smoothstep(distanceM, 300, 1200);
    // Chevrons about twice as long as the path is wide on screen.
    shared.uDash.value = THREE.MathUtils.lerp(Math.max(40, distanceM * .05), Math.max(2.6, distanceM * .022), shared.uNear.value);
    shared.uFlow.value = shared.uDash.value * .4;
    // The units' size glides to its new value (from a member's eyes to the
    // helicopter, or when zooming) instead of jumping.
    const wanted = unitOverride ?? unitScaleFor(distanceM);
    kNow = Math.abs(wanted - kNow) < .002 ? wanted : kNow + (wanted - kNow) * Math.min(1, dt * 3);
    const k = kNow;
    placeFlags(k); placeSigns(k);
    declutter([...startSprites, ...stageSprites].filter(sprite => sprite.visible));
    placeIlets(k); ilets.update(dt); updateElder(dt, k);
    if (!selected || !visible) return;
    const trail = selected.prepared;
    if (transfer) stepTransfer(dt, k);
    placeChest(dt);
    if (walk.playing && !transfer) {
      const goal = walk.target ?? trail.length, direction = goal < walk.s ? -1 : 1;
      let next = walk.s + WALK_SPEEDS[walk.speed] * dt * direction, reached = direction > 0 ? next >= goal : next <= goal;
      if (reached) next = goal;
      walk.direction = direction;
      // One 'stage' event per arrival (the end of a trail used to send two).
      let announced = false;
      if (direction > 0 && walk.stops) {
        const finished = done.get(selected.id) || new Set();
        const stage = nextStage(selected.stages.filter(st => !finished.has(st.id)), walk.s, next);
        if (stage) { next = stage.distanceM; reached = true; walk.target = null; announced = true; emit('stage', { trailId: selected.id, stage: stageInfo(stage) }); }
      }
      walk.s = next;
      if (reached) {
        walk.playing = false;
        if (walk.target != null) { walk.target = null; emit('halt', { trailId: selected.id, s: osm(walk.s) }); }
        else if (!announced && walk.s >= trail.length - .5 && !(done.get(selected.id)?.has('arrivee'))) emit('stage', { trailId: selected.id, stage: stageInfo(selected.stages.at(-1)) });
        else emit('halt', { trailId: selected.id, s: osm(walk.s) });
      }
    }
    placeTroop(dt, k);
    if (now - lastProgress > 250) { lastProgress = now; emit('progress', { trailId: selected.id, s: osm(walk.s), length: trail.rawLength, playing: walk.playing }); }
  }
  // Each walker heads for a target: its place in single file while walking, or
  // a place in a small arc facing the guide when the troop halts on the trail.
  // Displayed positions walk to their targets, so regrouping is animated too.
  // Nobody treads in the leader's exact footprints: each walker smooths the
  // path over a window of their own and sways slowly across the ribbon, with a
  // personal wavelength in metres (constant, so zooming never jolts them).
  const GAITS = Array.from({ length: 8 }, (_, i) => {
    const r = n => { const v = Math.sin((i + 1) * n) * 43758.5453; return v - Math.floor(v); };
    return { window: 3 + 5 * r(12.9898), sway: .18 + .3 * r(78.233), wave: 24 + 26 * r(37.719), phase: Math.PI * 2 * r(93.989), wave2: 8 + 7 * r(51.31), phase2: Math.PI * 2 * r(17.17) };
  });
  const KERNEL = [[-1, 1], [-.5, 2], [0, 3], [.5, 2], [1, 1]];
  function walkerPoint(trail, i, s, direction) {
    const gait = GAITS[i % GAITS.length];
    let x = 0, z = 0, tx = 0, tz = 0, total = 0;
    for (const [f, w] of KERNEL) {
      const p = pointAtDistance(trail, s + f * gait.window);
      x += p.x * w; z += p.z * w; tx += Math.sin(p.heading) * w; tz -= Math.cos(p.heading) * w; total += w;
    }
    x /= total; z /= total;
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    // Sideways offset (metres, right of increasing s) and its rate of change,
    // which turns the walker gently into each sway.
    const a = shared.uHalfWidthM.value * gait.sway, k1 = Math.PI * 2 / gait.wave, k2 = Math.PI * 2 / gait.wave2;
    const offset = a * (.75 * Math.sin(s * k1 + gait.phase) + .25 * Math.sin(s * k2 + gait.phase2));
    const drift = a * (.75 * k1 * Math.cos(s * k1 + gait.phase) + .25 * k2 * Math.cos(s * k2 + gait.phase2));
    x -= tz * offset / mpu; z += tx * offset / mpu;
    return { x, z, heading: Math.atan2((tx - tz * drift) * direction, -(tz + tx * drift) * direction) };
  }
  function placeTroop(dt, k) {
    const trail = selected.prepared, spacing = 1.7 * k, start = pointAtDistance(trail, 0), end = pointAtDistance(trail, trail.length);
    const gather = !walk.playing && walk.s > spacing * troop.count;
    // Halted at the stage whose riddle waits in the chest: gather round it.
    let round = null;
    if (!walk.playing && !transfer && chestStage && chest.group.visible && Math.abs(walk.s - chestStage.distanceM) < 5) {
      const front = new THREE.Vector3(0, 0, -1).applyQuaternion(chest.group.quaternion); front.y = 0;
      const l = front.length() || 1;
      round = { x: chest.group.position.x, z: chest.group.position.z, fx: front.x / l, fz: front.z / l };
    }
    const leader = pointAtDistance(trail, walk.s), back = leader.heading + (walk.direction < 0 ? 0 : Math.PI);
    const targets = formation(walk.s, troop.count, spacing * walk.direction).map((s, i) => {
      if (round) {
        // Around La Buse's chest: the guide just in front of it, the others in
        // a half circle, everyone facing it.
        const angle = i === 0 ? 0 : ((i - 1) / Math.max(1, troop.count - 2) - .5) * 2.6, radius = (i === 0 ? 1.5 : 2.5) * k / mpu;
        const dx = round.fx * Math.cos(angle) - round.fz * Math.sin(angle), dz = round.fx * Math.sin(angle) + round.fz * Math.cos(angle);
        const x = round.x + dx * radius, z = round.z + dz * radius;
        return { x, z, heading: Math.atan2(round.x - x, -(round.z - z)), s, onTrail: false };
      }
      if (gather && i > 0) {
        const angle = back + ((i - 1) / Math.max(1, troop.count - 2) - .5) * 1.9, radius = 2.6 * k / mpu;
        const x = leader.x + Math.sin(angle) * radius, z = leader.z - Math.cos(angle) * radius;
        return { x, z, heading: Math.atan2(leader.x - x, -(leader.z - z)), s, onTrail: false };
      }
      if (gather) return { x: leader.x, z: leader.z, heading: back, s, onTrail: true };
      let p, heading, overflow = 0;
      if (s < 0) { overflow = -s; p = start; heading = start.heading; }
      else if (s > trail.length) { overflow = s - trail.length; p = end; heading = end.heading + Math.PI; }
      else { p = walkerPoint(trail, i, s, walk.direction < 0 ? -1 : 1); heading = p.heading; }
      let x = p.x, z = p.z;
      if (overflow) {
        // Walkers who have not yet stepped onto the trail wait in a small group.
        const row = Math.ceil(overflow / spacing), col = (i % 3) - 1, b = row * spacing * .55 / mpu, side = col * spacing * .6 / mpu;
        x -= Math.sin(heading) * b - Math.cos(heading) * side; z += Math.cos(heading) * b + Math.sin(heading) * side;
      }
      return { x, z, heading, s: clamp(s, 0, trail.length), onTrail: !overflow };
    });
    if (transfer) {
      // Walk to the helicopter door, or wait inside it until stepping out.
      // Called to another trail, the troop waits where it stands meanwhile.
      const door = transfer.phase === 'boarding' || transfer.phase === 'approach' ? transfer.from : transfer.to;
      if (transfer.cross && transfer.phase === 'approach') targets.forEach((target, i) => { const shown = walk.display[i]; if (shown) targets[i] = { x: shown.x, z: shown.z, heading: target.heading, s: target.s, onTrail: false }; });
      targets.forEach((target, i) => {
        const waiting = transfer.phase === 'boarding' || (transfer.phase === 'unboarding' ? !transfer.out.has(i) : transfer.phase !== 'departure' && transfer.phase !== 'approach');
        if (waiting) targets[i] = { x: door.x, z: door.z, heading: Math.atan2(door.x - (walk.display[i]?.x ?? door.x), -(door.z - (walk.display[i]?.z ?? door.z))), s: target.s, onTrail: false };
      });
    }
    targets.forEach((target, i) => {
      const shown = walk.display[i];
      let x = target.x, z = target.z, moved = 0;
      if (shown) {
        const dx = target.x - shown.x, dz = target.z - shown.z, gap = Math.hypot(dx, dz) * mpu;
        // Far behind (a jump or a new trail): appear in place. Otherwise walk.
        const reach = Math.max(WALK_SPEEDS[walk.speed] * 1.25, 3 * k) * dt;
        if (gap < 60 * k && gap > reach) { x = shown.x + dx / gap * reach; z = shown.z + dz / gap * reach; }
        moved = Math.min(gap, reach);
      }
      walk.display[i] = { x, z };
      const walking = moved > .02 * k;
      // Heading: towards the target while regrouping, else along the trail.
      const toTarget = Math.hypot(target.x - x, target.z - z) * mpu;
      const heading = walking && toTarget > .05 * k ? Math.atan2(target.x - x, -(target.z - z)) : target.heading;
      // Uphill lean from the gradient over the next 2 m (metres, any relief scale).
      let slope = 0;
      if (walk.playing) {
        const here = pointAtDistance(trail, target.s), ahead = pointAtDistance(trail, target.s + 2 * walk.direction);
        slope = (heightAt(ahead.x, ahead.z) - heightAt(here.x, here.z)) * mpu / 2;
      }
      // The same walkable surface as the free explorer: ground, ribbons, decks.
      const onPath = target.onTrail && toTarget < 1.5 * k;
      let y = surfaceAt(x, z);
      if (onPath) y = Math.max(y, ribbonHeight(selected, target.s) + shared.uLift.value * 1.4);
      troop.setWalker(i, { x, y, z, heading, moving: walking, distance: moved, strideScale: k, dt, slope });
      if (transfer?.phase === 'boarding' && !transfer.boarded.has(i) && Math.hypot(x - transfer.from.x, z - transfer.from.z) * mpu < 2.5 * k) { transfer.boarded.add(i); troop.setHidden(i, true); }
    });
    troop.tick(dt); troop.setScale(k); troop.commit(1 / mpu);
  }
  // Ferry: the helicopter lands beside the troop, everyone boards, it flies to
  // the stage, lands, the troop steps out, and it takes off again.
  const ease = t => t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  function padBeside(x, z, heading, k, side = 1) {
    const off = 15 * k / mpu * side;
    return { x: x + Math.cos(heading) * off, z: z + Math.sin(heading) * off };
  }
  function startTransfer(stageId, { from: given = null, cross = false } = {}) {
    if (!selected || transfer) return false;
    hideChest();
    const stage = selected.stages.find(st => st.id === stageId); if (!stage) return false;
    walk.playing = false; walk.target = null;
    const leader = troop.getLeader(), k = kNow, here = pointAtDistance(selected.prepared, walk.s);
    const from = given || padBeside(leader.x, leader.z, here.heading, k), to = padBeside(stage.position.x, stage.position.z, stage.position.heading, k, -campSpot(selected, stage).side);
    const travel = Math.atan2(to.x - from.x, -(to.z - from.z));
    // Cruise above the highest ground along the way.
    let top = 0;
    for (let i = 0; i <= 16; i++) top = Math.max(top, heightAt(from.x + (to.x - from.x) * i / 16, from.z + (to.z - from.z) * i / 16));
    transfer = { phase: 'approach', t: 0, stage, from, to, travel, top, cross, boarded: new Set(), out: new Set(), pose: { x: from.x, y: 0, z: from.z, heading: travel, pitch: 0 } };
    heli.group.visible = visible;
    emit('transfer-start', { trailId: selected.id, stage: stageInfo(stage) });
    return true;
  }
  function stepTransfer(dt, k) {
    const tr = transfer, pose = tr.pose, lift = Math.max(1, k / 3);
    tr.t += dt;
    const ground = p => heightAt(p.x, p.z), cruise = Math.max(tr.top, ground(tr.from), ground(tr.to)) + 140 * lift / mpu;
    const next = phase => { tr.phase = phase; tr.t = 0; };
    if (tr.phase === 'approach') {
      const u = ease(Math.min(1, tr.t / 3)), back = 220 * lift / mpu;
      const sx = tr.from.x - Math.sin(tr.travel) * back, sz = tr.from.z + Math.cos(tr.travel) * back;
      pose.x = sx + (tr.from.x - sx) * u; pose.z = sz + (tr.from.z - sz) * u;
      pose.y = ground(tr.from) + (1 - u) * 160 * lift / mpu; pose.heading = tr.travel; pose.pitch = -.12 * (1 - u);
      if (tr.t >= 3) next('boarding');
    } else if (tr.phase === 'boarding') {
      pose.y = ground(tr.from); pose.pitch = 0;
      if (tr.boarded.size >= troop.count || tr.t > 9) { for (let i = 0; i < troop.count; i++) troop.setHidden(i, true); next('liftoff'); }
    } else if (tr.phase === 'liftoff') {
      const u = ease(Math.min(1, tr.t / 2));
      pose.y = ground(tr.from) + (cruise - ground(tr.from)) * u;
      if (tr.t >= 2) next('flight');
    } else if (tr.phase === 'flight') {
      const distanceM = Math.hypot(tr.to.x - tr.from.x, tr.to.z - tr.from.z) * mpu, duration = clamp(distanceM / 260, 3, 8), u = ease(Math.min(1, tr.t / duration));
      pose.x = tr.from.x + (tr.to.x - tr.from.x) * u; pose.z = tr.from.z + (tr.to.z - tr.from.z) * u;
      pose.y = cruise; pose.pitch = -.18 * Math.sin(Math.PI * u);
      if (tr.t >= duration) {
        // The troop now waits at the stage, inside the helicopter.
        walk.s = tr.stage.distanceM; walk.direction = 1;
        for (let i = 0; i < troop.count; i++) walk.display[i] = { x: tr.to.x, z: tr.to.z };
        next('landing');
      }
    } else if (tr.phase === 'landing') {
      const u = ease(Math.min(1, tr.t / 2.5));
      pose.x = tr.to.x; pose.z = tr.to.z; pose.y = cruise + (ground(tr.to) - cruise) * u; pose.pitch = 0;
      if (tr.t >= 2.5) next('unboarding');
    } else if (tr.phase === 'unboarding') {
      pose.y = ground(tr.to);
      const outCount = Math.min(troop.count, Math.floor(tr.t / .35) + 1);
      for (let i = 0; i < outCount; i++) if (!tr.out.has(i)) { tr.out.add(i); troop.setHidden(i, false); walk.display[i] = { x: tr.to.x, z: tr.to.z }; }
      if (tr.t >= troop.count * .35 + 1.2) next('departure');
    } else if (tr.phase === 'departure') {
      const u = ease(Math.min(1, tr.t / 4)), away = 320 * lift / mpu;
      pose.x = tr.to.x + Math.sin(tr.travel) * away * u; pose.z = tr.to.z - Math.cos(tr.travel) * away * u;
      pose.y = ground(tr.to) + 180 * lift / mpu * u; pose.pitch = -.15 * u;
      if (tr.t >= 4) {
        const stage = tr.stage; transfer = null; heli.group.visible = false;
        emit('transfer-end', { trailId: selected.id, stage: stageInfo(stage) });
        return;
      }
    }
    heli.group.position.set(pose.x, pose.y, pose.z);
    heli.group.rotation.set(pose.pitch, -pose.heading, 0, 'YXZ');
    heli.group.scale.setScalar(k / mpu);
    heli.update(dt, { rotorSpeed: tr.phase === 'boarding' || tr.phase === 'unboarding' ? .55 : 1 });
  }
  /** Fly the troop from where it stands to another trail (a zarboutan far
   * away, or back to the door it came from). Nothing to ferry: it appears there. */
  function startTransferToTrail(id, stageId = 'depart') {
    if (transfer) return false;
    const next = trails.find(t => t.id === id); if (!next) return false;
    let from = null; const shown = walk.display.slice();
    if (selected && troop.group.visible && shown.length) {
      const leader = troop.getLeader(), here = pointAtDistance(selected.prepared, walk.s);
      from = padBeside(leader.x, leader.z, here.heading, kNow);
    }
    select(id);
    if (!from) { const stage = next.stages.find(st => st.id === stageId); if (stage) walk.s = stage.distanceM; return 'direct'; }
    walk.display = shown;
    return startTransfer(stageId, { from, cross: true });
  }
  function cancelTransfer() {
    if (!transfer) return;
    transfer = null; heli.group.visible = false;
    for (let i = 0; i < troop.count; i++) troop.setHidden(i, false);
  }
  // The îlet takes the flattest ground beside its stage, off the trail, facing
  // the stage; chosen once per trail at a middle scale, so it never hops
  // about while zooming. The helicopter lands on the other side.
  const CAMP_K = 6, CAMP_TURNS = [50, 75, 90, 105, 130].flatMap(d => [-d, d]).map(d => d * Math.PI / 180);
  function campSpot(trail, stage) {
    if (stage.camp) return stage.camp;
    const p = stage.position, r = 4.5 * CAMP_K / mpu;
    let best = null;
    for (const turn of CAMP_TURNS) for (const dist of [9, 12]) {
      const a = p.heading + turn, d = dist * CAMP_K / mpu, x = p.x + Math.sin(a) * d, z = p.z - Math.cos(a) * d;
      if (nearestOnTrail(trail.prepared, x, z).distanceM < 6 * CAMP_K) continue;
      const heights = [heightAt(x, z), heightAt(x + r, z), heightAt(x - r, z), heightAt(x, z + r), heightAt(x, z - r)];
      if (Math.min(...heights) <= .5 / mpu) continue;
      // Steepness, a slight preference for the left and for nearness.
      const score = (Math.max(...heights) - Math.min(...heights)) * mpu * (turn < 0 ? 1 : 1.15) * (dist === 9 ? 1 : 1.1);
      if (!best || score < best.score) best = { score, turn, dist };
    }
    stage.camp = best ? { turn: best.turn, dist: best.dist, side: Math.sign(best.turn) } : { turn: -Math.PI / 2, dist: 10, side: -1 };
    return stage.camp;
  }
  function campFor(stage, k) {
    const p = stage.position, spot = campSpot(selected, stage), a = p.heading + spot.turn, d = spot.dist * k / mpu;
    return { x: p.x + Math.sin(a) * d, z: p.z - Math.cos(a) * d, turn: Math.atan2(Math.sin(a), -Math.cos(a)), scale: k / mpu };
  }
  function placeIlets(k) {
    if (!selected || !visible || viewDistanceM > 20000) { if (ilets.count) ilets.set([]); iletKey = ''; return; }
    const finished = done.get(selected.id) || new Set();
    // Each piece samples the ground: only when the scale, the terrain or a container changes.
    const key = `${selected.id}|${k.toFixed(3)}|${terrainVersion}|${[...finished].join()}|${chest.group.visible ? chestStage?.id : ''}`;
    if (key === iletKey) return; iletKey = key;
    // The treasure decides the container: a crate for a riddle, La Buse's chest at the end.
    // A hidden trail has one îlet, the zarboutan's, at its end, and no container.
    if (selected.cache) { ilets.set([{ ...campFor(selected.stages.at(-1), k), container: 'chest', open: true, hideContainer: true }]); return; }
    ilets.set(selected.stages.map(stage => ({ ...campFor(stage, k), container: stage.type === 'arrivee' ? 'chest' : 'crate', open: finished.has(stage.id), hideContainer: stage === chestStage && chest.group.visible })));
  }
  function showChest(stageId) {
    if (selected?.cache) return false;
    const stage = selected?.stages.find(st => st.id === stageId); if (!stage) return false;
    if (chestStage === stage && chest.group.visible) return true;
    chestStage = stage; chest.show(stage.type === 'arrivee' ? 'coffre' : 'caisse'); placeIlets(kNow); placeChest(0); return true;
  }
  function placeChest(dt) {
    if (!chestStage || !chest.group.visible) return;
    // In front of the îlet's fire, in place of its usual container.
    if (!ilets.containerTransform(selected.stages.indexOf(chestStage), chest.group.position, chest.group.quaternion)) return;
    chest.setScale(kNow / mpu); chest.update(dt);
  }
  function openChest() {
    if (!chestStage || !chest.group.visible) return false;
    const stage = chestStage, opened = () => emit('chest-opened', { trailId: selected?.id, stageId: stage.id });
    // Already open: straight to the riddle; opening: its callback will come.
    if (chest.state === 'open') opened(); else if (chest.state === 'closed') chest.open(opened);
    return true;
  }
  function hideChest() { chest.hide(); chestStage = null; }
  function isAtStage(stageId) {
    const stage = selected?.stages.find(st => st.id === stageId);
    return !!stage && !transfer && !walk.playing && Math.abs(walk.s - stage.distanceM) < 5;
  }
  function getHelicopterPosition() { return transfer ? { x: transfer.pose.x, y: transfer.pose.y, z: transfer.pose.z } : null; }
  /** The ferry's phase and pose, for the camera that films it. */
  function getTransferInfo() { return transfer ? { phase: transfer.phase, t: transfer.t, x: transfer.pose.x, y: transfer.pose.y, z: transfer.pose.z, heading: transfer.pose.heading, lift: Math.max(1, kNow / 3) } : null; }
  /** Where the riddle's container stands, while it is shown. */
  function getChestPosition() { return chest.group.visible ? chest.group.position.clone() : null; }
  /** The stage the troop stands at, halted, if any. */
  function stageHere() { return selected && !transfer && !walk.playing ? selected.stages.find(stage => Math.abs(walk.s - stage.distanceM) < 5) || null : null; }

  // Distances shown to the visitor are those of the OSM trace (the fiches').
  const osm = s => selected?.prepared.unmap(s) ?? s;
  function stageInfo(stage) { const { position, osmDistanceM, ...rest } = stage; return { ...rest, distanceM: osmDistanceM, index: selected.stages.indexOf(stage), total: selected.stages.length }; }

  function play() { if (!selected) return false; hideChest(); if (walk.s >= selected.prepared.length - .5) { walk.s = 0; walk.display = []; } walk.playing = true; emit('progress', { trailId: selected.id, s: osm(walk.s), length: selected.prepared.rawLength, playing: true }); return true; }
  function pause() { walk.playing = false; if (selected) emit('progress', { trailId: selected.id, s: osm(walk.s), length: selected.prepared.rawLength, playing: false }); }
  function walkTo(s) { if (!selected) return false; walk.target = clamp(s, 0, selected.prepared.length); walk.playing = true; return true; }
  /** Walk on to a stage of the selected trail, and stop there (the gamebook's television). */
  function walkToStage(id) { const stage = selected?.stages.find(st => st.id === id); if (!stage) return false; hideChest(); return walkTo(stage.distanceM); }
  function jumpTo(s) { if (!selected) return; walk.s = clamp(s, 0, selected.prepared.length); walk.target = null; walk.playing = false; walk.display = []; }
  function goToStage(id) { const stage = selected?.stages.find(st => st.id === id); if (!stage) return null; jumpTo(stage.distanceM); return stageInfo(stage); }
  function markDone(trailId, stageId, value = true) {
    if (!done.has(trailId)) done.set(trailId, new Set());
    if (value) done.get(trailId).add(stageId); else done.get(trailId).delete(stageId);
    paintFlags();
  }
  function setDone(trailId, ids = []) { done.set(trailId, new Set(ids)); paintFlags(); }
  function setSpeed(value) { if (Object.hasOwn(WALK_SPEEDS, value)) walk.speed = value; }
  function setStops(value) { walk.stops = !!value; }
  function setVisible(value) { visible = !!value; group.visible = visible; troop.group.visible = visible && !!selected; }
  function getLeaderPosition() {
    if (!selected) return null;
    const l = troop.getLeader(); return { x: l.x, y: l.y, z: l.z, heading: l.heading, walking: walk.playing && !transfer };
  }
  // Nearest trail (selected first) or stage around a ground point.
  function pickAt(x, z) {
    const k = unitScaleFor(viewDistanceM), tolerance = Math.max(25, viewDistanceM * .025);
    if (selected) {
      const stage = selected.stages.find(st => Math.hypot(st.position.x - x, st.position.z - z) * mpu < Math.max(tolerance, 2.2 * k));
      if (stage) return { type: 'stage', trailId: selected.id, stage: stageInfo(stage) };
      const near = nearestOnTrail(selected.prepared, x, z);
      if (near.distanceM < tolerance) return { type: 'trail', trailId: selected.id, s: near.s };
    }
    let best = null;
    for (const t of trails) { if (t.cache && !revealed.has(t.id)) continue; const near = nearestOnTrail(t.prepared, x, z); if (near.distanceM < tolerance * 1.5 && (!best || near.distanceM < best.distanceM)) best = { type: 'trail', trailId: t.id, s: near.s, distanceM: near.distanceM }; }
    return best;
  }
  // Stage and trail names are drawn in their markers: no floating labels.
  function getLabelRecords() { return []; }
  function getInfo() {
    return { trails: trails.length, selected: selected?.id || null, walking: walk.playing, s: Math.round(walk.s), length: Math.round(selected?.prepared.length || 0), speed: walk.speed, stops: walk.stops, unitScale: +unitScaleFor(viewDistanceM).toFixed(2), unitShown: +kNow.toFixed(2), transfer: transfer?.phase || null };
  }
  // Troop members, for the character cameras and free exploration.
  function memberIndex(id) { return troop.cast.findIndex(spec => spec.id === id); }
  function getMembers() { return troop.cast.map(spec => ({ id: spec.id, label: spec.label, tenrec: !!spec.tenrec })); }
  function getMemberPose(i) { return selected ? troop.getWalker(i) : null; }
  function setMemberHidden(i, value) { troop.setHidden(i, value); }
  function setCameraBubble(position, radiusUnits) { troop.setCameraBubble(position, radiusUnits); }
  function setUnitScaleOverride(value) { unitOverride = Number.isFinite(value) ? value : null; }
  function dispose() { cancelTransfer(); elder?.dispose(); heli.dispose(); chest.dispose(); ilets.dispose(); clear(); startSprites.forEach(disposeSprite); if (locator) disposeSprite(locator); troop.dispose(); pinGeometry.dispose(); baseGeometry.dispose(); group.clear(); }
  return { group, setData, select, update, onTerrainChanged, play, pause, walkTo, walkToStage, jumpTo, goToStage, markDone, setDone, setSpeed, setStops, setVisible, getLeaderPosition, pickAt, pickSprite, showChest, openChest, hideChest, getStarts: () => trails.filter(t => !t.cache).map(t => ({ id: t.id, x: t.stages[0].position.x, z: t.stages[0].position.z })), startTransfer, startTransferToTrail, setRevealed, surfaceAt, isAtStage, getHelicopterPosition, setBeckoning: ids => { beckoning = new Set(ids || []); }, getTransferInfo, getChestPosition, stageHere: () => { const stage = stageHere(); return stage ? stageInfo(stage) : null; }, isTransferring: () => !!transfer, getLabelRecords, getInfo, memberIndex, getMembers, getMemberPose, setMemberHidden, setCameraBubble, setUnitScaleOverride, getSelected: () => selected && describe(selected), getTrail: id => trails.find(t => t.id === id), dispose, get data() { return data; } };
}
