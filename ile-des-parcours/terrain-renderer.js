import * as THREE from './vendor/three.module.js';
import { FOREST_BELTS, BELT_LIMITS_M, LEEWARD_LONGITUDE } from './forest-types.js';

// The supplied IGN grid is the only elevation source. The illustrated palette
// and ground marks change colour, never the measured elevation or coastline.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const STEPS = [25, 50, 100, 250, 500, 1000];

// Visual intensity only: these profiles never alter the ESA classification.
// Keep fractional/mipmapped cover continuous, especially in the island overview.
const FOREST_DENSITY = Object.freeze({
  discreet: Object.freeze({ gamma: 1.1, opacity: .72, instances: .60, cutoff: .035 }),
  balanced: Object.freeze({ gamma: .9, opacity: .86, instances: .88, cutoff: .015 }),
  dense: Object.freeze({ gamma: .72, opacity: .94, instances: 1.08, cutoff: .008 }),
});
export function getForestRenderSettings(density = 'balanced') { return FOREST_DENSITY[density] || FOREST_DENSITY.balanced; }
export function forestVisualWeight(cover, density = 'balanced') {
  const settings = getForestRenderSettings(density);
  return Math.pow(clamp(Number(cover) || 0, 0, 1), settings.gamma) * settings.opacity;
}

// A gentle, direction-independent relief tint, not a shadow calculation. The
// fixed 500 m sampling lattice is independent of mesh LOD and camera position.
// Typed caches have a fixed island-sized capacity and fill only when queried;
// finer meshes interpolate the same field without resampling every vertex.
function createReliefTint(source) {
  const { bounds, metersPerUnit } = source, spacingM = 500;
  const spacing = spacingM / metersPerUnit;
  const col0 = Math.floor(bounds.minX / spacing) - 1, row0 = Math.floor(bounds.minZ / spacing) - 1;
  const columns = Math.ceil(bounds.maxX / spacing) - col0 + 2;
  const rows = Math.ceil(bounds.maxZ / spacing) - row0 + 2;
  const elevations = new Float32Array(columns * rows), shades = new Float32Array(columns * rows);
  const ready = new Uint8Array(columns * rows);
  function elevation(col, row) {
    if (col < 0 || col >= columns || row < 0 || row >= rows) return NaN;
    const at = row * columns + col;
    if (!(ready[at] & 1)) {
      const x = (col + col0) * spacing, z = (row + row0) * spacing;
      const h = x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ ? NaN : source.sampleMeters(x, z);
      // The DEM defines land as valid, non-negative elevation. Missing data and
      // sea never become artificial zero-height neighbours along the coast.
      elevations[at] = Number.isFinite(h) && h >= 0 ? h : NaN;
      ready[at] |= 1;
    }
    return elevations[at];
  }
  function shade(col, row) {
    const at = row * columns + col;
    if (!(ready[at] & 2)) {
      const center = elevation(col, row);
      const west = elevation(col - 1, row), east = elevation(col + 1, row);
      const north = elevation(col, row - 1), south = elevation(col, row + 1);
      // A planar slope stays neutral. Positive curvature darkens shallow
      // hollows by at most5.5%; exposed ridges brighten by at most2.5%.
      const bend = ((west + east + north + south) * .25 - center) / spacingM;
      shades[at] = Number.isFinite(bend) ? 1 - clamp(bend * .16, -.025, .055) : 1;
      ready[at] |= 2;
    }
    return shades[at];
  }
  return (x, z) => {
    if (!Number.isFinite(x + z) || x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return 1;
    const gx = x / spacing - col0, gz = z / spacing - row0;
    const col = Math.floor(gx), row = Math.floor(gz), fx = gx - col, fz = gz - row;
    const north = shade(col, row) * (1 - fx) + shade(col + 1, row) * fx;
    const south = shade(col, row + 1) * (1 - fx) + shade(col + 1, row + 1) * fx;
    return north * (1 - fz) + south * fz;
  };
}

// Ground palettes. « paradis » is the tropical look asked for the Fil
// d'Ariane: lusher greens, golden sand on low flat coasts. Colours only: the
// measured elevation and the forest mask are unchanged.
export const TERRAIN_PALETTES = Object.freeze({
  nature: Object.freeze({ meadow: '#98aa76', rock: '#989b87', volcanic: '#b09370', basalt: '#727c71', shore: '#c0b98c', forest: '#4c8056', sand: 0 }),
  paradis: Object.freeze({ meadow: '#7cb35a', rock: '#9b9381', volcanic: '#a8835d', basalt: '#6b726a', shore: '#f0dfac', forest: '#2f8049', sand: .92 }),
});

// A colour as a GLSL constant, in the linear space the shader works in.
const glslColour = hex => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };

