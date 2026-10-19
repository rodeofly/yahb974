import * as THREE from './vendor/three.module.js';

// Screen-space decluttering is deliberately independent of narrative rules.
// It hides labels behind the camera, behind the MNT and behind other labels.
export function createDynamicLabels({ container, camera, terrain, onSelect = () => {} }) {
  const layer = document.createElement('div');
  layer.className = 'world-dynamic-labels';
  layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:3;';
  container.appendChild(layer);
  const records = new Map();
  const projected = new THREE.Vector3(), target = new THREE.Vector3();
  const previousCamera = new THREE.Vector3(Infinity, Infinity, Infinity);
  const previousDirection = new THREE.Vector3(), direction = new THREE.Vector3();
  let labelMode = 'auto', selected = null, hovered = null, lastCompute = -Infinity, stillSince = 0;
  let lastMode = 'orbit', width = 1, height = 1, activeCount = 0;
  const metersPerUnit = terrain.metersPerUnit || 100;

  function clear() { for (const rec of records.values()) rec.el.remove(); records.clear(); }
  function setRecords(items) {
    clear();
    for (const item of items) {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'world-place-label'; el.setAttribute('aria-label', `Voir ${item.name}`);
      el.style.cssText = 'position:absolute;left:0;top:0;opacity:0;visibility:hidden;pointer-events:none;transform:translate(-50%,-100%);border:1px solid rgba(255,255,255,.32);border-radius:5px;padding:5px 8px;background:rgba(18,39,39,.82);color:#f9f7e9;font:500 11px/1.25 system-ui,sans-serif;letter-spacing:.01em;white-space:nowrap;box-shadow:0 2px 8px rgba(6,20,23,.12);transition:opacity .22s ease,background .2s;cursor:pointer;max-width:225px;overflow:hidden;text-overflow:ellipsis;';
      el.textContent = item.name;
      el.addEventListener('pointerenter', () => { hovered = item.id; lastCompute = -Infinity; });
      el.addEventListener('pointerleave', () => { hovered = null; lastCompute = -Infinity; });
      el.addEventListener('click', event => { event.stopPropagation(); selected = item.id; lastCompute = -Infinity; onSelect(item); });
      layer.appendChild(el);
      records.set(item.id, { ...item, el, active: false, opacity: 0, boxWidth: Math.min(225, Math.max(65, item.name.length * 5.8 + 18)), screenX: 0, screenY: 0 });
    }
    lastCompute = -Infinity;
  }
  function setMode(mode) { labelMode = ['auto', 'all', 'off'].includes(mode) ? mode : 'auto'; lastCompute = -Infinity; }
  function setCurrent(id) { selected = id; lastCompute = -Infinity; }
  function resize(w, h) { width = w; height = h; lastCompute = -Infinity; }

  function occluded(point) {
    const distance = camera.position.distanceTo(point);
    const step = Math.max(.25, terrain.sourceResolutionM / metersPerUnit || .25);
    const samples = Math.min(160, Math.max(8, Math.ceil(distance / (step * 8))));
    // Exclude both endpoints: this avoids treating the player's own ground or
    // the mountain carrying the label as an intervening obstacle.
    for (let i = 2; i < samples; i++) {
      const t = i / samples;
      const x = camera.position.x + (point.x - camera.position.x) * t;
      const z = camera.position.z + (point.z - camera.position.z) * t;
      const y = camera.position.y + (point.y - camera.position.y) * t;
      if (terrain.isLand(x, z) && terrain.heightAt(x, z) > y + Math.max(.006, distance * .00002)) return true;
    }
    return false;
  }

  function update(now, mode = 'orbit', player, moving = false) {
    camera.getWorldDirection(direction);
    const cameraChanged = previousCamera.distanceToSquared(camera.position) > .00003 || previousDirection.distanceToSquared(direction) > .00008;
    if (cameraChanged || moving) stillSince = now;
    previousCamera.copy(camera.position); previousDirection.copy(direction);
    const justMoving = now - stillSince < 200;
    if (now - lastCompute < (justMoving ? 75 : 160) && mode === lastMode) return;
    lastCompute = now; lastMode = mode;
    const candidates = [];
    for (const rec of records.values()) {
      rec.wanted = false;
      if (labelMode === 'off' || rec.enabled === false || (rec.type === 'player' && mode !== 'orbit')) continue;
      const p = typeof rec.getPosition === 'function' ? rec.getPosition() : rec.position;
      if (!p) continue;
      target.set(p.x, terrain.heightAt(p.x, p.z) + .035, p.z);
      const distance = camera.position.distanceTo(target);
      const actualTarget = target.clone();
      target.y += mode === 'orbit' ? Math.min(6, distance * .01) : Math.max(.025, Math.min(.4, distance * .006));
      projected.copy(target).project(camera);
      const sx = (projected.x * .5 + .5) * width, sy = (-projected.y * .5 + .5) * height;
      const half = rec.boxWidth / 2;
      const topMargin = width < 700 ? 140 : 92, bottomMargin = width < 700 ? 150 : 90;
      if (projected.z < -1 || projected.z > 1 || sx < half + 16 || sx > width - half - 16 || sy < topMargin || sy > height - bottomMargin) continue;
      if (occluded(actualTarget)) continue;
      const focus = rec.id === selected, hover = rec.id === hovered;
      const near = player ? Math.hypot(player.x - p.x, player.z - p.z) * metersPerUnit : distance * metersPerUnit;
      // At eye height a distant forest of labels is deliberately suppressed.
      if (labelMode === 'auto' && mode !== 'orbit' && near > 7500 && !focus && !hover) continue;
      const score = (hover ? 1000 : 0) + (focus ? 800 : 0) + (rec.priority || 0) + (rec.active ? 12 : 0) - distance * .05 - Math.abs(sx - width / 2) * .035;
      rec.screenX = sx; rec.screenY = sy;
      candidates.push({ rec, score, focus, hover, sx, sy, half, near });
    }
    candidates.sort((a, b) => b.score - a.score);
    const accepted = [];
    const panelRect=container.getBoundingClientRect();
    const reserved=[...container.parentElement.querySelectorAll('.terrain-settings:not([hidden]),.flight-instruments:not([hidden])')].map(el=>{
      const r=el.getBoundingClientRect();return {left:r.left-panelRect.left-8,right:r.right-panelRect.left+8,top:r.top-panelRect.top-8,bottom:r.bottom-panelRect.top+8};
    });
    const maxCount = labelMode === 'all' ? width < 600 ? 10 : 20 : width < 600 ? 3 : 5;
    for (const item of candidates) {
      if (accepted.length >= maxCount) break;
      const box = { left: item.sx - item.half - 8, right: item.sx + item.half + 8, top: item.sy - 35, bottom: item.sy + 8 };
      if (reserved.some(other => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)) continue;
      if (accepted.some(other => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)) continue;
      item.rec.wanted = true;
      item.rec.targetOpacity = item.focus || item.hover ? 1 : labelMode === 'auto' && justMoving ? .2 : .86;
      item.rec.el.style.left = `${item.sx.toFixed(1)}px`; item.rec.el.style.top = `${item.sy.toFixed(1)}px`;
      item.rec.el.style.background = item.focus ? 'rgba(113,87,34,.94)' : 'rgba(18,39,39,.82)';
      item.rec.el.style.zIndex = item.focus || item.hover ? '2' : '1';
      item.rec.el.title = `${item.rec.name}${Number.isFinite(item.near) ? ` · ${(item.near / 1000).toFixed(1)} km` : ''}`;
      accepted.push(box);
    }
    activeCount = accepted.length;
    for (const rec of records.values()) {
      rec.active = rec.wanted;
      rec.el.style.transition = rec.wanted ? 'opacity .22s ease,visibility 0s,background .2s' : 'opacity .22s ease,visibility 0s .22s,background .2s';
      rec.el.style.opacity = rec.wanted ? String(rec.targetOpacity) : '0';
      rec.el.style.visibility = rec.wanted ? 'visible' : 'hidden';
      rec.el.style.pointerEvents = rec.wanted && rec.targetOpacity > .5 ? 'auto' : 'none';
      rec.el.tabIndex = rec.wanted ? 0 : -1;
    }
  }
  function dispose() { clear(); layer.remove(); }
  return { setRecords, setMode, setCurrent, resize, update, dispose, getInfo: () => ({ mode: labelMode, count: activeCount, total: records.size }) };
}
