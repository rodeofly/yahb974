import * as THREE from './vendor/three.module.js';
import { getForestRenderSettings } from './terrain-renderer.js';
import { FOREST_BELTS, LEEWARD_LONGITUDE, forestBelt } from './forest-types.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const PROFILE = {
  eco: { radiusM: 170, canopyRadiusM: 520, rocks: 192, trees: 80, canopy: 72, chunksPerFrame: 1 },
  balanced: { radiusM: 250, canopyRadiusM: 720, rocks: 480, trees: 192, canopy: 192, chunksPerFrame: 2 },
  high: { radiusM: 320, canopyRadiusM: 920, rocks: 768, trees: 320, canopy: 320, chunksPerFrame: 2 },
};

function randomFor(cx, cz, salt) {
  let value = (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ salt) >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}
function sourceSlope(terrain, x, z) {
  const eps = Math.max(25, terrain.sourceResolutionM || 25) / terrain.metersPerUnit;
  const gx = (terrain.heightAt(x + eps, z) - terrain.heightAt(x - eps, z)) / (2 * eps);
  const gz = (terrain.heightAt(x, z + eps) - terrain.heightAt(x, z - eps)) / (2 * eps);
  return Math.hypot(gx, gz);
}

/** Deterministic, world-anchored art assets. Moving the camera cannot reshuffle
 * an existing cell. The forest mask is an observed cover estimate; individual
 * tree/rock locations are illustrative, not a surveyed asset inventory. */
export function generateDecorChunk({ terrain, cx, cz, forestCover = null, layer = 'near', forestDensity = 'balanced' }) {
  const mpu = terrain.metersPerUnit, sizeM = layer === 'canopy' ? 160 : 64;
  const size = sizeM / mpu, x0 = cx * size, z0 = cz * size;
  const sampleForest = forestCover?.sampleAt || terrain.forestCoverAt || (() => 0);
  const appearance = getForestRenderSettings(forestDensity);
  const records = [];
  const random = randomFor(cx, cz, layer === 'canopy' ? 172931 : 0x764310);
  const fournaise = terrain.geoToWorld(55.7087, -21.2443);
  if (layer === 'canopy') {
    for (let i = 0; i < 4; i++) {
      const x = x0 + ((i % 2) + .12 + random() * .76) / 2 * size;
      const z = z0 + (Math.floor(i / 2) + .12 + random() * .76) / 2 * size;
      const phase = random(), radiusM = 3.2 + random() * 3.8;
      const selection = random(), rotation = random() * TAU;
      const centreCover = sampleForest(x, z);
      if (!terrain.isLand(x, z) || centreCover <= appearance.cutoff) continue;
      const r = radiusM * .6 / mpu;
      const coverage = centreCover * .6 + (sampleForest(x-r,z)+sampleForest(x+r,z)+sampleForest(x,z-r)+sampleForest(x,z+r)) * .1;
      const slope = sourceSlope(terrain, x, z);
      const slopeWeight = 1 - smooth(1.15, 3, slope) * .6;
      // Fractional cover affects abundance continuously. Steep wooded slopes
      // are retained; only near-vertical faces cannot support a proxy crown.
      if (slope > 3.2 || selection > Math.pow(coverage, appearance.gamma) * appearance.instances * slopeWeight) continue;
      records.push({ kind: 'canopy', x, z, radiusM, heightM: 4 + phase * 3.5, phase, rotation });
    }
    return { cx, cz, x0, z0, x1: x0 + size, z1: z0 + size, layer, records };
  }
  // Only a few stones in each64 m cell. More frequent around the volcanic
  // uplands, but no lava/fire, artificial crater, or displacement of the DEM.
  for (let i = 0; i < 12; i++) {
    const x = x0 + ((i % 4) + .15 + random() * .7) / 4 * size;
    const z = z0 + (Math.floor(i / 4) + .15 + random() * .7) / 3 * size;
    const select = random(), phase = random(), sizeChoice = random(), rotation = random() * TAU;
    const altitude = terrain.sampleMeters(x, z);
    if (!Number.isFinite(altitude) || altitude < 3 || !terrain.isLand(x, z)) continue;
    const volcanic = (1 - smooth(5000, 12000, Math.hypot(x - fournaise.x, z - fournaise.z) * mpu)) * smooth(1100, 1950, altitude);
    const slope = sourceSlope(terrain, x, z);
    if (slope > 1.0 || select > .31 + volcanic * .42) continue;
    const sizeMeters = sizeChoice < .35 ? .15 + phase * .35 : sizeChoice < .84 ? .55 + phase * .65 : 1.2 + phase * .8;
    records.push({ kind: 'rock', x, z, sizeM: sizeMeters, heightM: sizeMeters * (.44 + phase * .24), phase, rotation, volcanic });
  }
  // Tree presence comes from the real cover mask. When unavailable, no guessed
  // forest is substituted by altitude or longitude.
  const treeRandom = randomFor(cx, cz, 0x313ac5);
  for (let i = 0; i < 4; i++) {
    const x = x0 + ((i % 2) + .15 + treeRandom() * .7) / 2 * size;
    const z = z0 + (Math.floor(i / 2) + .15 + treeRandom() * .7) / 2 * size;
    const phase = treeRandom(), selection = treeRandom(), altitude = terrain.sampleMeters(x, z), rotation = treeRandom() * TAU;
    const coverage = sampleForest(x, z), slope = sourceSlope(terrain, x, z);
    const slopeWeight = 1 - smooth(1.15, 3, slope) * .55;
    if (!terrain.isLand(x, z) || !Number.isFinite(altitude) || altitude < 3 || coverage <= appearance.cutoff || slope > 3.2 || selection > Math.pow(coverage, appearance.gamma) * appearance.instances * slopeWeight) continue;
    const heightM = (6 + phase * 5) * (1 - clamp(altitude / 3100, 0, 1) * .16);
    records.push({ kind: 'tree', x, z, heightM, phase, rotation });
  }
  return { cx, cz, x0, z0, x1: x0 + size, z1: z0 + size, layer, records };
}

