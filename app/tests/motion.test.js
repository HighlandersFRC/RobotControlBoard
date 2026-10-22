import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionLibrary, validateRecording } from '../src/motion.js';

function fixture(saved, storageFails = false) {
  let angles = [0, 0, 0, 0];
  let serialized = saved;
  const errors = [];
  const motion = new MotionLibrary({ getAngles: () => angles, applyAngles: next => { angles = [...next]; }, storage: { getItem: () => serialized, setItem: (_, value) => { if (storageFails) throw new Error('Full'); serialized = value; } }, onError: error => errors.push(error) });
  return { motion, set: next => { angles = next; }, angles: () => angles, saved: () => serialized, errors };
}

test('recordings capture both endpoints, survive reload, and play to the last pose', () => {
  const f = fixture();
  f.motion.record();
  f.motion.tick(.1);
  f.set([.5, -.5, .5, .5]);
  f.motion.tick(.1);
  f.motion.stop();
  const restored = fixture(f.saved());
  assert.deepEqual(restored.motion.slots[0].keyframes[0].angles, [0, 0, 0, 0]);
  restored.motion.loop = false;
  restored.motion.play();
  restored.motion.tick(10);
  assert.equal(restored.motion.mode, 'idle');
  assert.deepEqual(restored.angles(), [.5, -.5, .5, .5]);
});

test('legacy timing is normalized and malformed storage cannot enter playback', () => {
  const good = { keyframes: [{ time: .05, angles: [0, 0, 0, 0] }, { time: .55, angles: [0, 0, 0, 0] }] };
  assert.equal(validateRecording(good).duration, .5);
  for (const keyframes of [[], [null, null], [{ time: 1, angles: [0, 0, 0, 0] }, { time: 0, angles: [0, 0, 0, 0] }], [{ time: 0, angles: [0, NaN, 0, 0] }, { time: 1, angles: [0, 0, 0, 0] }]]) assert.equal(validateRecording({ keyframes }), null);
  const f = fixture('{broken JSON');
  f.motion.play();
  assert.equal(f.motion.mode, 'idle');
  assert.equal(f.errors.length, 1);
});

test('switching slots saves the original recording and does not mix playback with recording', () => {
  const f = fixture();
  f.motion.record();
  f.motion.tick(.2);
  f.motion.select(1);
  assert.ok(f.motion.slots[0]);
  assert.equal(f.motion.slots[1], null);
  f.motion.play('Wave');
  assert.equal(f.motion.mode, 'playing');
  f.motion.record();
  assert.equal(f.motion.mode, 'recording');
});

test('storage failures retain the recording in memory and report the failure', () => {
  const f = fixture(null, true);
  f.motion.record();
  f.motion.tick(.1);
  f.motion.stop();
  assert.ok(f.motion.slots[0]);
  assert.equal(f.errors.length, 1);
});

test('recordings stop at one minute, and zero-length recordings do not overwrite a saved slot', () => {
  const f = fixture();
  f.motion.record();
  for (let index = 0; index < 1250; index++) f.motion.tick(.05);
  assert.equal(f.motion.mode, 'idle');
  assert.equal(f.motion.slots[0].duration, 60);
  const saved = f.saved();
  f.motion.record();
  f.motion.stop();
  assert.equal(f.saved(), saved);
});
