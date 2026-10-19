// Pure geometry for the Fil d'Ariane trails: no Three.js, testable in Node.
// World units follow the terrain (1 unit = 100 m, X east, Z south); distances
// along a trail are kept in metres because the riddles and fiches speak metres.

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

const cumulative = (points, metersPerUnit) => {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z) * metersPerUnit);
  return cum;
};
// Uniform cubic B-spline over the OSM vertices, segment i (between vertices i
// and i + 1); phantom end vertices make it start and end on the trail's ends.
function bspline(points, i, t) {
  const b = points[i], c = points[i + 1];
  const a = points[i - 1] || { x: 2 * b.x - c.x, z: 2 * b.z - c.z }, d = points[i + 2] || { x: 2 * c.x - b.x, z: 2 * c.z - b.z };
  const u = 1 - t, w0 = u * u * u / 6, w1 = (3 * t * t * t - 6 * t * t + 4) / 6, w2 = (-3 * t * t * t + 3 * t * t + 3 * t + 1) / 6, w3 = t * t * t / 6;
  return { x: a.x * w0 + b.x * w1 + c.x * w2 + d.x * w3, z: a.z * w0 + b.z * w1 + c.z * w2 + d.z * w3 };
}

// `smooth`: the OSM polyline (simplified to 3 m, so all corners) becomes a
// rounded B-spline, sampled every `stepM` metres at most: positions then move
// at a constant speed along a curve without corners. `remap` turns a distance
// measured along the OSM polyline (the stages', the fiches') into one along the
// curve, `unmap` does the reverse; `rawLength` is the OSM length.
export function prepareTrail(lonLat, { geoToWorld, metersPerUnit }, { smooth = false, stepM = 4 } = {}) {
  const raw = lonLat.map(([lon, lat]) => { const p = geoToWorld(lon, lat); return { x: p.x, z: p.z }; });
  const rawCum = cumulative(raw, metersPerUnit);
  const rawLength = rawCum.at(-1) || 0, same = s => clamp(s, 0, rawLength);
  if (!smooth || raw.length < 3) return { points: raw, cum: rawCum, length: rawLength, rawLength, metersPerUnit, remap: same, unmap: same };
  const points = [], starts = [];
  for (let i = 0; i < raw.length - 1; i++) {
    starts.push(points.length);
    // As many samples as the curve (not the chord) is long, with some margin
    // because the spline does not run at an even pace within a segment.
    let curve = 0, last = bspline(raw, i, 0);
    for (let k = 1; k <= 8; k++) { const p = bspline(raw, i, k / 8); curve += Math.hypot(p.x - last.x, p.z - last.z) * metersPerUnit; last = p; }
    const n = Math.max(1, Math.ceil(curve * 1.5 / stepM));
    for (let k = 0; k < n; k++) points.push(bspline(raw, i, k / n));
  }
  starts.push(points.length); points.push({ ...raw.at(-1) });
  const cum = cumulative(points, metersPerUnit), knots = starts.map(j => cum[j]);
  // Piecewise linear between matching vertices, both ways.
  const convert = (from, to) => s => {
    s = clamp(s, 0, from.at(-1));
    const i = Math.min(segmentAt({ cum: from }, s), from.length - 2), t = (s - from[i]) / (from[i + 1] - from[i] || 1);
    return to[i] + (to[i + 1] - to[i]) * t;
  };
  return { points, cum, length: cum.at(-1), rawLength, metersPerUnit, remap: convert(rawCum, knots), unmap: convert(knots, rawCum) };
}

function segmentAt(trail, s) {
  const { cum } = trail;
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
  return lo;
}

// Position and heading (radians, 0 = north, clockwise) at s metres.
export function pointAtDistance(trail, s) {
  const { points, cum } = trail;
  if (points.length === 1) return { x: points[0].x, z: points[0].z, heading: 0, s: 0 };
  s = clamp(s, 0, trail.length);
  const i = Math.min(segmentAt(trail, s), points.length - 2);
  const a = points[i], b = points[i + 1], span = cum[i + 1] - cum[i] || 1e-9;
  const t = clamp((s - cum[i]) / span, 0, 1);
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading: Math.atan2(b.x - a.x, -(b.z - a.z)), s };
}

export function nearestOnTrail(trail, x, z) {
  const { points, cum, metersPerUnit } = trail;
  let best = { s: 0, distanceM: Infinity };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], dx = b.x - a.x, dz = b.z - a.z, ll = dx * dx + dz * dz || 1e-12;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / ll, 0, 1);
    const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z) * metersPerUnit;
    if (d < best.distanceM) best = { s: cum[i] + (cum[i + 1] - cum[i]) * t, distanceM: d };
  }
  return best;
}

// Evenly spaced samples (metres) that always keep the trail's own vertices,
// so the draped ribbon never cuts a hairpin bend.
export function resampleDistances(trail, stepM) {
  const out = [];
  for (let i = 0; i < trail.cum.length - 1; i++) {
    const a = trail.cum[i], b = trail.cum[i + 1], n = Math.max(1, Math.ceil((b - a) / stepM));
    for (let k = 0; k < n; k++) out.push(a + (b - a) * k / n);
  }
  out.push(trail.length);
  return out;
}

// Gain and loss from the exact IGN samples (not the displayed mesh), with a
// small hysteresis so 25 m grid noise does not inflate the totals.
export function elevationProfile(trail, sampleMeters, { stepM = 25, thresholdM = 3 } = {}) {
  const samples = [];
  for (let s = 0; s < trail.length; s += stepM) { const p = pointAtDistance(trail, s); samples.push({ s, m: sampleMeters(p.x, p.z) }); }
  const end = pointAtDistance(trail, trail.length); samples.push({ s: trail.length, m: sampleMeters(end.x, end.z) });
  const valid = samples.filter(p => Number.isFinite(p.m));
  let gain = 0, loss = 0, ref = valid[0]?.m ?? 0;
  for (const { m } of valid) {
    if (m - ref > thresholdM) { gain += m - ref; ref = m; }
    else if (ref - m > thresholdM) { loss += ref - m; ref = m; }
  }
  const heights = valid.map(p => p.m);
  return { gain: Math.round(gain), loss: Math.round(loss), min: Math.round(Math.min(...heights)), max: Math.round(Math.max(...heights)), start: Math.round(heights[0] ?? 0), end: Math.round(heights.at(-1) ?? 0), samples: valid };
}

// Walkers in single file behind the leader, the way a guided group keeps to
// a narrow path. Returns the distance along the trail of each walker.
export function formation(leaderS, count, spacingM) {
  return Array.from({ length: count }, (_, i) => leaderS - i * spacingM);
}

// Next stage strictly ahead of `fromS` that the walk should stop at.
export function nextStage(stages, fromS, toS) {
  return stages.find(stage => stage.distanceM > fromS + .01 && stage.distanceM <= toS + .01) || null;
}

export function formatKm(metres) {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;
}
