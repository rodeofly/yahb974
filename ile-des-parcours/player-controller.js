import * as THREE from './vendor/three.module.js';

// All public terrain coordinates are world units. Avatar dimensions, speeds and
// collision margins below are expressed in metres and divided by metersPerUnit.
export const PLAYER_SPEEDS = Object.freeze({ walk: 4.5, run: 12 });
export const PLAYER_JUMP = Object.freeze({ heightMeters: 2.75, velocityMetersPerSecond: Math.sqrt(2 * 9.81 * 2.75) });
export const PLAYER_MORPHOLOGY = Object.freeze({ eyeHeightMeters: 0.65, thirdPersonFocusMeters: 0.55, followDistanceMeters: 3.5 });
export const GLIDER_CONFIG = Object.freeze({ launchHeightMeters: 22, cruiseSpeed: 24, fastCruiseSpeed: 48, slowSpeed: 18, diveSpeed: 32, fastDiveSpeed: 64, cruiseSink: 1.4, slowSink: 0.8, diveSink: 5.8, turnRate: 0.95 });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const scaleOf = terrain => Number.isFinite(terrain?.metersPerUnit) && terrain.metersPerUnit > 0 ? terrain.metersPerUnit : 1;
export const dampingAlpha = (rate, dt) => 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt));
export const compassHeading = yaw => ((yaw * 180 / Math.PI) % 360 + 360) % 360;
const wrapAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

// The integral matters: damping just the speed, then multiplying its final
// value by dt makes acceleration cover different distances at 30 and 144 Hz.
export function integrateDampedValue(value, target, rate, dt) {
  dt = Math.max(0, Number.isFinite(dt) ? dt : 0);
  if (!(rate > 0)) return { value, integral: value * dt };
  const alpha = dampingAlpha(rate, dt);
  return { value: value + (target - value) * alpha, integral: target * dt + (value - target) * alpha / rate };
}

export function smoothLookAngle(value, target, dt, rate = 36) {
  return wrapAngle(value + wrapAngle(target - value) * dampingAlpha(rate, dt));
}

/** Smooth small terrain slope changes without eye bobbing or placing the view
 * below the visible surface. Bounds follow the feet even after a LOD change. */
export function stabilizeEyeHeight(current, feetHeight, dt, metersPerUnit = 1, eyeHeightMeters = PLAYER_MORPHOLOGY.eyeHeightMeters) {
  const desired = feetHeight + eyeHeightMeters / metersPerUnit;
  const smoothed = current + (desired - current) * dampingAlpha(20, dt);
  return clamp(smoothed, feetHeight + Math.max(0.25, eyeHeightMeters - 0.13) / metersPerUnit, feetHeight + (eyeHeightMeters + 0.2) / metersPerUnit);
}

export function normalizedMovement(right, forward) {
  const magnitude = Math.hypot(right, forward);
  const divisor = Math.max(1, magnitude);
  return { right: right / divisor, forward: forward / divisor };
}

export function movementInWorld(right, forward, yaw) {
  const input = normalizedMovement(right, forward);
  return {
    x: input.right * Math.cos(yaw) + input.forward * Math.sin(yaw),
    z: input.right * Math.sin(yaw) - input.forward * Math.cos(yaw)
  };
}

export function integrateVerticalMotion({ y, velocity, ground, dt, metersPerUnit = 1, grounded = false }) {
  if (grounded) return { y: ground, velocity: 0, onGround: true };
  const gravity = 9.81 / metersPerUnit;
  const nextVelocity = velocity - gravity * dt;
  const nextY = y + velocity * dt - 0.5 * gravity * dt * dt;
  if (nextY <= ground && nextVelocity <= 0) return { y: ground, velocity: 0, onGround: true };
  return { y: Math.max(ground, nextY), velocity: nextVelocity, onGround: false };
}

