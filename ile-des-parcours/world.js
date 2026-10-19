import * as THREE from './vendor/three.module.js';
import { loadTerrain } from './terrain/terrain-data.js';
import { createTerrainRenderer } from './terrain-renderer.js';
import { createDynamicLabels } from './dynamic-labels.js';
import { createPlayerController } from './player-controller.js';
import { createFramePacer } from './frame-pacing.js';
import { createGliderVisual } from './glider-visual.js';
import { createTenrecAvatar } from './tenrec-avatar.js';
import { createLandscapeDecor } from './landscape-decor.js';
import { loadForestCover } from './terrain/forest-cover.js';
import { createOceanSurface } from './ocean-surface.js';
import { createTrailLayer } from './trail-layer.js';
import { createRiverLayer } from './river-layer.js';
import { createCharacterAvatar } from './troop.js';
import { createRocketPack } from './rocket-pack.js';
import { createSkydive } from './skydive.js';

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
// Strategy camera, in the manner of Age of Empires III: fixed high pitch,
// ground-grabbing pan, rotation and a bounded zoom (scene units of 100 m).
// Free strategy view: zoom out to the whole island and tilt from nearly
// vertical to the horizon, as much as the explorer wants.
const RTS = Object.freeze({ minDistance: .4, maxDistance: 2300, defaultDistance: 3.4, minPhi: .06, maxPhi: 1.5, defaultPhi: .74 });
const TENREC_MORPHOLOGY = Object.freeze({ eyeHeightMeters: .65, thirdPersonFocusMeters: .55, followDistanceMeters: 3.5 });
const RTS_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract']);
const TAU = Math.PI * 2;
const LIGHTING_PRESETS = {
  day: { sun: '#fff0ce', intensity: 2.25, direction: [-120, 220, -160], sky: '#e1eee1', ground: '#677e51', ambient: 1.05, horizon: '#c5d6cf', zenith: '#698fac' },
  golden: { sun: '#ffe4bc', intensity: 2.3, direction: [-210, 112, -160], sky: '#dce6ef', ground: '#6d7663', ambient: .95, horizon: '#d7d9cf', zenith: '#7399b6' },
  // Bright tropical noon: deep blue zenith, luminous haze, warm sun.
  tropical: { sun: '#fff2cf', intensity: 2.6, direction: [-140, 260, -120], sky: '#d9f0ff', ground: '#5e8b4c', ambient: 1.08, horizon: '#c6e9f3', zenith: '#2c84d4' }
};
function disposeGroup(group) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  group.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      materials.add(m); for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
      for (const uniform of Object.values(m.uniforms || {})) if (uniform?.value?.isTexture) textures.add(uniform.value);
    }
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); group.clear();
}

