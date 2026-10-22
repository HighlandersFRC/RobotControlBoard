import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnowField } from '../src/snow.js';

test('snow falls in world space and wraps at the floor without growing the field', () => {
  const field = createSnowField(12, () => .5);
  const initial = field.positions[1];
  field.step(.04, 1);
  assert.ok(field.positions[1] < initial);
  field.positions[1] = .001;
  field.step(.04, 1);
  assert.equal(field.positions[1], 30);
  assert.equal(field.positions.length, 36);
  assert.ok(field.positions.every(Number.isFinite));
});

test('a local breeze displaces nearby snow in 3D while distant flakes keep falling', () => {
  const calm = createSnowField(2, () => .5);
  const wind = createSnowField(2, () => .5);
  calm.positions.set([0, 15, 0, 15, 15, 15]);
  wind.positions.set(calm.positions);
  const gust = { point: { x: 0, y: 15, z: 0 }, velocity: { x: 8, y: 0, z: 5 }, strength: 12 };
  calm.step(.05, 1);
  assert.equal(wind.step(.05, 1, gust), 1);
  assert.ok(wind.positions[0] > calm.positions[0]);
  assert.ok(wind.positions[2] > calm.positions[2]);
  assert.deepEqual(wind.positions.slice(3), calm.positions.slice(3));
});

test('a delayed animation frame cannot launch snow outside the simulation bounds', () => {
  const field = createSnowField(30, () => .5);
  for (let i = 0; i < 100; i++) field.step(15, i, { point: { x: 0, y: 15, z: 0 }, velocity: { x: 12, y: 12, z: 12 }, strength: 12 });
  assert.ok(field.positions.every(Number.isFinite));
  for (let i = 0; i < field.positions.length; i += 3) {
    assert.ok(Math.abs(field.positions[i]) <= 22);
    assert.ok(field.positions[i + 1] >= 0 && field.positions[i + 1] <= 34);
    assert.ok(Math.abs(field.positions[i + 2]) <= 22);
  }
});

test('snow drifts away from arm links without redirecting distant flakes', () => {
  const calm = createSnowField(2, () => .5);
  const protectedField = createSnowField(2, () => .5);
  calm.positions.set([.4, 8, .3, 14, 8, 14]);
  protectedField.positions.set(calm.positions);
  const link = { start: { x: 0, y: 4, z: 0 }, end: { x: 0, y: 12, z: 0 }, radius: 2 };
  calm.step(.05, 1);
  protectedField.step(.05, 1, null, [link]);
  assert.ok(protectedField.positions[0] > calm.positions[0]);
  assert.ok(protectedField.positions[2] > calm.positions[2]);
  assert.deepEqual(protectedField.positions.slice(3), calm.positions.slice(3));
});

test('snow avoidance stays finite at a link center and a zero-length link', () => {
  const field = createSnowField(1, () => .5);
  const center = { x: 0, y: 15, z: 0 };
  field.step(.05, 1, null, [{ start: center, end: center, radius: 2 }]);
  assert.ok(field.positions.every(Number.isFinite));
  assert.ok(field.positions[0] > 0);
});
