import * as THREE from './vendor/three.module.js';

// Rivers, ravines and waterfalls of La Réunion (OpenStreetMap, ODbL), flowing.
// OSM draws waterways downstream, so the water runs along each line; where
// the real IGN relief is steep the water speeds up and turns white, and at
// the mapped waterfalls a veil of water pours down the cliff into a cloud of
// spray. One draped ribbon mesh holds every river and every veil (one draw
// call), plus one cloud of points for the spray. Distances in metres along
// each line; world units are 100 m.

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const KIND = { r: 0, c: 0, s: 1 };
const STEP_M = 55;          // longest ribbon segment, so it follows the relief
const CELL = 10;            // spatial hash cell, world units (1 km)

// Uniform cubic B-spline through the simplified OSM vertices (as for the
// trails): rounded bends instead of the polyline's corners. Phantom end
// points keep both ends in place.
function bspline(points, i, t) {
  const b = points[i], c = points[i + 1];
  const a = points[i - 1] || { x: 2 * b.x - c.x, z: 2 * b.z - c.z }, d = points[i + 2] || { x: 2 * c.x - b.x, z: 2 * c.z - b.z };
  const u = 1 - t, w0 = u * u * u / 6, w1 = (3 * t * t * t - 6 * t * t + 4) / 6, w2 = (-3 * t * t * t + 3 * t * t + 3 * t + 1) / 6, w3 = t * t * t / 6;
  return { x: a.x * w0 + b.x * w1 + c.x * w2 + d.x * w3, z: a.z * w0 + b.z * w1 + c.z * w2 + d.z * w3 };
}