function terrainSample(terrain, x, z) {
  if (!terrain || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  const b = terrain.bounds;
  if (b && (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ)) return null;
  if (terrain.isLand && !terrain.isLand(x, z)) return null;
  const height = terrain.heightAt(x, z);
  if (!Number.isFinite(height) || (!terrain.isLand && height < 0)) return null;
  return height;
}

/** Trace the full movement, including a long frame, so a low frame rate cannot
 * skip coastlines or steep ridges. Sliding preserves the unblocked component. */
export function traceGroundMovement({ terrain, x, z, dx, dz, maxSlopeDegrees = 55, stepMeters = 0.75 }) {
  const scale = scaleOf(terrain);
  let height = terrainSample(terrain, x, z);
  if (height === null) return { x, z, height: terrain?.heightAt(x, z) ?? 0, blocked: true, blockedReason: 'outside-terrain' };
  const length = Math.hypot(dx, dz);
  if (!Number.isFinite(length) || length === 0) return { x, z, height, blocked: false, blockedReason: null };
  const count = Math.max(1, Math.ceil(length * scale / Math.max(0.1, stepMeters)));
  const sx = dx / count, sz = dz / count;
  const maxGradient = Math.tan(clamp(maxSlopeDegrees, 0, 85) * Math.PI / 180);
  let blocked = false, blockedReason = null;
  function candidate(nx, nz) {
    const h = terrainSample(terrain, nx, nz);
    if (h === null) return { valid: false, reason: 'coast' };
    const run = Math.hypot(nx - x, nz - z);
    // A millimetre of tolerance absorbs floating point interpolation noise;
    // a large fixed "step allowance" would defeat the slope limit at low speed.
    if (Math.abs(h - height) > run * maxGradient + 0.001 / scale) return { valid: false, reason: 'slope' };
    return { valid: true, x: nx, z: nz, height: h };
  }
  for (let i = 0; i < count; i++) {
    let next = candidate(x + sx, z + sz);
    if (!next.valid) {
      blocked = true; blockedReason = next.reason;
      const choices = [];
      if (Math.abs(sx) > 1e-12) { const c = candidate(x + sx, z); if (c.valid) choices.push(c); }
      if (Math.abs(sz) > 1e-12) { const c = candidate(x, z + sz); if (c.valid) choices.push(c); }
      if (!choices.length) break;
      next = choices.sort((a, b) => (b.x - x) * sx + (b.z - z) * sz - (a.x - x) * sx - (a.z - z) * sz)[0];
    }
    x = next.x; z = next.z; height = next.height;
  }
  return { x, z, height, blocked, blockedReason };
}

function flightSurface(terrain, x, z) {
  if (!terrain || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  const b = terrain.bounds;
  if (b && (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ)) return null;
  const land = terrain.isLand ? Boolean(terrain.isLand(x, z)) : Number.isFinite(terrain.heightAt(x, z));
  const height = land ? terrain.heightAt(x, z) : 0;
  return { height: Number.isFinite(height) ? Math.max(0, height) : 0, land: land && Number.isFinite(height) };
}

/** Swept flight collision. Sampling the whole segment prevents a fast dive
 * from crossing a ridge between frames. Sea has a real collision plane at y=0;
 * callers decide how to respawn after a water landing. */
export function traceFlightMovement({ terrain, x, y, z, dx, dy, dz, stepMeters = 0.75, clearanceMeters = 0.06 }) {
  const scale = scaleOf(terrain), margin = clearanceMeters / scale;
  const start = flightSurface(terrain, x, z);
  if (!start) return { x, y, z, ground: 0, land: false, landed: false, blocked: true, blockedReason: 'bounds', landingReason: null };
  const count = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) * scale / Math.max(0.1, stepMeters)));
  const sx = dx / count, sy = dy / count, sz = dz / count;
  let surface = start;
  for (let i = 0; i < count; i++) {
    const nx = x + sx, ny = y + sy, nz = z + sz;
    const next = flightSurface(terrain, nx, nz);
    if (!next) {
      // Keep the pilot above the last valid surface at the DEM boundary. A
      // turn remains possible, and descending never jumps to the ground.
      const finalY = Math.max(surface.height, y + sy * (count - i));
      const landed = finalY <= surface.height + margin;
      return { x, y: landed ? surface.height : finalY, z, ground: surface.height, land: surface.land, landed, blocked: true, blockedReason: 'bounds', landingReason: landed ? (surface.land ? 'terrain' : 'water') : null };
    }
    if (ny <= next.height + margin) {
      // Locate first contact to avoid snapping back a whole substep on steep
      // slopes. On a discontinuous surface, stay at the last clear point.
      let low = 0, high = 1;
      for (let j = 0; j < 14; j++) {
        const t = (low + high) / 2, sample = flightSurface(terrain, x + sx * t, z + sz * t);
        if (sample && y + sy * t > sample.height + margin) low = t; else high = t;
      }
      const cx = x + sx * low, cz = z + sz * low, cy = y + sy * low;
      const contact = flightSurface(terrain, cx, cz) || surface;
      if ((cy - contact.height) * scale > 1.1) {
        const finalY = Math.max(contact.height, cy + sy * (count - i));
        const landed = finalY <= contact.height + margin;
        return { x: cx, y: landed ? contact.height : finalY, z: cz, ground: contact.height, land: contact.land, landed, blocked: true, blockedReason: 'ridge', landingReason: landed ? (contact.land ? 'terrain' : 'water') : null };
      }
      return { x: cx, y: contact.height, z: cz, ground: contact.height, land: contact.land, landed: true, blocked: false, blockedReason: null, landingReason: contact.land ? 'terrain' : 'water' };
    }
    x = nx; y = ny; z = nz; surface = next;
  }
  return { x, y, z, ground: surface.height, land: surface.land, landed: false, blocked: false, blockedReason: null, landingReason: null };
}

// The avatar model faces +Z. Walking, it turns towards its motion; flying (or
// in FPS) towards its yaw: π − yaw (yaw + π mirrored it east–west, so the
// glider flew backwards on an eastward or westward heading).
export function avatarYawFor(mode, yaw, dx, dz) {
  return mode === 'fps' || mode === 'glide' ? Math.PI - yaw : Math.atan2(dx, dz);
}

// The glider's nose follows the middle of the picture: looking below the
// usual view dives, looking above it slows down (a small neutral zone).
export const GLIDE_LOOK_PITCH = -0.18;
export function lookToGlide(pitch) {
  const offset = GLIDE_LOOK_PITCH - pitch, neutral = 0.06;
  return Math.abs(offset) < neutral ? 0 : clamp((offset - Math.sign(offset) * neutral) * 2.5, -1, 1);
}

/** `climb` (m/s) is the rockets' push: the launch, or the throttle held down. */
export function gliderControlTargets(forward = 0, brake = false, speedMode = 'cruise', climb = 0) {
  const input = brake ? -1 : clamp(forward, -1, 1);
  const cruiseSpeed = speedMode === 'fast' ? GLIDER_CONFIG.fastCruiseSpeed : GLIDER_CONFIG.cruiseSpeed;
  const diveSpeed = speedMode === 'fast' ? GLIDER_CONFIG.fastDiveSpeed : GLIDER_CONFIG.diveSpeed;
  const target = input >= 0
    ? { speed: cruiseSpeed + (diveSpeed - cruiseSpeed) * input, verticalSpeed: -GLIDER_CONFIG.cruiseSink - (GLIDER_CONFIG.diveSink - GLIDER_CONFIG.cruiseSink) * input }
    : { speed: cruiseSpeed + (cruiseSpeed - GLIDER_CONFIG.slowSpeed) * input, verticalSpeed: -GLIDER_CONFIG.cruiseSink - (GLIDER_CONFIG.cruiseSink - GLIDER_CONFIG.slowSink) * input };
  if (climb > 0) target.verticalSpeed += climb;
  return target;
}

// The glider takes off on a burst of its two rockets: straight up, strong at
// first, easing off; the throttle (a click held down) then gives a steady climb.
export const GLIDER_LAUNCH = Object.freeze({ seconds: 1.6, climbMetersPerSecond: 22, forwardMetersPerSecond: 5 });
export const GLIDER_THROTTLE = Object.freeze({ climbMetersPerSecond: 3.5 });
/** Vertical speed of the launch t seconds after the click, m/s. */
export function launchVerticalSpeed(t) {
  const u = clamp(t / GLIDER_LAUNCH.seconds, 0, 1);
  return GLIDER_LAUNCH.climbMetersPerSecond * (1 - u * u);
}
/** Paraglider piloting with the mouse: the pointer stays in the middle and
 * moves a stick instead (x to the right, y towards the pilot, −1 to 1). Pulling
 * one side brakes that wing and turns; pulling both slows down; pushing away
 * is the speed bar (faster, steeper). A small dead zone at the centre. */
export function stickToGlide({ x = 0, y = 0 } = {}) {
  const dead = .06, shape = v => Math.abs(v) < dead ? 0 : Math.sign(v) * (Math.abs(v) - dead) / (1 - dead);
  return { right: clamp(shape(x), -1, 1), forward: clamp(-shape(y), -1, 1) };
}

