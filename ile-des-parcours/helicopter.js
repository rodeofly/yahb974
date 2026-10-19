import * as THREE from './vendor/three.module.js';

// The explorers' helicopter that ferries the troop to a stage: a friendly
// low-poly model in metres, nose towards -Z, skids at y = 0. Ten small meshes,
// shown only during a transfer; the rotors spin while it is visible.
export function createHelicopter({ colour = '#f2a93b', trim = '#fffdf6' } = {}) {
  const group = new THREE.Group(); group.name = 'Hélicoptère des explorateurs';
  const body = new THREE.MeshLambertMaterial({ color: colour }), white = new THREE.MeshLambertMaterial({ color: trim });
  const dark = new THREE.MeshLambertMaterial({ color: '#2b3a40' }), glass = new THREE.MeshLambertMaterial({ color: '#3d7d96', emissive: '#10343f' });
  const add = (geometry, material, position, rotation = [0, 0, 0], scale = [1, 1, 1]) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position); mesh.rotation.set(...rotation); mesh.scale.set(...scale); group.add(mesh); return mesh;
  };
  add(new THREE.SphereGeometry(1, 16, 12), body, [0, 1.75, 0], [0, 0, 0], [1.35, 1.25, 2.3]);
  add(new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI * .55), glass, [0, 1.95, -1.15], [-1.1, 0, 0], [1.12, 1.05, 1.15]);
  add(new THREE.BoxGeometry(2.72, .26, 3.2), white, [0, 1.3, .1]);
  add(new THREE.CylinderGeometry(.14, .32, 5.4, 10), body, [0, 2.05, 4.2], [Math.PI / 2, 0, 0]);
  add(new THREE.BoxGeometry(.16, 1.5, 1.1), white, [0, 2.65, 6.6], [-.25, 0, 0]);
  for (const side of [-1, 1]) {
    add(new THREE.CylinderGeometry(.08, .08, 4.2, 6), dark, [side * 1.15, .08, -.2], [Math.PI / 2, 0, 0]);
    for (const z of [-1, .7]) add(new THREE.CylinderGeometry(.06, .06, .9, 5), dark, [side * 1.0, .5, z], [0, 0, side * -.35]);
  }
  add(new THREE.CylinderGeometry(.12, .12, .6, 8), dark, [0, 3.15, 0]);
  const rotor = add(new THREE.BoxGeometry(10.5, .06, .42), dark, [0, 3.45, 0]);
  rotor.add(new THREE.Mesh(new THREE.BoxGeometry(.42, .06, 10.5), dark));
  const tailRotor = add(new THREE.BoxGeometry(.06, 2.1, .22), dark, [.18, 2.7, 6.75]);
  let spin = 0;
  function update(dt, { rotorSpeed = 1 } = {}) {
    spin += dt * 28 * rotorSpeed;
    rotor.rotation.y = spin; tailRotor.rotation.x = spin * 1.6;
  }
  function dispose() { group.traverse(o => { o.geometry?.dispose(); }); [body, white, dark, glass].forEach(m => m.dispose()); group.removeFromParent(); }
  return { group, update, dispose, lengthMeters: 12, doorOffset: new THREE.Vector3(1.7, 0, -.2) };
}
