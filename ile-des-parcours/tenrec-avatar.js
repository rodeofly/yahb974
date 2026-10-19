import * as THREE from './vendor/three.module.js';

// Original, deliberately enlarged game character inspired by Tenrec ecaudatus.
// Dimensions and gait are illustrative; this is not a biological simulation.
// AnimationMixer / AnimationClip are provided by the vendored MIT Three.js.
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smoothstep = (min, max, value) => { const t = clamp((value - min) / (max - min), 0, 1); return t * t * (3 - 2 * t); };
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const LEG_UPPER = .115, LEG_LOWER = .09, HIP_HEIGHT = .235;
const LEG_NAMES = ['ForeLeft', 'ForeRight', 'HindLeft', 'HindRight'];
const CLIP_NAMES = ['idle', 'walk', 'run', 'jump', 'glide'];

export const TENREC_AVATAR_CONFIG = Object.freeze({
  species: 'Tenrec ecaudatus',
  commonName: 'Tangue',
  lengthMeters: 1.23,
  heightMeters: .65,
  runBlendStartMetersPerSecond: 5.5,
  runBlendEndMetersPerSecond: 8,
  walkStrideMeters: 1.8,
  runStrideMeters: 3.2,
  maxCadenceHz: 4.2,
  transitionSeconds: .1,
  harnessPositionMeters: Object.freeze([0, .60, -.025])
});

// Bake static pieces together, retaining per-vertex colours. Only articulated
// parts remain separate meshes: one torso, one head, and three per leg.
function mergeParts(parts) {
  const positions = [], normals = [], colours = [];
  const normalMatrix = new THREE.Matrix3(), p = new THREE.Vector3(), n = new THREE.Vector3();
  for (const part of parts) {
    const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...(part.position || [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation || [0, 0, 0]))),
      new THREE.Vector3(...(part.scale || [1, 1, 1]))
    );
    normalMatrix.getNormalMatrix(matrix);
    const sourcePositions = geometry.getAttribute('position'), sourceNormals = geometry.getAttribute('normal');
    const colour = new THREE.Color(part.colour || '#a87b4c');
    for (let i = 0; i < sourcePositions.count; i++) {
      p.fromBufferAttribute(sourcePositions, i).applyMatrix4(matrix);
      n.fromBufferAttribute(sourceNormals, i).applyMatrix3(normalMatrix).normalize();
      positions.push(p.x, p.y, p.z); normals.push(n.x, n.y, n.z);
      const shade = part.coat ? .88 + .12 * (n.y * .5 + .5) + .025 * Math.sin(p.z * 16 + p.x * 5) : 1;
      colours.push(colour.r * shade, colour.g * shade, colour.b * shade);
    }
    geometry.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  merged.computeBoundingBox(); merged.computeBoundingSphere();
  return merged;
}

// Analytic two-link leg pose. The keyframes keep planted paws level and lift
// their return stroke. All solving happens once while clips are constructed.
function solveLeg(z, drop, bend = 1) {
  const length = Math.hypot(z, drop), maxLength = LEG_UPPER + LEG_LOWER - .0005;
  if (length > maxLength) { z *= maxLength / length; drop *= maxLength / length; }
  const knee = bend * Math.acos(clamp((drop * drop + z * z - LEG_UPPER ** 2 - LEG_LOWER ** 2) / (2 * LEG_UPPER * LEG_LOWER), -1, 1));
  const hip = Math.atan2(-z, drop) - Math.atan2(LEG_LOWER * Math.sin(knee), LEG_UPPER + LEG_LOWER * Math.cos(knee));
  return { hip, knee, paw: -hip - knee };
}

