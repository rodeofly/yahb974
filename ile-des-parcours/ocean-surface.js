import * as THREE from './vendor/three.module.js';

const FIELD_SIZE = 1024;
const COAST_RANGE_METERS = 2000;
const SEA_LEVEL_WORLD = -0.003;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/**
 * A coarse distance to sampled land cells, used only to soften the sea colour.
 * This field follows the DEM footprint; it is not surveyed coastline geometry,
 * water depth, bathymetry, a reef mask, or an invented lagoon.
 *
 * Two chamfer passes use metre-based horizontal, vertical and diagonal costs.
 * The temporary distances are discarded after packing one 512² RGBA texture.
 */
export function buildCoastField(terrain, { size = FIELD_SIZE, rangeMeters = COAST_RANGE_METERS } = {}) {
  const bounds = terrain?.bounds;
  if (!terrain?.isLand || !bounds || ![bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ].every(Number.isFinite) || bounds.maxX <= bounds.minX || bounds.maxZ <= bounds.minZ) {
    throw new Error('Le champ côtier nécessite les limites et le masque terrestre du MNT.');
  }
  if (!Number.isInteger(size) || size < 2 || size > FIELD_SIZE || !Number.isFinite(rangeMeters) || rangeMeters <= 0) {
    throw new Error('Résolution ou portée du champ côtier invalide.');
  }
  const metersPerUnit = Number.isFinite(terrain.metersPerUnit) && terrain.metersPerUnit > 0 ? terrain.metersPerUnit : 1;
  const stepX = (bounds.maxX - bounds.minX) / (size - 1), stepZ = (bounds.maxZ - bounds.minZ) / (size - 1);
  const costX = stepX * metersPerUnit, costZ = stepZ * metersPerUnit, diagonal = Math.hypot(costX, costZ);
  const count = size * size, distances = new Float32Array(count), data = new Uint8Array(count * 4);
  distances.fill(rangeMeters);
  let landSamples = 0;
  for (let row = 0; row < size; row++) {
    const z = bounds.minZ + row * stepZ;
    for (let col = 0; col < size; col++) {
      const index = row * size + col, land = Boolean(terrain.isLand(bounds.minX + col * stepX, z));
      if (land) { distances[index] = 0; landSamples++; }
      data[index * 4 + 1] = land ? 255 : 0;
      data[index * 4 + 3] = 255;
    }
  }
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const i = row * size + col;
    let d = distances[i];
    if (col > 0) d = Math.min(d, distances[i - 1] + costX);
    if (row > 0) {
      d = Math.min(d, distances[i - size] + costZ);
      if (col > 0) d = Math.min(d, distances[i - size - 1] + diagonal);
      if (col + 1 < size) d = Math.min(d, distances[i - size + 1] + diagonal);
    }
    distances[i] = d;
  }
  for (let row = size - 1; row >= 0; row--) for (let col = size - 1; col >= 0; col--) {
    const i = row * size + col;
    let d = distances[i];
    if (col + 1 < size) d = Math.min(d, distances[i + 1] + costX);
    if (row + 1 < size) {
      d = Math.min(d, distances[i + size] + costZ);
      if (col > 0) d = Math.min(d, distances[i + size - 1] + diagonal);
      if (col + 1 < size) d = Math.min(d, distances[i + size + 1] + diagonal);
    }
    distances[i] = d;
    data[i * 4] = Math.round(clamp(d / rangeMeters, 0, 1) * 255);
  }
  return { data, size, rangeMeters, landSamples, sampleCount: count, cellSizeMeters: { x: costX, z: costZ }, bounds: { ...bounds } };
}

const vertexShader = `
varying vec3 vWorld;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
  #include <logdepthbuf_vertex>
}`;

// The fringing coral reefs of the west and south-west coasts (approximate
// lon/lat boxes). Their lagoon and surf line are an illustration, not a survey.
export const REEF_ZONES = Object.freeze([
  { name: 'Saint-Gilles — La Saline', lat: [-21.115, -21.025], lon: [55.19, 55.27] },
  { name: 'Saint-Leu', lat: [-21.19, -21.15], lon: [55.25, 55.30] },
  { name: 'Étang-Salé', lat: [-21.28, -21.255], lon: [55.31, 55.37] },
  { name: 'Saint-Pierre', lat: [-21.352, -21.333], lon: [55.45, 55.49] },
]);
export function reefWeight(lon, lat) {
  let best = 0;
  for (const zone of REEF_ZONES) {
    const inside = Math.min(lat - zone.lat[0], zone.lat[1] - lat, lon - zone.lon[0], zone.lon[1] - lon);
    best = Math.max(best, clamp(inside / .006, 0, 1));
  }
  return best;
}
/** Marks the near-shore band of the reef zones in the field's blue channel. */
export function markReefs(field, terrain, reefDistanceMeters = 900) {
  if (typeof terrain?.worldToGeo !== 'function') return field;
  const { size, bounds, rangeMeters, data } = field;
  const stepX = (bounds.maxX - bounds.minX) / (size - 1), stepZ = (bounds.maxZ - bounds.minZ) / (size - 1);
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const i = (row * size + col) * 4, distance = data[i] / 255 * rangeMeters;
    if (data[i + 1] || distance > reefDistanceMeters) continue;
    const geo = terrain.worldToGeo(bounds.minX + col * stepX, bounds.minZ + row * stepZ);
    data[i + 2] = Math.round(reefWeight(geo.lon, geo.lat) * 255);
  }
  return field;
}

