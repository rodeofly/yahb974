import * as THREE from './vendor/three.module.js';

// A small cloth wing in avatar-local metres. The parent avatar supplies the
// common metric scale; the sail adds no terrain or gameplay collision surface.
export function createGliderVisual(avatar, { harnessHeightMeters = .54, wingHeightMeters = 1.68, halfSpanMeters = 1.85 } = {}) {
  const group=new THREE.Group();group.name='Planeur en toile';group.visible=false;
  const positions=[],colours=[],indices=[];
  const panels=[new THREE.Color('#df9252'),new THREE.Color('#edc978'),new THREE.Color('#f2dda0'),new THREE.Color('#d88455'),new THREE.Color('#d88455'),new THREE.Color('#f2dda0'),new THREE.Color('#edc978'),new THREE.Color('#df9252')];
  const halfSpan=halfSpanMeters,segments=8;
  function surface(x,rear){const arch=1-(x/halfSpan)**2;return new THREE.Vector3(x,wingHeightMeters+arch*.34-(rear ? .1 : 0),rear?-.64:.72);}
  for(let i=0;i<segments;i++){
    const x0=-halfSpan+i*halfSpan*2/segments,x1=x0+halfSpan*2/segments;
    const points=[surface(x0,false),surface(x1,false),surface(x0,true),surface(x1,true)],base=positions.length/3;
    for(const p of points){positions.push(p.x,p.y,p.z);colours.push(panels[i].r,panels[i].g,panels[i].b);}
    indices.push(base,base+2,base+1,base+1,base+2,base+3);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const cloth=new THREE.Mesh(geometry,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}));group.add(cloth);
  const threadPoints=[];
  const line=(a,b)=>threadPoints.push(a.x,a.y,a.z,b.x,b.y,b.z);
  for(let i=0;i<=segments;i++){const x=-halfSpan+i*halfSpan*2/segments;line(surface(x,false),surface(x,true));if(i<segments){const next=x+halfSpan*2/segments;line(surface(x,false),surface(next,false));line(surface(x,true),surface(next,true));}}
  for(const side of [-1,1]){const harness=new THREE.Vector3(side*.17,harnessHeightMeters,.08);line(harness,surface(side*halfSpan*.77,false));line(harness,surface(side*halfSpan*.77,true));}
  const threads=new THREE.BufferGeometry();threads.setAttribute('position',new THREE.Float32BufferAttribute(threadPoints,3));group.add(new THREE.LineSegments(threads,new THREE.LineBasicMaterial({color:'#776448'})));
  avatar.add(group);
  function update(flight){group.visible=!!flight?.active;group.rotation.z=flight?.active?-(flight.bank||0)*.25:0;group.rotation.x=flight?.active?Math.max(-.14,Math.min(.14,flight.pitch||0))*.5:0;}
  function dispose(){group.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose();});group.removeFromParent();}
  return {group,update,dispose};
}