function animationPose(name, t) {
  const pose = { lift: 0, pitch: 0, sway: 0, headPitch: 0, headYaw: 0, legs: [] };
  if (name === 'idle') {
    pose.lift = .0035 * (1 - Math.cos(TAU * t));
    pose.headPitch = -.035 + .018 * Math.sin(TAU * t);
    pose.headYaw = .07 * Math.sin(TAU * t);
    for (let i = 0; i < 4; i++) pose.legs.push(solveLeg(i < 2 ? .01 : -.012, .197, i < 2 ? 1 : -1));
  } else if (name === 'walk' || name === 'run') {
    const running = name === 'run';
    pose.lift = running ? .023 + .043 * (1 - Math.cos(TAU * t)) : .006 + .008 * (1 - Math.cos(TAU * t * 2));
    pose.pitch = running ? .075 * Math.sin(TAU * t) : .018 * Math.sin(TAU * t);
    pose.sway = (running ? .014 : .022) * Math.sin(TAU * t);
    pose.headPitch = -.035 - pose.pitch * .55;
    // Walking alternates diagonal pairs. The run changes to a small gallop:
    // hind paws gather first, then the forepaws reach into the next landing.
    const offsets = running ? [.06, .15, .54, .64] : [0, .5, .5, 0];
    for (let i = 0; i < 4; i++) {
      const phase = (t + offsets[i]) % 1;
      const planted = running ? .36 : .61;
      let z, lift;
      if (phase < planted) {
        z = (running ? .092 : .073) * (1 - 2 * phase / planted); lift = 0;
      } else {
        const swing = (phase - planted) / (1 - planted);
        z = (running ? .092 : .073) * (-1 + 2 * smoothstep(0, 1, swing));
        lift = (running ? .085 : .055) * Math.sin(Math.PI * swing);
      }
      // A slight bend remains even in extension; the lifted rig makes the
      // gallop visibly bouncy without moving the gameplay/collision root.
      pose.legs.push(solveLeg(z, .183 - lift, i < 2 ? 1 : -1));
    }
  } else if (name === 'jump') {
    const tuck = Math.sin(Math.PI * t);
    pose.pitch = -.16 + .29 * t; pose.headPitch = -pose.pitch * .45;
    pose.lift = .014 * tuck;
    for (let i = 0; i < 4; i++) pose.legs.push(solveLeg((i < 2 ? .025 : -.035) + (t - .5) * -.07, .19 - .065 * tuck, i < 2 ? 1 : -1));
  } else {
    pose.lift = .016 + .009 * Math.sin(TAU * t);
    pose.pitch = -.025 + .015 * Math.sin(TAU * t);
    pose.headPitch = -.055;
    for (let i = 0; i < 4; i++) pose.legs.push(solveLeg(i < 2 ? .067 : -.047, .155 + .008 * Math.sin(TAU * t + i), i < 2 ? 1 : -1));
  }
  return pose;
}

function createClips() {
  return CLIP_NAMES.map(name => {
    const duration = name === 'idle' ? 2.4 : name === 'glide' ? 1.8 : 1;
    const times = [], values = new Map();
    const push = (path, value) => { if (!values.has(path)) values.set(path, []); values.get(path).push(value); };
    // 32 samples suffice for small smooth limbs, without evaluating inverse
    // kinematics in the render loop. Loop endpoints share exactly one pose.
    for (let i = 0; i <= 32; i++) {
      const t = i === 32 && name !== 'jump' ? 0 : i / 32;
      const pose = animationPose(name, t); times.push(i / 32 * duration);
      push('TenrecRig.position[y]', pose.lift);
      push('TenrecRig.rotation[x]', pose.pitch);
      push('TenrecRig.rotation[z]', pose.sway);
      push('TenrecHead.rotation[x]', pose.headPitch);
      push('TenrecHead.rotation[y]', pose.headYaw);
      for (let leg = 0; leg < 4; leg++) {
        push(`${LEG_NAMES[leg]}Hip.rotation[x]`, pose.legs[leg].hip);
        push(`${LEG_NAMES[leg]}Knee.rotation[x]`, pose.legs[leg].knee);
        push(`${LEG_NAMES[leg]}Paw.rotation[x]`, pose.legs[leg].paw);
      }
    }
    return new THREE.AnimationClip(name, duration, [...values].map(([path, data]) => new THREE.NumberKeyframeTrack(path, times, data)));
  });
}

/** Avatar-local units are metres; +Z is forward and y=0 is ground contact.
 * The caller owns group.position/rotation/scale/visible and any attached wing
 * or shadow. The mixer only animates named descendants of TenrecRig.
 */
