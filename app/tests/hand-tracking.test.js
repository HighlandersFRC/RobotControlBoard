import test from 'node:test';
import assert from 'node:assert/strict';
import { HandTracking } from '../src/inputs/hand-tracking.js';
import { JOINTS } from '../src/arm/rig.js';

function fixture(t, media) {
  const instances = [], states = [], controls = [], poses = [], errors = [];
  class Tracker {
    constructor() { instances.push(this); this.closed = 0; }
    setOptions() {}
    onResults(callback) { this.result = callback; }
    async send() { if (this.failure) throw new Error('Tracker failed'); }
    async close() { this.closed++; }
  }
  class Track extends EventTarget { stopped = false; stop() { this.stopped = true; } }
  const track = new Track();
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const globals = {
    window: { Hands: Tracker, FaceDetection: Tracker },
    navigator: { mediaDevices: { getUserMedia: media ?? (async () => stream) } },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  };
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else delete globalThis[key]; });
  }
  const context = Object.fromEntries(['clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill', 'save', 'rect', 'clip', 'drawImage', 'restore'].map(name => [name, () => {}]));
  const tracker = new HandTracking({
    video: { play: async () => {}, videoWidth: 640, videoHeight: 400, readyState: 2, currentTime: 1, srcObject: null },
    canvas: { getContext: () => context, parentElement: { style: {} } },
    getAngles: () => [0, 0, 0, 0], onAngles: angles => poses.push(angles),
    onState: state => states.push(state), onControlChange: enabled => controls.push(enabled), onError: error => errors.push(error),
  });
  const landmarks = Array.from({ length: 21 }, () => ({ x: .4, y: .5 }));
  landmarks[0] = { x: .4, y: .8 };
  landmarks[5] = { x: .4, y: .55 };
  landmarks[6] = { x: .4, y: .4 };
  landmarks[7] = { x: .4, y: .25 };
  landmarks[9] = { x: .4, y: .35 };
  return { tracker, instances, states, controls, poses, errors, track, stream, landmarks };
}
const settled = () => new Promise(resolve => setImmediate(resolve));

test('camera starts in preview only; the control checkbox explicitly arms and disarms movement', async t => {
  const f = fixture(t);
  await f.tracker.toggle();
  assert.equal(f.tracker.enabled, true);
  assert.equal(f.tracker.control, false);
  f.tracker.onHands({ multiHandLandmarks: [f.landmarks] });
  assert.equal(f.poses.length, 0);
  f.tracker.smoothing = false;
  f.tracker.setControl(true);
  f.tracker.onHands({ multiHandLandmarks: [f.landmarks] });
  assert.equal(f.poses.length, 1);
  assert.equal(f.poses[0][3], JOINTS[3].max, 'An extended finger opens the claw.');
  f.landmarks[7] = { ...f.landmarks[5] };
  f.tracker.onHands({ multiHandLandmarks: [f.landmarks] });
  assert.equal(f.poses[1][3], JOINTS[3].min, 'A curled finger closes the claw.');
  f.tracker.setControl(false);
  f.tracker.onHands({ multiHandLandmarks: [f.landmarks] });
  assert.equal(f.poses.length, 2);
  await f.tracker.stop();
  assert.equal(f.controls.at(-1), false);
  assert.equal(f.track.stopped, true);
});

test('stopping during startup releases a late camera stream and cannot re-enable hand control', async t => {
  let resolveStream;
  const f = fixture(t, () => new Promise(resolve => { resolveStream = resolve; }));
  const starting = f.tracker.toggle();
  await settled();
  await f.tracker.stop();
  resolveStream(f.stream);
  await starting;
  assert.equal(f.tracker.enabled, false);
  assert.equal(f.tracker.control, false);
  assert.equal(f.track.stopped, true);
  assert.ok(!f.states.includes('detecting'));
  assert.deepEqual(f.errors, []);
});

test('late results from a stopped camera are ignored after a new session starts', async t => {
  const f = fixture(t);
  await f.tracker.toggle();
  const oldResults = f.instances[0].result;
  await f.tracker.stop();
  await f.tracker.toggle();
  f.tracker.setControl(true);
  oldResults({ multiHandLandmarks: [f.landmarks] });
  assert.equal(f.poses.length, 0);
  f.instances.at(-1).result({ multiHandLandmarks: [f.landmarks] });
  assert.equal(f.poses.length, 1);
  await f.tracker.stop();
});

test('camera disconnect and tracking failures immediately clear control and release resources', async t => {
  const f = fixture(t);
  await f.tracker.toggle();
  f.tracker.setControl(true);
  f.track.dispatchEvent(new Event('ended'));
  assert.equal(f.tracker.control, false);
  await settled();
  assert.equal(f.tracker.enabled, false);
  assert.equal(f.instances[0].closed, 1);
  assert.equal(f.controls.at(-1), false);
  await f.tracker.toggle();
  f.tracker.setControl(true);
  f.instances.at(-1).failure = true;
  await f.tracker.processFrame();
  await settled();
  assert.equal(f.tracker.control, false);
  assert.equal(f.tracker.enabled, false);
  assert.equal(f.track.stopped, true);
  assert.equal(f.errors.length, 2);
});

test('denied camera access leaves the checkbox off and permits a clean retry', async t => {
  let first = true;
  const f = fixture(t, async () => { if (first) { first = false; throw new DOMException('Denied', 'NotAllowedError'); } return f.stream; });
  await f.tracker.toggle();
  assert.equal(f.tracker.control, false);
  assert.equal(f.tracker.busy, false);
  assert.equal(f.errors.length, 1);
  await f.tracker.toggle();
  assert.equal(f.tracker.enabled, true);
  assert.equal(f.tracker.control, false);
  await f.tracker.stop();
});

test('a rapid camera restart waits for the old frame and cannot close the new tracker', async t => {
  const f = fixture(t);
  await f.tracker.toggle();
  let finishFrame;
  f.instances[0].send = () => new Promise(resolve => { finishFrame = resolve; });
  f.tracker.frameTask = f.tracker.processFrame();
  const stopping = f.tracker.stop();
  await f.tracker.toggle();
  assert.equal(f.instances.length, 1);
  assert.equal(f.states.at(-1), 'stopping');
  finishFrame();
  await stopping;
  await f.tracker.toggle();
  assert.equal(f.tracker.enabled, true);
  assert.equal(f.instances.length, 2);
  assert.equal(f.instances[0].closed, 1);
  assert.equal(f.instances[1].closed, 0);
  await f.tracker.stop();
});
