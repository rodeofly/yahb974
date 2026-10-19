import * as THREE from './vendor/three.module.js';

// The blend between two views (wolf, helicopter, panorama, a member's eyes…): the camera glides from its old pose to
// the new one by interpolating three things together, the position, the point it looks at (its target, on the ground)
// and the field of view, and keeps aiming at that moving target. Before, the orientation turned on its own while the
// position moved: going down from the helicopter to the wolf, the gaze swept across the landscape.

const FORWARD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);

/**
 * The point of the ground (or of the sea, at y = 0) a camera looks at: where its line of sight first meets the
 * relief, found by growing steps then bisection. Looking at the sky: a point `fallbackM` metres ahead.
 */
export function focusOf(position, quaternion, heightAt, { metersPerUnit = 1, maxM = 60000, fallbackM = 800 } = {}) {
  const dir = FORWARD.clone().applyQuaternion(quaternion);
  const at = m => position.clone().addScaledVector(dir, m / metersPerUnit);
  const below = p => p.y <= Math.max(0, heightAt(p.x, p.z));
  let before = 0;
  for (let m = 1; m <= maxM; m *= 1.08) {
    if (below(at(m))) {
      let lo = before, hi = m;
      for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (below(at(mid))) hi = mid; else lo = mid; }
      return at(hi);
    }
    before = m;
  }
  return at(fallbackM);
}

/**
 * The in-between pose at progress u (0 → 1). `from` and `to`: { position, quaternion, focus, fov }. The position
 * stays above the relief (a straight line from the helicopter to the wolf would go through a ridge); the
 * camera aims at the interpolated focus; near the end, the view's exact orientation (roll included) takes over.
 */
export function blendPose(from, to, u, heightAt, { metersPerUnit = 1, clearanceM = 3 } = {}) {
  const position = from.position.clone().lerp(to.position, u);
  // Height above the ground kept on the way: the views' own heights (a wolf's eye is 1 m up), at most `clearanceM`.
  const above = p => Math.max(0, p.y - Math.max(0, heightAt(p.x, p.z)));
  const keep = Math.min(clearanceM / metersPerUnit, above(from.position) + (above(to.position) - above(from.position)) * u);
  const floor = Math.max(0, heightAt(position.x, position.z)) + keep;
  if (position.y < floor) position.y = floor;
  const focus = from.focus.clone().lerp(to.focus, u);
  const sight = focus.clone().sub(position);
  let quaternion;
  if (sight.lengthSq() < 1e-12 || Math.abs(sight.normalize().y) > .995) {
    // Looking straight down (or up): no stable heading to aim with, so turn as before.
    quaternion = from.quaternion.clone().slerp(to.quaternion, u);
  } else {
    quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(position, focus, UP));
    quaternion.slerp(to.quaternion, u ** 4);
  }
  return { position, focus, quaternion, fov: from.fov + (to.fov - from.fov) * u };
}