export function createTerrainRenderer(source, { precisionM = 250, quality = 'balanced', style = 'nature', verticalScale = 1, forestDensity = 'balanced', palette = 'nature', onSurfaceChange = () => {} } = {}) {
  const group = new THREE.Group();
  group.name = 'IGN RGE ALTI — terrain réel, palette illustrée';
  group.scale.y = verticalScale;
  const { bounds, metersPerUnit } = source;
  const tileSize = 4000 / metersPerUnit;
  const tiles = [], lookup = new Map();
  const landColour = new THREE.Color();
  const meadow = new THREE.Color(), rock = new THREE.Color(), volcanic = new THREE.Color(), basalt = new THREE.Color(), shore = new THREE.Color();
  let paletteName = 'nature', sandWeight = 0;
  function applyPalette(name) {
    paletteName = Object.hasOwn(TERRAIN_PALETTES, name) ? name : 'nature';
    const p = TERRAIN_PALETTES[paletteName];
    meadow.set(p.meadow); rock.set(p.rock); volcanic.set(p.volcanic); basalt.set(p.basalt); shore.set(p.shore); sandWeight = p.sand;
  }
  applyPalette(palette);
  const sourceStep = Math.max(25, source.sourceResolutionM || source.cellSizeM || 25);
  const availableSteps = STEPS.filter(n => n >= sourceStep);
  const clock = () => performance.now();
  let disposed = false, meshRevision = 0, lastLOD = -Infinity, lastMode = 'orbit';
  let activeJob = null, pending = [];
  const lastCamera = new THREE.Vector3(Infinity, Infinity, Infinity);
  const volcanicPosition = source.geoToWorld(55.7087, -21.2443);
  const reliefTint = createReliefTint(source);

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.FrontSide, flatShading: style === 'voxel' });
  const detail = { value: quality === 'eco' ? 0 : 1 };
  let forestCover = null;
  const emptyForest = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat); emptyForest.needsUpdate = true;
  const forestUniforms = {
    uForestMap: { value: emptyForest }, uForestReady: { value: 0 },
    uForestBounds: { value: new THREE.Vector4(bounds.minX, bounds.minZ, bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) },
    uForestTexel: { value: new THREE.Vector2(1, 1) },
    uForestColour: { value: new THREE.Color(TERRAIN_PALETTES[paletteName].forest) },
    uForestGamma: { value: getForestRenderSettings(forestDensity).gamma },
    uForestOpacity: { value: getForestRenderSettings(forestDensity).opacity },
    uForestTypes: { value: 1 }, uVerticalScale: { value: verticalScale },
  };
  material.onBeforeCompile = shader => {
    shader.uniforms.uSurfaceDetail = detail;
    Object.assign(shader.uniforms, forestUniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float terrainRelief;\nvarying float vTerrainRelief;\nvarying vec3 vTerrainPosition;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainRelief = terrainRelief;\nvTerrainPosition = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vTerrainPosition;
      varying float vTerrainRelief;
      uniform float uSurfaceDetail;
      uniform sampler2D uForestMap;
      uniform vec4 uForestBounds;
      uniform vec2 uForestTexel;
      uniform float uForestReady;
      uniform vec3 uForestColour;
      uniform float uForestGamma, uForestOpacity;
      uniform float uForestTypes, uVerticalScale;
      float terrainHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float terrainNoise(vec2 p) { vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(terrainHash(i),terrainHash(i+vec2(1,0)),f.x),mix(terrainHash(i+vec2(0,1)),terrainHash(i+vec2(1,1)),f.x),f.y); }
      vec3 canopyField(vec2 p) {
        vec2 cell=floor(p),f=fract(p),u=f*f*(3.0-2.0*f),du=6.0*f*(1.0-f);
        float a=terrainHash(cell),b=terrainHash(cell+vec2(1,0));
        float c=terrainHash(cell+vec2(0,1)),d=terrainHash(cell+vec2(1,1));
        float value=mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
        vec2 gradient=vec2(mix(b-a,d-c,u.y),mix(c-a,d-b,u.x))*du;
        return vec3(value,gradient);
      }
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec2 metres = vTerrainPosition.xz * ${metersPerUnit.toFixed(1)};
      vec2 forestUV = (vTerrainPosition.xz-uForestBounds.xy)/uForestBounds.zw;
      float inForestBounds = step(0.0,forestUV.x)*step(forestUV.x,1.0)*step(0.0,forestUV.y)*step(forestUV.y,1.0);
      vec2 forestSampleUV = mix(uForestTexel*.5,vec2(1.0)-uForestTexel*.5,clamp(forestUV,0.0,1.0));
      float forestAmount = texture2D(uForestMap,forestSampleUV).r*uForestReady*inForestBounds;
      // A mixed 50 m cell and a minified map texel are fractions, not low-
      // confidence binary labels. The former0.14/0.80 gate erased such patches.
      forestAmount = pow(clamp(forestAmount,0.0,1.0),uForestGamma);
      // Broad, quiet brush patches remain readable from a glider or a hillside.
      // One low-frequency noise field; no normal perturbation or extra lights.
      float patchNoise = terrainNoise(metres * .014);
      float terrainPatch = smoothstep(.34, .68, patchNoise);
      diffuseColor.rgb *= mix(.90, 1.045, terrainPatch);
      float greenGround = smoothstep(.025, .14, diffuseColor.g - diffuseColor.r * .82);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.06, 1.01, .90), (1.0-terrainPatch)*.18*greenGround);
      // Broad hue drift over open grass: drier yellow-green and cooler lush
      // areas, so a vivid palette does not read as one flat plastic green.
      float hueDrift = terrainNoise(metres * .0045 + 17.0);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.1, 1.04, .78), smoothstep(.56, .86, hueDrift) * .55 * greenGround);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.8, .94, .9), (1.0 - smoothstep(.14, .44, hueDrift)) * .45 * greenGround);
      // Sparse hand-painted grass strokes, filtered out before subpixel scale.
      // The derivative filter removes distant crawling/shimmering. No white specks.
      vec2 mark = metres * .72;
      float footprint = max(length(dFdx(mark)), length(dFdy(mark)));
      float readable = (1.0-smoothstep(.10, .40, footprint))*uSurfaceDetail;
      vec2 cell = floor(mark), local = fract(mark)-.5;
      float seed = terrainHash(cell);
      local.x += (seed-.5)*.30;
      float stroke = 1.0-smoothstep(.018, .055, abs(local.x + local.y*.27));
      stroke *= smoothstep(-.26,-.16,local.y)*(1.0-smoothstep(.03,.17,local.y));
      float blade = stroke * step(.67,seed) * readable * greenGround;
      diffuseColor.rgb *= 1.0-blade*.16;
      // Close up, a fine mottling of grass tufts; it fades before it can shimmer.
      float tuft = terrainNoise(metres * .38);
      diffuseColor.rgb *= mix(1.0, .86 + tuft * .26, readable * greenGround);
      // Satellite-classified cover controls the footprint. Rounded crowns are
      // a visual proxy in the material, without individual far-away tree meshes.
      mat2 crownRotation=mat2(.8,-.6,.6,.8);
      vec2 crownUV=crownRotation*metres*.095;
      vec3 crown=canopyField(crownUV);
      float crownFootprint=max(length(dFdx(crownUV)),length(dFdy(crownUV)));
      float crownReadable=1.0-smoothstep(.13,.8,crownFootprint);
      float crownDistance=smoothstep(${(14 / metersPerUnit).toFixed(4)},${(50 / metersPerUnit).toFixed(4)},length(vViewPosition));
      float canopyProxy=forestAmount*crownReadable*crownDistance;
      vec2 crownGradient=mat2(.8,.6,-.6,.8)*crown.yz;
      vec3 treeColour=uForestColour*(.94+terrainPatch*.08);
      // Vegetation belts, posterised: flat tints by altitude and side of the
      // island, with ragged limits (the ESA mask alone places the forest).
      if (uForestTypes > .5) {
        float beltWobble = terrainNoise(metres * .0014 + 41.0);
        float beltHeight = vTerrainPosition.y / uVerticalScale * ${metersPerUnit.toFixed(1)} + (beltWobble - .5) * 170.0;
        float leeward = step(vTerrainPosition.x + (beltWobble - .5) * 30.0, ${source.geoToWorld(LEEWARD_LONGITUDE, -21.1).x.toFixed(2)});
        vec3 belt = beltHeight < ${BELT_LIMITS_M.lowlands.toFixed(1)} ? mix(${glslColour(FOREST_BELTS[1].colour)}, ${glslColour(FOREST_BELTS[0].colour)}, leeward)
          : beltHeight < ${BELT_LIMITS_M.mountain.toFixed(1)} ? ${glslColour(FOREST_BELTS[2].colour)}
          : beltHeight < ${BELT_LIMITS_M.tamarind.toFixed(1)} ? ${glslColour(FOREST_BELTS[3].colour)} : ${glslColour(FOREST_BELTS[4].colour)};
        treeColour = belt * (.94 + terrainPatch * .08);
      }
      // Reuse the existing crown field: a little depth in its hollows, with no
      // extra noise, texture lookup, or unfiltered distant pattern.
      float crownHollow=1.0-crown.x;
      treeColour*=1.0+((crown.x-.5)*.19-crownHollow*crownHollow*.025)*crownReadable*crownDistance;
      diffuseColor.rgb=mix(diffuseColor.rgb,treeColour,forestAmount*uForestOpacity);
      diffuseColor.rgb*=vTerrainRelief;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      // Both operands are in view space. Unlike the former sine perturbation,
      // this proxy keeps its lighting direction fixed when the camera rotates.
      vec3 crownTiltView=mat3(viewMatrix)*vec3(crownGradient.x,0.0,crownGradient.y);
      normal=normalize(normal+crownTiltView*canopyProxy*.22);
    `);
  };
  material.customProgramCacheKey = () => 'ign-cartoon-ground-v7-forest-belts';

  function colour(x, z, heightMeters, slope) {
    // A quiet open-ground base. Forest presence and extent come exclusively
    // from the satellite mask; no altitude/longitude vegetation bands remain.
    landColour.copy(meadow);
    landColour.lerp(rock, smooth(.75, 2.1, slope) * .76);
    // A restrained local volcanic-soil tint is illustrative, not land-cover data.
    const nearFournaise=1-smooth(2500/metersPerUnit,12000/metersPerUnit,Math.hypot(x-volcanicPosition.x,z-volcanicPosition.z));
    const exposed=nearFournaise*(.34+smooth(.4,1.8,slope)*.20);
    landColour.lerp(volcanic,exposed);
    landColour.lerp(basalt,nearFournaise*smooth(.9,2.3,slope)*.34);
    // « nature »: no sandy ring. « paradis »: sand only on low, flat coastal
    // land (beaches and river mouths); cliffs and slopes keep their colour.
    landColour.lerp(shore,sandWeight ? (1-smooth(1.5,9,heightMeters))*(1-smooth(.08,.35,slope))*sandWeight : (1-smooth(0,20,heightMeters))*.08);
    return landColour;
  }

  function landInTile(x0, z0, x1, z1) {
    for (let iz = 0; iz <= 16; iz++) for (let ix = 0; ix <= 16; ix++) {
      if (source.isLand(x0 + (x1 - x0) * ix / 16, z0 + (z1 - z0) * iz / 16)) return true;
    }
    return false;
  }
  for (let iz = 0, z = bounds.minZ; z < bounds.maxZ - .001; z += tileSize, iz++) {
    for (let ix = 0, x = bounds.minX; x < bounds.maxX - .001; x += tileSize, ix++) {
      const x1 = Math.min(x + tileSize, bounds.maxX), z1 = Math.min(z + tileSize, bounds.maxZ);
      if (!landInTile(x, z, x1, z1)) continue;
      const tile = { x0: x, z0: z, x1, z1, ix, iz, stepM: 0, mesh: null, heights: null, desired: 500, force: false, priority: Infinity, centerHeight: source.heightAt((x + x1) / 2, (z + z1) / 2) };
      tiles.push(tile); lookup.set(`${ix}:${iz}`, tile);
    }
  }

  function makeJob(tile, stepM) {
    const nx = Math.max(2, Math.ceil((tile.x1 - tile.x0) * metersPerUnit / stepM));
    const nz = Math.max(2, Math.ceil((tile.z1 - tile.z0) * metersPerUnit / stepM));
    const dx = (tile.x1 - tile.x0) / nx, dz = (tile.z1 - tile.z0) / nz;
    const count = (nx + 1) * (nz + 1), capacity = count + 4 * (nx + nz);
    return { tile, stepM, nx, nz, dx, dz, count, style, row: 0, phase: 'vertices',
      positions: new Float32Array(capacity * 3), colours: new Float32Array(capacity * 3), normals: new Float32Array(capacity * 3),
      relief: new Float32Array(capacity),
      indices: new (capacity > 65535 ? Uint32Array : Uint16Array)(nx * nz * 6 + 12 * (nx + nz)),
      heights: new Float32Array(count), vertexCursor: count, indexCursor: 0,
      eps: Math.max(sourceStep / metersPerUnit, Math.min(dx, dz) * .25), minY: Infinity, maxY: -Infinity,
    };
  }

  function vertexRow(job, iz) {
    const { tile, nx, dx, dz, stepM, eps, positions, colours, normals, heights, relief } = job;
    const quantization = Math.max(1, Math.min(12, stepM * .075));
    // A coarse vertex stands for the ground around it: a 1-2-1 weighted mean
    // of the real samples over its footprint, not one point picked from it.
    // Distant ridges then read as rounded crests and pitons instead of spikes
    // (no invented relief; the native 25 m tiles keep every sample).
    const reach = stepM > sourceStep ? stepM / 2 / metersPerUnit : 0;
    const groundAt = (x, z) => {
      const centre = source.sampleMeters(x, z);
      if (!reach || !Number.isFinite(centre) || centre < 0) return centre;
      let sum = centre * 4, weight = 4;
      for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
        if (!j && !k) continue;
        const m = source.sampleMeters(x + k * reach, z + j * reach), w = (2 - Math.abs(j)) * (2 - Math.abs(k));
        if (Number.isFinite(m) && m >= 0) { sum += m * w; weight += w; }
      }
      return sum / weight;
    };
    for (let ix = 0; ix <= nx; ix++) {
      const x = tile.x0 + ix * dx, z = tile.z0 + iz * dz, index = iz * (nx + 1) + ix, i = index * 3;
      const sample = groundAt(x, z);
      const valid = Number.isFinite(sample) && sample >= 0;
      const y = valid ? (job.style === 'voxel' ? Math.round(sample / quantization) * quantization : sample) / metersPerUnit : -.5 / metersPerUnit;
      heights[index] = y; positions[i] = x; positions[i + 1] = y; positions[i + 2] = z;
      relief[index] = valid ? reliefTint(x, z) : 1;
      job.minY = Math.min(job.minY, y); job.maxY = Math.max(job.maxY, y);
      const left = source.heightAt(clamp(x - eps, bounds.minX, bounds.maxX), z);
      const right = source.heightAt(clamp(x + eps, bounds.minX, bounds.maxX), z);
      const north = source.heightAt(x, clamp(z - eps, bounds.minZ, bounds.maxZ));
      const south = source.heightAt(x, clamp(z + eps, bounds.minZ, bounds.maxZ));
      const gx = Number.isFinite(right - left) ? (right - left) / (2 * eps) : 0;
      const gz = Number.isFinite(south - north) ? (south - north) / (2 * eps) : 0;
      const norm = Math.hypot(gx, 1, gz);
      normals[i] = -gx / norm; normals[i + 1] = 1 / norm; normals[i + 2] = -gz / norm;
      const c = colour(x, z, valid ? sample : 0, Math.hypot(gx, gz));
      colours[i] = c.r; colours[i + 1] = c.g; colours[i + 2] = c.b;
    }
  }

  function indexRow(job, iz) {
    const { nx, heights, indices } = job;
    for (let ix = 0; ix < nx; ix++) {
      const a = iz * (nx + 1) + ix, b = a + 1, c = a + nx + 1, d = c + 1;
      if (Math.max(heights[a], heights[b], heights[c], heights[d]) < 0) continue;
      const at = job.indexCursor; indices[at] = a; indices[at + 1] = c; indices[at + 2] = b; indices[at + 3] = b; indices[at + 4] = c; indices[at + 5] = d; job.indexCursor += 6;
    }
  }

  function finishJob(job) {
    const { tile, nx, nz, positions, colours, normals, heights, indices, stepM, relief } = job;
    // Skirts only close distant LOD cracks; they never participate in collisions.
    const skirtDepth = Math.max(2, stepM * .7) / metersPerUnit;
    const addSkirt = (a, b) => {
      if (heights[a] < 0 && heights[b] < 0) return;
      const off = job.vertexCursor;
      for (const index of [a, b]) {
        const target = job.vertexCursor++ * 3, from = index * 3;
        positions[target] = positions[from]; positions[target + 1] = heights[index] - skirtDepth; positions[target + 2] = positions[from + 2];
        relief[target / 3] = relief[index];
        for (let axis = 0; axis < 3; axis++) { colours[target + axis] = colours[from + axis] * .94; normals[target + axis] = normals[from + axis]; }
      }
      const at = job.indexCursor; indices[at] = a; indices[at + 1] = off; indices[at + 2] = b; indices[at + 3] = b; indices[at + 4] = off; indices[at + 5] = off + 1; job.indexCursor += 6;
    };
    for (let ix = 0; ix < nx; ix++) { addSkirt(ix + 1, ix); addSkirt(nz * (nx + 1) + ix, nz * (nx + 1) + ix + 1); }
    for (let iz = 0; iz < nz; iz++) { addSkirt(iz * (nx + 1), (iz + 1) * (nx + 1)); addSkirt((iz + 1) * (nx + 1) + nx, iz * (nx + 1) + nx); }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, job.vertexCursor * 3), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours.subarray(0, job.vertexCursor * 3), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals.subarray(0, job.vertexCursor * 3), 3));
    geometry.setAttribute('terrainRelief', new THREE.BufferAttribute(relief.subarray(0, job.vertexCursor), 1));
    geometry.setIndex(new THREE.BufferAttribute(indices.subarray(0, job.indexCursor), 1));
    geometry.boundingBox = new THREE.Box3(new THREE.Vector3(tile.x0, job.minY - skirtDepth, tile.z0), new THREE.Vector3(tile.x1, job.maxY, tile.z1));
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    // Publish only the completed mesh. Height queries continue to use the old
    // triangles while this job is split across frames, so the player cannot fall
    // onto a partly built surface.
    if (tile.mesh) { group.remove(tile.mesh); tile.mesh.geometry.dispose(); }
    const mesh = new THREE.Mesh(geometry, material); mesh.name = `IGN ${tile.ix}/${tile.iz} ${stepM} m`;
    group.add(mesh);
    Object.assign(tile, { mesh, stepM, heights, nx, nz, dx: job.dx, dz: job.dz, force: false });
    meshRevision++;
  }

  function advanceJob(job, deadline = Infinity) {
    while (job.phase === 'vertices' && job.row <= job.nz) {
      vertexRow(job, job.row++);
      if (clock() >= deadline) return false;
    }
    if (job.phase === 'vertices') { job.phase = 'indices'; job.row = 0; }
    while (job.phase === 'indices' && job.row < job.nz) {
      indexRow(job, job.row++);
      if (clock() >= deadline) return false;
    }
    finishJob(job); return true;
  }
  function rebuildTile(tile, stepM) { const job = makeJob(tile, stepM); advanceJob(job); }

  // A cheap overview first. Fine tiles are prepared in bounded CPU slices while
  // retaining the 4 km tile footprint, avoiding thousands of extra draw calls.
  for (const tile of tiles) rebuildTile(tile, Math.max(500, sourceStep));

  function nearestTile(x, z) {
    const ix = Math.floor(clamp((x - bounds.minX) / tileSize, 0, Math.ceil((bounds.maxX - bounds.minX) / tileSize) - 1));
    const iz = Math.floor(clamp((z - bounds.minZ) / tileSize, 0, Math.ceil((bounds.maxZ - bounds.minZ) / tileSize) - 1));
    return lookup.get(`${ix}:${iz}`);
  }
  function heightAt(x, z) {
    const t = nearestTile(x, z);
    if (!t?.heights || x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return source.heightAt(x, z) * verticalScale;
    const gx = clamp((x - t.x0) / t.dx, 0, t.nx - 1e-7), gz = clamp((z - t.z0) / t.dz, 0, t.nz - 1e-7);
    const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
    const a = iz * (t.nx + 1) + ix, b = a + 1, c = a + t.nx + 1, d = c + 1;
    const raw = fx + fz <= 1 ? t.heights[a] + (t.heights[b] - t.heights[a]) * fx + (t.heights[c] - t.heights[a]) * fz
      : t.heights[d] + (t.heights[c] - t.heights[d]) * (1 - fx) + (t.heights[b] - t.heights[d]) * (1 - fz);
    return raw * verticalScale;
  }
  function queueChanges() { pending = tiles.filter(t => (t.force || t.desired !== t.stepM) && activeJob?.tile !== t).sort((a, b) => a.priority - b.priority); }

  function update(camera, mode = 'orbit', now = 0) {
    if (disposed) return false;
    if (now - lastLOD > 350 && (lastCamera.distanceToSquared(camera.position) > .01 || mode !== lastMode || lastLOD < 0)) {
      const cam = camera.position;
      const altitudeAGL = Math.max(0, (cam.y - source.heightAt(cam.x, cam.z) * verticalScale) * metersPerUnit);
      for (const t of tiles) {
        const dx = Math.max(t.x0 - cam.x, 0, cam.x - t.x1), dz = Math.max(t.z0 - cam.z, 0, cam.z - t.z1);
        const horizontalM = Math.hypot(dx, dz) * metersPerUnit;
        const distanceM = Math.hypot(dx, dz, Math.max(0, cam.y - t.centerHeight * verticalScale)) * metersPerUnit;
        // At gliding altitude the terrain need not keep native 25 m triangles.
        // The finer patch is requested well before approach to the ground, with
        // hysteresis so boundary crossings do not constantly toggle resolution.
        const nearbyPlayer = mode !== 'orbit' && mode !== 'rts' && horizontalM < (t.stepM === sourceStep ? 700 : 450) && altitudeAGL < (t.stepM === sourceStep ? 220 : 160);
        let minimum = nearbyPlayer ? sourceStep : precisionM;
        if (mode === 'glide' && horizontalM < 1000) minimum = Math.min(minimum, altitudeAGL < 500 ? 50 : altitudeAGL < 1500 ? 100 : 250);
        // Strategy camera: the trail and troop under the view get the native grid.
        if (mode === 'rts') minimum = Math.min(minimum, distanceM < 2500 ? sourceStep : distanceM < 6000 ? 50 : distanceM < 12000 ? 100 : precisionM);
        const pixelRatio = mode === 'orbit' ? { eco: 500, balanced: 700, high: 1100 }[quality] : mode === 'rts' ? { eco: 160, balanced: 240, high: 340 }[quality] : { eco: 100, balanced: 150, high: 220 }[quality];
        const recommended = Math.max(minimum, distanceM / pixelRatio);
        t.desired = nearbyPlayer ? sourceStep : availableSteps.find(s => s >= recommended) || availableSteps.at(-1);
        t.priority = distanceM;
      }
      lastLOD = now; lastCamera.copy(cam); lastMode = mode;
      if (activeJob && (activeJob.style !== style || activeJob.stepM !== activeJob.tile.desired)) activeJob = null;
      queueChanges();
    }
    const deadline = clock() + { eco: 2, balanced: 3, high: 4.5 }[quality];
    const changedTiles = [];
    do {
      if (!activeJob) {
        let tile;
        while (pending.length && !tile) { const next = pending.shift(); if (next.force || next.desired !== next.stepM) tile = next; }
        if (!tile) break;
        activeJob = makeJob(tile, tile.desired);
      }
      if (!advanceJob(activeJob, deadline)) break;
      changedTiles.push(activeJob.tile); activeJob = null;
    } while (clock() < deadline && changedTiles.length < (quality === 'eco' ? 1 : 2));
    if (changedTiles.length) onSurfaceChange(changedTiles);
    return changedTiles.length > 0;
  }

  function refineAt(x, z) {
    const center = nearestTile(x, z);
    if (center && (center.stepM !== sourceStep || center.force)) {
      if (activeJob?.tile === center) activeJob = null;
      rebuildTile(center, sourceStep); center.desired = sourceStep; onSurfaceChange([center]);
    }
  }
  function invalidate() { lastLOD = -Infinity; lastCamera.set(Infinity, Infinity, Infinity); }
  function setPrecision(value) { const next = clamp(Number(value) || 250, sourceStep, 1000); if (next !== precisionM) { precisionM = next; invalidate(); } }
  function setQuality(value) { const next = ['eco', 'balanced', 'high'].includes(value) ? value : 'balanced'; if (next === quality) return; quality = next; detail.value = quality === 'eco' ? 0 : 1; invalidate(); }
  function setStyle(value) {
    const next = value === 'voxel' ? 'voxel' : 'nature'; if (style === next) return;
    style = next; material.flatShading = next === 'voxel'; material.needsUpdate = true;
    activeJob = null; for (const t of tiles) t.force = true; queueChanges(); invalidate();
  }
  function setPalette(value) {
    const next = Object.hasOwn(TERRAIN_PALETTES, value) ? value : 'nature'; if (next === paletteName) return;
    applyPalette(next); forestUniforms.uForestColour.value.set(TERRAIN_PALETTES[next].forest);
    activeJob = null; for (const t of tiles) t.force = true; queueChanges(); invalidate();
  }
  function setVerticalScale(value) {
    const next = clamp(Number(value) || 1, 1, 2); if (next === verticalScale) return;
    // A transform changes scale without rebuilding every terrain vertex. Three
    // also transforms the normal matrix; collision queries use the same factor.
    verticalScale = next; group.scale.y = next; forestUniforms.uVerticalScale.value = next; onSurfaceChange(tiles); invalidate();
  }
  function setForestDensity(value) {
    forestDensity=Object.hasOwn(FOREST_DENSITY,value)?value:'balanced';
    const settings=getForestRenderSettings(forestDensity);
    forestUniforms.uForestGamma.value=settings.gamma;
    forestUniforms.uForestOpacity.value=settings.opacity;
  }
  /** Forest tinted by vegetation belts (true) or in one colour. */
  function setForestTypes(value) { forestUniforms.uForestTypes.value = value ? 1 : 0; }
  function setForestCover(mask) {
    if (forestUniforms.uForestMap.value !== emptyForest) forestUniforms.uForestMap.value.dispose();
    forestCover = mask && mask.data?.length === mask.width * mask.height ? mask : null;
    if (!forestCover) { forestUniforms.uForestMap.value = emptyForest; forestUniforms.uForestReady.value = 0; return false; }
    const texture = new THREE.DataTexture(mask.data, mask.width, mask.height, THREE.RedFormat, THREE.UnsignedByteType);
    texture.unpackAlignment = 1; texture.flipY = false; texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping; texture.needsUpdate = true;
    forestUniforms.uForestMap.value = texture; forestUniforms.uForestReady.value = 1;
    const b = mask.bounds;
    forestUniforms.uForestBounds.value.set(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
    forestUniforms.uForestTexel.value.set(1 / mask.width, 1 / mask.height);
    return true;
  }
  function getInfo(x, z) {
    const steps = tiles.map(t => t.stepM);
    return { precisionM, effectivePrecisionM: Math.min(...steps), precisionRangeM: { min: Math.min(...steps), max: Math.max(...steps) }, localPrecisionM: nearestTile(x, z)?.stepM || sourceStep, tileCount: tiles.length, meshRevision, verticalScale, surfaceStyle: style, palette: paletteName, precisionLevels: [500, 250, 100, 50, 25].filter(n => n >= sourceStep), sourceResolutionM: sourceStep, pendingTiles: pending.length + Number(Boolean(activeJob)), forestCover: Boolean(forestCover), forestDensity, forestSource: forestCover?.metadata || null };
  }
  function dispose() { if (disposed) return; disposed = true; activeJob = null; pending = []; for (const t of tiles) t.mesh?.geometry.dispose(); material.dispose(); if (forestUniforms.uForestMap.value !== emptyForest) forestUniforms.uForestMap.value.dispose(); emptyForest.dispose(); group.clear(); }
  return { group, heightAt, update, refineAt, setPrecision, setQuality, setStyle, setPalette, setVerticalScale, setForestCover, setForestDensity, setForestTypes, getInfo, dispose };
}