export async function createWorld(container, { onNodeSelect = () => {}, onReady = () => {}, onProgress = () => {}, onPlayerChange = () => {}, onLandmarkSelect = () => {}, terrainDetail = 'full', opening = null } = {}) {
  if (!container?.appendChild) throw new Error('Conteneur du monde 3D introuvable.');
  let source, forestCover = null, forestError = null;
  try {
    [source, forestCover] = await Promise.all([
      loadTerrain({ onProgress, lite: terrainDetail === 'lite' }),
      loadForestCover().catch(error => { forestError = error.message; return null; })
    ]);
  }
  catch (error) { throw new Error(`Le MNT réel de La Réunion n’a pas pu être chargé : ${error.message}. Aucun relief de substitution n’est affiché.`, { cause: error }); }
  if (!source?.heightAt || !source?.geoToWorld || !source?.bounds) throw new Error('Le MNT IGN est incomplet : coordonnées ou altitudes manquantes.');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'default', logarithmicDepthBuffer: true, preserveDrawingBuffer: false }); }
  catch (error) { throw new Error('La visualisation du terrain réel nécessite WebGL2 sur cet appareil.', { cause: error }); }
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-label', 'Terrain réel en 3D de La Réunion. Vue carte : glisser pour tourner, molette pour rapprocher. Modes personnage : ZQSD ou WASD, flèches et commandes tactiles.');
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;';
  container.appendChild(canvas);
  const previousPosition = container.style.position;
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
  const scene = new THREE.Scene();
  const horizon = new THREE.Color('#c5d6cf');
  scene.background = horizon;
  // A map camera can sit more than 200 km away in portrait view. Ground-level
  // fog must never erase its overview: only exploration modes use atmosphere.
  const explorationFog = new THREE.Fog(horizon, 100, 1250);
  scene.fog = null;
  const camera = new THREE.PerspectiveCamera(44, 1, .12, 5000);
  const sun = new THREE.DirectionalLight('#fff0ce', 2.25); sun.position.set(-120, 220, -160);
  const ambient = new THREE.HemisphereLight('#e1eee1', '#677e51', 1.05);
  scene.add(sun, ambient);
  let width = 1, height = 1, hasSize = true, visible = true, disposed = false, contextLost = false;
  let quality = 'balanced', style = 'nature', ambiance = 'paradis', precisionM = 250, verticalScale = 1, forestDensity = 'balanced', lighting = 'day', narrativeVisible = false;
  let graph = { nodes: [], edges: [] }, currentId = null, visited = new Set(), graphSignature = '';
  let controller = null, landscape = null, animationId = 0, lastInfo = 0, fps = 0, fpsCount = 0, fpsStart = performance.now();
  const pacer = createFramePacer();
  let appliedCameraMode = 'orbit';
  let lastPlayer = null, normalizedCoordinates = false;
  let trailLayer = null, riverLayer = null, rts = false, follow = false, themeNames = {}, blend = null;
  // Preset camera shots (panorama, helicopter, a member's eyes or shoulder)
  // and free exploration as one member of the troop.
  let cinema = null, freeCharacter = null;
  const islandHeart = source.geoToWorld(55.475, -21.095);
  const rtsKeys = new Set();
  const additionalDestinations = [{ id: 'foret-belouve', name: 'Bélouve', lon: 55.55, lat: -21.06, priority: 54 }];
  const landmarks = [...(source.metadata?.landmarks || source.landmarks || []), ...additionalDestinations].map((item, i) => ({ ...item, name: item.name || item.label || item.title, id: item.id || `place-${i}`, priority: item.priority || 90 - i * 4, position: source.geoToWorld(item.lon, item.lat) }));
  const terrainRenderer = createTerrainRenderer(source, { quality, precisionM, style, verticalScale, palette: ambiance, onSurfaceChange: changedTiles => {
    if (!controller) return;
    controller.setTerrain(explorerTerrain);
    controller.update(0);
    landscape?.onTerrainChanged(changedTiles);
    trailLayer?.onTerrainChanged(changedTiles);
    riverLayer?.onTerrainChanged(changedTiles);
  } });
  if (forestCover) terrainRenderer.setForestCover(forestCover);
  scene.add(terrainRenderer.group);
  const walkingTerrain = { ...source, heightAt: (x, z) => terrainRenderer.heightAt(x, z), sourceResolutionM: source.sourceResolutionM || source.cellSizeM || 25 };
  // The free explorer walks on the troop's own surface: the trail ribbons
  // (which float a little above the mesh) and the îlets' decks included.
  const explorerTerrain = { ...walkingTerrain, heightAt: (x, z) => trailLayer ? trailLayer.surfaceAt(x, z) : walkingTerrain.heightAt(x, z) };

  const sky = new THREE.Mesh(new THREE.SphereGeometry(3200, 20, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: { uHorizon: { value: horizon }, uZenith: { value: new THREE.Color('#698fac') }, uSun: { value: sun.position.clone().normalize() } },
    vertexShader: 'varying vec3 vDirection; void main(){vDirection=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying vec3 vDirection;uniform vec3 uHorizon,uZenith,uSun;void main(){vec3 d=normalize(vDirection);float altitude=pow(max(0.0,d.y),.6);vec3 col=mix(uHorizon,uZenith,altitude);float glow=pow(max(0.0,dot(d,uSun)),24.0);col+=vec3(.12,.095,.055)*glow;gl_FragColor=vec4(col,1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`
  }));
  sky.renderOrder = -100; sky.frustumCulled = false; scene.add(sky);

  const ocean = createOceanSurface({ terrain: source, camera, horizon, sunDirection: sun.position });
  scene.add(ocean.mesh);

  const tenrec = createTenrecAvatar();
  const avatar = tenrec.group;
  avatar.scale.setScalar(1 / source.metersPerUnit);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.46, 18), new THREE.MeshBasicMaterial({ color: '#24392d', transparent: true, opacity: .25, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = .014; shadow.scale.set(.82, 1.4, 1); avatar.add(shadow); scene.add(avatar);

  const emitTrail = (type, detail = {}) => {
    // Once the helicopter has set the troop down, follow it in the panoramic soar.
    if (type === 'transfer-end' && cinema?.type === 'transfer') setView('papangue');
    container.dispatchEvent(new CustomEvent('trailevent', { detail: { type, ...detail } }));
  };
  // Shots that place the camera themselves instead of steering the orbit.
  const CUSTOM_SHOTS = ['papangue', 'loup', 'skydive', 'transfer', 'frame'];
  trailLayer = createTrailLayer({ source, heightAt: walkingTerrain.heightAt, emit: emitTrail });
  scene.add(trailLayer.group);
  // Rivers, ravines and waterfalls (OpenStreetMap), loaded after the relief.
  riverLayer = createRiverLayer({ source, heightAt: walkingTerrain.heightAt });
  scene.add(riverLayer.group);
  fetch(new URL('./rivers/rivieres.json', import.meta.url)).then(response => response.ok ? response.json() : null)
    .then(data => { if (data && !disposed) { riverLayer.setData(data); emitTrail('rivers-loaded', {}); } })
    .catch(error => console.warn('Rivières indisponibles :', error.message));
  const skydive = createSkydive({ source, heightAt: walkingTerrain.heightAt });
  scene.add(skydive.group);
  const labels = createDynamicLabels({ container, camera, terrain: walkingTerrain, onSelect: item => {
    if (item.type === 'narrative') { onNodeSelect(item.nodeId); return; }
    if (item.type === 'trail') { emitTrail('select-request', { trailId: item.trailId }); return; }
    if (item.type === 'trail-stage') { emitTrail('stage-click', { trailId: item.trailId, stageId: item.stageId }); return; }
    if (item.id === 'player') { focusPlayer(); return; }
    labels.setCurrent(item.id); focusLandmark(item.id); onLandmarkSelect({ id: item.id, name: item.name, lon: item.lon, lat: item.lat });
  } });
  const gliderVisual = createGliderVisual(avatar, { harnessHeightMeters: .54, wingHeightMeters: 1.68, halfSpanMeters: 1.85 });
  // The glider's two rockets: the launch burst and the throttle (the same pack as the big jump's).
  const gliderRockets = createRocketPack({ metersPerUnit: source.metersPerUnit, puffMeters: 1.6 });
  avatar.add(gliderRockets.group); scene.add(gliderRockets.smoke);
  landscape = createLandscapeDecor({ terrain: source, heightAt: walkingTerrain.heightAt, quality, style });
  if (forestCover) landscape.setForestCover(forestCover);
  const pathGroup = new THREE.Group(), nodeGroup = new THREE.Group();
  scene.add(pathGroup, nodeGroup, landscape.group); pathGroup.visible = nodeGroup.visible = false;
  const nodeRecords = new Map();

  const start = landmarks.find(p => /ma[iï]do/i.test(p.id + p.name)) || landmarks[0];
  const startPos = { ...(start?.position || source.geoToWorld(55.388261, -21.069674)) };
  // The IGN landmark is on the cliff edge. Begin 75 m west on its plateau.
  if (start && /ma[iï]do/i.test(start.id + start.name)) startPos.x -= 75 / source.metersPerUnit;
  terrainRenderer.refineAt(startPos.x, startPos.z);
  avatar.position.set(startPos.x, terrainRenderer.heightAt(startPos.x, startPos.z), startPos.z);
  controller = createPlayerController({ camera, canvas, container, avatar, terrain: explorerTerrain, morphology: { eyeHeightMeters: .65, thirdPersonFocusMeters: .55, followDistanceMeters: 3.5 }, onChange: info => { lastPlayer = info; onPlayerChange(info); }, onInteract: () => {
    if (!narrativeVisible) return;
    const p = controller.getPosition(); const nearest = [...nodeRecords.values()].sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    if (nearest && Math.hypot(nearest.x - p.x, nearest.z - p.z) * source.metersPerUnit < 80) onNodeSelect(nearest.id);
  } });
  if (!controller.teleport(startPos.x, startPos.z)) {
    const safe = landmarks.find(l => source.isLand(l.position.x, l.position.z));
    if (safe) controller.teleport(safe.position.x, safe.position.z);
  }

  function refreshLabels() {
    const items = landmarks.map(l => ({ ...l, type: 'geographic' }));
    items.push({ id: 'player', name: 'Vous êtes ici', type: 'player', priority: 40, getPosition: () => controller.getPosition() });
    items.push(...trailLayer.getLabelRecords(themeNames));
    if (narrativeVisible) for (const n of nodeRecords.values()) items.push({ id: `node:${n.id}`, nodeId: n.id, name: n.title, type: 'narrative', priority: n.id === currentId ? 120 : 25, position: n });
    labels.setRecords(items);
  }
  function setGraph(next = {}) {
    const rawNodes = next.nodes || [], rawEdges = next.edges || next.links || [];
    const signature = JSON.stringify([rawNodes.map(n => [n.id, n.title, n.x, n.z, n.lon, n.lat]), rawEdges.map(e => [e.id, e.source, e.target])]);
    if (signature === graphSignature) return;
    graphSignature = signature; graph = { ...next, nodes: rawNodes, edges: rawEdges };
    nodeRecords.clear(); normalizedCoordinates = true;
    const b = source.bounds;
    for (const n of rawNodes) {
      const p = Number.isFinite(n.lon) && Number.isFinite(n.lat) ? source.geoToWorld(n.lon, n.lat) : { x: clamp((Number(n.x) || 0) * 5, b.minX + 10, b.maxX - 10), z: clamp((Number(n.z) || 0) * 5, b.minZ + 10, b.maxZ - 10) };
      nodeRecords.set(String(n.id), { ...n, id: String(n.id), title: String(n.title || n.id), ...p });
    }
    rebuildNarrative(); refreshLabels();
  }
  function rebuildNarrative() {
    disposeGroup(nodeGroup); disposeGroup(pathGroup);
    if (!narrativeVisible) return;
    const markerMat = new THREE.MeshBasicMaterial({ color: '#e8b564' });
    const markerGeometry = new THREE.OctahedronGeometry(.22, 0);
    for (const n of nodeRecords.values()) {
      if (!source.isLand(n.x, n.z)) continue;
      const mark = new THREE.Mesh(markerGeometry, markerMat); mark.position.set(n.x, terrainRenderer.heightAt(n.x, n.z) + .4, n.z); nodeGroup.add(mark);
    }
    if (!nodeGroup.children.length) { markerMat.dispose(); markerGeometry.dispose(); }
    for (const e of graph.edges) {
      const a = nodeRecords.get(String(e.source?.id ?? e.source)), b = nodeRecords.get(String(e.target?.id ?? e.target));
      if (!a || !b || a.id === b.id) continue;
      const points = [];
      for (let i = 0; i <= 48; i++) { const t = i / 48, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t; points.push(new THREE.Vector3(x, terrainRenderer.heightAt(x, z) + .08, z)); }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#d7af75', transparent: true, opacity: .65 })); pathGroup.add(line);
    }
  }
  function setState(state = {}) { currentId = String(state.current ?? state.currentNode ?? ''); visited = new Set(state.visited || []); if (narrativeVisible) refreshLabels(); }
  function setNarrativeVisible(value) { narrativeVisible = Boolean(value); pathGroup.visible = nodeGroup.visible = narrativeVisible; rebuildNarrative(); refreshLabels(); }

  let theta = -.63, phi = .75, distance = 1160, desiredTheta = theta, desiredPhi = phi, desiredDistance = distance;
  const orbitTarget = new THREE.Vector3(0, 8, 0), desiredTarget = orbitTarget.clone();
  let manualOrbit = false;
  const defaultDistance = () => Math.max(1020, 1050 / Math.min(1, Math.max(.46, width / height)));
  function updateOrbit(dt) {
    if (rts) { desiredDistance = clamp(desiredDistance, RTS.minDistance, RTS.maxDistance); desiredPhi = clamp(desiredPhi, RTS.minPhi, RTS.maxPhi); }
    // Preset shots drift gently; the player's own moves answer at once.
    const a = 1 - Math.exp(-dt * (cinema && (cinema.type === 'helico' || cinema.type === 'panorama') ? 2.2 : 8));
    theta += (desiredTheta - theta) * a; phi += (desiredPhi - phi) * a; distance += (desiredDistance - distance) * a; orbitTarget.lerp(desiredTarget, a);
    camera.position.set(orbitTarget.x + distance * Math.sin(phi) * Math.sin(theta), orbitTarget.y + distance * Math.cos(phi), orbitTarget.z + distance * Math.sin(phi) * Math.cos(theta));
    const ground = walkingTerrain.heightAt(camera.position.x, camera.position.z);
    camera.position.y = Math.max(camera.position.y, ground + (cinema?.type === 'helico' ? .5 : .05));
    if (cinema?.type === 'helico') {
      // Over steep ridges the helicopter tilts up towards the vertical, at the
      // same distance (the troop keeps its size), just enough to clear the
      // crests between it and the troop; quick to rise, slow to come down.
      const mpu = source.metersPerUnit, eyeAt = p => new THREE.Vector3(orbitTarget.x + distance * Math.sin(p) * Math.sin(theta), orbitTarget.y + distance * Math.cos(p), orbitTarget.z + distance * Math.sin(p) * Math.cos(theta));
      const hidden = p => {
        const eye = eyeAt(p);
        for (let i = 2; i <= 12; i++) {
          const u = i / 12, x = orbitTarget.x + (eye.x - orbitTarget.x) * u, z = orbitTarget.z + (eye.z - orbitTarget.z) * u;
          if (walkingTerrain.heightAt(x, z) + 25 / mpu * u > orbitTarget.y + (eye.y - orbitTarget.y) * u) return true;
        }
        return false;
      };
      let clear = phi;
      while (clear > .12 && hidden(clear)) clear -= .08;
      cinema.phiCap = cinema.phiCap == null ? clear : cinema.phiCap + (clear - cinema.phiCap) * Math.min(1, dt * (clear < cinema.phiCap ? 4 : .7));
      if (cinema.phiCap < phi) camera.position.copy(eyeAt(cinema.phiCap));
    }
    camera.lookAt(orbitTarget);
  }
  function resetView() { setCameraMode('orbit'); desiredTarget.set(0, 8 * verticalScale, 0); desiredTheta = -.63; desiredPhi = .75; desiredDistance = defaultDistance(); manualOrbit = false; labels.setCurrent(null); }
  function focusLandmark(id) {
    const place = landmarks.find(l => l.id === id); if (!place) return false;
    labels.setCurrent(id);
    if (controller.getMode() === 'orbit') { desiredTarget.set(place.position.x, terrainRenderer.heightAt(place.position.x, place.position.z), place.position.z); desiredDistance = 100; desiredPhi = .95; manualOrbit = true; }
    return true;
  }
  function focusPlayer() {
    const p = controller.getPosition();
    if (controller.getMode() === 'orbit') { desiredTarget.copy(p); desiredDistance = 12; desiredPhi = 1; manualOrbit = true; }
    labels.setCurrent('player');
  }
  function focusNode(id) {
    if (!narrativeVisible) { focusPlayer(); return; }
    const node = nodeRecords.get(String(id)); if (!node) return;
    if (controller.getMode() === 'orbit') { desiredTarget.set(node.x, terrainRenderer.heightAt(node.x, node.z), node.z); desiredDistance = 65; manualOrbit = true; }
    labels.setCurrent(`node:${id}`);
  }
  function teleportTo(lon, lat) {
    let place = null;
    if (typeof lon === 'string') { place = landmarks.find(l => l.id === lon); if (!place) return false; lat = place.lat; lon = place.lon; }
    else if (lon && typeof lon === 'object') { const value = lon; lon = value.lon; lat = value.lat; }
    if (!Number.isFinite(Number(lon)) || !Number.isFinite(Number(lat))) return false;
    if (!place) place = landmarks.find(l => Math.abs(l.lon - Number(lon)) < 1e-7 && Math.abs(l.lat - Number(lat)) < 1e-7);
    const p = source.geoToWorld(Number(lon), Number(lat));
    if (place && /ma[iï]do/i.test(place.id + place.name)) p.x -= 75 / source.metersPerUnit;
    if (!source.isLand(p.x, p.z)) return false;
    terrainRenderer.refineAt(p.x, p.z);
    const success = controller.teleport(p.x, p.z);
    if (success) {
      if (controller.getMode() === 'orbit') { desiredTarget.set(p.x, terrainRenderer.heightAt(p.x, p.z), p.z); desiredDistance = 90; manualOrbit = true; }
      labels.setCurrent(place?.id || null); updateLandscape(0);
    }
    return success;
  }
  function configureCamera(mode) {
    appliedCameraMode = mode;
    camera.near = mode === 'orbit' ? .06 : mode === 'rts' ? .02 : .0008;
    camera.fov = mode === 'orbit' ? 44 : mode === 'rts' ? 40 : mode === 'glide' ? 74 : 68;
    camera.updateProjectionMatrix();
    // The strategy view keeps only a light haze on distant ridges.
    scene.fog = mode === 'orbit' ? null : explorationFog;
    explorationFog.near = mode === 'glide' ? 180 : mode === 'rts' ? 220 : 100;
    explorationFog.far = mode === 'glide' ? 1550 : mode === 'rts' ? 2400 : 1250;
    ocean.setAtmosphereStrength(mode === 'orbit' ? .12 : mode === 'rts' ? .3 : .72);
    canvas.style.cursor = mode === 'orbit' || mode === 'rts' ? 'grab' : 'crosshair';
  }
  function enterRts() {
    if (controller.getMode() !== 'orbit') {
      const p = controller.getPosition();
      desiredTarget.copy(p); orbitTarget.copy(p);
      const offset = camera.position.clone().sub(p); desiredTheta = theta = Math.atan2(offset.x, offset.z);
      controller.setMode('orbit');
    }
    rts = true; avatar.visible = false;
    if (desiredDistance > 60) {
      // Entering from the island overview: start close to the troop.
      const leader = trailLayer.getLeaderPosition();
      if (leader) desiredTarget.set(leader.x, leader.y, leader.z);
      desiredDistance = RTS.defaultDistance;
    }
    desiredDistance = clamp(desiredDistance, RTS.minDistance, RTS.maxDistance);
    desiredPhi = clamp(desiredPhi, RTS.minPhi, RTS.maxPhi);
    terrainRenderer.refineAt(desiredTarget.x, desiredTarget.z);
    manualOrbit = true; configureCamera('rts');
    return true;
  }
  function leaveRts(mode) {
    rts = false; follow = false; rtsKeys.clear(); avatar.visible = true;
    // Stepping down from the strategy view lands the explorer beside the troop.
    const leader = trailLayer.getLeaderPosition();
    if (leader && mode !== 'orbit') controller.teleport(leader.x, leader.z);
  }
  function setCameraMode(mode) {
    if (!['orbit', 'third', 'fps', 'glide', 'rts'].includes(mode)) return false;
    stopCinema();
    if (['orbit', 'rts', 'glide'].includes(mode)) endFree();
    if (mode === (rts ? 'rts' : controller.getMode())) return true;
    startBlend();
    resetOrbitInput();
    if (mode === 'rts') return enterRts();
    if (rts) { leaveRts(mode); if (mode === 'orbit') { configureCamera('orbit'); return true; } }
    const p = controller.getPosition();
    if (mode !== 'orbit') terrainRenderer.refineAt(p.x, p.z);
    else {
      desiredTarget.copy(p); orbitTarget.copy(p); desiredDistance = distance = 100; desiredPhi = phi = .95;
      const offset = camera.position.clone().sub(p); desiredTheta = theta = Math.atan2(offset.x, offset.z); manualOrbit = true;
    }
    controller.setMode(mode); configureCamera(mode);
    if (mode !== 'orbit') controller.update(0);
    return true;
  }
  function updateLandscape(dt, focus = null) {
    if (focus) { landscape.update(focus, { dt, mode: 'third', altitudeAGL: 0 }); return; }
    if (rts) {
      // Decor gathers around the centre of the strategy view.
      landscape.update(orbitTarget, { dt, mode: 'orbit', altitudeAGL: Math.max(0, camera.position.y - walkingTerrain.heightAt(orbitTarget.x, orbitTarget.z)) * source.metersPerUnit });
      return;
    }
    const p = controller.getPosition();
    landscape.update(p, { dt, mode: controller.getMode(), altitudeAGL: Math.max(0, p.y - walkingTerrain.heightAt(p.x, p.z)) * source.metersPerUnit });
  }
  function setStyle(value) {
    const next = value === 'voxel' ? 'voxel' : 'nature'; if (next === style) return;
    style = next; terrainRenderer.setStyle(style); landscape.setStyle(style); rebuildNarrative();
  }
  function setQuality(value) {
    const next = ['eco', 'balanced', 'high'].includes(value) ? value : 'balanced'; if (next === quality) return;
    quality = next; renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, { eco: 1, balanced: 1.35, high: 1.8 }[quality]));
    terrainRenderer.setQuality(quality); landscape.setQuality(quality);
  }
  function setLighting(value) {
    lighting = Object.hasOwn(LIGHTING_PRESETS, value) ? value : 'day';
    const preset = LIGHTING_PRESETS[lighting];
    sun.color.set(preset.sun); sun.intensity = preset.intensity; sun.position.set(...preset.direction);
    ambient.color.set(preset.sky); ambient.groundColor.set(preset.ground); ambient.intensity = preset.ambient;
    horizon.set(preset.horizon); explorationFog.color.copy(horizon);
    sky.material.uniforms.uZenith.value.set(preset.zenith);
    sky.material.uniforms.uSun.value.copy(sun.position).normalize();
    ocean.setLightDirection(sun.position);
  }
  /** « paradis » (tropical ground, lagoon, foam) or « nature » (the former look). */
  function setAmbiance(value) {
    ambiance = value === 'nature' ? 'nature' : 'paradis';
    terrainRenderer.setPalette(ambiance); ocean.setParadise(ambiance === 'paradis');
  }
  function setPrecision(value) { precisionM = clamp(Number(value) || 250, source.sourceResolutionM || 25, 1000); terrainRenderer.setPrecision(precisionM); }
  function setForestDensity(value) {
    const next = ['off', 'discreet', 'balanced', 'dense'].includes(value) ? value : 'balanced';
    const wasVisible = forestDensity !== 'off';
    forestDensity = next;
    const show = next !== 'off';
    if (show !== wasVisible) {
      terrainRenderer.setForestCover(show ? forestCover : null);
      landscape.setForestCover(show ? forestCover : null);
    }
    if (show) {
      terrainRenderer.setForestDensity(next);
      landscape.setForestDensity(next);
    }
  }
  // Forest tinted by Réunion's vegetation belts, or in one colour.
  // Optional calls: a browser holding an older copy of one module must not stop the island loading.
  function setForestTypes(value) { terrainRenderer.setForestTypes?.(value); landscape.setForestTypes?.(value); }
  function setVerticalScale(value) { verticalScale = clamp(Number(value) || 1, 1, 2); terrainRenderer.setVerticalScale(verticalScale); rebuildNarrative(); trailLayer.onTerrainChanged(null); riverLayer.onTerrainChanged(null); }

  // Ground under a screen point: march along the view ray over the displayed
  // mesh, then refine by bisection.
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function groundAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return null;
    ndc.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const o = raycaster.ray.origin, d = raycaster.ray.direction, below = t => o.y + d.y * t <= walkingTerrain.heightAt(o.x + d.x * t, o.z + d.z * t);
    let previous = 0, t = 0, step = Math.max(.01, distance * .003);
    for (let i = 0; i < 1500 && t < distance * 8 + 40; i++) {
      if (below(t)) {
        let a = previous, b = t;
        for (let k = 0; k < 14; k++) { const mid = (a + b) / 2; if (below(mid)) b = mid; else a = mid; }
        return { x: o.x + d.x * b, z: o.z + d.z * b };
      }
      previous = t; t += step; step *= 1.012;
    }
    return null;
  }
  // Someone else may decide what a click means (the gamebook's television): true = handled.
  let pickHandler = null;
  function clickWorld(clientX, clientY) {
    const ground = groundAt(clientX, clientY);
    if (cinema?.type === 'skydive') {
      // During the big jump, a click on any trail is the choice of the landing door.
      const pick = trailLayer.pickSprite(raycaster) || (ground && trailLayer.pickAt(ground.x, ground.z));
      if (pick?.trailId && pickHandler?.({ type: 'door', trailId: pick.trailId })) return;
      if (pick?.trailId) chooseSkydive(pick.trailId);
      else pickHandler?.({ type: 'none' });
      return;
    }
    // Marker discs are tested first: they float above the ground.
    const hit = trailLayer.pickSprite(raycaster) || (ground && trailLayer.pickAt(ground.x, ground.z));
    // A click on nothing in particular: only someone listening (the television) cares.
    if (!hit) { pickHandler?.({ type: 'none' }); return; }
    if (pickHandler?.(hit)) return;
    // The helicopter view stays on (the close-up made the camera lurch).
    if (hit.type === 'troop') { if (cinema?.type !== 'helico') setView('helico'); return; }
    if (hit.type === 'chest') { trailLayer.openChest(); return; }
    if (hit.type === 'sign') { emitTrail('sign-click', { trailId: hit.trailId }); return; }
    const selected = trailLayer.getInfo().selected;
    if (hit.type === 'stage') emitTrail('stage-click', { trailId: hit.trailId, stageId: hit.stage.id });
    else if (hit.trailId !== selected) emitTrail('select-request', { trailId: hit.trailId });
    else if (rts) { trailLayer.walkTo(hit.s); emitTrail('walk-to', { trailId: hit.trailId, s: trailLayer.getTrail(hit.trailId)?.prepared.unmap(hit.s) ?? hit.s }); }
  }

  const pointers = new Map(); let press = null, pinch = 0, twist = 0;
  function resetOrbitInput() {
    for (const id of pointers.keys()) { try { if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id); } catch { /* Capture may already be released. */ } }
    pointers.clear(); press = null; pinch = 0; twist = 0;
    canvas.style.cursor = controller.getMode() === 'orbit' ? 'grab' : 'crosshair';
  }
  const zoomLimits = () => rts ? [RTS.minDistance, RTS.maxDistance] : [.12, 2300];
  function pointerDown(e) {
    if (controller.getMode() !== 'orbit' || ![0, 1, 2].includes(e.button ?? 0)) return;
    // Taking the mouse during a panorama or helicopter shot hands control back.
    // The helicopter view is kept: dragging turns round the troop instead.
    if (cinema && ['panorama', 'papangue', 'loup', 'transfer', 'frame'].includes(cinema.type)) stopCinema();
    canvas.setPointerCapture?.(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Strategy view: the left button grabs the ground, the right one turns.
    const pan = rts ? !(e.button === 1 || e.button === 2 || e.ctrlKey) : e.button === 1 || e.button === 2 || e.shiftKey;
    press = { x: e.clientX, y: e.clientY, moved: false, pan, multi: pointers.size > 1 };
    if (pointers.size === 2) { const ps = [...pointers.values()]; pinch = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y); twist = Math.atan2(ps[1].y - ps[0].y, ps[1].x - ps[0].x); }
    canvas.style.cursor = 'grabbing';
  }
  function pointerMove(e) {
    if (controller.getMode() !== 'orbit' || !pointers.has(e.pointerId)) return;
    const previous = pointers.get(e.pointerId), dx = e.clientX - previous.x, dy = e.clientY - previous.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) press.moved = true;
    if (cinema && cinema.type.startsWith('char')) { cinema.yaw -= dx * .005; cinema.pitch = clamp(cinema.pitch - dy * .004, -.7, .6); return; }
    if (cinema?.type === 'helico') { cinema.turn -= dx * .005; desiredTheta -= dx * .005; cinema.tilt = clamp(cinema.tilt + dy * .003, -.6, .5); return; }
    if (pointers.size > 1) {
      const ps = [...pointers.values()], next = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), [lo, hi] = zoomLimits();
      if (next > 0 && pinch > 0) desiredDistance = clamp(desiredDistance * pinch / next, lo, hi); pinch = next; if (press) press.multi = true;
      if (rts) { const angle = Math.atan2(ps[1].y - ps[0].y, ps[1].x - ps[0].x); let delta = angle - twist; delta = Math.atan2(Math.sin(delta), Math.cos(delta)); desiredTheta -= delta; twist = angle; }
    }
    else if (press?.pan) {
      follow = false;
      const speed = desiredDistance * .0011;
      desiredTarget.x -= (Math.cos(desiredTheta) * dx + Math.sin(desiredTheta) * dy) * speed;
      desiredTarget.z += (Math.sin(desiredTheta) * dx - Math.cos(desiredTheta) * dy) * speed;
      desiredTarget.x = clamp(desiredTarget.x, source.bounds.minX, source.bounds.maxX); desiredTarget.z = clamp(desiredTarget.z, source.bounds.minZ, source.bounds.maxZ);
      desiredTarget.y = Math.max(0, terrainRenderer.heightAt(desiredTarget.x, desiredTarget.z));
    } else { desiredTheta -= dx * .005; desiredPhi = rts ? clamp(desiredPhi + dy * .003, RTS.minPhi, RTS.maxPhi) : clamp(desiredPhi + dy * .004, .12, 1.43); }
    manualOrbit = true;
  }
  function pointerUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId); try { canvas.releasePointerCapture?.(e.pointerId); } catch { /* Capture can already be released by the browser. */ }
    // A short press without drag is a click: select a trail, a stage, or send
    // the troop along its trail in the strategy view.
    if (e.type === 'pointerup' && press && !press.moved && !press.multi && !pointers.size) clickWorld(e.clientX, e.clientY);
    if (!pointers.size) { press = null; pinch = 0; canvas.style.cursor = controller.getMode() === 'orbit' ? 'grab' : 'crosshair'; }
  }
  function wheel(e) {
    if (controller.getMode() !== 'orbit') return; e.preventDefault();
    if (cinema?.type === 'char-third') { cinema.zoom = clamp(cinema.zoom * Math.exp(e.deltaY * .001), .5, 4); return; }
    if (cinema?.type === 'char-fps') return;
    // In the helicopter view the wheel brings it nearer or takes it away.
    if (cinema?.type === 'helico') { cinema.zoom = clamp(cinema.zoom * Math.exp(e.deltaY * .001), .25, 6); return; }
    if (cinema) stopCinema();
    const [lo, hi] = zoomLimits(); desiredDistance = clamp(desiredDistance * Math.exp(e.deltaY * .001), lo, hi); manualOrbit = true; }
  const editable = target => target?.closest?.('input,select,textarea,[contenteditable="true"]');
  function rtsKeyDown(e) {
    if (cinema && e.key === 'Escape' && !editable(e.target)) { setCameraMode('orbit'); return; }
    if (!rts || !visible || editable(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (RTS_KEYS.has(e.code)) { e.preventDefault(); rtsKeys.add(e.code); }
    else if (e.code === 'Space' && !e.repeat) { e.preventDefault(); emitTrail('toggle-walk', {}); }
    else if (e.code === 'KeyF' && !e.repeat) { e.preventDefault(); setFollow(!follow); emitTrail('follow', { follow }); }
  }
  function rtsKeyUp(e) { rtsKeys.delete(e.code); }
  function updateRtsInput(dt) {
    const held = (...codes) => codes.some(c => rtsKeys.has(c)) ? 1 : 0;
    const forward = held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown'), right = held('KeyD', 'ArrowRight') - held('KeyA', 'ArrowLeft');
    const turn = held('KeyE') - held('KeyQ'), zoom = held('Minus', 'NumpadSubtract') - held('Equal', 'NumpadAdd');
    if (cinema?.type === 'helico') {
      // Locked helicopter: Q/E turn round the troop, +/- bring it nearer.
      if (turn) { cinema.turn += turn * 1.5 * dt; desiredTheta += turn * 1.5 * dt; }
      if (zoom) cinema.zoom = clamp(cinema.zoom * Math.exp(zoom * 1.6 * dt), .25, 6);
      return;
    }
    if ((forward || right || turn || zoom) && cinema) stopCinema();
    if (forward || right) {
      const step = desiredDistance * 1.2 * dt, s = Math.sin(desiredTheta), c = Math.cos(desiredTheta);
      desiredTarget.x = clamp(desiredTarget.x + (-s * forward + c * right) * step, source.bounds.minX, source.bounds.maxX);
      desiredTarget.z = clamp(desiredTarget.z + (-c * forward - s * right) * step, source.bounds.minZ, source.bounds.maxZ);
      desiredTarget.y = Math.max(0, terrainRenderer.heightAt(desiredTarget.x, desiredTarget.z)); follow = false;
    }
    if (turn) desiredTheta += turn * 1.5 * dt;
    if (zoom) desiredDistance = clamp(desiredDistance * Math.exp(zoom * 1.6 * dt), RTS.minDistance, RTS.maxDistance);
    if (follow) { const leader = trailLayer.getLeaderPosition(); if (leader) desiredTarget.set(leader.x, leader.y, leader.z); }
  }
  function setFollow(value) { follow = !!value && !!trailLayer.getInfo().selected; return follow; }
  document.addEventListener('keydown', rtsKeyDown); document.addEventListener('keyup', rtsKeyUp);
  function contextMenu(e) { e.preventDefault(); }
  canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointermove', pointerMove); canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointercancel', pointerUp); canvas.addEventListener('lostpointercapture', pointerUp); canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('contextmenu', contextMenu); window.addEventListener('blur', resetOrbitInput);

  // Parts of the picture covered by someone else's panels (the gamebook's legend and buttons): the subject the
  // camera looks at is shown in the middle of what remains, by shifting the picture (setViewOffset).
  let viewInsets = { top: 0, bottom: 0, left: 0, right: 0 };
  function applyViewInsets() {
    const dx = Math.round((viewInsets.right - viewInsets.left) / 2), dy = Math.round((viewInsets.bottom - viewInsets.top) / 2);
    if ((dx || dy) && width > 1 && height > 1) camera.setViewOffset(width, height, dx, dy, width, height); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  function setViewInsets({ top = 0, bottom = 0, left = 0, right = 0 } = {}) {
    const n = v => Math.max(0, Math.round(Number(v) || 0)), next = { top: n(top), bottom: n(bottom), left: n(left), right: n(right) };
    if (Object.keys(next).every(k => next[k] === viewInsets[k])) return;
    viewInsets = next; applyViewInsets();
  }
  function resize() {
    const rect = container.getBoundingClientRect(); hasSize = rect.width > 0 && rect.height > 0;
    if (!hasSize) { cancelAnimationFrame(animationId); animationId = 0; return; }
    width = Math.max(1, rect.width); height = Math.max(1, rect.height); camera.aspect = width / height; applyViewInsets(); renderer.setSize(width, height, false); labels.resize(width, height);
    if (!manualOrbit) desiredDistance = defaultDistance(); resume();
  }
  function tick(now) {
    if (disposed || !visible || !hasSize || contextLost || document.hidden) { animationId = 0; return; }
    animationId = requestAnimationFrame(tick);
    const frame = pacer.step(now, { quality }); if (!frame.render) return;
    const dt = frame.dt;
    const characterShot = cinema && cinema.type.startsWith('char');
    if (controller.getMode() === 'orbit' && !characterShot) {
      if (rts) updateRtsInput(dt);
      if (!CUSTOM_SHOTS.includes(cinema?.type)) { updateCinemaOrbit(dt); updateOrbit(dt); }
    }
    lastPlayer = controller.update(dt);
    if (rts && controller.getMode() !== 'orbit') leaveRts(controller.getMode());
    const mode = controller.getMode(), viewMode = characterShot ? (cinema.type === 'char-fps' ? 'fps' : 'third') : cinema?.type === 'skydive' ? 'glide' : rts ? 'rts' : mode;
    if (viewMode !== appliedCameraMode) configureCamera(viewMode);
    // The camera is current before choosing LOD. Geometry construction has its
    // own small work budget; the previous valid surface stays visible meanwhile.
    terrainRenderer.update(camera, viewMode, now);
    const leaderNow = CUSTOM_SHOTS.includes(cinema?.type) ? trailLayer.getLeaderPosition() : null;
    // The strategy haze recedes as the camera climbs, never hiding the island.
    if (viewMode === 'rts') { explorationFog.near = Math.max(220, distance * 1.5); explorationFog.far = Math.max(2400, distance * 5); }
    if (cinema?.type === 'skydive') { const a = camera.position.y; explorationFog.near = Math.max(180, a * 1.5); explorationFog.far = Math.max(1550, a * 5); }
    // Near the ground, the jump sizes the units from the camera's distance to
    // the landing spot, as the helicopter that takes over will.
    const jump = cinema?.type === 'skydive' ? skydive.getPose() : null, jumpLow = jump && jump.phase !== 'hover' && jump.phase !== 'glide';
    const viewDistanceM = characterShot ? 8 : jump ? (jumpLow ? camera.position.distanceTo(jump.landing) * source.metersPerUnit : Math.max(400, jump.altitudeM)) : leaderNow ? camera.position.distanceTo(leaderNow) * source.metersPerUnit : (mode === 'orbit' ? distance : .1) * source.metersPerUnit;
    trailLayer.update(dt, now, { distanceM: viewDistanceM, camera, width, height, pixel: 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / height });
    if (jump) skydive.setDrawnScale(jumpLow ? trailLayer.getInfo().unitShown : null);
    riverLayer.update(now, { pixel: 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / height });
    if (characterShot) placeCharacterCamera(dt);
    if (cinema?.type === 'papangue') placePapangueCamera(dt);
    else if (cinema?.type === 'loup') placeLoupCamera(dt);
    else if (cinema?.type === 'skydive') placeSkydiveCamera(dt);
    else if (cinema?.type === 'transfer') placeTransferCamera(dt);
    else if (cinema?.type === 'frame') placeFrameCamera(dt);
    applyBlend(dt);
    freeCharacter?.model?.update(dt, lastPlayer);
    lastPlayer = controller.getInfo();
    const flight = lastPlayer.flight;
    gliderVisual.update(flight);
    gliderRockets.setVisible(!!flight?.active); gliderRockets.setThrust(flight?.thrust || 0); avatar.updateMatrixWorld(true); gliderRockets.update(dt);
    avatar.rotation.z = flight?.active ? -(flight.bank || 0) * .4 : 0;
    shadow.visible = !!lastPlayer.onGround && !flight?.active;
    tenrec.update(dt, lastPlayer);
    const shotFocus = characterShot ? trailLayer.getMemberPose(cinema.index) : null;
    const decorVisible = characterShot || mode !== 'orbit' || distance < (rts ? 25 : 20);
    if (decorVisible) updateLandscape(dt, shotFocus);
    landscape.group.visible = decorVisible;
    sky.position.copy(camera.position); ocean.update(now / 1000); camera.updateMatrixWorld();
    labels.update(now, viewMode, shotFocus || (rts ? orbitTarget : controller.getPosition()), lastPlayer.moving || !!shotFocus?.moving); renderer.render(scene, camera);
    fpsCount++; if (now - fpsStart >= 1000) { fps = Math.round(fpsCount * 1000 / (now - fpsStart)); fpsCount = 0; fpsStart = now; }
    if (now - lastInfo > 250) { lastInfo = now; container.dispatchEvent(new CustomEvent('worldinfo', { detail: getInfo() })); }
  }
  function resume() { if (!disposed && visible && hasSize && !contextLost && !document.hidden && !animationId) { pacer.reset(); fpsCount = 0; fpsStart = performance.now(); animationId = requestAnimationFrame(tick); } }
  function setVisible(value) { visible = Boolean(value); controller.setEnabled(visible && !document.hidden); if (!visible) { resetOrbitInput(); cancelAnimationFrame(animationId); animationId = 0; fps = 0; } else { resize(); resume(); } }
  function visibilityChange() { controller.setEnabled(visible && !document.hidden); if (document.hidden) { resetOrbitInput(); cancelAnimationFrame(animationId); animationId = 0; } else resume(); }
  function lost(e) { e.preventDefault(); contextLost = true; controller.setEnabled(false); cancelAnimationFrame(animationId); animationId = 0; }
  function restored() { contextLost = false; controller.setEnabled(visible && !document.hidden); resume(); }
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(container);
  document.addEventListener('visibilitychange', visibilityChange); canvas.addEventListener('webglcontextlost', lost); canvas.addEventListener('webglcontextrestored', restored);

  function getInfo() {
    // In the strategy view the readouts describe the centre of the view.
    const player = controller.getInfo(), p = rts ? orbitTarget : controller.getPosition(), geo = source.worldToGeo(p.x, p.z), terrainInfo = terrainRenderer.getInfo(p.x, p.z);
    const groundAltitudeM = source.isLand(p.x, p.z) ? source.sampleMeters(p.x, p.z) : 0;
    const clearanceMeters = Math.max(0, p.y - Math.max(0, walkingTerrain.heightAt(p.x, p.z))) * source.metersPerUnit;
    return { renderer: 'WebGL2', style, quality, forestDensity, lighting, ambiance, avatar: tenrec.getInfo(), atmosphere: { enabled: Boolean(scene.fog), near: scene.fog?.near ?? null, far: scene.fog?.far ?? null }, cameraMode: cinema ? 'cinema' : rts ? 'rts' : controller.getMode(), view: getView(), follow, trails: trailLayer.getInfo(), rivers: riverLayer.getInfo(), precisionM, effectivePrecisionM: terrainInfo.effectivePrecisionM, precisionRangeM: terrainInfo.precisionRangeM, precisionLevels: terrainInfo.precisionLevels, sourceResolutionM: source.sourceResolutionM || source.cellSizeM || 25, verticalScale, fps, triangles: renderer.info.render.triangles, drawCalls: renderer.info.render.calls, contextLost, visible: visible && hasSize && !document.hidden, moving: player.moving, nodes: graph.nodes.length, normalizedCoordinates, narrativeVisible,
      player: { ...player, position: { x: p.x, y: p.y, z: p.z }, altitudeM: groundAltitudeM + clearanceMeters, groundAltitudeM, clearanceMeters, lon: geo.lon, lat: geo.lat },
      camera: (() => { const leader = trailLayer.getLeaderPosition(); return { x: camera.position.x, y: camera.position.y, z: camera.position.z, troopDistanceM: leader ? Math.round(camera.position.distanceTo(new THREE.Vector3(leader.x, leader.y, leader.z)) * source.metersPerUnit) : null, landingDistanceM: cinema?.type === 'skydive' ? Math.round(camera.position.distanceTo(skydive.getPose().landing) * source.metersPerUnit) : null, leader: leader ? { x: leader.x, z: leader.z } : null, landing: cinema?.type === 'skydive' ? (({ x, z }) => ({ x, z }))(skydive.getPose().landing) : null }; })(), labels: labels.getInfo(), decor: landscape.getInfo(), ocean: ocean.getInfo(), forest: { available: !!forestCover, visible: !!forestCover && forestDensity !== 'off', metadata: forestCover?.metadata, error: forestError },
      terrain: { ...terrainInfo, metadata: source.metadata, source: source.metadata?.source || source.metadata?.title || 'IGN RGE ALTI', sourceResolutionM: source.sourceResolutionM || source.cellSizeM || 25, metersPerUnit: source.metersPerUnit, bounds: source.bounds, notice: 'Relief IGN réel. Couvert arboré dérivé de la classification satellitaire ESA WorldCover 2021. Canopée, arbres, sol cartoon et rochers illustratifs.' } };
  }
  function dispose() {
    if (disposed) return; disposed = true; cancelAnimationFrame(animationId); resizeObserver.disconnect(); controller.dispose(); labels.dispose(); gliderVisual.dispose(); gliderRockets.dispose(); tenrec.dispose(); landscape.dispose(); trailLayer.dispose(); riverLayer.dispose(); terrainRenderer.dispose(); scene.remove(ocean.mesh); ocean.dispose();
    document.removeEventListener('keydown', rtsKeyDown); document.removeEventListener('keyup', rtsKeyUp);
    document.removeEventListener('visibilitychange', visibilityChange); canvas.removeEventListener('webglcontextlost', lost); canvas.removeEventListener('webglcontextrestored', restored);
    canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove); canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerUp); canvas.removeEventListener('lostpointercapture', pointerUp); canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('contextmenu', contextMenu); window.removeEventListener('blur', resetOrbitInput);
    disposeGroup(scene); renderer.dispose(); canvas.remove(); if (container.style.position === 'relative' && previousPosition !== 'relative') container.style.position = previousPosition;
  }
  function stopCinema() {
    if (!cinema) return;
    if (cinema.type === 'skydive') skydive.hide();
    if (CUSTOM_SHOTS.includes(cinema.type)) {
      // Hand the soaring or prowling view back to the strategy camera without a jump.
      const target = cinema.look || orbitTarget, offset = camera.position.clone().sub(target), length = offset.length() || 1;
      orbitTarget.copy(target); desiredTarget.copy(target);
      distance = desiredDistance = clamp(length, RTS.minDistance, RTS.maxDistance);
      theta = desiredTheta = Math.atan2(offset.x, offset.z);
      phi = desiredPhi = clamp(Math.acos(clamp(offset.y / length, -1, 1)), RTS.minPhi, RTS.maxPhi);
    }
    if (cinema.type === 'char-fps') trailLayer.setMemberHidden(cinema.index, false);
    trailLayer.setUnitScaleOverride(null); trailLayer.setCameraBubble(null);
    cinema = null;
  }
  const tenrecRig = avatar.getObjectByName('TenrecRig');
  function endFree() {
    if (!freeCharacter) return;
    freeCharacter.model?.dispose();
    if (tenrecRig) tenrecRig.visible = true;
    controller.setMorphology(TENREC_MORPHOLOGY);
    trailLayer.setMemberHidden(freeCharacter.index, false); trailLayer.setUnitScaleOverride(null);
    freeCharacter = null;
  }
  function startFree(index) {
    const pose = trailLayer.getMemberPose(index); if (!pose) return false;
    endFree(); stopCinema();
    let model = null;
    if (!pose.spec.tenrec) {
      model = createCharacterAvatar(pose.spec.id);
      avatar.add(model.group); if (tenrecRig) tenrecRig.visible = false;
      controller.setMorphology(model.morphology);
    }
    trailLayer.pause(); trailLayer.setMemberHidden(index, true); trailLayer.setUnitScaleOverride(1);
    if (controller.getMode() !== 'third' && controller.getMode() !== 'fps') setCameraMode('third');
    freeCharacter = { index, model, id: pose.spec.id };
    terrainRenderer.refineAt(pose.x, pose.z); controller.teleport(pose.x, pose.z);
    return true;
  }
  const panoramaDistance = () => Math.max(300, 330 / Math.sqrt(Math.min(1, Math.max(.4, width / height))));
  /** Preset shots: 'panorama', 'papangue' (high soaring circles), 'helico',
   * 'char-third', 'char-fps', 'char-free'. */
  function setView(view, { character = 'tangue' } = {}) {
    if (!(view === 'helico' && cinema?.type === 'helico')) startBlend();
    if (view === 'panorama') {
      setCameraMode('orbit');
      cinema = { type: 'panorama', t: 0 };
      desiredTarget.set(islandHeart.x, terrainRenderer.heightAt(islandHeart.x, islandHeart.z) * .5, islandHeart.z);
      desiredDistance = panoramaDistance(); desiredPhi = .98; manualOrbit = true;
      return true;
    }
    if (!trailLayer.getInfo().selected) return false;
    const index = Math.max(0, trailLayer.memberIndex(character));
    if (view === 'helico') {
      // Already flying: keep the visitor's own zoom and angle.
      const keep = cinema?.type === 'helico' ? cinema : null;
      setCameraMode('rts'); cinema = { type: view, t: keep?.t ?? 0, zoom: keep?.zoom ?? 1, turn: keep?.turn ?? 0, tilt: keep?.tilt ?? 0 };
      return true;
    }
    if (view === 'loup') { setCameraMode('rts'); cinema = { type: view, t: 0, angle: null, look: null }; return true; }
    if (view === 'papangue') { setCameraMode('rts'); cinema = { type: view, t: 0, circle: territoryOf(trailLayer.getInfo().selected), angle: null, look: null }; return true; }
    if (view === 'char-free') return startFree(index);
    if (view === 'char-third' || view === 'char-fps') {
      setCameraMode('orbit');
      cinema = { type: view, index, t: 0, yaw: 0, pitch: 0, zoom: 1, look: null, snap: true };
      trailLayer.setUnitScaleOverride(1);
      if (view === 'char-fps') trailLayer.setMemberHidden(index, true);
      return true;
    }
    return false;
  }
  function getView() { return { view: freeCharacter ? 'char-free' : cinema?.type || (rts ? 'rts' : controller.getMode()), character: freeCharacter?.id || (cinema?.index != null ? trailLayer.getMembers()[cinema.index]?.id : null) }; }
  // Shots that steer the orbit target: slow island turn, helicopter circles.
  function updateCinemaOrbit(dt) {
    if (!cinema) return;
    cinema.t += dt;
    if (cinema.type === 'panorama') desiredTheta += .035 * dt;
    if (cinema.type === 'helico') {
      const leader = trailLayer.getLeaderPosition(), mpu = source.metersPerUnit;
      if (trailLayer.stageHere()) {
        // Waiting at a stage: slow circles round the whole scene, troop and
        // treasure, as near as it all fits in the picture.
        const points = trailLayer.getMembers().map((_, i) => trailLayer.getMemberPose(i)).filter(Boolean).map(p => new THREE.Vector3(p.x, p.y, p.z));
        const chestAt = trailLayer.getChestPosition(); if (chestAt) points.push(chestAt);
        const sphere = new THREE.Box3().setFromPoints(points).getBoundingSphere(new THREE.Sphere());
        const fov = THREE.MathUtils.degToRad(camera.fov) * Math.min(1, camera.aspect);
        desiredTarget.copy(sphere.center);
        // Gathered round the chest: the closest shot that still holds everyone
        // and the chest (Florian: « le zoom max »); the wheel still adjusts it.
        const gathered = !!chestAt;
        desiredDistance = clamp((sphere.radius + (gathered ? 1.2 : 4) / mpu) / Math.sin(fov / 2 * (gathered ? .95 : .85)), gathered ? .12 : .9, 8) * cinema.zoom;
        desiredTheta += (gathered ? .04 : .07) * dt; desiredPhi = clamp((gathered ? .82 : .92) + cinema.tilt, .2, 1.4);
      } else if (leader?.walking) {
        // On the way: a tracking shot from behind and above the troop,
        // swaying gently from one shoulder to the other.
        desiredTarget.set(leader.x, leader.y, leader.z);
        const behind = -leader.heading + .55 * Math.sin(cinema.t * .09) + cinema.turn;
        desiredTheta += Math.atan2(Math.sin(behind - desiredTheta), Math.cos(behind - desiredTheta)) * Math.min(1, dt * .6);
        desiredDistance = (2.6 + .6 * Math.sin(cinema.t * .11)) * cinema.zoom; desiredPhi = clamp(.9 + cinema.tilt, .2, 1.4);
      } else {
        if (leader) desiredTarget.set(leader.x, leader.y, leader.z);
        desiredTheta += .16 * dt;
        desiredDistance = (2.2 + 2.6 * (.5 + .5 * Math.sin(cinema.t * .12))) * cinema.zoom;
        desiredPhi = clamp(.84 + .14 * Math.sin(cinema.t * .07 + 1) + cinema.tilt, .2, 1.4);
      }
    }
  }
  const lookTarget = new THREE.Vector3(), cameraGoal = new THREE.Vector3();
  // The papangue's territory: the circle that holds the whole trail.
  function territoryOf(trailId) {
    const trail = trailLayer.getTrail(trailId); if (!trail) return null;
    const points = trail.prepared.points, xs = points.map(p => p.x), zs = points.map(p => p.z);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    let r = 0, top = -Infinity;
    for (let i = 0; i < points.length; i += 4) { r = Math.max(r, Math.hypot(points[i].x - cx, points[i].z - cz)); top = Math.max(top, walkingTerrain.heightAt(points[i].x, points[i].z)); }
    return { cx, cz, r, top };
  }
  // « Le grand saut »: start in free fall over the ocean, glide to the middle
  // of the trails and wait there for the visitor's choice.
  function startSkydive() {
    // Already falling (the scene opens on the jump): carry on.
    if (cinema?.type === 'skydive' && skydive.phase === 'hover') return true;
    const starts = trailLayer.getStarts();
    setCameraMode('orbit');
    trailLayer.select(null); refreshLabels();
    const centre = starts.length ? { x: starts.reduce((n, p) => n + p.x, 0) / starts.length, z: starts.reduce((n, p) => n + p.z, 0) / starts.length } : { x: islandHeart.x, z: islandHeart.z };
    // The map's point of view, the whole island below with its trails. The
    // jump pops in at once: no glide from the previous picture.
    skydive.start(centre, { altitude: defaultDistance() * .65 });
    cinema = { type: 'skydive', t: 0, look: null, reach: defaultDistance() * .52, yaw: 0 };
    configureCamera('glide'); blend = null; placeSkydiveCamera(0);
    emitTrail('skydive-start', {});
    return true;
  }
  function chooseSkydive(trailId) {
    if (cinema?.type !== 'skydive') return false;
    const trail = trailLayer.getTrail(trailId); if (!trail) return false;
    const start = trail.stages[0].position;
    if (!skydive.choose({ x: start.x, z: start.z })) return false;
    trailLayer.select(trailId); refreshLabels();
    // The troop waits at the door, without its tangue: the diver is the tangue.
    trailLayer.setMemberHidden(0, true);
    emitTrail('skydive-choice', { trailId });
    return true;
  }
  function placeSkydiveCamera(dt) {
    const mpu = source.metersPerUnit;
    if (skydive.phase === 'hover') {
      // The map's point of view: the whole island from high above, north at
      // the top, turning and nearing very slowly; the tangue falls head down
      // in the foreground, low in the picture so the trails stay clear.
      cinema.t += dt;
      const target = new THREE.Vector3(0, 8 * verticalScale, 0), reach = cinema.reach * Math.exp(-.003 * cinema.t);
      const yaw = cinema.yaw + .01 * cinema.t, tilt = .38;
      camera.position.set(target.x + reach * Math.sin(tilt) * Math.sin(yaw), target.y + reach * Math.cos(tilt), target.z + reach * Math.sin(tilt) * Math.cos(yaw));
      camera.up.set(0, 1, 0); camera.lookAt(target);
      const forward = target.clone().sub(camera.position).normalize(), screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const ahead = 9 * skydive.getPose().scale / mpu;
      skydive.holdAt(camera.position.clone().addScaledVector(forward, ahead).addScaledVector(screenUp, -ahead * .27), Math.atan2(forward.x, -forward.z), -Math.asin(clamp(-forward.y, -1, 1)));
      skydive.update(dt);
      cinema.look = target; orbitTarget.copy(target); distance = reach;
      return;
    }
    const pose = skydive.update(dt);
    if (pose.phase === 'done') {
      // Set down at the door: the helicopter takes over, gliding from here.
      const trailId = trailLayer.getInfo().selected;
      skydive.setDiverVisible(true); trailLayer.setMemberHidden(0, false); stopCinema(); setView('helico'); emitTrail('skydive-end', { trailId });
      return;
    }
    const p = pose.position;
    if (pose.phase === 'glide') {
      // The wingsuit opens and the tangue glides past: the camera stays where
      // it was, only turning a little to keep it in sight.
      if (!cinema.glideLook) cinema.glideLook = (cinema.look || pose.centre).clone();
      cinema.frozen = { position: camera.position.clone(), quaternion: camera.quaternion.clone() };
      lookTarget.copy(cinema.glideLook).lerp(p, .3);
      camera.up.set(0, 1, 0); camera.lookAt(lookTarget);
      cinema.previous = p.clone();
      return;
    }
    // Direction of motion, smoothed.
    if (!cinema.previous) cinema.previous = p.clone();
    const motion = p.clone().sub(cinema.previous); cinema.previous.copy(p);
    if (motion.lengthSq() > 1e-12) { motion.normalize(); cinema.dir = cinema.dir ? cinema.dir.lerp(motion, 1 - Math.exp(-dt * 4)).normalize() : motion; }
    const dir = cinema.dir || new THREE.Vector3(0, -1, 0);
    // Through the tangue's eyes while it dives; two seconds before the
    // retro-rockets fire, the view glides outside, behind and a little aside,
    // to watch the retro-rockets fire and the landing.
    // Through the tangue's eyes only briefly: then a ghost camera flies ahead
    // to a helicopter's vantage point near the landing spot and films the
    // tangue arriving, the rockets firing and the touch-down.
    const outside = pose.phase === 'dive' ? THREE.MathUtils.smootherstep(pose.t, .9, 2.5) : 1;
    const eye = p.clone().addScaledVector(dir, .5 * pose.scale / mpu);
    const eyeLook = pose.phase === 'dive' ? pose.target.clone() : eye.clone().add(dir);
    // The vantage follows the landing spot's height as its relief refines.
    const vantage = vantageFor(pose.landing, cinema.frozen?.position || camera.position);
    if (!cinema.vantage) cinema.vantage = vantage; else cinema.vantage.lerp(vantage, 1 - Math.exp(-dt * 4));
    camera.position.lerpVectors(eye, cinema.vantage, outside);
    // Waiting at the vantage: eyes on the landing spot, raised towards the
    // tangue by 18° at most, so the landscape stays in the picture and the
    // tangue comes down into it from above.
    const toSpot = pose.landing.clone().sub(camera.position).normalize(), toDiver = p.clone().sub(camera.position).normalize();
    const apart = toSpot.angleTo(toDiver), watch = apart > .31 ? toSpot.clone().lerp(toDiver, .31 / apart).normalize() : toDiver;
    lookTarget.lerpVectors(eyeLook, camera.position.clone().addScaledVector(watch, camera.position.distanceTo(p)), outside);
    camera.up.set(0, 1, 0); camera.lookAt(lookTarget);
    // Entering the dive: a smooth swoop from where the camera watched the
    // glide into the tangue's eyes (no jump).
    if (pose.phase === 'dive' && !cinema.diveFrom) cinema.diveFrom = { position: cinema.frozen?.position || camera.position.clone(), quaternion: cinema.frozen?.quaternion || camera.quaternion.clone() };
    const swoop = pose.phase === 'dive' ? THREE.MathUtils.smootherstep(pose.t, 0, .9) : 1;
    if (swoop < 1) { camera.position.lerpVectors(cinema.diveFrom.position, camera.position, swoop); camera.quaternion.slerpQuaternions(cinema.diveFrom.quaternion, camera.quaternion, swoop); }
    skydive.setDiverVisible(outside > .2 || swoop < .8);
    cinema.look = lookTarget.clone(); orbitTarget.copy(p); distance = camera.position.distanceTo(orbitTarget);
  }
  // Where the ghost camera waits for the landing: 80 m off the landing spot,
  // on the side it came from, 60 m up, high enough to see the spot over the
  // ground between.
  function vantageFor(landing, from) {
    const mpu = source.metersPerUnit, away = new THREE.Vector3(from.x - landing.x, 0, from.z - landing.z);
    if (away.lengthSq() < 1e-8) away.set(0, 0, 1); away.normalize();
    // At the helicopter's own distance (about 100 m): when it takes over, the
    // camera barely moves and the troop keeps its size.
    const reach = 80 / mpu, spot = new THREE.Vector3(landing.x + away.x * reach, 0, landing.z + away.z * reach);
    spot.y = Math.max(walkingTerrain.heightAt(spot.x, spot.z) + 30 / mpu, landing.y + 60 / mpu);
    // Crests in the way (not the slope right under the landing spot, which
    // would send the camera far too high).
    for (let i = 3; i < 10; i++) {
      const u = i / 10, crest = walkingTerrain.heightAt(landing.x + (spot.x - landing.x) * u, landing.z + (spot.z - landing.z) * u) + 20 / mpu;
      spot.y = Math.max(spot.y, landing.y + (crest - landing.y) / u);
    }
    return spot;
  }
  // The helicopter ferry. While it lands and boards the troop the camera does
  // not move (a ghost camera); once it lifts off, the view rushes in behind it
  // and rides along; when it sets down, the wolf prowls round to watch the
  // troop step out and walk to the stage.
  function placeTransferCamera(dt) {
    const heli = trailLayer.getTransferInfo(), mpu = source.metersPerUnit;
    if (!heli) return;
    if (heli.phase === 'approach' || heli.phase === 'boarding' || (heli.phase === 'liftoff' && heli.t < .5)) return;
    // Set down: the helicopter view circles the troop stepping out.
    if (heli.phase === 'unboarding' || heli.phase === 'departure') { setView('helico'); return; }
    cinema.rush = (cinema.rush ?? 0) + dt;
    const fx = Math.sin(heli.heading), fz = -Math.cos(heli.heading), back = 48 * heli.lift / mpu, up = 18 * heli.lift / mpu;
    cameraGoal.set(heli.x - fx * back, heli.y + up, heli.z - fz * back);
    cameraGoal.y = Math.max(cameraGoal.y, walkingTerrain.heightAt(cameraGoal.x, cameraGoal.z) + 3 / mpu);
    // Rushing in: slow to start, then a tight chase.
    camera.position.lerp(cameraGoal, 1 - Math.exp(-dt * Math.min(7, 1.2 + cinema.rush * 4)));
    lookTarget.set(heli.x + fx * 25 * heli.lift / mpu, heli.y, heli.z + fz * 25 * heli.lift / mpu);
    if (!cinema.look) cinema.look = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(10));
    cinema.look.lerp(lookTarget, 1 - Math.exp(-dt * Math.min(8, 1.5 + cinema.rush * 4)));
    camera.up.set(0, 1, 0); camera.lookAt(cinema.look);
    orbitTarget.copy(cinema.look); distance = camera.position.distanceTo(orbitTarget);
  }
  // Visiting a waterfall: from downstream and a little aside, looking up at
  // the veil, far enough back to see it whole.
  function visitWaterfall(name) {
    const fall = riverLayer.getWaterfalls().filter(f => f.name === name).sort((a, b) => b.dropM - a.dropM)[0];
    if (!fall) return false;
    const mpu = source.metersPerUnit, top = new THREE.Vector3(fall.top.x, fall.top.y, fall.top.z), bottom = new THREE.Vector3(fall.bottom.x, fall.bottom.y, fall.bottom.z);
    const reach = Math.max(220, fall.dropM * 2.4) / mpu, sideX = -fall.dir.z, sideZ = fall.dir.x;
    const goal = new THREE.Vector3(bottom.x + (fall.dir.x * .85 + sideX * .4) * reach, 0, bottom.z + (fall.dir.z * .85 + sideZ * .4) * reach);
    goal.y = Math.max(walkingTerrain.heightAt(goal.x, goal.z) + 40 / mpu, bottom.y + reach * .3);
    terrainRenderer.refineAt(bottom.x, bottom.z);
    startBlend(); setCameraMode('rts');
    cinema = { type: 'frame', t: 0, centre: top.clone().lerp(bottom, .55), goal, look: null };
    return true;
  }
  // Ghost camera: a change of view glides from the last picture to the new
  // one instead of jumping (no lurch that turns the stomach).
  function startBlend(duration = 1.8) { blend = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), t: 0, duration }; }
  function applyBlend(dt) {
    if (!blend) return;
    blend.t += dt;
    const u = THREE.MathUtils.smootherstep(blend.t / blend.duration, 0, 1);
    camera.position.lerpVectors(blend.position, camera.position, u);
    camera.quaternion.slerpQuaternions(blend.quaternion, camera.quaternion, u);
    if (u >= 1) blend = null;
  }
  // The close-up: as near as possible while every member of the troop and
  // the treasure stay in the frame, seen three-quarters from above.
  function frameScene() {
    if (!trailLayer.getInfo().selected) return false;
    const points = trailLayer.getMembers().map((_, i) => trailLayer.getMemberPose(i)).filter(Boolean).map(p => new THREE.Vector3(p.x, p.y, p.z));
    const chestAt = trailLayer.getChestPosition(); if (chestAt) points.push(chestAt);
    if (!points.length) return false;
    const box = new THREE.Box3().setFromPoints(points), centre = box.getCenter(new THREE.Vector3()), sphere = box.getBoundingSphere(new THREE.Sphere());
    const mpu = source.metersPerUnit, members = points.slice(0, chestAt ? -1 : undefined), troopAt = new THREE.Box3().setFromPoints(members).getCenter(new THREE.Vector3());
    // Look across from the troop to the treasure, turned to a three-quarter view.
    const axis = chestAt ? Math.atan2(chestAt.x - troopAt.x, chestAt.z - troopAt.z) : Math.atan2(camera.position.x - centre.x, camera.position.z - centre.z) - 1.1;
    const azimuth = axis + 1.1, elevation = .5, fov = THREE.MathUtils.degToRad(camera.fov) * Math.min(1, camera.aspect);
    // A little farther, and aimed low: the scene sits in the upper part of
    // the picture, above the riddle's card.
    const reach = Math.max(sphere.radius + 2.5 / mpu, 6 / mpu) / Math.sin(fov / 2 * .9) * 1.35;
    const goal = new THREE.Vector3(centre.x + Math.sin(azimuth) * Math.cos(elevation) * reach, centre.y + Math.sin(elevation) * reach, centre.z + Math.cos(azimuth) * Math.cos(elevation) * reach);
    goal.y = Math.max(goal.y, walkingTerrain.heightAt(goal.x, goal.z) + 3 / mpu);
    const view = centre.clone().sub(goal).normalize(), screenUp = new THREE.Vector3(0, 1, 0).addScaledVector(view, -view.y).normalize();
    const aim = centre.clone().setY(centre.y + .8 / mpu).addScaledVector(screenUp, -reach * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * .5);
    startBlend(); setCameraMode('rts');
    cinema = { type: 'frame', t: 0, centre: aim, goal, look: null };
    return true;
  }
  function placeFrameCamera(dt) {
    cinema.t += dt;
    camera.position.lerp(cinema.goal, 1 - Math.exp(-dt * 2.8));
    if (!cinema.look) cinema.look = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(camera.position.distanceTo(cinema.centre)));
    cinema.look.lerp(cinema.centre, 1 - Math.exp(-dt * 3.5));
    camera.up.set(0, 1, 0); camera.lookAt(cinema.look);
    orbitTarget.copy(cinema.look); distance = camera.position.distanceTo(orbitTarget);
  }
  // Prowling like a wolf: at ground level, on a circle concentric to the troop,
  // drifting in and out, rising only to keep the troop in sight over a ridge.
  function placeLoupCamera(dt) {
    const leader = trailLayer.getLeaderPosition(), mpu = source.metersPerUnit; if (!leader) return;
    if (cinema.angle == null) cinema.angle = Math.atan2(camera.position.x - leader.x, camera.position.z - leader.z);
    cinema.t += dt; cinema.angle += .1 * dt;
    const radius = (115 + 35 * Math.sin(cinema.t * .23)) / mpu, eye = leader.y + 2 / mpu;
    cameraGoal.set(leader.x + Math.sin(cinema.angle) * radius, 0, leader.z + Math.cos(cinema.angle) * radius);
    let y = walkingTerrain.heightAt(cameraGoal.x, cameraGoal.z) + 3.5 / mpu;
    for (let i = 1; i < 10; i++) {
      const u = i / 10, ground = walkingTerrain.heightAt(cameraGoal.x + (leader.x - cameraGoal.x) * u, cameraGoal.z + (leader.z - cameraGoal.z) * u) + 1.5 / mpu;
      y = Math.max(y, (ground - eye * u) / (1 - u));
    }
    cameraGoal.y = y;
    camera.position.lerp(cameraGoal, 1 - Math.exp(-dt * 1.5));
    camera.position.y = Math.max(camera.position.y, walkingTerrain.heightAt(camera.position.x, camera.position.z) + 1.5 / mpu);
    lookTarget.set(leader.x, eye, leader.z);
    if (!cinema.look) cinema.look = lookTarget.clone(); else cinema.look.lerp(lookTarget, 1 - Math.exp(-dt * 3));
    camera.up.set(0, 1, 0); camera.lookAt(cinema.look);
    orbitTarget.copy(cinema.look); distance = camera.position.distanceTo(orbitTarget);
  }
  // Soaring like the papangue, Réunion's harrier: slow wide circles over the
  // whole trail, eyes always on its prey, the troop.
  function placePapangueCamera(dt) {
    const c = cinema.circle, leader = trailLayer.getLeaderPosition(), mpu = source.metersPerUnit; if (!c || !leader) return;
    if (cinema.angle == null) cinema.angle = Math.atan2(camera.position.x - c.cx, camera.position.z - c.cz);
    cinema.t += dt; cinema.angle += .055 * dt;
    // Its circle leans towards the prey and stays within 2.6 km of it, high
    // over the trail's summits, climbing whenever a ridge would hide the troop.
    const cx = c.cx + (leader.x - c.cx) * .6, cz = c.cz + (leader.z - c.cz) * .6, radius = Math.min(c.r * .8 + 500 / mpu, 2600 / mpu);
    cameraGoal.set(cx + Math.sin(cinema.angle) * radius, 0, cz + Math.cos(cinema.angle) * radius);
    let soar = Math.max(c.top + 350 / mpu, walkingTerrain.heightAt(cameraGoal.x, cameraGoal.z) + 400 / mpu) + Math.sin(cinema.t * .2) * 50 / mpu;
    for (let i = 1; i < 10; i++) {
      const u = i / 10, ground = walkingTerrain.heightAt(cameraGoal.x + (leader.x - cameraGoal.x) * u, cameraGoal.z + (leader.z - cameraGoal.z) * u) + 40 / mpu;
      soar = Math.max(soar, (ground - leader.y * u) / (1 - u));
    }
    cameraGoal.y = soar;
    camera.position.lerp(cameraGoal, 1 - Math.exp(-dt * 1.2));
    camera.position.y = Math.max(camera.position.y, walkingTerrain.heightAt(camera.position.x, camera.position.z) + 150 / mpu);
    lookTarget.set(leader.x, leader.y, leader.z);
    if (!cinema.look) cinema.look = lookTarget.clone(); else cinema.look.lerp(lookTarget, 1 - Math.exp(-dt * 3));
    camera.up.set(0, 1, 0); camera.lookAt(cinema.look);
    // Labels, decor and readouts follow the prey.
    orbitTarget.copy(cinema.look); distance = camera.position.distanceTo(orbitTarget);
  }
  // A member's own view while the troop walks: behind the shoulder or eyes.
  function placeCharacterCamera(dt) {
    const pose = trailLayer.getMemberPose(cinema.index); if (!pose) return;
    const mpu = source.metersPerUnit;
    if (!pointers.size) { cinema.yaw *= Math.exp(-dt * .5); cinema.pitch *= Math.exp(-dt * .5); }
    const yaw = pose.heading + cinema.yaw, fx = Math.sin(yaw), fz = -Math.cos(yaw);
    if (cinema.type === 'char-fps') {
      const bob = Math.abs(Math.sin(pose.phase)) * .03 * pose.swing;
      cameraGoal.set(pose.x + Math.sin(pose.heading) * .12 / mpu, pose.y + (pose.eye + bob) / mpu, pose.z - Math.cos(pose.heading) * .12 / mpu);
      camera.position.copy(cameraGoal);
      const pitch = -.1 + cinema.pitch;
      lookTarget.set(cameraGoal.x + fx * Math.cos(pitch), cameraGoal.y + Math.sin(pitch), cameraGoal.z + fz * Math.cos(pitch));
    } else {
      const tenrecView = pose.spec.tenrec, back = (tenrecView ? 3 : 4.6) * cinema.zoom / mpu, up = (tenrecView ? 1.4 : 2.9) * cinema.zoom / mpu;
      cameraGoal.set(pose.x - fx * back, pose.y + up + cinema.pitch * back, pose.z - fz * back);
      cameraGoal.y = Math.max(cameraGoal.y, walkingTerrain.heightAt(cameraGoal.x, cameraGoal.z) + .8 / mpu);
      if (cinema.snap || camera.position.distanceTo(cameraGoal) * mpu > 60) camera.position.copy(cameraGoal);
      else camera.position.lerp(cameraGoal, 1 - Math.exp(-dt * 3.5));
      lookTarget.set(pose.x + fx * 1.5 / mpu, pose.y + pose.eye * .85 / mpu, pose.z + fz * 1.5 / mpu);
    }
    if (!cinema.look || cinema.snap) cinema.look = lookTarget.clone(); else cinema.look.lerp(lookTarget, 1 - Math.exp(-dt * 6));
    cinema.snap = false;
    trailLayer.setCameraBubble(camera.position, 2.4 / mpu);
    camera.up.set(0, 1, 0); camera.lookAt(cinema.type === 'char-fps' ? lookTarget : cinema.look);
  }

  // Fil d'Ariane API: the UI drives trails, troop and strategy camera here.
  function focusTrailPoint(x, z, { heading = null, distanceUnits = RTS.defaultDistance } = {}) {
    if (!rts) setCameraMode('rts');
    desiredTarget.set(x, terrainRenderer.heightAt(x, z), z); terrainRenderer.refineAt(x, z);
    if (heading !== null) desiredTheta = -heading;
    desiredDistance = clamp(distanceUnits, RTS.minDistance, RTS.maxDistance); desiredPhi = RTS.defaultPhi; manualOrbit = true;
  }
  const trails = {
    load(data) {
      themeNames = Object.fromEntries((data?.themes || []).map(t => [t.id, t.nom]));
      const summaries = trailLayer.setData(data); refreshLabels(); return summaries;
    },
    select(id, { fly = true, stage = null } = {}) {
      const info = trailLayer.select(id, { stage }); refreshLabels();
      const trail = trailLayer.getTrail(id);
      // Choosing a trail sends the papangue over its whole territory.
      if (info && fly && trail) setView('papangue');
      return info;
    },
    overview(id) {
      const trail = trailLayer.getTrail(id); if (!trail) return;
      const xs = trail.prepared.points.map(p => p.x), zs = trail.prepared.points.map(p => p.z);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      focusTrailPoint(cx, cz, { distanceUnits: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) * 1.6 + 4 });
    },
    // Setting off: the helicopter follows, unless the visitor watches through a member's eyes.
    play: () => { const ok = trailLayer.play(); if (ok && !['char-fps', 'char-third', 'char-free', 'helico', 'transfer'].includes(getView().view)) setView('helico'); return ok; },
    pause: () => trailLayer.pause(),
    walkTo: s => trailLayer.walkTo(s), walkToStage: id => trailLayer.walkToStage(id),
    goToStage(id) {
      const stage = trailLayer.goToStage(id); if (!stage) return null;
      const position = trailLayer.getTrail(trailLayer.getInfo().selected).stages[stage.index].position;
      focusTrailPoint(position.x, position.z, { heading: position.heading, distanceUnits: Math.min(desiredDistance, RTS.defaultDistance) });
      return stage;
    },
    markDone: (trailId, stageId, value) => trailLayer.markDone(trailId, stageId, value),
    setDone: (trailId, ids) => trailLayer.setDone(trailId, ids),
    setSpeed: value => trailLayer.setSpeed(value), setStops: value => trailLayer.setStops(value),
    startSkydive, chooseSkydive, frameScene, beckon: ids => trailLayer.setBeckoning(ids),
    /** Shape and elevation profile of a trail, in metres along its OSM trace (for the minimap and the cross-section). */
    getProfile(id) {
      const t = trailLayer.getTrail(id); if (!t) return null;
      return { id: t.id, colour: t.couleur, length: t.prepared.rawLength, points: t.prepared.points.filter((_, i) => i % 3 === 0 || i === t.prepared.points.length - 1).map(p => ({ x: p.x, z: p.z })),
        samples: t.profile.samples.map(p => ({ s: t.prepared.unmap(p.s), m: p.m })), stages: t.stages.map(st => ({ id: st.id, type: st.type, theme: st.theme, s: st.osmDistanceM, x: st.position.x, z: st.position.z })) };
    },
    showChest: id => trailLayer.showChest(id), openChest: () => trailLayer.openChest(), hideChest: () => trailLayer.hideChest(),
    /** Fly the troop to a stage by helicopter; false when already flying. */
    travelTo(stageId) {
      if (!trailLayer.startTransfer(stageId)) return false;
      setCameraMode('rts'); cinema = { type: 'transfer', t: 0 };
      return true;
    },
    /** Fly the troop to another trail (a zarboutan's, or back to a door):
     * true while flying, 'direct' when there was no troop to ferry. */
    travelToTrail(id, stageId = 'depart') {
      const result = trailLayer.startTransferToTrail(id, stageId); refreshLabels();
      if (result === true) { setCameraMode('rts'); cinema = { type: 'transfer', t: 0 }; }
      else if (result === 'direct') setView('helico');
      return result;
    },
    /** Hidden trails whose clue has been found: drawn and clickable. */
    setRevealed: ids => trailLayer.setRevealed(ids),
    isAtStage: id => trailLayer.isAtStage(id), isTransferring: () => trailLayer.isTransferring(),
    setFollow, getInfo: () => ({ ...trailLayer.getInfo(), follow }), getSelected: () => trailLayer.getSelected(),
  };
  refreshLabels(); updateLandscape(0); resize(); desiredDistance = distance = defaultDistance(); updateOrbit(1); canvas.style.cursor = 'grab';
  // The visit opens on the tangue in free fall, from the very first picture.
  if (opening === 'skydive') startSkydive();
  resume();
  queueMicrotask(() => { if (!disposed) onReady(getInfo()); });
  // For the minimap: the relief, the main rivers, and where the troop and the camera are.
  function getMapSource() { return { bounds: source.bounds, metersPerUnit: source.metersPerUnit, sampleMeters: (x, z) => source.sampleMeters(x, z), rivers: riverLayer.getMainRivers() }; }
  function getMinimapState() {
    const dir = camera.getWorldDirection(new THREE.Vector3()), leader = trailLayer.getLeaderPosition();
    return { leader: leader && trailLayer.getInfo().selected ? { x: leader.x, z: leader.z } : null, camera: { x: camera.position.x, z: camera.position.z, yaw: Math.atan2(dir.x, -dir.z), fov: 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect), height: camera.position.y - walkingTerrain.heightAt(camera.position.x, camera.position.z) } };
  }
  // A click on the minimap: the strategy view goes there.
  function focusMapPoint(x, z) {
    startBlend(); setCameraMode('rts');
    desiredTarget.set(x, Math.max(0, walkingTerrain.heightAt(x, z)), z); desiredDistance = clamp(Math.max(desiredDistance, 12), RTS.minDistance, 40); follow = false; manualOrbit = true;
    return true;
  }
  return { setPickHandler: fn => { pickHandler = typeof fn === 'function' ? fn : null; }, setViewInsets, setGraph, setState, setStyle, setQuality, setLighting, setAmbiance, setRivers: value => riverLayer.setVisible(value), getWaterfalls: () => riverLayer.getWaterfalls(), visitWaterfall, getMapSource, getMinimapState, focusMapPoint, setVisible, focusNode, focusPlayer, focusLandmark, resetView, dispose, getInfo, setCameraMode, setPrecision, setForestDensity, setForestTypes, setLabelMode: labels.setMode, setVerticalScale, setNarrativeVisible, teleportTo, setSpeed: controller.setSpeed, setFlightSpeed: controller.setFlightSpeed, requestPointerLock: controller.requestPointerLock, trails, setView, getView, getMembers: () => trailLayer.getMembers(), getLandmarks: () => landmarks.map(({ id, name, lon, lat }) => ({ id, name, lon, lat })) };
}
