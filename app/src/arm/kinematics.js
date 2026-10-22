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

export function solveTarget(target, currentAngles = [0, 0, 0, 0], { continuous = false } = {}) {
  if (![target.x, target.y, target.z].every(Number.isFinite)) return [...currentAngles];
  const radius = Math.hypot(target.x, target.z);
  const height = target.y - (CAD.shoulder - CAD.baseBottom) * CAD.scale;
  const cosine = MathUtils.clamp((radius ** 2 + height ** 2 - upperLength ** 2 - lowerLength ** 2) / (2 * upperLength * lowerLength), -1, 1);
  let best;
  let bestError = Infinity;
  let bestMovement = Infinity;
  // The tool can lie on either side of the shoulder. Solving only positive
  // radii makes a small wrist drag flip the turntable on backward-facing poses.
  for (const side of [1, -1]) {
    const reach = radius * side;
    let yaw = radius < 1e-8 ? currentAngles[0] : MathUtils.euclideanModulo(Math.atan2(-target.z, target.x) + (side < 0 ? Math.PI : 0) + Math.PI, Math.PI * 2) - Math.PI;
    if (continuous) {
      const delta = yaw - currentAngles[0];
      yaw = clampAngle(currentAngles[0] + Math.atan2(Math.sin(delta), Math.cos(delta)), 0);
      if (Math.abs(yaw - currentAngles[0]) > Math.PI / 2) continue;
    }
    const seeds = [-Math.acos(cosine), Math.acos(cosine)].map(bend => [
      Math.atan2(height, reach) - Math.atan2(lowerLength * Math.sin(bend), upperLength + lowerLength * Math.cos(bend)) - Math.PI / 2,
      bend,
    ]);
    seeds.push([currentAngles[1], currentAngles[2]]);
    for (const [seedShoulder, seedElbow] of seeds) {
      let shoulder = clampAngle(MathUtils.euclideanModulo(seedShoulder + Math.PI, Math.PI * 2) - Math.PI, 1);
      let elbow = clampAngle(seedElbow, 2);
      // Refine the limited solution instead of assuming every ground point is reachable.
      for (let iteration = 0; iteration < 40; iteration++) {
        for (const index of [2, 1]) {
          const pivot = index === 2 ? { x: -upperLength * Math.sin(shoulder), y: upperLength * Math.cos(shoulder) } : { x: 0, y: 0 };
          const tip = planarTip(shoulder, elbow);
          const vx = tip.x - pivot.x, vy = tip.y - pivot.y;
          const wx = reach - pivot.x, wy = height - pivot.y;
          const delta = Math.atan2(vx * wy - vy * wx, vx * wx + vy * wy);
          if (index === 2) elbow = clampAngle(elbow + delta, 2);
          else shoulder = clampAngle(shoulder + delta, 1);
        }
      }
      const tip = planarTip(shoulder, elbow);
      const error = Math.hypot(tip.x * Math.cos(yaw) - target.x, tip.y - height, -tip.x * Math.sin(yaw) - target.z);
      const candidate = [yaw, shoulder, elbow, currentAngles[3]];
      const movement = candidate.reduce((sum, value, index) => sum + (value - currentAngles[index]) ** 2, 0);
      if (error < bestError - .0001 || (Math.abs(error - bestError) <= .0001 && movement < bestMovement)) {
        bestError = error;
        bestMovement = movement;
        best = candidate;
      }
    }
  }
  return best.map((value, index) => MathUtils.clamp(value, JOINTS[index].min, JOINTS[index].max));
}

export function targetError(rig, target) {
  return rig.toolPosition().distanceTo(new Vector3(target.x, target.y, target.z));
}
