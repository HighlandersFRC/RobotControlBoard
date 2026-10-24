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
          copy.userData.armFinish = name === 'base' ? 'base' : name === 'turntable' ? 'turntable' : 'body';
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
    addClawTool(rig);
    rig.root.updateMatrixWorld(true);
  } finally {
    decoder.dispose();
  }
}

function addClawTool(rig) {
  // A procedural two-jaw tool represents the replacement claw, independent of
  // the supplied arm CAD. Opening the jaws does not rotate the old wrist axis.
  const steel = new MeshStandardMaterial();
  const dark = new MeshStandardMaterial();
  steel.userData.armFinish = 'tool';
  dark.userData.armFinish = 'bearing';
  const bearing = new Mesh(new CylinderGeometry(.43, .43, .18, 32), dark);
  bearing.position.y = .09;
  const flange = new Mesh(new CylinderGeometry(.57, .57, .13, 32), steel);
  flange.position.y = .245;
  rig.pivots[3].add(bearing, flange);
  rig.clawJaws.forEach((jaw, index) => {
    const finger = new Mesh(new BoxGeometry(.15, .6, .3), steel);
    finger.position.y = .56;
    const pad = new Mesh(new BoxGeometry(.18, .15, .32), dark);
    pad.position.set(index === 0 ? .07 : -.07, .79, 0);
    jaw.add(finger, pad);
  });
  rig.pivots[3].traverse(object => { if (object.isMesh) object.castShadow = object.receiveShadow = true; });
}

export function applyModelTheme(root, style) {
  const token = name => style.getPropertyValue(`--arm-${name}`).trim();
  root.traverse(object => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const finish = material.userData.armFinish;
      if (!finish) continue;
      material.color.set(token(finish));
      material.metalness = Number(token('metalness'));
      material.roughness = Number(token('roughness')) + (finish === 'base' || finish === 'bearing' ? .04 : 0);
    }
  });
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