const fragmentShader = `
varying vec3 vWorld;
uniform float uTime, uAtmosphereStrength, uCoastRange, uFieldTexel, uParadise;
uniform vec3 uCamera, uHorizon, uSunDirection;
uniform sampler2D uCoastField;
uniform vec4 uBounds;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec2 coastUv = (vWorld.xz - uBounds.xy) / uBounds.zw;
  float inField = step(0.0, coastUv.x) * step(coastUv.x, 1.0)
    * step(0.0, coastUv.y) * step(coastUv.y, 1.0);
  // One sample replaces the previous four neighbouring binary-mask samples.
  // The gentle colour change is illustrative, never a water-depth estimate.
  vec2 fieldUv = coastUv * (1.0 - uFieldTexel) + vec2(0.5 * uFieldTexel);
  vec4 coastField = texture2D(uCoastField, fieldUv);
  float coastDistance = mix(uCoastRange, coastField.r * uCoastRange, inField);
  float reef = coastField.b * inField;
  float coastPresence = 1.0 - smoothstep(0.0, 600.0, coastDistance);
  vec3 natural = mix(vec3(0.10, 0.26, 0.30), vec3(0.17, 0.365, 0.36), coastPresence * 0.48);
  // Tropical palette: deep ocean blue, open water, turquoise shallows and,
  // inside the reef zones, a pale lagoon up to the surf line.
  vec3 tropical = mix(vec3(0.015, 0.16, 0.36), vec3(0.0, 0.33, 0.52), 1.0 - smoothstep(600.0, 2000.0, coastDistance));
  tropical = mix(tropical, vec3(0.05, 0.6, 0.65), 1.0 - smoothstep(40.0, 420.0, coastDistance));
  tropical = mix(tropical, vec3(0.32, 0.86, 0.8), reef * (1.0 - smoothstep(300.0, 380.0, coastDistance)));
  vec3 colour = mix(natural, tropical, uParadise);

  vec3 toCamera = uCamera - vWorld;
  float cameraDistance = max(length(toCamera), 0.0001);
  vec3 viewDirection = toCamera / cameraDistance;
  float phaseA = vWorld.x * 4.1 + vWorld.z * 2.7 + uTime * 0.65;
  float phaseB = vWorld.z * 3.8 - vWorld.x * 0.9 - uTime * 0.40;
  float phaseFootprint = max(fwidth(phaseA), fwidth(phaseB));
  float pixelFilter = 1.0 - smoothstep(0.45, 2.5, phaseFootprint);
  float detailWeight = (1.0 - smoothstep(20.0, 160.0, cameraDistance)) * pixelFilter;
  float waveA = sin(phaseA), waveB = sin(phaseB);
  colour += waveA * waveB * 0.0065 * detailWeight;
  // Foam: a breaking line along the shore and the reef crest. Far away the
  // band widens with the pixel footprint instead of flickering.
  float foamWidth = max(55.0, fwidth(coastDistance) * 1.6);
  float shoreWave = sin(coastDistance * 0.09 - uTime * 1.6 + phaseA * 0.3) * detailWeight;
  float shoreFoam = (1.0 - smoothstep(6.0, foamWidth, coastDistance + shoreWave * 10.0)) * (1.0 - coastField.g);
  float crest = reef * (1.0 - smoothstep(16.0, foamWidth, abs(coastDistance - 350.0 + 12.0 * sin(phaseB * 0.5 + uTime))));
  float foam = max(shoreFoam * (0.75 + 0.25 * sin(uTime * 1.3 + phaseB)), crest * (0.6 + 0.4 * sin(uTime * 2.0 + phaseA)));
  colour = mix(colour, vec3(0.93, 0.97, 0.96), clamp(foam, 0.0, 1.0) * uParadise * 0.85);

  // Small normal changes give a soft warm glint without a reflection texture,
  // scene capture, foam ring, or additional draw call. Filtering also removes
  // the specular detail before waves become smaller than a screen pixel.
  vec3 surfaceNormal = normalize(vec3(cos(phaseA) * 0.035 * detailWeight, 1.0, cos(phaseB) * 0.027 * detailWeight));
  vec3 halfDirection = normalize(uSunDirection + viewDirection + vec3(0.0, 0.0001, 0.0));
  float sunGlint = pow(max(dot(surfaceNormal, halfDirection), 0.0), 42.0);
  colour += vec3(0.76, 0.68, 0.48) * sunGlint * mix(0.043, 0.13, uParadise) * detailWeight;
  float grazing = clamp(1.0 - max(viewDirection.y, 0.0), 0.0, 1.0);
  colour = mix(colour, uHorizon, grazing * grazing * grazing * 0.055 * detailWeight);

  float atmosphere = (1.0 - exp(-cameraDistance * 0.0006)) * uAtmosphereStrength;
  colour = mix(colour, uHorizon, atmosphere);
  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** A single opaque plane. update() takes elapsed seconds, not a delta. */
export function createOceanSurface({ terrain, camera, horizon, sunDirection } = {}) {
  if (!camera?.position) throw new Error('Une caméra est nécessaire pour la surface de l’océan.');
  const field = markReefs(buildCoastField(terrain), terrain);
  const coastTexture = new THREE.DataTexture(field.data, field.size, field.size, THREE.RGBAFormat, THREE.UnsignedByteType);
  coastTexture.name = 'Distance côtière illustrative issue du masque MNT';
  coastTexture.minFilter = coastTexture.magFilter = THREE.LinearFilter;
  coastTexture.wrapS = coastTexture.wrapT = THREE.ClampToEdgeWrapping;
  coastTexture.generateMipmaps = false; coastTexture.flipY = false; coastTexture.needsUpdate = true;
  const direction = new THREE.Vector3(-120, 220, -160).normalize();
  const material = new THREE.ShaderMaterial({
    name: 'Océan — teinte côtière et reflets discrets',
    uniforms: {
      uTime: { value: 0 }, uAtmosphereStrength: { value: 0.12 }, uParadise: { value: 1 }, uCoastRange: { value: field.rangeMeters }, uFieldTexel: { value: 1 / field.size },
      uCamera: { value: camera.position }, uHorizon: { value: horizon?.isColor ? horizon : new THREE.Color(horizon ?? '#c5d6cf') },
      uSunDirection: { value: direction }, uCoastField: { value: coastTexture },
      uBounds: { value: new THREE.Vector4(field.bounds.minX, field.bounds.minZ, field.bounds.maxX - field.bounds.minX, field.bounds.maxZ - field.bounds.minZ) }
    },
    vertexShader, fragmentShader
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), material);
  mesh.name = 'Océan'; mesh.rotation.x = -Math.PI / 2; mesh.position.y = SEA_LEVEL_WORLD;
  let disposed = false;
  function update(elapsedSeconds) { if (!disposed && Number.isFinite(elapsedSeconds)) material.uniforms.uTime.value = Math.max(0, elapsedSeconds); }
  function setAtmosphereStrength(value) {
    if (disposed || !Number.isFinite(value)) return false;
    material.uniforms.uAtmosphereStrength.value = clamp(value, 0, 1); return true;
  }
  function setLightDirection(value) {
    if (disposed || !value || ![value.x, value.y, value.z].every(Number.isFinite) || Math.hypot(value.x, value.y, value.z) < 1e-8) return false;
    direction.set(value.x, value.y, value.z).normalize(); return true;
  }
  function setParadise(value) { material.uniforms.uParadise.value = value ? 1 : 0; }
  function getInfo() {
    return { drawCalls: 1, triangles: 2, textureSize: field.size, textureBytes: field.data.byteLength, textureSamplesPerFragment: 1,
      coastRangeMeters: field.rangeMeters, coastCellSizeMeters: { ...field.cellSizeMeters }, coastSource: 'DEM land footprint', coastDistanceApproximate: true,
      bathymetry: false, reflectionPass: false, paradise: material.uniforms.uParadise.value === 1, reefZones: REEF_ZONES.length, landSamples: field.landSamples, atmosphereStrength: material.uniforms.uAtmosphereStrength.value, disposed };
  }
  function dispose() {
    if (disposed) return;
    disposed = true; mesh.removeFromParent(); mesh.geometry.dispose(); material.dispose(); coastTexture.dispose();
  }
  if (sunDirection) setLightDirection(sunDirection);
  return { mesh, material, update, setAtmosphereStrength, setLightDirection, setParadise, getInfo, dispose };
}