export function createTenrecAvatar() {
  const group = new THREE.Group(); group.name = 'Tangue — Tenrec ecaudatus';
  const rig = new THREE.Group(); rig.name = 'TenrecRig'; group.add(rig);
  const resources = { geometries: new Set(), materials: new Set() };
  const material = new THREE.MeshLambertMaterial({ vertexColors: true }); resources.materials.add(material);
  const sphere = new THREE.SphereGeometry(1, 12, 8), smallSphere = new THREE.SphereGeometry(1, 8, 6);
  const glintSphere = new THREE.SphereGeometry(1, 6, 4), cone = new THREE.ConeGeometry(1, 1, 4);
  const snout = new THREE.CylinderGeometry(.28, 1, 1, 8);
  const part = (geometry, position, scale, colour, rotation = [0, 0, 0], coat = false) => ({ geometry, position, scale, colour, rotation, coat });
  function mesh(name, parts, parent = rig) {
    const geometry = mergeParts(parts); resources.geometries.add(geometry);
    const result = new THREE.Mesh(geometry, material); result.name = name; parent.add(result); return result;
  }

  const bodyParts = [
    part(sphere, [0, .365, -.05], [.238, .224, .42], '#a77949', [0, 0, 0], true),
    part(sphere, [0, .365, .19], [.191, .187, .24], '#b48a56', [0, 0, 0], true)
  ];
  // Short backward-leaning tufts suggest a coarse coat. They are merged into
  // the torso, rather than represented by hundreds of separate hair objects.
  for (let row = 0; row < 7; row++) for (let col = 0; col < 7; col++) {
    const x = (col - 3) * .047, z = -.34 + row * .08 + (col % 2) * .014;
    const radial = 1 - (x / .238) ** 2 - ((z + .05) / .42) ** 2;
    if (radial < .17) continue;
    const y = .365 + .224 * Math.sqrt(radial);
    const size = .042 + .013 * ((row + col * 2) % 3);
    bodyParts.push(part(cone, [x, y + size * .27, z - size * .14], [.016, size, .022], (row + col) % 3 ? '#c29a63' : '#947043', [-.52, 0, -x * 1.2]));
  }
  mesh('TenrecCoat', bodyParts);

  const head = new THREE.Group(); head.name = 'TenrecHead'; head.position.set(0, .38, .33); rig.add(head);
  const headParts = [
    part(sphere, [0, .022, .046], [.145, .137, .17], '#b78b58', [0, 0, 0], true),
    part(snout, [0, -.029, .235], [.089, .278, .076], '#c49b6b', [Math.PI / 2 + .12, 0, 0]),
    part(smallSphere, [0, -.064, .377], [.036, .028, .035], '#44382c')
  ];
  for (const side of [-1, 1]) {
    headParts.push(
      part(smallSphere, [side * .128, .111, -.008], [.052, .061, .034], '#9c734c', [.10, side * -.3, side * -.28]),
      part(smallSphere, [side * .13, .112, .015], [.032, .041, .012], '#c59776', [.10, side * -.3, side * -.28]),
      part(smallSphere, [side * .113, .059, .125], [.034, .037, .031], '#2f291f', [0, side * .32, 0]),
      part(glintSphere, [side * .121, .075, .149], [.009, .011, .009], '#f3e6c4'),
      part(smallSphere, [side * .081, -.024, .148], [.045, .041, .065], '#c9a779')
    );
  }
  mesh('TenrecFace', headParts, head);

  for (let i = 0; i < 4; i++) {
    const side = i % 2 ? 1 : -1, fore = i < 2;
    const hip = new THREE.Group(); hip.name = `${LEG_NAMES[i]}Hip`;
    // Keep the joints inside the flank ellipsoids, including at full stride;
    // wider pivots made the outer hind thigh appear detached in oblique views.
    hip.position.set(side * (fore ? .137 : .145), HIP_HEIGHT, fore ? .255 : -.289); rig.add(hip);
    const knee = new THREE.Group(); knee.name = `${LEG_NAMES[i]}Knee`; knee.position.y = -LEG_UPPER; hip.add(knee);
    const paw = new THREE.Group(); paw.name = `${LEG_NAMES[i]}Paw`; paw.position.y = -LEG_LOWER; knee.add(paw);
    mesh(`${LEG_NAMES[i]}Upper`, [part(smallSphere, [0, -.054, 0], [fore ? .050 : .064, .075, .061], fore ? '#a27a4e' : '#967048', [0, 0, 0], true)], hip);
    mesh(`${LEG_NAMES[i]}Lower`, [part(smallSphere, [0, -.039, .002], [.035, .061, .038], '#ad875e')], knee);
    const paws = [part(smallSphere, [0, .001, .027], [.052, .031, .077], '#8c6b4e')];
    for (let claw = -1; claw <= 1; claw++) paws.push(part(cone, [claw * .022, -.002, .099], [.009, .036, .007], '#d8c2a1', [Math.PI / 2, 0, 0]));
    mesh(`${LEG_NAMES[i]}Foot`, paws, paw);
  }
  sphere.dispose(); smallSphere.dispose(); glintSphere.dispose(); cone.dispose(); snout.dispose();

  const attachment = new THREE.Object3D(); attachment.name = 'TenrecHarness';
  attachment.position.fromArray(TENREC_AVATAR_CONFIG.harnessPositionMeters); rig.add(attachment);
  const clips = createClips(); group.animations = clips;
  const mixer = new THREE.AnimationMixer(rig), actions = {};
  for (const clip of clips) {
    const action = mixer.clipAction(clip); actions[clip.name] = action;
    action.setEffectiveWeight(clip.name === 'idle' ? 1 : 0).play();
  }
  actions.jump.setEffectiveTimeScale(0);
  mixer.update(0);
  let state = 'idle', disposed = false, distanceMeters = 0, cadenceHz = 0, currentSpeed = 0;
  const weights = Object.fromEntries(CLIP_NAMES.map(name => [name, name === 'idle' ? 1 : 0]));
  const stats = { meshes: resources.geometries.size, triangles: 0 };
  resources.geometries.forEach(geometry => { stats.triangles += geometry.getAttribute('position').count / 3; });

  function update(deltaSeconds, playerInfo = {}) {
    if (disposed) return;
    const dt = clamp(finite(deltaSeconds), 0, .075);
    const flight = playerInfo.flight || {};
    const speed = clamp(finite(playerInfo.speedMetersPerSecond), 0, 40);
    const airborne = playerInfo.onGround === false, orbit = playerInfo.mode === 'orbit';
    const moving = !orbit && !airborne && !flight.active && playerInfo.moving !== false && speed > .035;
    const runMix = smoothstep(TENREC_AVATAR_CONFIG.runBlendStartMetersPerSecond, TENREC_AVATAR_CONFIG.runBlendEndMetersPerSecond, speed);
    const target = { idle: 0, walk: 0, run: 0, jump: 0, glide: 0 };
    if (flight.active) { target.glide = 1; state = 'glide'; }
    else if (airborne && !orbit) { target.jump = 1; state = 'jump'; }
    else if (moving) {
      const amount = smoothstep(.035, .35, speed);
      target.idle = 1 - amount; target.walk = amount * (1 - runMix); target.run = amount * runMix;
      state = runMix >= .5 ? 'run' : 'walk';
    } else { target.idle = 1; state = 'idle'; }

    const blend = 1 - Math.exp(-dt / TENREC_AVATAR_CONFIG.transitionSeconds);
    for (const name of CLIP_NAMES) {
      weights[name] += (target[name] - weights[name]) * blend;
      actions[name].setEffectiveWeight(weights[name]);
    }
    const stride = TENREC_AVATAR_CONFIG.walkStrideMeters + (TENREC_AVATAR_CONFIG.runStrideMeters - TENREC_AVATAR_CONFIG.walkStrideMeters) * runMix;
    cadenceHz = moving ? Math.min(TENREC_AVATAR_CONFIG.maxCadenceHz, speed / stride) : 0;
    actions.walk.setEffectiveTimeScale(cadenceHz); actions.run.setEffectiveTimeScale(cadenceHz);
    // Both gait clips keep a shared phase, including through a speed change.
    // The jump pose follows ascent/apex/descent, rather than repeatedly looping
    // the takeoff clip throughout a long jump.
    if (target.jump) actions.jump.time = clamp(.5 - finite(flight.verticalSpeedMetersPerSecond) / 22, 0, 1);
    if (moving) distanceMeters += speed * dt;
    currentSpeed = speed;
    mixer.update(dt);
  }
  function getInfo() {
    return {
      species: TENREC_AVATAR_CONFIG.species, commonName: TENREC_AVATAR_CONFIG.commonName,
      state, cadenceHz, phase: actions.walk.time, distanceMeters, speedMetersPerSecond: currentSpeed,
      weights: { ...weights }, meshes: stats.meshes, triangles: stats.triangles,
      animationSystem: 'Three.js AnimationMixer', clips: [...CLIP_NAMES], disposed
    };
  }
  function dispose() {
    if (disposed) return;
    disposed = true; mixer.stopAllAction(); mixer.uncacheRoot(rig);
    resources.geometries.forEach(geometry => geometry.dispose());
    resources.materials.forEach(ownedMaterial => ownedMaterial.dispose());
    // Leave the caller's root, shadow and wing intact; only our rig is owned.
    rig.removeFromParent(); group.animations = [];
  }
  return { group, attachment, update, getInfo, dispose };
}