function createBasaltGeometry() {
  const geometry = new THREE.DodecahedronGeometry(1, 0), attribute = geometry.attributes.position;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < attribute.count; i++) {
    const x = attribute.getX(i), y = attribute.getY(i), z = attribute.getZ(i);
    const deform = 1 + Math.sin(x * 4.1 + y * 3.7 - z * 2.9) * .105;
    const newY = y * (1 + Math.cos(x * 3.1 + z * 5.3) * .07);
    attribute.setXYZ(i, x * deform, newY, z * (1 + Math.sin(y * 3.2 + x * 2.6) * .085));
    minY = Math.min(minY, newY); maxY = Math.max(maxY, newY);
  }
  for (let i = 0; i < attribute.count; i++) attribute.setY(i, (attribute.getY(i) - minY) / (maxY - minY));
  geometry.computeVertexNormals(); return geometry;
}

function shadeCrownGeometry(geometry) {
  const position = geometry.attributes.position, colours = new Float32Array(position.count * 3);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < position.count; i++) { minY = Math.min(minY, position.getY(i)); maxY = Math.max(maxY, position.getY(i)); }
  for (let i = 0; i < position.count; i++) {
    const height = (position.getY(i) - minY) / (maxY - minY);
    const shade = 1 - (1 - smooth(.04, .58, height)) * .12;
    const warmth = smooth(.58, .98, height);
    // Linear-light multipliers preserve each instance's existing green palette.
    // The shaded base and gently warm top travel with the reused crown geometry.
    colours[i * 3] = shade * (1 + warmth * .025);
    colours[i * 3 + 1] = shade * (1 + warmth * .01);
    colours[i * 3 + 2] = shade * (1 - warmth * .025);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geometry;
}

/** Four instanced draw calls at most: stones, trunks, near foliage, canopy
 * proxies. Meshes and geometries are allocated once and reused while moving. */