function waterMaterial(uniforms) {
  const material = new THREE.MeshBasicMaterial({ color: '#2c8fb8', transparent: true, depthWrite: false, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute vec3 aSide;
attribute float aEdge;
attribute float aDist;
attribute float aWidth;
attribute float aSlope;
attribute float aKind;
uniform float uPixel;
uniform float uMetre;
varying float vDist;
varying float vEdge;
varying float vSlope;
varying float vKind;
varying float vFar;
` + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
// Real width up close, never thinner than a pixel or two from afar.
float camDist = distance(transformed, cameraPosition);
float minPixels = aKind < .5 ? 1.2 : aKind < 1.5 ? .75 : aKind < 2.5 ? .55 : 2.0;
transformed += aSide * max(aWidth * .5 * uMetre, uPixel * camDist * minPixels);
transformed.y += max(.5 * uMetre, camDist * .0015) * (aKind > 2.5 ? 2.5 : 1.0);
vDist = aDist; vEdge = aEdge; vSlope = aSlope; vKind = aKind;
vFar = smoothstep(800.0 * uMetre, 6000.0 * uMetre, camDist);`);
    shader.fragmentShader = `uniform float uTime;
varying float vDist;
varying float vEdge;
varying float vSlope;
varying float vKind;
varying float vFar;
float waterHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float waterNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(waterHash(i), waterHash(i + vec2(1.0, 0.0)), f.x), mix(waterHash(i + vec2(0.0, 1.0)), waterHash(i + vec2(1.0, 1.0)), f.x), f.y); }
` + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
float edge = abs(vEdge);
bool veil = vKind > 2.5;
// The steeper the bed, the faster it runs (metres per second, for the eye).
float speed = veil ? 22.0 : 1.4 + vSlope * 16.0;
float flow = vDist - uTime * speed;
float swell = waterNoise(vec2(flow * .12, vEdge * 1.4));
float crests = waterNoise(vec2((vDist - uTime * speed * 1.35) * (veil ? .9 : .35), vEdge * (veil ? 9.0 : 3.1) + 7.0));
float glints = waterNoise(vec2((vDist - uTime * speed * .8) * 1.3, vEdge * 7.0 + 13.0));
// Deep in the middle of the bed, clear over the shallows by the banks.
vec3 water = mix(vec3(.03, .27, .42), vec3(.1, .48, .62), clamp(swell * .8 + edge * .3, 0.0, 1.0));
water = mix(water, vec3(.38, .78, .8), smoothstep(.55, .95, edge));
// Ripple crests running downstream, and sparkles of sunlight.
water += smoothstep(.62, .8, crests) * (1.0 - edge * .5) * vec3(.12, .16, .16);
water += smoothstep(.9, .97, glints) * (1.0 - vFar) * .45;
// A thin line of foam along the banks.
water = mix(water, vec3(.9, .96, .97), smoothstep(.78, .9, edge) * (1.0 - smoothstep(.9, 1.0, edge)) * .5 * (1.0 - vFar));
// Rapids and falls: white water in streaks.
float white = veil ? .75 : smoothstep(.12, .5, vSlope);
float foam = clamp(white * (.35 + .65 * smoothstep(.45, .85, crests)), 0.0, 1.0);
water = mix(water, vec3(.94, .98, 1.0), foam * (1.0 - vFar * .6));
// Far away, the average blue of a line on the map.
water = mix(water, vec3(.12, .5, .7), vFar * .5);
float alpha = 1.0 - smoothstep(.7, 1.0, edge);
alpha *= vKind < .5 ? .95 : (vKind < 1.5 ? .8 : vKind < 2.5 ? .5 : .9) * (vKind < 2.5 ? mix(1.0, .55, vFar) : 1.0);
diffuseColor.rgb = water;
diffuseColor.a *= alpha;`);
  };
  material.customProgramCacheKey = () => 'river-water-v2';
  return material;
}

function sprayMaterial(uniforms) {
  // Soft puffs that rise, swell and fade, each on its own beat.
  return new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, fog: false,
    vertexShader: `attribute float aSeed;
uniform float uTime;
uniform float uPixel;
uniform float uMetre;
varying float vAlpha;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  float life = fract(uTime * (.18 + aSeed * .12) + aSeed * 7.0);
  vec3 p = position;
  p.y += life * 14.0 * uMetre;
  p.x += sin(aSeed * 40.0 + uTime * .7) * 4.0 * uMetre * life;
  p.z += cos(aSeed * 31.0 + uTime * .6) * 4.0 * uMetre * life;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  vAlpha = sin(life * 3.14159) * .38 * (1.0 - smoothstep(1500.0 * uMetre, 4000.0 * uMetre, d));
  gl_PointSize = clamp((9.0 + life * 16.0) * uMetre / (d * uPixel), 1.0, 160.0);
  #include <logdepthbuf_vertex>
}`,
    fragmentShader: `varying float vAlpha;
#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float r = length(gl_PointCoord - .5) * 2.0;
  gl_FragColor = vec4(.96, .98, 1.0, vAlpha * (1.0 - smoothstep(.2, 1.0, r)));
}`,
  });
}

// The map-scale waterfall (Florian, 18/10 : « des gerbes d'eau sur la carte », puis « tes cascades sont à
// l'envers ») : drops leave the top of the fall and drop, faster and faster, to its foot, where a few bounce
// back as a splash. The fall keeps at least 30 pixels of height on the screen, so that it reads on the island
// map ; it shows when the close veil and spray have faded with distance (from 2 km).
function burstMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, fog: false,
    vertexShader: `attribute float aSeed;
attribute vec3 aTop;
uniform float uTime;
uniform float uPixel;
uniform float uMetre;
varying float vAlpha;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 base = modelViewMatrix * vec4(position, 1.0);
  float d = max(-base.z, 1e-4);
  float px = d * uPixel;                      // one screen pixel, in world units, at this distance
  vec3 up = aTop - position;                  // from the foot to the top of the fall
  up.y = max(up.y, 30.0 * px);                // at least 30 pixels high
  float splash = step(.78, aSeed);            // a few drops bounce at the foot
  float life = fract(uTime * (.45 + aSeed * .25) + aSeed * 5.3);
  vec3 p;
  if (splash > .5) {
    float a = aSeed * 40.0;
    p = position + vec3(cos(a) * life * 7.0 * px, (sin(life * 3.14159) * 7.0 + 1.0) * px, sin(a) * life * 7.0 * px);
  } else {
    float t = life * life;                    // falling faster and faster
    float spread = (aSeed - .4) * 5.0 * px * t;
    p = position + up * (1.0 - t) + vec3(spread, 0.0, -spread * .6);
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float fade = smoothstep(1800.0 * uMetre, 4500.0 * uMetre, d);
  vAlpha = fade * (splash > .5 ? (1.0 - life) * .7 : smoothstep(0.0, .12, life) * (1.0 - smoothstep(.85, 1.0, life)) * .9);
  gl_PointSize = splash > .5 ? 3.0 : 3.5 + life * 1.5;
  #include <logdepthbuf_vertex>
}`,
    fragmentShader: `varying float vAlpha;
