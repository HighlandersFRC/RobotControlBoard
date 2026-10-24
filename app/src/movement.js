import { JOINTS, clampAngle } from './arm/rig.js';

export const MAX_JOINT_SPEED = Math.PI / 12; // 15 degrees per second, including playback.

export class Movement {
  constructor(rig) { this.rig = rig; this.hold(); }
  getTarget() { return [...this.target]; }
  setTarget(angles, source = 'manual') {
    if (!Array.isArray(angles) || angles.length !== JOINTS.length || !angles.every(Number.isFinite)) return false;
    this.target = angles.map(clampAngle);
    this.source = source;
    return true;
  }
  hold() { this.target = this.rig.getAngles(); }
  tick(delta) {
    if (!Number.isFinite(delta) || delta <= 0) return;
    // A delayed frame must never turn into a large catch-up movement.
    const step = MAX_JOINT_SPEED * Math.min(delta, .05);
    const next = this.rig.getAngles().map((angle, index) => angle + Math.max(-step, Math.min(step, this.target[index] - angle)));
    this.rig.setAngles(next, this.source);
  }
}
