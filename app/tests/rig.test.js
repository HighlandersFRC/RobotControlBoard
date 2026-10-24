import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { CAD, JOINTS, createRig } from '../src/arm/rig.js';
import { solveTarget } from '../src/arm/kinematics.js';

const close = (a, b, tolerance = 1e-8) => assert.ok(a.distanceTo(b) < tolerance, `${a.toArray()} separated from ${b.toArray()}`);
const world = (object, point = [0, 0, 0]) => object.localToWorld(new Vector3(...point));

test('CAD bearing faces remain coincident throughout the full joint ranges', () => {
  const rig = createRig();
  // Compare actual mesh-space bearing centers, not only parent group origins.
  for (let yaw = -180; yaw <= 180; yaw += 60) {
    for (let shoulder = -90; shoulder <= 90; shoulder += 30) {
      for (let elbow = -90; elbow <= 90; elbow += 30) {
        for (const wrist of [-60, 0, 60]) {
          rig.setAngles([yaw, shoulder, elbow, wrist].map(value => value * Math.PI / 180));
          close(world(rig.mounts[1]), world(rig.pivots[0]));
          close(world(rig.mounts[1], [0, 0, CAD.shoulder]), world(rig.mounts[2], [0, 0, CAD.shoulder]));
          close(world(rig.mounts[2], [0, 0, CAD.elbow]), world(rig.mounts[3], [0, 0, CAD.forearmSocket]));
          close(world(rig.mounts[3], [0, 0, CAD.forearmTop]), world(rig.pivots[3]));
        }
      }
    }
  }
});

test('bearing calibration matches the circular faces in the source CAD files', () => {
  for (const [file, height] of [['turntable', CAD.shoulder], ['arm', CAD.shoulder], ['arm', CAD.elbow], ['joint', CAD.forearmSocket]]) {
    const gltf = JSON.parse(readFileSync(new URL(`../public/models/${file}.gltf`, import.meta.url)));
    const faces = gltf.meshes.flatMap(mesh => mesh.primitives.map(primitive => gltf.accessors[primitive.attributes.POSITION]));
    assert.ok(faces.some(face => {
      const center = (face.min[2] + face.max[2]) / 2;
      const width = face.max[0] - face.min[0];
      const heightSpan = face.max[2] - face.min[2];
      return Math.abs(center - height) < 1e-5 && width > .015 && Math.abs(width - heightSpan) < .001;
    }), `${file} has no bearing centered at ${height}`);
  }
});

test('all input sources share joint limits and reject non-finite values', () => {
  const rig = createRig();
  for (const source of ['manual', 'gamepad', 'serial', 'hand', 'sequence']) {
    rig.setAngles([100, -100, 100, -100], source);
    assert.deepEqual(rig.getAngles(), [JOINTS[0].max, JOINTS[1].min, JOINTS[2].max, JOINTS[3].min]);
    const before = rig.getAngles();
    rig.setAngles([NaN, Infinity, undefined, -Infinity], source);
    assert.deepEqual(rig.getAngles(), before);
  }
});

test('rotating the wrist changes its tool orientation while keeping the bearing fixed', () => {
  const rig = createRig();
  const before = world(rig.pivots[3]);
  const toolCorner = world(rig.tip, [.4, 0, 0]);
  rig.setAngles([0, 0, 0, 1]);
  close(before, world(rig.pivots[3]));
  assert.ok(toolCorner.distanceTo(world(rig.tip, [.4, 0, 0])) > .3);
});

test('inverse kinematics reaches attainable poses and stays finite at singularities', () => {
  const rig = createRig();
  for (const pose of [[0, -.7, .5, 0], [1, -.5, -.4, .2], [-1.5, -1, 1.3, -.3]]) {
    rig.setAngles(pose);
    const target = rig.toolPosition();
    rig.setAngles([0, 0, 0, pose[3]]);
    rig.setAngles(solveTarget(target, rig.getAngles()));
    close(rig.toolPosition(), target, .001);
  }
  for (const target of [new Vector3(), new Vector3(0, (CAD.shoulder - CAD.baseBottom) * CAD.scale, 0), new Vector3(10000, -10000, 10000)]) {
    const angles = solveTarget(target);
    assert.ok(angles.every((angle, index) => Number.isFinite(angle) && angle >= JOINTS[index].min && angle <= JOINTS[index].max));
  }
});

test('wrist targets work on both sides of the shoulder without changing wrist roll', () => {
  const rig = createRig();
  for (const yaw of [-2.4, -.5, 0, 1.2, 2.7]) {
    for (const shoulder of [-1.2, -.4, .3, .9]) {
      for (const elbow of [-1.1, -.25, .25, 1.1]) {
        const pose = [yaw, shoulder, elbow, .45];
        rig.setAngles(pose);
        const target = rig.toolPosition();
        const solved = solveTarget(target, pose);
        assert.equal(solved[3], .45);
        assert.ok(solved.every((value, index) => Math.abs(value - pose[index]) < .001), 'An unchanged wrist target must not flip an existing pose.');
        rig.setAngles(solved);
        close(rig.toolPosition(), target, .001);
      }
    }
  }
});

test('continuous wrist movement crosses the base axis without turntable or elbow jumps', () => {
  const expected = createRig();
  const actual = createRig();
  actual.setAngles([.7, -.3, .12, -.4]);
  for (let step = 0; step <= 120; step++) {
    expected.setAngles([.7, -.3 + step * .005, .12, -.4]);
    const target = expected.toolPosition();
    const previous = actual.getAngles();
    const next = solveTarget(target, previous, { continuous: true });
    assert.ok(next.every((angle, index) => Math.abs(angle - previous[index]) < .06), 'A small wrist drag must keep a continuous joint solution.');
    actual.setAngles(next);
    close(actual.toolPosition(), target, .002);
  }
});

test('wrist dragging holds the turntable limit instead of wrapping through a full turn', () => {
  const rig = createRig();
  rig.setAngles([-Math.PI + .005, -.7, .4, .2]);
  const target = rig.toolPosition();
  const current = [Math.PI - .005, -.7, .4, .2];
  const solved = solveTarget(target, current, { continuous: true });
  assert.equal(solved[0], Math.PI);
  assert.ok(solved.every((angle, index) => Math.abs(angle - current[index]) < .02));
});
