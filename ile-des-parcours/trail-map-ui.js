import { THEME_COLORS } from './trail-layer.js';

// The trail's technical corner, top right, like a strategy game's minimap:
// an IGN-style map (hillshade, contour lines every 100 m and bolder every
// 500 m, sea, main rivers, the trail as a red dashed line with its stages,
// the troop and the camera's field of view; a click sends the strategy view
// there) and the trail's cross-section (altitude against distance, stages,
// the troop's position, a readout under the pointer). The relief is drawn
// once per trail from the IGN grid; the live layer four times a second.

const SIZE = 232, PROFILE_H = 104;
const ALTITUDE_TINTS = [[0, [238, 243, 224]], [700, [231, 236, 210]], [1400, [236, 228, 205]], [2200, [231, 220, 206]], [3100, [246, 243, 238]]];
const lerp = (a, b, t) => a + (b - a) * t;
const km = m => `${(m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;

function tint(h) {
  for (let i = 1; i < ALTITUDE_TINTS.length; i++) {
    const [h1, c1] = ALTITUDE_TINTS[i], [h0, c0] = ALTITUDE_TINTS[i - 1];
    if (h <= h1) { const t = Math.max(0, (h - h0) / (h1 - h0)); return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)]; }
  }
  return ALTITUDE_TINTS.at(-1)[1];
}

export function initTrailMap(world, { hud }) {
  const box = document.createElement('section'); box.className = 'trail-map'; box.setAttribute('aria-label', 'Carte et profil du sentier');
  box.innerHTML = `<header><span class="trail-map-title">Carte · relief IGN</span><button type="button" class="trail-map-fold" aria-expanded="true" title="Replier la carte">−</button></header>
    <div class="trail-map-body">
      <div class="trail-map-frame"><canvas class="trail-map-relief" aria-hidden="true"></canvas><canvas class="trail-map-live" title="Cliquer pour y aller"></canvas><span class="trail-map-scale"></span></div>
      <div class="trail-map-profile" hidden><div class="trail-map-profile-head"><span>Profil en coupe</span><span class="trail-map-readout"></span></div><canvas aria-label="Profil d’altitude du sentier"></canvas></div>
    </div>`;
  hud.append(box);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const relief = box.querySelector('.trail-map-relief'), live = box.querySelector('.trail-map-live'), scale = box.querySelector('.trail-map-scale');
  const profileBox = box.querySelector('.trail-map-profile'), profileCanvas = profileBox.querySelector('canvas'), readout = box.querySelector('.trail-map-readout');
  for (const c of [relief, live]) { c.width = c.height = SIZE * dpr; c.style.width = c.style.height = `${SIZE}px`; }
  profileCanvas.width = SIZE * dpr; profileCanvas.height = PROFILE_H * dpr; profileCanvas.style.width = `${SIZE}px`; profileCanvas.style.height = `${PROFILE_H}px`;
  let region = null, trail = null, progress = 0, hover = null, timer = 0;

  // The square of world units shown: the trail and its surroundings, or the island.
  function regionFor(profile) {
    const map = world.getMapSource(), b = map.bounds;
    if (!profile) { const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 1.04, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2; return { x0: cx - span / 2, z0: cz - span / 2, span }; }
    const xs = profile.points.map(p => p.x), zs = profile.points.map(p => p.z);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 3000 / map.metersPerUnit) * 1.3;
    return { x0: cx - span / 2, z0: cz - span / 2, span };
  }
  const toPixel = (x, z) => [(x - region.x0) / region.span * SIZE * dpr, (z - region.z0) / region.span * SIZE * dpr];

  function drawRelief() {
    const map = world.getMapSource(), n = SIZE * dpr, cell = region.span * map.metersPerUnit / n;
    const heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const m = map.sampleMeters(region.x0 + (i + .5) / n * region.span, region.z0 + (j + .5) / n * region.span);
      heights[j * n + i] = Number.isFinite(m) && m > 0 ? m : -1;
    }
    const g = relief.getContext('2d'), image = g.createImageData(n, n), px = image.data;
    const L = [-.5, .7071, -.5], ll = Math.hypot(...L);
    // Contour interval to the scale: 100 m on a trail, wider on the whole island.
    const step = cell <= 30 ? 100 : cell <= 80 ? 250 : 500, bold = step * 5;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, h = heights[k], o = k * 4;
      if (h < 0) {
        // Sea, a little darker along the coast.
        const coast = (i > 0 && heights[k - 1] >= 0) || (i < n - 1 && heights[k + 1] >= 0) || (j > 0 && heights[k - n] >= 0) || (j < n - 1 && heights[k + n] >= 0);
        px.set(coast ? [96, 150, 190, 255] : [206, 230, 242, 255], o); continue;
      }
      const at = (di, dj) => { const v = heights[Math.min(n - 1, Math.max(0, j + dj)) * n + Math.min(n - 1, Math.max(0, i + di))]; return v < 0 ? h : v; };
      const dx = (at(1, 0) - at(-1, 0)) / (2 * cell), dz = (at(0, 1) - at(0, -1)) / (2 * cell), nl = Math.hypot(dx, 1, dz);
      const shade = Math.max(0, (-dx * L[0] + L[1] - dz * L[2]) / (nl * ll));
      const [r, gr, bl] = tint(h), lit = .62 + .5 * shade;
      let c = [r * lit, gr * lit, bl * lit];
      // Contour lines: thin every 100 m, bolder every 500 m (IGN brown).
      const right = at(1, 0), down = at(0, 1);
      if (Math.floor(h / bold) !== Math.floor(right / bold) || Math.floor(h / bold) !== Math.floor(down / bold)) c = c.map((v, q) => lerp(v, [140, 92, 50][q], .75));
      else if (Math.floor(h / step) !== Math.floor(right / step) || Math.floor(h / step) !== Math.floor(down / step)) c = c.map((v, q) => lerp(v, [176, 128, 82][q], .4));
      px.set([c[0], c[1], c[2], 255], o);
    }
    g.putImageData(image, 0, 0);
    // Main rivers in blue.
    g.strokeStyle = '#3f86c4'; g.lineWidth = 1.1 * dpr; g.lineJoin = 'round';
    for (const line of map.rivers || []) {
      g.beginPath(); line.forEach((p, i) => { const [x, y] = toPixel(p.x, p.z); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke();
    }
    // Scale bar text: the width of the map.
    const width = region.span * map.metersPerUnit;
    scale.textContent = `← ${width >= 2000 ? km(width) : `${Math.round(width)} m`} →`;
  }

  function drawLive() {
    const g = live.getContext('2d'), n = SIZE * dpr; g.clearRect(0, 0, n, n);
    if (trail) {
      // The trail: a white halo under the IGN red dashes.
      const path = () => { g.beginPath(); trail.points.forEach((p, i) => { const [x, y] = toPixel(p.x, p.z); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); };
      g.lineJoin = 'round'; g.lineCap = 'round';
      path(); g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 4 * dpr; g.setLineDash([]); g.stroke();
      path(); g.strokeStyle = '#d6282b'; g.lineWidth = 2.2 * dpr; g.setLineDash([5 * dpr, 3 * dpr]); g.stroke(); g.setLineDash([]);
      trail.stages.forEach((stage, i) => {
        const [x, y] = toPixel(stage.x, stage.z);
        g.beginPath(); g.arc(x, y, (stage.type === 'enigme' ? 5.5 : 6.5) * dpr, 0, Math.PI * 2);
        g.fillStyle = THEME_COLORS[stage.theme || stage.type] || '#204d40'; g.fill(); g.lineWidth = 1.5 * dpr; g.strokeStyle = '#fff'; g.stroke();
        g.fillStyle = '#fff'; g.font = `bold ${7 * dpr}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(stage.type === 'depart' ? '⚑' : stage.type === 'arrivee' ? '★' : String(i), x, y + .5 * dpr);
      });
    }
    const state = world.getMinimapState();
    // The camera's field of view, as in a strategy game.
    const cam = state.camera, [cx, cy] = toPixel(cam.x, cam.z), mpu = world.getMapSource().metersPerUnit;
    if (cx > 0 && cx < n && cy > 0 && cy < n && cam.height * mpu < 20000) {
      const reach = Math.min(n * .9, Math.max(14 * dpr, (cam.height * 4) / region.span * n));
      g.beginPath(); g.moveTo(cx, cy);
      for (const side of [-1, 1]) { const a = cam.yaw + side * cam.fov / 2; g.lineTo(cx + Math.sin(a) * reach, cy - Math.cos(a) * reach); }
      g.closePath(); g.fillStyle = 'rgba(255,255,255,.28)'; g.fill(); g.strokeStyle = 'rgba(32,77,64,.7)'; g.lineWidth = 1 * dpr; g.stroke();
    }
    if (state.leader) {
      const [x, y] = toPixel(state.leader.x, state.leader.z), pulse = 1 + .25 * Math.sin(performance.now() / 250);
      g.beginPath(); g.arc(x, y, 7 * dpr * pulse, 0, Math.PI * 2); g.fillStyle = 'rgba(255,213,74,.35)'; g.fill();
      g.beginPath(); g.arc(x, y, 4 * dpr, 0, Math.PI * 2); g.fillStyle = '#ffb000'; g.fill(); g.lineWidth = 1.6 * dpr; g.strokeStyle = '#3c2512'; g.stroke();
    }
  }

  function drawProfile() {
    const g = profileCanvas.getContext('2d'), W = SIZE * dpr, H = PROFILE_H * dpr; g.clearRect(0, 0, W, H);
    if (!trail?.samples.length) return;
    const left = 30 * dpr, right = 6 * dpr, top = 12 * dpr, bottom = 16 * dpr;
    const lo = Math.min(...trail.samples.map(p => p.m)), hi = Math.max(...trail.samples.map(p => p.m));
    const step = hi - lo > 1200 ? 500 : hi - lo > 500 ? 200 : 100, y0 = Math.floor(lo / step) * step, y1 = Math.ceil(hi / step) * step || y0 + step;
    const X = s => left + s / trail.length * (W - left - right), Y = m => top + (1 - (m - y0) / (y1 - y0)) * (H - top - bottom);
    // Grid and altitude labels.
    g.font = `${8 * dpr}px system-ui, sans-serif`; g.fillStyle = '#6d8771'; g.textAlign = 'right'; g.textBaseline = 'middle'; g.strokeStyle = 'rgba(32,77,64,.12)'; g.lineWidth = 1;
    for (let m = y0; m <= y1; m += step) { g.beginPath(); g.moveTo(left, Y(m)); g.lineTo(W - right, Y(m)); g.stroke(); g.fillText(`${m}`, left - 3 * dpr, Y(m)); }
    // The cross-section, filled like a slice of the island.
    const gradient = g.createLinearGradient(0, top, 0, H - bottom); gradient.addColorStop(0, '#c99a5b'); gradient.addColorStop(1, '#e8efd9');
    g.beginPath(); g.moveTo(X(0), H - bottom); trail.samples.forEach(p => g.lineTo(X(p.s), Y(p.m))); g.lineTo(X(trail.length), H - bottom); g.closePath();
    g.fillStyle = gradient; g.fill();
    g.beginPath(); trail.samples.forEach((p, i) => (i ? g.lineTo(X(p.s), Y(p.m)) : g.moveTo(X(p.s), Y(p.m)))); g.strokeStyle = '#6b4a2e'; g.lineWidth = 1.6 * dpr; g.stroke();
    // Distance labels.
    g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = '#6d8771';
    for (const s of [0, trail.length / 2, trail.length]) g.fillText(km(s), Math.min(W - 14 * dpr, Math.max(left + 10 * dpr, X(s))), H - 3 * dpr);
    const altitudeAt = s => { const i = Math.max(1, trail.samples.findIndex(p => p.s >= s)), a = trail.samples[i - 1], b = trail.samples[Math.min(i, trail.samples.length - 1)]; return a && b ? lerp(a.m, b.m, (s - a.s) / ((b.s - a.s) || 1)) : lo; };
    // Stages along the way.
    trail.stages.forEach((stage, i) => {
      const x = X(stage.s), y = Y(altitudeAt(stage.s));
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, top - 2 * dpr); g.strokeStyle = 'rgba(32,77,64,.25)'; g.lineWidth = 1; g.stroke();
      g.beginPath(); g.arc(x, y, 3.2 * dpr, 0, Math.PI * 2); g.fillStyle = THEME_COLORS[stage.theme || stage.type] || '#204d40'; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1 * dpr; g.stroke();
      if (stage.type === 'enigme') { g.fillStyle = '#204d40'; g.font = `bold ${7 * dpr}px system-ui, sans-serif`; g.fillText(String(i), x, top - 3 * dpr); }
    });
    // The troop, and the pointer.
    const mark = (s, colour) => { const x = X(s); g.beginPath(); g.moveTo(x, top); g.lineTo(x, H - bottom); g.strokeStyle = colour; g.lineWidth = 1.4 * dpr; g.stroke(); g.beginPath(); g.arc(x, Y(altitudeAt(s)), 4 * dpr, 0, Math.PI * 2); g.fillStyle = colour; g.fill(); };
    mark(Math.min(trail.length, Math.max(0, progress)), '#ffb000');
    if (hover != null) mark(hover, 'rgba(32,77,64,.75)');
    const shown = hover ?? progress;
    readout.textContent = `${km(shown)} · ${Math.round(altitudeAt(shown)).toLocaleString('fr-FR')} m`;
    drawProfile.toDistance = clientX => { const r = profileCanvas.getBoundingClientRect(); return Math.min(trail.length, Math.max(0, ((clientX - r.left) * dpr - left) / (W - left - right) * trail.length)); };
  }

  function setTrail(id) {
    trail = id ? world.trails.getProfile?.(id) : null; hover = null;
    region = regionFor(trail); profileBox.hidden = !trail;
    box.querySelector('.trail-map-title').textContent = trail ? 'Carte · relief IGN · sentier' : 'Carte · relief IGN';
    drawRelief(); drawLive(); drawProfile();
  }
  function setProgress(s) { progress = s; drawProfile(); }

  live.addEventListener('click', event => {
    const r = live.getBoundingClientRect();
    world.focusMapPoint?.(region.x0 + (event.clientX - r.left) / r.width * region.span, region.z0 + (event.clientY - r.top) / r.height * region.span);
  });
  profileCanvas.addEventListener('pointermove', event => { if (trail && drawProfile.toDistance) { hover = drawProfile.toDistance(event.clientX); drawProfile(); } });
  profileCanvas.addEventListener('pointerleave', () => { hover = null; drawProfile(); });
  box.querySelector('.trail-map-fold').addEventListener('click', event => {
    const folded = box.classList.toggle('is-folded');
    event.currentTarget.textContent = folded ? '+' : '−'; event.currentTarget.setAttribute('aria-expanded', String(!folded));
  });
  // The live layer, four times a second; out of the way during the big jump.
  const tick = () => {
    const jumping = world.getView?.().view === 'skydive';
    box.hidden = jumping;
    if (!jumping && !box.classList.contains('is-folded')) drawLive();
    timer = setTimeout(tick, 250);
  };
  setTrail(null); tick();
  return { setTrail, setProgress, refresh: () => { if (region) drawRelief(); }, dispose() { clearTimeout(timer); box.remove(); } };
}
