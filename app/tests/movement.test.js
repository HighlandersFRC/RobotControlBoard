import test from 'node:test';
import assert from 'node:assert/strict';
import { createRig, JOINTS } from '../src/arm/rig.js';
import { Movement, MAX_JOINT_SPEED } from '../src/movement.js';

test('manual, controller, hand, and sequence targets all share the same slow movement limit', () => {
  for (const source of ['manual', 'gamepad', 'hand', 'sequence']) {
    const rig = createRig(), movement = new Movement(rig);
    for (let frame = 0; frame < 60; frame++) {
      movement.setTarget(JOINTS.map(joint => joint.max), source);
      const before = rig.getAngles();
      movement.tick(1 / 60);
      rig.getAngles().forEach((angle, index) => assert.ok(angle - before[index] <= MAX_JOINT_SPEED / 60 + 1e-9));
    }
    rig.getAngles().forEach(angle => assert.ok(Math.abs(angle - MAX_JOINT_SPEED) < 1e-8));
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
  assert.ok(rig.getAngles().every(angle => angle <= MAX_JOINT_SPEED * .05));
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
