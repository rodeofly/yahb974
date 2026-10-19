/**
 * ESA WorldCover 2021 class-10 area fractions, aligned to the IGN terrain.
 * Values describe classified wooded area, not individual trees or crown density.
 */
let loadPromise;

/** Decode the small uint8 cover grid without network access. */
export function createForestCover(metadata, buffer) {
  const {width,height,bounds}=metadata;
  if (!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2) {
    throw new Error('Dimensions du masque de couvert arboré invalides');
  }
  if (!bounds || !Number.isFinite(bounds.minX+bounds.maxX+bounds.minZ+bounds.maxZ)
      || bounds.minX>=bounds.maxX || bounds.minZ>=bounds.maxZ) {
    throw new Error('Emprise du masque de couvert arboré invalide');
  }
  let data;
  if (buffer instanceof Uint8Array) data=new Uint8Array(buffer.buffer,buffer.byteOffset,buffer.byteLength);
  else if (buffer instanceof ArrayBuffer) data=new Uint8Array(buffer);
  else throw new TypeError('Un tableau Uint8Array ou un ArrayBuffer est requis');
  if(data.byteLength!==width*height)throw new Error(`Masque arboré tronqué : ${data.byteLength} octets, ${width*height} attendus`);
  const invWidth=(width-1)/(bounds.maxX-bounds.minX);
  const invHeight=(height-1)/(bounds.maxZ-bounds.minZ);
  /** Bilinear display sampling. Returns zero outside measured grid bounds. */
  function sampleAt(x,z) {
    if (!Number.isFinite(x)||!Number.isFinite(z)||x<bounds.minX||x>bounds.maxX||z<bounds.minZ||z>bounds.maxZ) return 0;
    const col=(x-bounds.minX)*invWidth,row=(z-bounds.minZ)*invHeight;
    const c0=Math.floor(col),r0=Math.floor(row),c1=Math.min(width-1,c0+1),r1=Math.min(height-1,r0+1);
    const tx=col-c0,tz=row-r0;
    const a=data[r0*width+c0]*(1-tx)+data[r0*width+c1]*tx;
    const b=data[r1*width+c0]*(1-tx)+data[r1*width+c1]*tx;
    return (a*(1-tz)+b*tz)/255;
  }
  return {width,height,data,bounds:{...bounds},sampleAt,metadata,
    sampleSpacingM:metadata.sampleSpacingM,observationYear:metadata.observationYear};
}

/** Load the bundled historical tree-cover mask (about 2 MB). */
export function loadForestCover() {
  if(!loadPromise) {
    loadPromise=(async()=>{
      const response=await fetch(new URL('./forest-metadata.json',import.meta.url));
      if(!response.ok)throw new Error(`Métadonnées arborées indisponibles (${response.status})`);
      const metadata=await response.json();
      const binary=await fetch(new URL(metadata.file,import.meta.url));
      if(!binary.ok)throw new Error(`Couvert arboré indisponible (${binary.status})`);
      // A text-only host receives the mask as base64 (fileEncoding).
      if(metadata.fileEncoding==='base64'){const {decodeBase64}=await import('./terrain-data.js');return createForestCover(metadata,decodeBase64(await binary.text()));}
      return createForestCover(metadata,await binary.arrayBuffer());
    })();
    loadPromise.catch(()=>{loadPromise=undefined;});
  }
  return loadPromise;
}
