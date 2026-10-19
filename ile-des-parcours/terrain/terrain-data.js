/**
 * Real IGN RGE ALTI terrain. All sampling is deterministic and measured in metres.
 * Geometry samples retain their absolute altitude; the display scale is 100 m/u.
 * The 25 m extraction is NOT a claim of 25 m vertical accuracy or 1 m detail.
 */
const D2R = Math.PI / 180;
const A = 6378137;
const E2 = 0.006694380022900787; // GRS80 ellipsoid, RGR92 / EPSG:2975.
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;
const CENTRAL_MERIDIAN = 57 * D2R;
const cache = new Map();

/** Geographic lon/lat (degrees) to EPSG:2975 easting/northing (metres).
 * RGR92 and WGS84 are treated as coincident at this 25 m display resolution.
 * Series expansion is valid in Reunion's UTM zone; not a global CRS engine.
 */
export function lonLatToUtm(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new TypeError('Finite longitude and latitude required');
  const phi = lat * D2R, lambda = lon * D2R;
  const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
  const n = A / Math.sqrt(1 - E2 * sin * sin);
  const t = tan * tan, c = EP2 * cos * cos, aa = cos * (lambda - CENTRAL_MERIDIAN);
  const m = A * ((1 - E2/4 - 3*E2*E2/64 - 5*E2**3/256)*phi
    - (3*E2/8 + 3*E2*E2/32 + 45*E2**3/1024)*Math.sin(2*phi)
    + (15*E2*E2/256 + 45*E2**3/1024)*Math.sin(4*phi)
    - 35*E2**3/3072*Math.sin(6*phi));
  return {
    easting: 500000 + K0*n*(aa + (1-t+c)*aa**3/6 + (5-18*t+t*t+72*c-58*EP2)*aa**5/120),
    northing: 10000000 + K0*(m+n*tan*(aa*aa/2 + (5-t+9*c+4*c*c)*aa**4/24 + (61-58*t+t*t+600*c-330*EP2)*aa**6/720)),
  };
}

/** EPSG:2975 metres to geographic longitude/latitude, inverse UTM series. */
export function utmToLonLat(easting, northing) {
  const x = easting - 500000, y = northing - 10000000;
  const m = y / K0;
  const mu = m / (A*(1-E2/4-3*E2*E2/64-5*E2**3/256));
  const e1 = (1-Math.sqrt(1-E2))/(1+Math.sqrt(1-E2));
  const phi1 = mu + (3*e1/2-27*e1**3/32)*Math.sin(2*mu)
    + (21*e1*e1/16-55*e1**4/32)*Math.sin(4*mu)
    + 151*e1**3/96*Math.sin(6*mu) + 1097*e1**4/512*Math.sin(8*mu);
  const s = Math.sin(phi1), c = Math.cos(phi1), t = Math.tan(phi1);
  const n1 = A/Math.sqrt(1-E2*s*s), r1 = A*(1-E2)/(1-E2*s*s)**1.5;
  const t1 = t*t, c1 = EP2*c*c, d = x/(n1*K0);
  const lat = phi1 - n1*t/r1*(d*d/2-(5+3*t1+10*c1-4*c1*c1-9*EP2)*d**4/24
    +(61+90*t1+298*c1+45*t1*t1-252*EP2-3*c1*c1)*d**6/720);
  const lon = CENTRAL_MERIDIAN + (d-(1+2*t1+c1)*d**3/6
    +(5-2*c1+28*t1-3*c1*c1+8*EP2+24*t1*t1)*d**5/120)/c;
  return { lon: lon/D2R, lat: lat/D2R };
}