export function createLandscapeDecor({ terrain, heightAt = terrain.heightAt, quality = 'balanced', style = 'nature', forestCover = null, forestDensity = 'balanced' } = {}) {
  const group = new THREE.Group(); group.name = 'Basalte et canopée — décor illustratif instancié';
  const mpu = terrain.metersPerUnit;
  let disposed = false, mask = forestCover, frame = 0, lastNearEnabled = null;
  let lastFadeCenter = new THREE.Vector3(Infinity, 0, Infinity);
  let profile = PROFILE[quality] || PROFILE.balanced, pending = [];
  const chunks = new Map(), desired = new Map();
  const lastCenter = new THREE.Vector3(Infinity, 0, Infinity), transform = new THREE.Object3D();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0), color = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0), groundNormal = new THREE.Vector3();
  const geoms = {
    basalt: createBasaltGeometry(), rockBlock: new THREE.BoxGeometry(2, 1, 2).translate(0, .5, 0),
    foliage: shadeCrownGeometry(new THREE.IcosahedronGeometry(1, 1)), foliageBlock: shadeCrownGeometry(new THREE.BoxGeometry(1.6, 1.65, 1.6)),
    trunk: new THREE.CylinderGeometry(.09, .135, 1, 5), trunkBlock: new THREE.BoxGeometry(.2, 1, .2),
  };
  const materials = {
    basalt: new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, flatShading: true }),
    foliage: new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, vertexColors: true }),
    trunk: new THREE.MeshStandardMaterial({ color: '#967556', roughness: 1 }),
    canopy: new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, vertexColors: true }),
  };
  function makeMesh(geometry, material, capacity, name) {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0;
    group.add(mesh); return mesh;
  }
  const pools = {
    rock: { limit: profile.rocks, capacity: PROFILE.high.rocks, meshes: [makeMesh(geoms.basalt, materials.basalt, PROFILE.high.rocks, 'Cailloux et rochers basaltiques')], slots: [], free: [] },
    tree: { limit: profile.trees, capacity: PROFILE.high.trees, meshes: [makeMesh(geoms.foliage, materials.foliage, PROFILE.high.trees, 'Cimes proches'), makeMesh(geoms.trunk, materials.trunk, PROFILE.high.trees, 'Troncs proches')], slots: [], free: [] },
    canopy: { limit: profile.canopy, capacity: PROFILE.high.canopy, meshes: [makeMesh(geoms.foliage, materials.canopy, PROFILE.high.canopy, 'Groupes de cimes à moyenne distance')], slots: [], free: [] },
  };
  for (const pool of Object.values(pools)) { pool.active = 0; pool.slots = new Array(pool.capacity).fill(null); for (let i = pool.capacity - 1; i >= 0; i--) pool.free.push(i); }
  function mark(pool) { pool.dirty = true; }
  function allocate(record) {
    const pool = pools[record.kind]; if (pool.active >= pool.limit || !pool.free.length) return false;
    const slot = pool.free.pop(); pool.slots[slot] = record; record.slot = slot; pool.active = (pool.active || 0) + 1;
    for (const mesh of pool.meshes) mesh.count = Math.max(mesh.count, slot + 1);
    if (record.kind === 'rock') color.set(record.volcanic > .4 ? '#606563' : '#858778').lerp(new THREE.Color('#484f4b'), record.phase * .5);
    else paintTree(record);
    pool.meshes[0].setColorAt(slot, color); pool.colorsDirty = true;
    return true;
  }
  // Trees take their vegetation belt's tint (as the forest on the ground), or the plain greens.
  const leewardX = terrain.geoToWorld ? terrain.geoToWorld(LEEWARD_LONGITUDE, -21.1).x : -Infinity;
  const beltColours = FOREST_BELTS.map(belt => new THREE.Color(belt.colour)), shadeColour = new THREE.Color('#2f4f35');
  let forestTypes = true;
  function paintTree(record) {
    if (forestTypes && terrain.sampleMeters) {
      const metres = terrain.sampleMeters(record.x, record.z);
      color.copy(beltColours[forestBelt(Number.isFinite(metres) ? metres : 0, record.x < leewardX)]).lerp(shadeColour, record.phase * (record.kind === 'canopy' ? .3 : .22));
    } else if (record.kind === 'canopy') color.set('#66935e').lerp(new THREE.Color('#4c8056'), record.phase * .48);
    else color.set('#76a064').lerp(new THREE.Color('#4c8056'), record.phase * .56);
  }
  function setForestTypes(value) {
    forestTypes = !!value;
    for (const kind of ['tree', 'canopy']) {
      const pool = pools[kind];
      // Instance colours exist only once a tree has been placed.
      pool.slots.forEach((record, slot) => { if (record) { paintTree(record); pool.meshes[0].setColorAt(slot, color); pool.colorsDirty = true; } });
    }
  }
  function release(record) {
    const pool = pools[record.kind], slot = record.slot;
    if (slot == null || pool.slots[slot] !== record) return;
    for (const mesh of pool.meshes) mesh.setMatrixAt(slot, zero);
    pool.slots[slot] = null; pool.free.push(slot); pool.active--; record.slot = null;
    let count = pool.meshes[0].count; while (count > 0 && !pool.slots[count - 1]) count--;
    for (const mesh of pool.meshes) mesh.count = count;
    mark(pool);
  }
  function applyRecord(record, fade, reanchor = false) {
    const pool = pools[record.kind];
    if (reanchor || !Number.isFinite(record.y)) {
      record.y = heightAt(record.x, record.z);
      if (record.kind !== 'tree') {
        const e = .5 / mpu;
        const gx = (heightAt(record.x + e, record.z) - heightAt(record.x - e, record.z)) / (2 * e);
        const gz = (heightAt(record.x, record.z + e) - heightAt(record.x, record.z - e)) / (2 * e);
        groundNormal.set(-gx, 1, -gz).normalize();
        record.nx = groundNormal.x; record.ny = groundNormal.y; record.nz = groundNormal.z;
      }
    }
    if (!Number.isFinite(record.y)) { for (const mesh of pool.meshes) mesh.setMatrixAt(record.slot, zero); mark(pool); return; }
    const h = record.heightM / mpu, slot = record.slot;
    transform.rotation.set(0, record.rotation, 0);
    if (record.kind !== 'tree') { groundNormal.set(record.nx, record.ny, record.nz); transform.quaternion.setFromUnitVectors(up, groundNormal); transform.rotateY(record.rotation); }
    if (record.kind === 'rock') {
      const d = record.sizeM / mpu;
      transform.position.set(record.x - record.nx * h * .08, record.y - record.ny * h * .08, record.z - record.nz * h * .08);
      transform.scale.set(d * .5 * fade, h * fade, d * (.39 + record.phase * .15) * fade);
      transform.updateMatrix(); pool.meshes[0].setMatrixAt(slot, transform.matrix);
    } else if (record.kind === 'tree') {
      transform.position.set(record.x, record.y + h * .68 * fade, record.z);
      transform.scale.set(h * .34 * fade, h * .38 * fade, h * .38 * fade);
      transform.updateMatrix(); pool.meshes[0].setMatrixAt(slot, transform.matrix);
      transform.position.y = record.y + h * .27 * fade;
      transform.scale.set(h * .56 * fade, h * .54 * fade, h * .56 * fade);
      transform.updateMatrix(); pool.meshes[1].setMatrixAt(slot, transform.matrix);
    } else {
      const r = record.radiusM / mpu;
      transform.position.set(record.x + record.nx * h * .45 * fade, record.y + record.ny * h * .45 * fade, record.z + record.nz * h * .45 * fade);
      transform.scale.set(r * fade, h * .65 * fade, r * (.85 + record.phase * .18) * fade);
      transform.updateMatrix(); pool.meshes[0].setMatrixAt(slot, transform.matrix);
    }
    mark(pool);
  }
  function removeChunk(chunk) { for (const record of chunk.records) release(record); chunks.delete(chunk.key); }
  function rebuildWanted(position, nearEnabled) {
    desired.clear();
    const layers = mask?.sampleAt || terrain.forestCoverAt
      ? [{ name: 'canopy', sizeM: 160, radiusM: profile.canopyRadiusM }]
      : [];
    if (nearEnabled) layers.push({ name: 'near', sizeM: 64, radiusM: profile.radiusM });
    for (const layer of layers) {
      const cell = layer.sizeM / mpu, cx = Math.floor(position.x / cell), cz = Math.floor(position.z / cell), reach = Math.ceil(layer.radiusM / layer.sizeM);
      for (let oz = -reach; oz <= reach; oz++) for (let ox = -reach; ox <= reach; ox++) {
        const ix = cx + ox, iz = cz + oz;
        const distance = Math.hypot((ix + .5) * cell - position.x, (iz + .5) * cell - position.z) * mpu;
        if (distance > layer.radiusM + layer.sizeM * .35) continue;
        // Keep an overlapping forest layer. Individual-crown fading is applied
        // below, instead of cutting entire square cells into a visible annulus.
        const key = `${layer.name}:${ix}:${iz}`;
        desired.set(key, { key, cx: ix, cz: iz, layer: layer.name, distance, priority: distance + (layer.name === 'canopy' ? 160 : 0) });
      }
    }
    pending = [...desired.values()].filter(item => !chunks.has(item.key)).sort((a, b) => a.priority - b.priority);
    lastCenter.copy(position); lastNearEnabled = nearEnabled;
  }
  function addChunk(request) {
    const chunk = generateDecorChunk({ terrain, cx: request.cx, cz: request.cz, forestCover: mask, layer: request.layer, forestDensity });
    Object.assign(chunk, { key: request.key, fade: 0, anchorDirty: true });
    const candidates = chunk.records;
    chunk.records = []; chunk.waiting = [];
    for (const record of candidates) (allocate(record) ? chunk.records : chunk.waiting).push(record);
    chunks.set(chunk.key, chunk);
  }
  function update(position, { dt = 1 / 60, mode = 'fps', altitudeAGL = 0 } = {}) {
    if (disposed || !position || !Number.isFinite(position.x + position.z)) return;
    frame++;
    const nearWeight = 1 - smooth(180, 500, Math.max(0, altitudeAGL));
    const nearEnabled = nearWeight > .001;
    const movedForFade = frame % 3 === 0 && lastFadeCenter.distanceToSquared(position) * mpu * mpu > .04;
    if (movedForFade) lastFadeCenter.copy(position);
    if (lastCenter.distanceToSquared(position) * mpu * mpu > 64 || nearEnabled !== lastNearEnabled) rebuildWanted(position, nearEnabled);
    // New cells are prepared over several frames. Existing instances never move
    // merely because the character crossed a grid cell or changed camera mode.
    for (let i = 0; i < profile.chunksPerFrame && pending.length; i++) addChunk(pending.shift());
    if (frame % 4 === 0) {
      const waiting = [...chunks.values()].filter(c => c.waiting.length && desired.has(c.key));
      waiting.sort((a, b) => Math.hypot((a.x0+a.x1)*.5-position.x,(a.z0+a.z1)*.5-position.z)-Math.hypot((b.x0+b.x1)*.5-position.x,(b.z0+b.z1)*.5-position.z));
      let budget = 10;
      for (const chunk of waiting) {
        chunk.waiting = chunk.waiting.filter(record => {
          if (budget <= 0 || !allocate(record)) return true;
          budget--; chunk.records.push(record); chunk.anchorDirty = true; return false;
        });
        if (budget <= 0) break;
      }
    }
    let refreshBudget = profile.chunksPerFrame;
    for (const chunk of chunks.values()) {
      if (!chunk.forestDirty || refreshBudget <= 0) continue;
      refreshBudget--; chunk.forestDirty = false;
      const candidates = generateDecorChunk({ terrain, cx: chunk.cx, cz: chunk.cz, forestCover: mask, layer: chunk.layer, forestDensity }).records.filter(r => r.kind !== 'rock');
      const keyFor = r => `${r.kind}:${r.x}:${r.z}`;
      const existing = new Map([...chunk.records, ...chunk.waiting].filter(r => r.kind !== 'rock').map(r => [keyFor(r), r]));
      const keptKeys = new Set(candidates.map(keyFor));
      for (const record of chunk.records) if (record.kind !== 'rock' && !keptKeys.has(keyFor(record))) release(record);
      chunk.records = chunk.records.filter(r => r.kind === 'rock'); chunk.waiting = chunk.waiting.filter(r => r.kind === 'rock');
      for (const candidate of candidates) {
        const record = existing.get(keyFor(candidate)) || candidate;
        if (record.slot != null || allocate(record)) chunk.records.push(record); else chunk.waiting.push(record);
      }
      chunk.anchorDirty = true;
    }
    const blend = 1 - Math.exp(-Math.min(dt, .075) * 7);
    for (const chunk of chunks.values()) {
      const inRange = desired.has(chunk.key);
      const target = inRange ? 1 : 0;
      const next = chunk.fade + (target - chunk.fade) * blend;
      if (!inRange && next < .004) { removeChunk(chunk); continue; }
      chunk.fade = next;
      if (chunk.anchorDirty || movedForFade || Math.abs(next - (chunk.renderedFade || 0)) > .003 || frame % 8 === 0) {
        chunk.renderedFade = next;
        for (const record of chunk.records) {
          const distanceM = Math.hypot(record.x-position.x,record.z-position.z)*mpu;
          const radiusM = (record.kind === 'canopy' ? profile.canopyRadiusM : profile.radiusM) * (.91 + record.phase * .09);
          const outer = 1 - smooth(radiusM * .55, radiusM, distanceM);
          const inner = record.kind === 'canopy' ? 1 - nearWeight * (1 - smooth(25 + record.phase*15, 90 + record.phase*25, distanceM)) : nearWeight;
          applyRecord(record, next * outer * inner, chunk.anchorDirty);
        }
        chunk.anchorDirty = false;
      }
    }
    for (const pool of Object.values(pools)) {
      if (pool.dirty) { for (const mesh of pool.meshes) mesh.instanceMatrix.needsUpdate = true; pool.dirty = false; }
      if (pool.colorsDirty && pool.meshes[0].instanceColor) { pool.meshes[0].instanceColor.needsUpdate = true; pool.colorsDirty = false; }
    }
  }
  function onTerrainChanged(tiles = null) {
    for (const chunk of chunks.values()) if (!tiles || tiles.some(tile => chunk.x1 >= tile.x0 && chunk.x0 <= tile.x1 && chunk.z1 >= tile.z0 && chunk.z0 <= tile.z1)) chunk.anchorDirty = true;
  }
  function invalidateCells() {
    for (const chunk of [...chunks.values()]) removeChunk(chunk);
    pending = []; desired.clear(); lastCenter.set(Infinity, 0, Infinity);
    for (const pool of Object.values(pools)) {
      pool.free = []; pool.slots.fill(null); pool.active = 0;
      for (let i = pool.capacity - 1; i >= 0; i--) pool.free.push(i);
      for (const mesh of pool.meshes) mesh.count = 0;
    }
  }
  function setForestDensity(value) {
    const next = ['discreet','balanced','dense'].includes(value) ? value : 'balanced';
    if (next === forestDensity) return;
    forestDensity = next;
    // Revisit forest records in bounded batches; stones and retained trees keep
    // their existing instances. The data raster itself is never modified.
    for (const chunk of chunks.values()) chunk.forestDirty = true;
  }
  function setForestCover(value) { if (mask === value) return; mask = value?.sampleAt ? value : null; invalidateCells(); }
  function setStyle(value) {
    style = value === 'voxel' ? 'voxel' : 'nature';
    pools.rock.meshes[0].geometry = style === 'voxel' ? geoms.rockBlock : geoms.basalt;
    pools.tree.meshes[0].geometry = pools.canopy.meshes[0].geometry = style === 'voxel' ? geoms.foliageBlock : geoms.foliage;
    pools.tree.meshes[1].geometry = style === 'voxel' ? geoms.trunkBlock : geoms.trunk;
    for (const key of ['foliage', 'canopy']) { materials[key].flatShading = style === 'voxel'; materials[key].needsUpdate = true; }
  }
  function setQuality(value) {
    const next = PROFILE[value] || PROFILE.balanced;
    if (next === profile) return;
    profile = next; quality = value;
    pools.rock.limit = profile.rocks; pools.tree.limit = profile.trees; pools.canopy.limit = profile.canopy;
    invalidateCells();
  }
  function getInfo() { return { rocks: pools.rock.active || 0, trees: pools.tree.active || 0, canopyGroups: pools.canopy.active || 0, chunks: chunks.size, pendingChunks: pending.length, instancedDrawCalls: 4, forestCover: Boolean(mask), forestDensity, quality }; }
  function dispose() {
    if (disposed) return; disposed = true; chunks.clear(); desired.clear(); pending = [];
    for (const geometry of Object.values(geoms)) geometry.dispose();
    for (const material of Object.values(materials)) material.dispose();
    for (const pool of Object.values(pools)) for (const mesh of pool.meshes) mesh.dispose();
    group.clear();
  }
  setStyle(style);
  return { group, update, onTerrainChanged, setStyle, setQuality, setForestCover, setForestDensity, setForestTypes, getInfo, dispose };
}
