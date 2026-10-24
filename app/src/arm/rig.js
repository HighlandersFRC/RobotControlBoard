import { Group, MathUtils, Vector3 } from 'three';

const radians = MathUtils.degToRad;
export const JOINTS = [
  { name: 'Turntable', axis: 'y', min: radians(-180), max: radians(180) },
  { name: 'Shoulder', axis: 'z', min: radians(-90), max: radians(60) },
  { name: 'Elbow', axis: 'z', min: radians(-90), max: radians(90) },
  { name: 'Wrist', axis: 'y', min: radians(-60), max: radians(60) },
];

// CAD exports use metres, Z up, and a shared assembly origin at the base top.
// Hinge heights come from the circular bearing faces in the supplied models.
export const CAD = Object.freeze({
  scale: 50,
  baseBottom: -0.0509,
  shoulder: 0.042544,
  elbow: 0.161802,
  forearmSocket: 0.163834,
  forearmTop: 0.223647,
  toolHeight: 0.55,
});

export function clampAngle(value, index) {
  const joint = JOINTS[index];
  if (!joint || !Number.isFinite(value)) return null;
  return MathUtils.clamp(value, joint.min, joint.max);
}

export function createRig() {
  const root = new Group();
  root.name = 'BUDX';
  root.position.y = -CAD.baseBottom * CAD.scale;
  const pivots = JOINTS.map(({ name }, index) => {
    const pivot = new Group();
    pivot.name = name;
    pivot.userData.jointIndex = index;
    return pivot;
  });
  root.add(pivots[0]);
  pivots[0].add(pivots[1]);
  pivots[1].position.y = CAD.shoulder * CAD.scale;
  pivots[1].add(pivots[2]);
  pivots[2].position.y = (CAD.elbow - CAD.shoulder) * CAD.scale;
  pivots[2].add(pivots[3]);
  pivots[3].position.y = (CAD.forearmTop - CAD.forearmSocket) * CAD.scale;

  const mounts = ['base', 'turntable', 'arm', 'joint'].map(name => {
    const mount = new Group();
    mount.name = `${name} CAD mount`;
    mount.scale.setScalar(CAD.scale);
    mount.rotation.x = -Math.PI / 2;
    return mount;
  });
  root.add(mounts[0]);
  pivots[0].add(mounts[1]);
  pivots[1].add(mounts[2]);
  mounts[2].position.y = -CAD.shoulder * CAD.scale;
  pivots[2].add(mounts[3]);
  mounts[3].position.y = -CAD.forearmSocket * CAD.scale;

  const tip = new Group();
  tip.name = 'Tool center';
  tip.position.y = CAD.toolHeight;
  pivots[3].add(tip);
  const listeners = new Set();

  const rig = {
    root, pivots, mounts, tip,
    getAngles: () => pivots.map((pivot, index) => pivot.rotation[JOINTS[index].axis]),
    setAngles(angles, source = 'manual') {
      let changed = false;
      pivots.forEach((pivot, index) => {
        const value = clampAngle(angles[index], index);
        if (value === null || Math.abs(value - pivot.rotation[JOINTS[index].axis]) < 1e-9) return;
        pivot.rotation[JOINTS[index].axis] = value;
        changed = true;
      });
      if (changed) {
        root.updateMatrixWorld(true);
        listeners.forEach(listener => listener(rig.getAngles(), source));
      }
      return changed;
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    toolPosition: () => { root.updateMatrixWorld(true); return tip.getWorldPosition(new Vector3()); },
  };
  root.updateMatrixWorld(true);
  return rig;
}
