import { MathUtils, Vector3 } from 'three';
import { CAD, JOINTS, clampAngle } from './rig.js';

const upperLength = (CAD.elbow - CAD.shoulder) * CAD.scale;
const lowerLength = (CAD.forearmTop - CAD.forearmSocket) * CAD.scale + CAD.toolHeight;

export function planarTip(shoulder, elbow) {
  return {
    x: -upperLength * Math.sin(shoulder) - lowerLength * Math.sin(shoulder + elbow),
    y: upperLength * Math.cos(shoulder) + lowerLength * Math.cos(shoulder + elbow),
  };
}

export function solveTarget(target, currentAngles = [0, 0, 0, 0]) {
  if (![target.x, target.y, target.z].every(Number.isFinite)) return [...currentAngles];
  const radius = Math.hypot(target.x, target.z);
  const height = target.y - (CAD.shoulder - CAD.baseBottom) * CAD.scale;
  const cosine = MathUtils.clamp((radius ** 2 + height ** 2 - upperLength ** 2 - lowerLength ** 2) / (2 * upperLength * lowerLength), -1, 1);
  let best;
  let bestError = Infinity;
  for (const bend of [-Math.acos(cosine), Math.acos(cosine)]) {
    let shoulder = clampAngle(Math.atan2(height, radius) - Math.atan2(lowerLength * Math.sin(bend), upperLength + lowerLength * Math.cos(bend)) - Math.PI / 2, 1);
    let elbow = clampAngle(bend, 2);
    // Refine the limited solution instead of assuming every ground point is reachable.
    for (let iteration = 0; iteration < 40; iteration++) {
      for (const index of [2, 1]) {
        const pivot = index === 2 ? { x: -upperLength * Math.sin(shoulder), y: upperLength * Math.cos(shoulder) } : { x: 0, y: 0 };
        const tip = planarTip(shoulder, elbow);
        const vx = tip.x - pivot.x, vy = tip.y - pivot.y;
        const wx = radius - pivot.x, wy = height - pivot.y;
        const delta = Math.atan2(vx * wy - vy * wx, vx * wx + vy * wy);
        if (index === 2) elbow = clampAngle(elbow + delta, 2);
        else shoulder = clampAngle(shoulder + delta, 1);
      }
    }
    const tip = planarTip(shoulder, elbow);
    const error = Math.hypot(tip.x - radius, tip.y - height);
    if (error < bestError) {
      bestError = error;
      best = [radius < 1e-8 ? currentAngles[0] : clampAngle(Math.atan2(-target.z, target.x), 0), shoulder, elbow, currentAngles[3]];
    }
  }
  return best.map((value, index) => MathUtils.clamp(value, JOINTS[index].min, JOINTS[index].max));
}

export function targetError(rig, target) {
  return rig.toolPosition().distanceTo(new Vector3(target.x, target.y, target.z));
}