#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float r = length(gl_PointCoord - .5) * 2.0;
  if (r > 1.0) discard;
  gl_FragColor = vec4(mix(vec3(.62, .86, 1.0), vec3(1.0), 1.0 - r), vAlpha * (1.0 - smoothstep(.55, 1.0, r)));
}`,
  });
}
const BURST_DROPS = 9;

export function createRiverLayer({ source, heightAt }) {
  const mpu = source.metersPerUnit;
  const group = new THREE.Group(); group.name = 'Rivières et cascades';
  const uniforms = { uTime: { value: 0 }, uPixel: { value: .001 }, uMetre: { value: 1 / mpu } };
  const material = waterMaterial(uniforms), spray = sprayMaterial(uniforms), burstMat = burstMaterial(uniforms);
  let bursts = null;
  let mesh = null, mist = null, xs = null, zs = null, positions = null, cells = new Map(), mistBase = null, falls = [], mainLines = [], info = { rivers: 0, waterfalls: 0, km: 0 };

  const ground = (x, z) => Math.max(0, heightAt(x, z));
  const metres = (x, z) => { const m = source.sampleMeters(x, z); return Number.isFinite(m) ? Math.max(0, m) : 0; };

  /** Builds the water from rivieres.json (see scripts/rivers/build_rivers.py). */
  function setData(data) {
    clear();
    const lines = [];
    let km = 0;
    for (const river of data?.rivers || []) {
      const raw = river.c.map(([lon, lat]) => source.geoToWorld(lon, lat));
      const points = [];
      for (let i = 0; i < raw.length - 1; i++) {
        const a = raw[i], b = raw[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * mpu * 1.5 / STEP_M));
        for (let k = 0; k < n; k++) points.push(raw.length > 2 ? bspline(raw, i, k / n) : { x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n });
      }
      points.push({ ...raw.at(-1) });
      const kind = river.i ? 2 : KIND[river.k] ?? 1;
      lines.push({ points, width: river.w || 5, kind });
    }
    // The waterfalls: a veil down the slope, following the river when one
    // passes by, otherwise the steepest way down.
    const veils = [], puffs = [], byCell = new Map();
    lines.forEach(line => line.points.forEach((p, i) => { const key = `${Math.floor(p.x / CELL)}:${Math.floor(p.z / CELL)}`; (byCell.get(key) || byCell.set(key, []).get(key)).push({ line, i }); }));
    // The closest river point within 150 m.
    const nearestRiver = (x, z) => {
      let best = null;
      for (let cx = Math.floor((x - 1.5) / CELL); cx <= Math.floor((x + 1.5) / CELL); cx++) for (let cz = Math.floor((z - 1.5) / CELL); cz <= Math.floor((z + 1.5) / CELL); cz++) {
        for (const hit of byCell.get(`${cx}:${cz}`) || []) {
          const p = hit.line.points[hit.i], d = Math.hypot(p.x - x, p.z - z);
          if (d < 1.5 && (!best || d < best.d)) best = { d, ...hit };
        }
      }
      return best;
    };
    const seen = [];
    for (const fall of data?.waterfalls || []) {
      const p = source.geoToWorld(fall.lon, fall.lat);
      // OSM sometimes maps one fall twice (a node and a way): one veil only.
      if (seen.some(q => Math.hypot(q.x - p.x, q.z - p.z) < .6)) continue;
      seen.push(p);
      let dx, dz, width = 9;
      const near = nearestRiver(p.x, p.z);
      if (near) {
        const a = near.line.points[Math.max(0, near.i - 1)], b = near.line.points[Math.min(near.line.points.length - 1, near.i + 1)];
        dx = b.x - a.x; dz = b.z - a.z; width = Math.max(8, near.line.width * 1.3);
      } else {
        const e = .4; dx = metres(p.x - e, p.z) - metres(p.x + e, p.z); dz = metres(p.x, p.z - e) - metres(p.x, p.z + e);
      }
      const l = Math.hypot(dx, dz); if (!l) continue; dx /= l; dz /= l;
      // Walk down from a little upstream until the slope eases off.
      const step = 10 / mpu, start = { x: p.x - dx * 2 * step, z: p.z - dz * 2 * step }, points = [start];
      let previous = metres(start.x, start.z), gentle = 0;
      for (let k = 1; k <= 45; k++) {
        const q = { x: start.x + dx * k * step, z: start.z + dz * k * step }, h = metres(q.x, q.z);
        points.push(q);
        gentle = previous - h < 3 ? gentle + 1 : 0; previous = h;
        if (k > 5 && gentle >= 3) break;
      }
      const drop = metres(start.x, start.z) - metres(points.at(-1).x, points.at(-1).z);
      if (drop < 6) continue;
      veils.push({ points, width, kind: 3 });
      falls.push({ name: fall.n || null, top: start, bottom: points.at(-1), dropM: Math.round(drop), dir: { x: dx, z: dz } });
      const bottom = points.at(-1);
      for (let k = 0; k < 10; k++) {
        const a = k * 2.4, r = (3 + (k * 37 % 9)) / mpu;
        puffs.push({ x: bottom.x + Math.cos(a) * r, z: bottom.z + Math.sin(a) * r, seed: (k * 0.618 + veils.length * 0.37) % 1 });
      }
    }
    const all = [...lines, ...veils];
    const total = all.reduce((n, line) => n + line.points.length, 0);
    xs = new Float32Array(total); zs = new Float32Array(total);
    positions = new Float32Array(total * 6);
    const side = new Float32Array(total * 6), edge = new Float32Array(total * 2), dist = new Float32Array(total * 2), width = new Float32Array(total * 2), slope = new Float32Array(total * 2), kinds = new Float32Array(total * 2);
    const index = [];
    let v = 0;
    for (const line of all) {
      const pts = line.points;
      let along = 0;
      const heights = pts.map(p => metres(p.x, p.z));
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        if (i) along += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) * mpu;
        let tx = b.x - a.x, tz = b.z - a.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        // Downstream gradient over the neighbours, from the IGN samples.
        const span = Math.hypot(b.x - a.x, b.z - a.z) * mpu || 1;
        const grade = clamp((heights[Math.max(0, i - 1)] - heights[Math.min(pts.length - 1, i + 1)]) / span, 0, 1.5);
        xs[v] = p.x; zs[v] = p.z;
        const y = ground(p.x, p.z);
        for (const k of [0, 1]) {
          const j = v * 2 + k, s = k ? 1 : -1;
          positions.set([p.x, y, p.z], j * 3); side.set([-tz * s, 0, tx * s], j * 3);
          edge[j] = s; dist[j] = along; width[j] = line.width; slope[j] = grade; kinds[j] = line.kind;
        }
        if (i) { const o = (v - 1) * 2; index.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
        const key = `${Math.floor(p.x / CELL)}:${Math.floor(p.z / CELL)}`;
        (cells.get(key) || cells.set(key, []).get(key)).push(v);
        v++;
      }
      if (line.kind !== 3) km += along / 1000;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 3));
    geometry.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
    geometry.setAttribute('aDist', new THREE.BufferAttribute(dist, 1));
    geometry.setAttribute('aWidth', new THREE.BufferAttribute(width, 1));
    geometry.setAttribute('aSlope', new THREE.BufferAttribute(slope, 1));
    geometry.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1));
    geometry.setIndex(index.length > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
    mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false; mesh.renderOrder = 2; mesh.name = 'Eau courante';
    group.add(mesh);
    // Spray at the foot of each waterfall.
    mistBase = puffs;
    const mistPositions = new Float32Array(puffs.length * 3), seeds = new Float32Array(puffs.length);
    puffs.forEach((puff, i) => { mistPositions.set([puff.x, ground(puff.x, puff.z), puff.z], i * 3); seeds[i] = puff.seed; });
    const mistGeometry = new THREE.BufferGeometry();
    mistGeometry.setAttribute('position', new THREE.BufferAttribute(mistPositions, 3));
    mistGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    mist = new THREE.Points(mistGeometry, spray);
    mist.frustumCulled = false; mist.renderOrder = 4; mist.name = 'Embruns';
    group.add(mist);
    // The bursts seen from afar: a few drops per waterfall foot.
    const burstPositions = new Float32Array(falls.length * BURST_DROPS * 3), burstTops = new Float32Array(falls.length * BURST_DROPS * 3), burstSeeds = new Float32Array(falls.length * BURST_DROPS);
    falls.forEach((fall, f) => { for (let k = 0; k < BURST_DROPS; k++) {
      const i = f * BURST_DROPS + k;
      burstPositions.set([fall.bottom.x, ground(fall.bottom.x, fall.bottom.z), fall.bottom.z], i * 3);
      burstTops.set([fall.top.x, ground(fall.top.x, fall.top.z), fall.top.z], i * 3);
      burstSeeds[i] = (k / BURST_DROPS + f * 0.137) % 1;
    } });
    const burstGeometry = new THREE.BufferGeometry();
    burstGeometry.setAttribute('position', new THREE.BufferAttribute(burstPositions, 3));
    burstGeometry.setAttribute('aTop', new THREE.BufferAttribute(burstTops, 3));
    burstGeometry.setAttribute('aSeed', new THREE.BufferAttribute(burstSeeds, 1));
    bursts = new THREE.Points(burstGeometry, burstMat);
    bursts.frustumCulled = false; bursts.renderOrder = 5; bursts.name = 'Gerbes des cascades';
    group.add(bursts);
    info = { rivers: lines.length, waterfalls: veils.length, km: Math.round(km), vertices: total * 2 };
    mainLines = lines.filter(line => line.kind === 0).map(line => line.points.filter((_, i) => i % 4 === 0 || i === line.points.length - 1));
    return info;
  }
  // Heights follow the mesh on display, tile by tile, as for the trails.
  function onTerrainChanged(tiles) {
    if (!mesh) return;
    const drape = i => { const y = ground(xs[i], zs[i]); positions[i * 6 + 1] = y; positions[i * 6 + 4] = y; };
    if (!tiles?.length) for (let i = 0; i < xs.length; i++) drape(i);
    else for (const t of tiles) {
      for (let cx = Math.floor(t.x0 / CELL); cx <= Math.floor(t.x1 / CELL); cx++) for (let cz = Math.floor(t.z0 / CELL); cz <= Math.floor(t.z1 / CELL); cz++) {
        for (const i of cells.get(`${cx}:${cz}`) || []) if (xs[i] >= t.x0 && xs[i] <= t.x1 && zs[i] >= t.z0 && zs[i] <= t.z1) drape(i);
      }
    }
    mesh.geometry.getAttribute('position').needsUpdate = true;
    const mp = mist.geometry.getAttribute('position');
    mistBase.forEach((puff, i) => mp.setY(i, ground(puff.x, puff.z)));
    mp.needsUpdate = true;
    if (bursts) {
      const bp = bursts.geometry.getAttribute('position'), bt = bursts.geometry.getAttribute('aTop');
      falls.forEach((fall, f) => {
        const y = ground(fall.bottom.x, fall.bottom.z), yTop = ground(fall.top.x, fall.top.z);
        for (let k = 0; k < BURST_DROPS; k++) { bp.setY(f * BURST_DROPS + k, y); bt.setY(f * BURST_DROPS + k, yTop); }
      });
      bp.needsUpdate = true; bt.needsUpdate = true;
    }
  }
  /** pixel: world units per pixel at unit distance (vertical field of view / screen height). */
  function update(now, { pixel }) {
    uniforms.uTime.value = (now / 1000) % 3600;
    uniforms.uPixel.value = pixel;
  }
  function setVisible(value) { group.visible = !!value; }
  /** The waterfalls drawn, with their top, foot (world units, on the ground shown), drop and direction of flow. */
  function getWaterfalls() {
    return falls.map(fall => ({ ...fall, top: { ...fall.top, y: ground(fall.top.x, fall.top.z) }, bottom: { ...fall.bottom, y: ground(fall.bottom.x, fall.bottom.z) } }));
  }
  function clear() {
    if (mesh) { mesh.geometry.dispose(); group.remove(mesh); mesh = null; }
    if (mist) { mist.geometry.dispose(); group.remove(mist); mist = null; }
    if (bursts) { bursts.geometry.dispose(); group.remove(bursts); bursts = null; }
    cells = new Map(); xs = zs = positions = null; falls = [];
  }
  function dispose() { clear(); material.dispose(); spray.dispose(); burstMat.dispose(); }
  return { group, setData, onTerrainChanged, update, setVisible, getWaterfalls, getMainRivers: () => mainLines, dispose, getInfo: () => ({ ...info, visible: group.visible }) };
}