// A phone on Wi-Fi may lose a connection in the middle of a large file and
// wait forever: a part that stops progressing is aborted and fetched again.
async function fetchBinary(url, onProgress, { stallMs = 15000, attempts = 4 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return await fetchOnce(url, onProgress, stallMs); }
    catch (error) {
      if (attempt >= attempts) throw error;
      onProgress?.({ loaded: 0, total: 0, phase: 'terrain', retry: attempt });
      await new Promise(resolve => setTimeout(resolve, 600 * attempt));
    }
  }
}
async function fetchOnce(url, onProgress, stallMs) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let watchdog = 0;
  const arm = () => { clearTimeout(watchdog); if (controller) watchdog = setTimeout(() => controller.abort(), stallMs); };
  arm();
  const response = await fetch(url, controller ? { signal: controller.signal } : undefined).finally(() => clearTimeout(watchdog));
  if (!response.ok) throw new Error(`Terrain IGN indisponible (${response.status})`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body) return response.arrayBuffer();
  const reader = response.body.getReader(), chunks = [];
  let loaded = 0;
  arm();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      arm();
      chunks.push(value); loaded += value.byteLength;
      onProgress?.({ loaded, total, phase: 'terrain' });
    }
  } finally { clearTimeout(watchdog); }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

/** Hosts that serve only text may carry the grid as base64 parts. */
export function decodeBase64(text) {
  const binary = atob(String(text).replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
async function fetchPart(url, onProgress, encoding) {
  if (encoding !== 'base64') return fetchBinary(url, onProgress);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Terrain IGN indisponible (${response.status})`);
  const buffer = decodeBase64(await response.text());
  onProgress?.({ loaded: buffer.byteLength, total: 0, phase: 'terrain' });
  return buffer;
}

/** Build sampler without networking (also used by reproducibility checks).
 * @param {object} metadata JSON sidecar generated by fetch_reunion.py.
 * @param {ArrayBuffer|Uint8Array} buffer raw little-endian uint16 elevations.
 * @param {object} [options] overview=true expects the optional 100 m subset.
 */
export function createTerrain(metadata, buffer, { overview = false, variant = overview ? 'overview' : null } = {}) {
  const spec = variant ? metadata[variant] : metadata;
  const width = spec.width, height = spec.height;
  const bytes = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset+buffer.byteLength);
  if (bytes.byteLength !== width*height*2) throw new Error(`Grille IGN tronquée: ${bytes.byteLength} octets, ${width*height*2} attendus`);
  const dataView = new DataView(bytes);
  const heights = new Float32Array(width*height);
  const enc = metadata.encoding;
  for (let i=0; i<heights.length; i++) {
    const code = dataView.getUint16(i*2, true);
    heights[i] = code === enc.nodata ? NaN : code*enc.scaleM+enc.offsetM;
  }
  const { west, east, north, south } = metadata.bounds;
  const { originEasting, originNorthing, metersPerUnit } = metadata.world;
  const unitsPerMeter = 1/metersPerUnit;
  const cellSizeM = variant ? spec.sampleSpacingM : metadata.sampleSpacingM;
  const bounds = {
    minX: (west-originEasting)*unitsPerMeter,
    maxX: (east-originEasting)*unitsPerMeter,
    minZ: (originNorthing-north)*unitsPerMeter,
    maxZ: (originNorthing-south)*unitsPerMeter,
  };

  const gridPosition = (x,z) => ({
    col: (x*metersPerUnit+originEasting-west)/cellSizeM,
    row: (north-originNorthing+z*metersPerUnit)/cellSizeM,
  });

  /** Bilinear interpolation of the neighbouring measured grid values.
   * NODATA is preserved: if the nearest sample is missing, the result is NaN.
   * On the boundary, only valid neighbouring samples contribute to interpolation.
   */
  function sampleMeters(x, z) {
    const {col, row} = gridPosition(x,z);
    if (!Number.isFinite(col) || !Number.isFinite(row) || col<0 || row<0 || col>width-1 || row>height-1) return NaN;
    if (!Number.isFinite(heights[Math.round(row)*width+Math.round(col)])) return NaN;
    const c0 = Math.floor(col), r0 = Math.floor(row), c1 = Math.min(width-1,c0+1), r1 = Math.min(height-1,r0+1);
    const tx = col-c0, tz = row-r0;
    const h00 = heights[r0*width+c0], h10 = heights[r0*width+c1];
    const h01 = heights[r1*width+c0], h11 = heights[r1*width+c1];
    if (Number.isFinite(h00+h10+h01+h11)) {
      return (h00*(1-tx)+h10*tx)*(1-tz)+(h01*(1-tx)+h11*tx)*tz;
    }
    let sum=0, weight=0;
    const pairs = [[h00,(1-tx)*(1-tz)], [h10,tx*(1-tz)], [h01,(1-tx)*tz], [h11,tx*tz]];
    for (const [v,w] of pairs) if (Number.isFinite(v) && w>0) { sum+=v*w; weight+=w; }
    return weight>0 ? sum/weight : NaN;
  }

  function heightAt(x,z) {
    const metres = sampleMeters(x,z);
    return Number.isFinite(metres) ? metres*unitsPerMeter : 0;
  }
  function geoToWorld(lon,lat) {
    const { easting,northing } = lonLatToUtm(lon,lat);
    const x=(easting-originEasting)*unitsPerMeter, z=(originNorthing-northing)*unitsPerMeter;
    return {x, y:heightAt(x,z), z};
  }
  function worldToGeo(x,z) {
    return utmToLonLat(x*metersPerUnit+originEasting, originNorthing-z*metersPerUnit);
  }
  const terrain = {
    width, height, heights, bounds, metadata, cellSizeM, metersPerUnit, unitsPerMeter,
    sourceResolutionM: cellSizeM, sampleSpacingM: cellSizeM,
    heightAt, sampleHeight: heightAt, sampleMeters, geoToWorld, lonLatToWorld:geoToWorld,
    fromLonLat:geoToWorld, worldToGeo, gridPosition,
    hasData: (x,z) => Number.isFinite(sampleMeters(x,z)),
    isLand: (x,z) => { const m=sampleMeters(x,z); return Number.isFinite(m) && m>=0; },
    // Mask is derived from terrain altitude; this is not a surveyed coastline layer.
    landMaskNote: 'Valid elevation >= 0 m; NODATA remains a separate unavailable-data state.',
  };
  terrain.landmarks = (metadata.landmarks || []).map(p => ({...p,...geoToWorld(p.lon,p.lat)}));
  return terrain;
}

/** Load bundled terrain: the 25 m grid, or lite=true for the 50 m grid (4 MB,
 * phones and slow connections), or overview=true for the 100 m, 1 MB subset. */
export function loadTerrain({ onProgress, overview = false, lite = false } = {}) {
  const key = overview ? 'overview' : lite ? 'lite' : 'full';
  if (!cache.has(key)) {
    const task = (async () => {
      const response = await fetch(new URL('./metadata.json',import.meta.url));
      if (!response.ok) throw new Error(`Métadonnées IGN indisponibles (${response.status})`);
      const metadata = await response.json();
      // Grids come as ordered parts: small files survive a flaky connection.
      const variant = key === 'full' ? null : key in metadata ? key : null;
      const spec = variant ? metadata[variant] : metadata;
      const filenames = spec.parts || [spec.file];
      const parts = [];
      let received = 0;
      for (const filename of filenames) {
        const part = await fetchPart(new URL(filename,import.meta.url), onProgress && (p => onProgress({ ...p, loaded: received + p.loaded })), spec.partsEncoding || (variant ? undefined : metadata.partsEncoding));
        parts.push(new Uint8Array(part)); received += part.byteLength;
      }
      const bytes = parts.length === 1 ? parts[0] : new Uint8Array(received);
      if (parts.length > 1) { let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; } }
      return createTerrain(metadata,bytes,{variant});
    })();
    cache.set(key, task);
    task.catch(() => cache.delete(key));
  }
  return cache.get(key);
}