/** Metre-based arcade flight with a continuous, gentle sink. Energy is never
 * created by holding the brake; gaining height takes the rockets (`climb`). */
export function stepGliderMotion({ terrain, state, yaw, forward = 0, brake = false, speedMode = 'cruise', climb = 0, dt }) {
  const scale = scaleOf(terrain), target = gliderControlTargets(forward, brake, speedMode, climb);
  const speed = integrateDampedValue(state.speedMetersPerSecond, target.speed, 1.8, dt);
  const vertical = integrateDampedValue(state.verticalSpeedMetersPerSecond, target.verticalSpeed, 3, dt);
  const contact = traceFlightMovement({ terrain, x: state.x, y: state.y, z: state.z, dx: Math.sin(yaw) * speed.integral / scale, dy: vertical.integral / scale, dz: -Math.cos(yaw) * speed.integral / scale });
  return { ...contact, speedMetersPerSecond: speed.value, verticalSpeedMetersPerSecond: contact.landed ? 0 : vertical.value };
}

/** Fraction of a camera boom that is visible above the DEM. The terrain is
 * sampled along the complete segment, not just at the camera destination. */
export function cameraTerrainFraction({ terrain, anchor, desired, clearanceMeters = 0.25, samples = 28 }) {
  const clearance = clearanceMeters / scaleOf(terrain);
  const heightAt = (x, z) => {
    const h = terrain.heightAt(x, z);
    return Number.isFinite(h) ? h : 0;
  };
  const clearAt = t => {
    const x = anchor.x + (desired.x - anchor.x) * t;
    const y = anchor.y + (desired.y - anchor.y) * t;
    const z = anchor.z + (desired.z - anchor.z) * t;
    return y >= heightAt(x, z) + clearance;
  };
  let previous = 0;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    if (!clearAt(t)) {
      let low = previous, high = t;
      for (let j = 0; j < 7; j++) { const mid = (low + high) / 2; if (clearAt(mid)) low = mid; else high = mid; }
      return Math.max(0, low - 0.008);
    }
    previous = t;
  }
  return 1;
}

/** Standalone terrain-following controller. Orbit controls remain the world's
 * responsibility: this module never moves the camera or captures input there. */
