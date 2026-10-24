import test from 'node:test';
import assert from 'node:assert/strict';
import { createRig, JOINTS } from '../src/arm/rig.js';
import { Movement, JOINT_SPEEDS } from '../src/movement.js';

test('all inputs move turntable and elbow at 45 degrees/sec, shoulder at 3, and wrist at 15', () => {
  for (const source of ['manual', 'gamepad', 'hand', 'sequence']) {
    const rig = createRig(), movement = new Movement(rig);
    for (let frame = 0; frame < 60; frame++) {
      movement.setTarget(JOINTS.map(joint => joint.max), source);
      const before = rig.getAngles();
      movement.tick(1 / 60);
      rig.getAngles().forEach((angle, index) => assert.ok(angle - before[index] <= JOINT_SPEEDS[index] / 60 + 1e-9));
    }
    const degrees = rig.getAngles().map(angle => angle * 180 / Math.PI);
    degrees.forEach((angle, index) => assert.ok(Math.abs(angle - [45, 3, 45, 15][index]) < 1e-8));
  }
});

test('movement is refresh-rate independent and a delayed frame cannot jump to its target', () => {
  function simulate(fps) {
    const rig = createRig(), movement = new Movement(rig);
    movement.setTarget([1, 1, 1, 1]);
    for (let frame = 0; frame < fps; frame++) movement.tick(1 / fps);
    return rig.getAngles();
  }
  simulate(30).forEach((angle, index) => assert.ok(Math.abs(angle - simulate(144)[index]) < 1e-9));
  const rig = createRig(), movement = new Movement(rig);
  movement.setTarget([1, 1, 1, 1]);
  movement.tick(10);
  assert.ok(rig.getAngles().every((angle, index) => angle <= JOINT_SPEEDS[index] * .05));
});

test('Stop drops a pending destination, invalid targets are rejected, and small moves never overshoot', () => {
  const rig = createRig(), movement = new Movement(rig);
  movement.setTarget([1, 1, 1, 1]);
  movement.tick(.02);
  movement.hold();
  const held = rig.getAngles();
  for (let frame = 0; frame < 100; frame++) movement.tick(.02);
  assert.deepEqual(rig.getAngles(), held);
  for (const invalid of [[NaN, 0, 0, 0], [Infinity, 0, 0, 0], [], null]) assert.equal(movement.setTarget(invalid), false);
  assert.deepEqual(movement.getTarget(), held);
  const target = held.map(angle => angle + .001);
  movement.setTarget(target);
  movement.tick(.02);
  assert.deepEqual(rig.getAngles(), target);
});
