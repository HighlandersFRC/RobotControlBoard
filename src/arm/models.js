import { BoxGeometry, CylinderGeometry, Mesh, MeshStandardMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

export async function loadModels(rig, onProgress) {
  const base = import.meta.env.BASE_URL;
  const decoder = new DRACOLoader();
  decoder.setDecoderPath(`${base}draco/`);
  decoder.setDecoderConfig({ type: 'wasm' });
  const loader = new GLTFLoader().setDRACOLoader(decoder);
  let loaded = 0;
  try {
    // Stage the complete assembly before attaching anything, including on retry.
    const results = await Promise.allSettled(['base', 'turntable', 'arm', 'joint'].map(async name => {
      const { scene } = await loader.loadAsync(`${base}models/${name}.gltf`);
      scene.traverse(object => {
        if (!object.isMesh) return;
        object.castShadow = object.receiveShadow = true;
        const source = Array.isArray(object.material) ? object.material : [object.material];
        const materials = source.map(material => {
          const copy = material.clone();
          copy.color.set(name === 'base' ? '#292c30' : name === 'turntable' ? '#303338' : '#36393d');
          copy.roughness = .56;
          copy.metalness = .18;
          return copy;
        });
        object.material = Array.isArray(object.material) ? materials : materials[0];
      });
      onProgress?.(++loaded);
      return scene;
    }));
    if (results.some(result => result.status === 'rejected')) {
      results.forEach(result => { if (result.status === 'fulfilled') disposeObject(result.value); });
      throw new Error('A model part could not be loaded. Check your connection and try again.');
    }
    results.forEach((result, index) => rig.mounts[index].add(result.value));
    addWristTool(rig.pivots[3]);
    rig.root.updateMatrixWorld(true);
  } finally {
    decoder.dispose();
  }
}

function addWristTool(wrist) {
  // The repo has four CAD parts but no wrist tool. A small flange makes the
  // fourth axis visible; its bearing stays centered as the tool rolls.
  const steel = new MeshStandardMaterial({ color: '#414448', metalness: .18, roughness: .56 });
  const dark = new MeshStandardMaterial({ color: '#292c30', metalness: .18, roughness: .56 });
  const bearing = new Mesh(new CylinderGeometry(.43, .43, .18, 32), dark);
  bearing.position.y = .09;
  const flange = new Mesh(new CylinderGeometry(.57, .57, .13, 32), steel);
  flange.position.y = .245;
  const tool = new Mesh(new BoxGeometry(.8, .24, .25), steel);
  tool.position.y = .43;
  wrist.add(bearing, flange, tool);
  wrist.traverse(object => { if (object.isMesh) object.castShadow = object.receiveShadow = true; });
}

export function disposeObject(root) {
  const geometries = new Set();
  const materials = new Set();
  root.traverse(object => {
    if (!object.isMesh) return;
    geometries.add(object.geometry);
    (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}