export function createPlayerController({ camera, canvas, container, avatar, terrain: initialTerrain, morphology = {}, onChange = () => {}, onInteract = () => {} }) {
  if (!camera || !canvas || !container || !initialTerrain?.heightAt) throw new Error('Caméra, canevas, conteneur et terrain requis.');
  const doc = canvas.ownerDocument;
  const win = doc.defaultView;
  const dimensions = Object.fromEntries(Object.entries(PLAYER_MORPHOLOGY).map(([key, fallback]) => [key, Number.isFinite(morphology?.[key]) && morphology[key] > 0 ? morphology[key] : fallback]));
  let terrain = initialTerrain;
  let mode = 'orbit', speedMode = 'walk', flightSpeedMode = 'cruise', enabled = true, disposed = false;
  let yaw = 0, pitch = -0.18, targetYaw = 0, targetPitch = -0.18, verticalVelocity = 0;
  let velocityX = 0, velocityZ = 0, eyeHeight = NaN;
  let onGround = true, moving = false, blocked = false, blockedReason = null;
  let speedMetersPerSecond = 0, notificationTime = 0, snapCamera = true;
  let followDistanceMeters = dimensions.followDistanceMeters, touchRun = false, keyboardActive = false;
  let flightSpeed = GLIDER_CONFIG.cruiseSpeed, flightVerticalSpeed = -GLIDER_CONFIG.cruiseSink, flightBank = 0, flightPitch = 0;
  let flightLanded = false, flightLandingReason = null;
  // The glider's rockets and the mouse stick.
  let launchElapsed = Infinity, throttle = false, thrust = 0, stick = { x: 0, y: 0 };
  let mouseDrag = null, lookPointer = null, joystickPointer = null;
  let joystickCenter = { x: 0, y: 0 }, joystickInput = { right: 0, forward: 0 };
  const keys = new Set(), cleanups = [];
  const position = avatar?.position?.clone() ?? new THREE.Vector3();
  const lastSafeGround = position.clone();
  const lookDirection = new THREE.Vector3(0, 0, -1);
  const anchor = new THREE.Vector3(), desiredCamera = new THREE.Vector3(), safeCamera = new THREE.Vector3();
  const previousCamera = new THREE.Vector3();
  const previousTabIndex = canvas.getAttribute('tabindex');
  if (canvas.tabIndex < 0) canvas.tabIndex = 0;

  const controls = doc.createElement('div');
  controls.className = 'player-touch-controls';
  controls.hidden = true;
  controls.innerHTML = '<div class="player-look-zone" aria-hidden="true"></div><div class="player-joystick" role="group" aria-label="Joystick : déplacer le personnage"><span class="player-joystick-knob"></span></div><button type="button" class="player-run-toggle" aria-label="Activer la course" aria-pressed="false">Courir</button><button type="button" class="player-jump-button" aria-label="Faire sauter le tangue">Sauter</button>';
  const joystick = controls.querySelector('.player-joystick');
  const knob = controls.querySelector('.player-joystick-knob');
  const lookZone = controls.querySelector('.player-look-zone');
  const runButton = controls.querySelector('.player-run-toggle');
  const jumpButton = controls.querySelector('.player-jump-button');
  const crosshair = doc.createElement('div');
  crosshair.className = 'player-crosshair';
  crosshair.hidden = true; crosshair.setAttribute('aria-hidden', 'true');
  // In flight, the locked pointer is drawn as a stick: a ring in the middle of
  // the picture and a dot showing which way the brakes are pulled.
  const stickView = doc.createElement('div');
  stickView.className = 'player-stick'; stickView.hidden = true; stickView.setAttribute('aria-hidden', 'true');
  stickView.innerHTML = '<svg viewBox="-64 -64 128 128" width="128" height="128"><circle class="ring" r="56"/><circle class="dead" r="5"/><line class="pull" x1="0" y1="0" x2="0" y2="0"/><circle class="knob" r="8"/></svg><span class="gas">🚀 Gaz</span>';
  const stickLine = stickView.querySelector('.pull'), stickKnob = stickView.querySelector('.knob');
  const style = doc.createElement('style');
  style.textContent = `
    .player-touch-controls{position:absolute;inset:0;z-index:4;pointer-events:none;display:none;user-select:none;-webkit-user-select:none}
    .player-touch-controls[hidden],.player-crosshair[hidden]{display:none!important}
    .player-look-zone{position:absolute;top:0;bottom:0;right:0;width:50%;touch-action:none;pointer-events:auto}
    .player-joystick{position:absolute;left:24px;bottom:48px;width:106px;height:106px;border-radius:50%;background:#f0f7ed28;border:1px solid #ffffffe0;box-shadow:0 2px 15px #142d3828;touch-action:none;pointer-events:auto}
    .player-joystick-knob{position:absolute;left:31px;top:31px;width:42px;height:42px;border-radius:50%;background:#edf4e5ce;border:1px solid #fff;box-shadow:0 2px 9px #183c4a28;pointer-events:none}
    .player-run-toggle,.player-jump-button{position:absolute;right:25px;bottom:57px;min-width:65px;min-height:48px;padding:10px;border-radius:24px;background:#edf4e5d9;color:#183d39;border:1px solid #fff;font:600 11px system-ui;pointer-events:auto;touch-action:manipulation}
    .player-jump-button{right:105px}
    .player-jump-button[hidden]{display:none!important}
    .player-run-toggle[aria-pressed=true]{background:#285e52;color:white}
    .player-crosshair{position:absolute;top:50%;left:50%;width:5px;height:5px;transform:translate(-50%,-50%);border-radius:50%;background:#fff;box-shadow:0 0 0 1px #14332b80,0 0 8px #14332b60;z-index:3;pointer-events:none}
    .player-stick{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:3;pointer-events:none;filter:drop-shadow(0 0 3px #14332b90)}
    .player-stick[hidden]{display:none!important}
    .player-stick svg{display:block;overflow:visible}
    .player-stick .ring{fill:none;stroke:#ffffffb0;stroke-width:2;stroke-dasharray:6 6}
    .player-stick .dead{fill:none;stroke:#ffffff90;stroke-width:1.5}
    .player-stick .pull{stroke:#ffd36b;stroke-width:3;stroke-linecap:round}
    .player-stick .knob{fill:#ffd36b;stroke:#3a2408;stroke-width:2}
    .player-stick .gas{position:absolute;left:50%;top:100%;transform:translate(-50%,6px);font:700 12px system-ui;color:#fff;background:#d0502ccc;border-radius:10px;padding:2px 8px;opacity:0;transition:opacity .15s}
    .player-stick.is-gas .ring{stroke:#ff8a1f;stroke-dasharray:none;stroke-width:3}
    .player-stick.is-gas .gas{opacity:1}
    @media(any-pointer:coarse){.player-touch-controls:not([hidden]){display:block}}
  `;
  container.append(style, controls, crosshair, stickView);

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  }
  function pointerLocked() { return doc.pointerLockElement === canvas; }
  function active() { return enabled && !disposed && mode !== 'orbit'; }
  function editable(target) { return !!target?.closest?.('input,textarea,select,button,[contenteditable="true"],[role="textbox"]'); }
  function focusCanvas() { keyboardActive = true; try { canvas.focus({ preventScroll: true }); } catch { canvas.focus(); } }
  function updateLookDirection() { lookDirection.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)); }
  function getInfo() {
    const surface = flightSurface(terrain, position.x, position.z);
    return { mode, speedMode, moving, onGround, speedMetersPerSecond, headingDegrees: compassHeading(yaw), pointerLocked: pointerLocked(), pointerLockSupported: typeof canvas.requestPointerLock === 'function', blocked, blockedReason, position: { x: position.x, y: position.y, z: position.z },
      flight: { active: mode === 'glide', speedMode: flightSpeedMode, bank: flightBank, pitch: flightPitch, speedMetersPerSecond: mode === 'glide' ? flightSpeed : 0, verticalSpeedMetersPerSecond: mode === 'glide' ? flightVerticalSpeed : verticalVelocity * scaleOf(terrain), clearanceMeters: Math.max(0, (position.y - (surface?.height ?? 0)) * scaleOf(terrain)), landed: flightLanded, landingReason: flightLandingReason,
        thrust: mode === 'glide' ? thrust : 0, launching: mode === 'glide' && launchElapsed < GLIDER_LAUNCH.seconds, throttle: mode === 'glide' && throttle, stick: { ...stick } } };
  }
  function notify() { if (!disposed) onChange(getInfo()); }
  function resetJoystick() { joystickInput = { right: 0, forward: 0 }; knob.style.transform = ''; }
  function releaseCapture(element, pointer) { if (pointer !== null) { try { if (element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer); } catch { /* Detached surfaces may already have released capture. */ } } }
  function resetKeys() {
    keys.clear(); moving = false; speedMetersPerSecond = 0; velocityX = 0; velocityZ = 0; throttle = false;
    const mouseId = mouseDrag?.id ?? null, touchId = lookPointer?.id ?? null, stickId = joystickPointer;
    mouseDrag = null; lookPointer = null; joystickPointer = null;
    releaseCapture(canvas, mouseId); releaseCapture(lookZone, touchId); releaseCapture(joystick, stickId);
    resetJoystick();
  }
  function exitPointerLock() { if (pointerLocked()) { try { doc.exitPointerLock(); } catch { /* No lock remains. */ } } }
  function changeLook(dx, dy, sensitivity = 0.0026) {
    targetYaw = wrapAngle(targetYaw + clamp(dx, -350, 350) * sensitivity);
    targetPitch = clamp(targetPitch - clamp(dy, -350, 350) * sensitivity, mode === 'fps' ? -1.35 : -0.86, mode === 'fps' ? 1.3 : 0.65);
  }
  const moveCodes = new Set(['KeyW', 'KeyZ', 'ArrowUp', 'KeyS', 'ArrowDown', 'KeyA', 'KeyQ', 'ArrowLeft', 'KeyD', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
  listen(doc, 'keydown', event => {
    if (!active() || editable(event.target) || (!keyboardActive && !pointerLocked() && doc.activeElement !== canvas) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (moveCodes.has(event.code)) { event.preventDefault(); keys.add(event.code); }
    else if (event.code === 'KeyE' && !event.repeat) { event.preventDefault(); onInteract(getInfo()); }
    else if (event.code === 'Space') { event.preventDefault(); if (mode === 'glide') throttle = true; else if (!event.repeat) jump(); }
    else if (event.code === 'Escape') { resetKeys(); exitPointerLock(); }
  });
  listen(doc, 'keyup', event => { keys.delete(event.code); if (event.code === 'Space') throttle = false; });
  listen(win, 'blur', () => { keyboardActive = false; resetKeys(); });
  listen(doc, 'visibilitychange', () => { if (doc.hidden) { keyboardActive = false; resetKeys(); exitPointerLock(); } });
  listen(doc, 'pointerdown', event => { if (active() && !container.contains(event.target)) { keyboardActive = false; resetKeys(); } });
  listen(canvas, 'blur', () => { if (!pointerLocked()) { keyboardActive = false; resetKeys(); } });
  listen(doc, 'pointerlockchange', () => { mouseDrag = null; if (pointerLocked()) focusCanvas(); else resetKeys(); notify(); });
  listen(doc, 'pointerlockerror', () => { notify(); });

  listen(canvas, 'pointerdown', event => {
    if (!active() || (event.button !== 0 && event.pointerType !== 'touch')) return;
    focusCanvas(); event.preventDefault();
    // In flight, a click held down is the throttle; with a mouse it also
    // locks the pointer in the middle, where it becomes the stick.
    if (mode === 'glide' && event.pointerType === 'mouse') { throttle = true; if (!pointerLocked()) lockForFlight(); }
    if (!pointerLocked() && !mouseDrag) {
      mouseDrag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      try { canvas.setPointerCapture(event.pointerId); } catch { /* Pointer capture is optional. */ }
    }
  });
  listen(canvas, 'pointermove', event => {
    if (!active() || pointerLocked() || mouseDrag?.id !== event.pointerId) return;
    changeLook(event.clientX - mouseDrag.x, event.clientY - mouseDrag.y, event.pointerType === 'touch' ? 0.005 : 0.003);
    mouseDrag.x = event.clientX; mouseDrag.y = event.clientY; event.preventDefault();
  });
  function endMouse(event) {
    if (event.pointerType === 'mouse') throttle = false;
    if (mouseDrag?.id === event.pointerId) { mouseDrag = null; releaseCapture(canvas, event.pointerId); }
  }
  listen(canvas, 'pointerup', endMouse); listen(canvas, 'pointercancel', endMouse); listen(canvas, 'lostpointercapture', endMouse);
  listen(doc, 'mousemove', event => {
    if (!active() || !pointerLocked()) return;
    if (mode === 'glide') moveStick(event.movementX, event.movementY); else changeLook(event.movementX, event.movementY);
  });
  // The stick: the mouse moves it inside a disc; it drifts slowly back to the
  // centre, as the brake lines rise when the pilot's hands let go.
  function moveStick(dx, dy) {
    stick.x += clamp(dx, -200, 200) / 240; stick.y += clamp(dy, -200, 200) / 240;
    const r = Math.hypot(stick.x, stick.y); if (r > 1) { stick.x /= r; stick.y /= r; }
  }
  function lockForFlight() {
    if (!canvas.requestPointerLock) return;
    try { const result = canvas.requestPointerLock(); result?.catch?.(() => notify()); } catch { notify(); }
  }
  listen(canvas, 'wheel', event => {
    if (!active()) return;
    event.preventDefault();
    if (mode === 'third') followDistanceMeters = clamp(followDistanceMeters * Math.exp(event.deltaY * 0.0015), 2, 10);
  }, { passive: false });
  listen(canvas, 'contextmenu', event => { if (active()) event.preventDefault(); });

  function updateJoystick(event) {
    const radius = 36;
    const dx = event.clientX - joystickCenter.x, dy = event.clientY - joystickCenter.y;
    const length = Math.hypot(dx, dy), factor = Math.min(1, radius / Math.max(length, 1));
    const x = dx * factor, y = dy * factor;
    knob.style.transform = `translate(${x}px,${y}px)`;
    const deadZone = 0.12, magnitude = Math.min(1, length / radius);
    const strength = Math.max(0, (magnitude - deadZone) / (1 - deadZone));
    joystickInput = { right: length ? dx / length * strength : 0, forward: length ? -dy / length * strength : 0 };
  }
  listen(joystick, 'pointerdown', event => {
    if (!active() || joystickPointer !== null) return;
    event.preventDefault(); event.stopPropagation(); focusCanvas();
    const rect = joystick.getBoundingClientRect(); joystickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    joystickPointer = event.pointerId;
    try { joystick.setPointerCapture(event.pointerId); } catch { /* Optional on older WebViews. */ }
    updateJoystick(event);
  });
  listen(joystick, 'pointermove', event => { if (joystickPointer === event.pointerId) { event.preventDefault(); updateJoystick(event); } });
  function endJoystick(event) { if (joystickPointer === event.pointerId) { joystickPointer = null; resetJoystick(); releaseCapture(joystick, event.pointerId); } }
  listen(joystick, 'pointerup', endJoystick); listen(joystick, 'pointercancel', endJoystick); listen(joystick, 'lostpointercapture', endJoystick);
  listen(lookZone, 'pointerdown', event => {
    if (!active() || lookPointer) return;
    event.preventDefault(); event.stopPropagation(); focusCanvas();
    lookPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    try { lookZone.setPointerCapture(event.pointerId); } catch { /* Optional on older WebViews. */ }
  });
  listen(lookZone, 'pointermove', event => {
    if (lookPointer?.id !== event.pointerId) return;
    changeLook(event.clientX - lookPointer.x, event.clientY - lookPointer.y, 0.005);
    lookPointer.x = event.clientX; lookPointer.y = event.clientY; event.preventDefault();
  });
  function endLook(event) { if (lookPointer?.id === event.pointerId) { lookPointer = null; releaseCapture(lookZone, event.pointerId); } }
  listen(lookZone, 'pointerup', endLook); listen(lookZone, 'pointercancel', endLook); listen(lookZone, 'lostpointercapture', endLook);
  // Keep the movement finger captured when a second finger toggles sprint.
  // The button's default focus would otherwise blur the canvas and reset input.
  listen(runButton, 'pointerdown', event => { if (active()) { event.preventDefault(); focusCanvas(); } });
  listen(runButton, 'click', () => {
    if (mode === 'glide') { touchRun = !touchRun; updateControlPresentation(); }
    else setSpeed(speedMode === 'run' ? 'walk' : 'run');
    focusCanvas();
  });
  // Jump on the touch press itself, preserving the movement finger and focus.
  // The click handler also serves keyboard and assistive activation; a second
  // activation cannot double-jump because jump() requires ground contact.
  listen(jumpButton, 'pointerdown', event => {
    if (!active()) return;
    event.preventDefault(); event.stopPropagation(); focusCanvas();
    // In flight the same button is the throttle, held down.
    if (mode === 'glide') { throttle = true; try { jumpButton.setPointerCapture(event.pointerId); } catch { /* Optional. */ } } else jump();
  });
  const endGas = () => { if (mode === 'glide') throttle = false; };
  listen(jumpButton, 'pointerup', endGas); listen(jumpButton, 'pointercancel', endGas); listen(jumpButton, 'lostpointercapture', endGas);
  listen(jumpButton, 'click', () => { if (active() && mode !== 'glide') { focusCanvas(); jump(); } });

  function updateControlPresentation() {
    controls.hidden = !enabled || mode === 'orbit'; crosshair.hidden = !enabled || mode !== 'fps';
    stickView.hidden = !enabled || mode !== 'glide' || !pointerLocked();
    container.dataset.playerMode = mode;
    joystick.setAttribute('aria-label', mode === 'glide' ? 'Joystick : diriger le planeur, avancer pour piquer, reculer pour freiner' : 'Joystick : déplacer le personnage');
    runButton.hidden = false; jumpButton.hidden = false;
    jumpButton.textContent = mode === 'glide' ? '🚀 Gaz' : 'Sauter';
    jumpButton.setAttribute('aria-label', mode === 'glide' ? 'Mettre les gaz : maintenir pour monter' : 'Faire sauter le tangue');
    const selected = mode === 'glide' ? touchRun : speedMode === 'run';
    runButton.setAttribute('aria-pressed', String(selected));
    runButton.setAttribute('aria-label', mode === 'glide' ? (selected ? 'Relâcher le frein du planeur' : 'Freiner le planeur') : (selected ? 'Revenir à la marche' : 'Activer la course'));
    runButton.textContent = mode === 'glide' ? (selected ? 'Relâcher' : 'Freiner') : (selected ? 'Marcher' : 'Courir');
  }
  function setMode(next) {
    if (!['orbit', 'third', 'fps', 'glide'].includes(next)) throw new Error(`Mode caméra inconnu : ${next}`);
    if (next === mode || disposed) return;
    const previousMode = mode;
    resetKeys(); exitPointerLock(); mode = next; snapCamera = !(previousMode === 'glide' && next === 'third');
    touchRun = false; eyeHeight = NaN;
    updateControlPresentation();
    if (avatar) avatar.visible = mode !== 'fps';
    if (mode !== 'orbit') {
      if (previousMode === 'orbit') { camera.getWorldDirection(lookDirection); yaw = Math.atan2(lookDirection.x, -lookDirection.z); pitch = mode === 'fps' ? -0.03 : -0.18; }
      targetYaw = yaw; targetPitch = pitch;
      if (mode === 'glide') {
        const surface = flightSurface(terrain, position.x, position.z);
        const ground = surface?.height ?? 0, scale = scaleOf(terrain);
        if (onGround && surface?.land) lastSafeGround.copy(position);
        // One explicit launch, on a burst of the rockets, straight up from the
        // ground; already high in the air, the wing simply opens.
        const low = (position.y - ground) * scale < GLIDER_CONFIG.launchHeightMeters;
        onGround = false; stick = { x: 0, y: 0 }; throttle = false;
        if (low) {
          position.y = Math.max(position.y, ground + .3 / scale);
          launchElapsed = 0; flightSpeed = GLIDER_LAUNCH.forwardMetersPerSecond; flightVerticalSpeed = launchVerticalSpeed(0);
        } else {
          launchElapsed = Infinity; flightSpeed = gliderControlTargets(0, false, flightSpeedMode).speed; flightVerticalSpeed = -GLIDER_CONFIG.cruiseSink;
        }
        verticalVelocity = flightVerticalSpeed / scale;
        flightBank = 0; flightPitch = Math.atan2(flightVerticalSpeed, Math.max(1, flightSpeed));
        flightLanded = false; flightLandingReason = null;
        pitch = targetPitch = -0.15; avatar?.position.copy(position);
        // With a mouse, the pointer is locked in the middle and becomes the stick.
        if (win.matchMedia?.('(any-pointer: fine)')?.matches) lockForFlight();
      } else if (previousMode === 'glide') {
        verticalVelocity = flightVerticalSpeed / scaleOf(terrain); onGround = false;
        flightLanded = false; flightLandingReason = null;
      }
      updateLookDirection(); if (enabled) focusCanvas();
    } else {
      keyboardActive = false;
      // The overview pauses the character in place, including an airborne
      // position. Returning to a walking camera resumes gravity from there.
      if (previousMode === 'glide') verticalVelocity = flightVerticalSpeed / scaleOf(terrain);
    }
    notify();
  }
  function toggleGlide() { setMode(mode === 'glide' ? 'third' : 'glide'); return mode; }
  function setSpeed(next) {
    // A persisted v0.3 "travel" setting must never resurrect 220 m/s on land.
    // Ground pace and fast flight are independent preferences from now on.
    if (next === 'travel') next = 'run';
    if (!Object.hasOwn(PLAYER_SPEEDS, next)) throw new Error(`Vitesse inconnue : ${next}`);
    speedMode = next; touchRun = false; updateControlPresentation(); notify();
  }
  function setFlightSpeed(next) {
    if (!['cruise', 'fast'].includes(next)) throw new Error(`Vitesse de vol inconnue : ${next}`);
    flightSpeedMode = next; notify();
  }
  function teleport(x, z) {
    const y = terrainSample(terrain, Number(x), Number(z));
    if (y === null || disposed) return false;
    position.set(Number(x), y, Number(z)); lastSafeGround.copy(position); verticalVelocity = 0; onGround = true; blocked = false; blockedReason = null;
    if (mode === 'glide') mode = 'third'; flightLanded = false; flightLandingReason = null; touchRun = false;
    resetKeys(); snapCamera = true; eyeHeight = NaN; updateControlPresentation(); avatar?.position.copy(position); if (active()) focusCanvas(); notify(); return true;
  }
  // Eye height and camera boom follow the body being explored (tenrec or human).
  function setMorphology(next = {}) {
    for (const key of Object.keys(PLAYER_MORPHOLOGY)) if (Number.isFinite(next[key]) && next[key] > 0) dimensions[key] = next[key];
    followDistanceMeters = dimensions.followDistanceMeters; eyeHeight = NaN; snapCamera = true;
  }
  function setTerrain(next) {
    if (!next?.heightAt) throw new Error('Le terrain doit exposer heightAt(x, z).');
    terrain = next;
    const y = terrainSample(terrain, position.x, position.z);
    if (y !== null) {
      // LOD changes elsewhere must not disturb the camera. In flight and
      // jumps, preserve absolute altitude unless the new mesh reaches it.
      position.y = onGround ? y : Math.max(y, position.y);
      avatar?.position.copy(position);
      if (onGround) lastSafeGround.copy(position);
    }
  }
  function setEnabled(value) {
    enabled = Boolean(value);
    updateControlPresentation();
    if (!enabled) { keyboardActive = false; resetKeys(); exitPointerLock(); }
    snapCamera = true;
  }
  async function requestPointerLock() {
    if (!active() || mode !== 'fps' || !canvas.requestPointerLock) return false;
    focusCanvas();
    try {
      const result = canvas.requestPointerLock();
      if (result && typeof result.then === 'function') { await result; return pointerLocked(); }
      return true; // Older browsers confirm the request through pointerlockchange.
    }
    catch { notify(); return false; }
  }
  function jump() {
    if (!active() || mode === 'glide' || !onGround) return false;
    verticalVelocity = PLAYER_JUMP.velocityMetersPerSecond / scaleOf(terrain); onGround = false; return true;
  }
  function restoreLastGround() {
    position.copy(lastSafeGround);
    const ground = terrainSample(terrain, position.x, position.z);
    if (ground !== null) position.y = ground;
    onGround = true; verticalVelocity = 0;
    velocityX = velocityZ = 0; eyeHeight = NaN; snapCamera = true;
  }
  function finishFlight(reason) {
    exitPointerLock(); launchElapsed = Infinity; throttle = false; thrust = 0; stick = { x: 0, y: 0 };
    if (reason === 'water') restoreLastGround();
    onGround = true; verticalVelocity = 0; velocityX = velocityZ = 0;
    flightVerticalSpeed = 0; flightLanded = true; flightLandingReason = reason;
    lastSafeGround.copy(position);
    mode = 'third'; touchRun = false; resetKeys(); updateControlPresentation();
    // Keep the existing chase position for a soft landing. A sea recovery is
    // an explicit respawn and must not interpolate the camera across the map.
    if (reason !== 'water') snapCamera = false;
    notify();
  }
  function update(dt) {
    if (!active()) return getInfo();
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.075) : 0;
    const scale = scaleOf(terrain);
    const held = (...codes) => codes.some(code => keys.has(code)) ? 1 : 0;
    const right = held('KeyD', 'ArrowRight') - held('KeyA', 'KeyQ', 'ArrowLeft') + joystickInput.right;
    const forward = held('KeyW', 'KeyZ', 'ArrowUp') - held('KeyS', 'ArrowDown') + joystickInput.forward;
    const sprint = held('ShiftLeft', 'ShiftRight') || touchRun;
    const beforeX = position.x, beforeZ = position.z;
    let respawned = false;
    if (mode === 'glide' && dt > 0) {
      // Small physics steps keep curved paths and collisions consistent on
      // high-refresh displays and when an inexpensive phone draws fewer fps.
      const steps = Math.max(1, Math.ceil(dt * 120)), step = dt / steps;
      // The locked mouse pilots through the stick; the camera then simply
      // follows behind, a little above the wing.
      const piloting = pointerLocked();
      if (piloting) {
        targetPitch = GLIDE_LOOK_PITCH;
        const recentre = Math.exp(-0.7 * dt); stick.x *= recentre; stick.y *= recentre;
      }
      const brakes = piloting ? stickToGlide(stick) : { right: 0, forward: 0 };
      for (let i = 0; i < steps; i++) {
        const previousYaw = yaw;
        targetYaw = wrapAngle(targetYaw + clamp(right + brakes.right * 1.25, -1.25, 1.25) * GLIDER_CONFIG.turnRate * step);
        yaw = smoothLookAngle(yaw, targetYaw, step, 7);
        pitch += (targetPitch - pitch) * dampingAlpha(14, step);
        const turnSpeed = step > 0 ? wrapAngle(yaw - previousYaw) / step : 0;
        flightBank += (clamp(-turnSpeed * 0.62, -0.6, 0.6) - flightBank) * dampingAlpha(7, step);
        // Rockets: the launch burst first, then the throttle while held.
        let climb = 0;
        if (launchElapsed < GLIDER_LAUNCH.seconds) {
          launchElapsed += step; climb = launchVerticalSpeed(launchElapsed) + GLIDER_CONFIG.cruiseSink;
          flightVerticalSpeed = Math.max(flightVerticalSpeed, launchVerticalSpeed(launchElapsed));
        } else if (throttle) climb = GLIDER_THROTTLE.climbMetersPerSecond + GLIDER_CONFIG.cruiseSink;
        const result = stepGliderMotion({ terrain, state: { x: position.x, y: position.y, z: position.z, speedMetersPerSecond: flightSpeed, verticalSpeedMetersPerSecond: flightVerticalSpeed }, yaw, forward: clamp(forward + brakes.forward + (piloting ? 0 : lookToGlide(targetPitch)), -1, 1), brake: Boolean(sprint), speedMode: flightSpeedMode, climb, dt: step });
        position.set(result.x, result.y, result.z); flightSpeed = result.speedMetersPerSecond; flightVerticalSpeed = result.verticalSpeedMetersPerSecond;
        verticalVelocity = flightVerticalSpeed / scale;
        blocked = result.blocked; blockedReason = result.blockedReason;
        flightPitch += (Math.atan2(flightVerticalSpeed, flightSpeed) - flightPitch) * dampingAlpha(5, step);
        onGround = false;
        if (result.landed && launchElapsed >= .4) { respawned = result.landingReason === 'water'; finishFlight(result.landingReason); break; }
      }
      // Flames: big for the launch, steady for the throttle.
      const wanted = launchElapsed < GLIDER_LAUNCH.seconds ? 1.6 - .6 * launchElapsed / GLIDER_LAUNCH.seconds : throttle ? 1 : 0;
      thrust += (wanted - thrust) * dampingAlpha(12, dt);
      if (mode === 'glide') {
        stickView.hidden = !piloting; stickView.classList?.toggle('is-gas', thrust > .3);
        const kx = stick.x * 50, ky = stick.y * 50;
        stickLine.setAttribute('x2', kx.toFixed(1)); stickLine.setAttribute('y2', ky.toFixed(1));
        stickKnob.setAttribute('cx', kx.toFixed(1)); stickKnob.setAttribute('cy', ky.toFixed(1));
      }
    } else if (mode !== 'glide' && dt > 0) {
      yaw = smoothLookAngle(yaw, targetYaw, dt);
      pitch += (targetPitch - pitch) * dampingAlpha(36, dt);
      const movement = movementInWorld(right, forward, yaw);
      const speed = speedMode === 'run' || sprint ? PLAYER_SPEEDS.run : PLAYER_SPEEDS.walk;
      const rate = Math.hypot(right, forward) > 0.01 ? 15 : 23;
      const horizontalX = integrateDampedValue(velocityX, movement.x * speed, rate, dt);
      const horizontalZ = integrateDampedValue(velocityZ, movement.z * speed, rate, dt);
      velocityX = horizontalX.value; velocityZ = horizontalZ.value;
      const dx = horizontalX.integral / scale, dz = horizontalZ.integral / scale;
      if (onGround) {
        const result = traceGroundMovement({ terrain, x: position.x, z: position.z, dx, dz });
        position.x = result.x; position.z = result.z; blocked = result.blocked; blockedReason = result.blockedReason;
        position.y = Number.isFinite(result.height) ? result.height : position.y;
        verticalVelocity = 0;
      } else {
        // Folding the wing preserves altitude and resumes gravity, including
        // above the sea. Jumping uses the same swept collision without a foot
        // clearance margin, so short upward steps do not land immediately.
        const dy = verticalVelocity * dt - 0.5 * 9.81 / scale * dt * dt;
        verticalVelocity -= 9.81 / scale * dt;
        const result = traceFlightMovement({ terrain, x: position.x, y: position.y, z: position.z, dx, dy, dz, clearanceMeters: 0 });
        position.set(result.x, result.y, result.z); blocked = result.blocked; blockedReason = result.blockedReason;
        onGround = result.landed;
        if (onGround) {
          verticalVelocity = 0;
          if (!result.land) { restoreLastGround(); respawned = true; flightLanded = true; flightLandingReason = 'water'; notify(); }
        }
      }
      if (blocked && dt > 0) {
        // Do not store invisible velocity against a wall for the next frame.
        velocityX = (position.x - beforeX) * scale / dt;
        velocityZ = (position.z - beforeZ) * scale / dt;
      }
      flightBank += (0 - flightBank) * dampingAlpha(10, dt);
      flightPitch += (0 - flightPitch) * dampingAlpha(10, dt);
      if (onGround && terrainSample(terrain, position.x, position.z) !== null) lastSafeGround.copy(position);
    }
    // update(0) refreshes the safe camera after a tile rebuild. It must not
    // cancel a jump, report a fictitious stop, or emit a landing event.
    if (dt > 0) {
      speedMetersPerSecond = !respawned ? Math.hypot(position.x - beforeX, position.z - beforeZ) * scale / dt : 0;
      moving = speedMetersPerSecond > 0.015 || mode === 'glide';
    }
    if (avatar) {
      avatar.position.copy(position);
      if (moving || mode === 'fps') {
        const avatarYaw = avatarYawFor(mode, yaw, position.x - beforeX, position.z - beforeZ);
        const delta = Math.atan2(Math.sin(avatarYaw - avatar.rotation.y), Math.cos(avatarYaw - avatar.rotation.y));
        avatar.rotation.y += delta * dampingAlpha(15, dt);
      }
    }
    updateLookDirection();
    if (mode === 'fps') {
      eyeHeight = snapCamera || !Number.isFinite(eyeHeight) ? position.y + dimensions.eyeHeightMeters / scale : stabilizeEyeHeight(eyeHeight, position.y, dt, scale, dimensions.eyeHeightMeters);
      camera.position.copy(position); camera.position.y = eyeHeight;
      anchor.copy(camera.position).add(lookDirection); camera.lookAt(anchor);
      if (avatar) avatar.visible = false;
    } else {
      const gliding = mode === 'glide';
      anchor.copy(position); anchor.y += (gliding ? dimensions.thirdPersonFocusMeters + 0.5 : dimensions.thirdPersonFocusMeters) / scale;
      desiredCamera.copy(anchor).addScaledVector(lookDirection, -(gliding ? 9.5 : followDistanceMeters) / scale);
      if (gliding) desiredCamera.y += 1.2 / scale;
      const fraction = cameraTerrainFraction({ terrain, anchor, desired: desiredCamera, clearanceMeters: gliding ? 0.45 : 0.25 });
      safeCamera.copy(anchor).lerp(desiredCamera, fraction);
      if (snapCamera) camera.position.copy(safeCamera);
      else camera.position.lerp(safeCamera, dampingAlpha(gliding ? 9 : 12, dt));
      // A smoothed camera can itself pass through a ridge during a sharp turn.
      previousCamera.copy(camera.position);
      const safeFraction = cameraTerrainFraction({ terrain, anchor, desired: previousCamera });
      camera.position.copy(anchor).lerp(previousCamera, safeFraction);
      const cameraGround = terrain.heightAt(camera.position.x, camera.position.z);
      if (Number.isFinite(cameraGround)) camera.position.y = Math.max(camera.position.y, cameraGround + 0.25 / scale);
      camera.up.set(0, 1, 0); camera.lookAt(anchor);
      if (avatar) avatar.visible = camera.position.distanceTo(anchor) * scale > 0.75;
    }
    snapCamera = false;
    notificationTime += dt;
    if (notificationTime >= 0.12) { notificationTime = 0; notify(); }
    return getInfo();
  }
  function dispose() {
    if (disposed) return;
    resetKeys(); exitPointerLock(); disposed = true;
    cleanups.forEach(cleanup => cleanup()); controls.remove(); crosshair.remove(); stickView.remove(); style.remove();
    if (previousTabIndex === null) canvas.removeAttribute('tabindex'); else canvas.setAttribute('tabindex', previousTabIndex);
    delete container.dataset.playerMode;
  }
  updateLookDirection();
  return {
    setMode, getMode: () => mode, update, getInfo, teleport,
    getPosition: () => position.clone(), getHeading: () => compassHeading(yaw), getLookDirection: () => lookDirection.clone(),
    setSpeed, getSpeed: () => speedMode, setMorphology, setFlightSpeed, getFlightSpeed: () => flightSpeedMode, setTerrain, setEnabled, resetKeys, requestPointerLock, jump, toggleGlide, dispose
  };
}
