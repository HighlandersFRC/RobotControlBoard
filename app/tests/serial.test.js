import test from 'node:test';
import assert from 'node:assert/strict';
import { JOINTS } from '../src/arm/rig.js';
import { encodeAngles, parseSerialLine, SerialConnection } from '../src/inputs/serial.js';
import { createRig } from '../src/arm/rig.js';
import { Movement } from '../src/movement.js';

async function serialFixture({ write } = {}) {
  const writes = [], errors = [];
  let time = 0, angles = [0, 0, 0, 0], locked = false, incoming;
  const port = { open: async () => {}, close: async () => {}, readable: new ReadableStream({ start(controller) { incoming = controller; } }), writable: { getWriter() {
    assert.equal(locked, false);
    locked = true;
    return {
      write(bytes) {
        const text = new TextDecoder().decode(bytes);
        writes.push({ text, time });
        return Promise.resolve(write?.(text, writes.length));
      },
      releaseLock() { locked = false; },
    };
  } } };
  const connection = new SerialConnection({ serial: { requestPort: async () => port }, getAngles: () => [...angles], clock: () => time, onStatus: () => {}, onError: error => errors.push(error) });
  await connection.toggle();
  return { connection, port, writes, errors, incoming,
    set(next) { angles = [...next]; connection.queue(next); },
    time(value) { time = value; },
    async tick(value) { time = value; connection.tick(value); await connection.writing; },
    shoulders: () => writes.map(write => Number(write.text.match(/S1:(\d+)/)[1])),
  };
}

test('serial protocol preserves the existing servo mapping and clamps hardware input', () => {
  assert.equal(encodeAngles(JOINTS.map(joint => joint.min)), 'S0:0,S1:0,S2:0,S3:0\n');
  assert.equal(encodeAngles(JOINTS.map(joint => joint.max)), 'S0:180,S1:180,S2:180,S3:180\n');
  const parsed = parseSerialLine('P0:200,P1:-20,P2:90,P3:180\r', [0, 0, 0, 0]);
  assert.deepEqual(parsed.angles, [JOINTS[0].max, JOINTS[1].min, 0, JOINTS[3].max]);
});

test('adopting an aligned pose sends nothing and removes old shoulder catch-up', async t => {
  const f = await serialFixture();
  t.after(() => f.connection.disconnect());
  f.set([0, 1, 0, 0]);
  await f.tick(0);
  assert.ok(f.connection.pending);
  const pose = [.4, -.8, .2, -.3];
  assert.equal(f.connection.adoptPose(pose), true);
  assert.equal(f.connection.pending, null);
  await f.tick(1000);
  assert.equal(f.writes.length, 1, 'Align/Start does not transmit a position.');
  f.connection.resume();
  await f.tick(2000);
  assert.equal(f.writes.length, 1, 'There is no old target to catch up to.');
  const next = [...pose]; next[3] += .1;
  f.set(next);
  await f.tick(3000);
  assert.equal(f.writes.at(-1).text, encodeAngles(next), 'First movement retains the aligned shoulder, not its old target.');
});

test('alignment cannot replace the baseline while a USB write is in flight', async t => {
  let release;
  const f = await serialFixture({ write: () => new Promise(resolve => { release = resolve; }) });
  t.after(() => f.connection.disconnect());
  for (const invalid of [null, [], [0, NaN, 0, 0]]) assert.equal(f.connection.adoptPose(invalid), false);
  f.set([0, 1, 0, 0]);
  f.connection.tick(0);
  assert.equal(f.connection.adoptPose([0, -.5, 0, 0]), false);
  f.connection.hold();
  release();
  await f.connection.writing;
  assert.equal(f.connection.adoptPose([0, -.5, 0, 0]), true);
  assert.equal(f.connection.lastMessage, encodeAngles([0, -.5, 0, 0]));
  await f.tick(5000);
  assert.equal(f.writes.length, 1);
});

test('serial input rejects negative indices, partial numbers, NaN, and unknown fields', () => {
  for (const line of ['P-1:90', 'P99:1', 'P0:20oops', 'P0:NaN', 'DX:Infinity', 'P0:1e900', '', 'x'.repeat(300)]) assert.equal(parseSerialLine(line, [0, 0, 0, 0]), null);
  assert.equal(parseSerialLine('DX:20,DY:-10', [0, 0, 0, 0]).dx, .02);
});

test('serial writer awaits each write, coalesces changes, and cancels queued output on Stop', async () => {
  const writes = [];
  let releaseWrite;
  let locked = false;
  const port = { writable: { getWriter() { assert.equal(locked, false); locked = true; return { write(bytes) { writes.push(new TextDecoder().decode(bytes)); return new Promise(resolve => { releaseWrite = resolve; }); }, releaseLock() { locked = false; } }; } } };
  const connection = new SerialConnection({ serial: {}, onError: error => assert.fail(error) });
  connection.port = port;
  connection.queue([0, 0, 0, 0]);
  connection.tick(0);
  connection.queue([1, 0, 0, 0]);
  connection.tick(100);
  assert.equal(writes.length, 1);
  releaseWrite();
  await connection.writing;
  connection.tick(100);
  assert.equal(writes.length, 2);
  releaseWrite();
  await connection.writing;
  connection.queue([2, 0, 0, 0]);
  connection.hold();
  connection.tick(200);
  assert.equal(writes.length, 2);
});

test('returning to the last sent pose discards an obsolete pending command', () => {
  const connection = new SerialConnection({ serial: {} });
  connection.port = {};
  connection.lastMessage = encodeAngles([0, 0, 0, 0]);
  connection.queue([1, 0, 0, 0]);
  assert.ok(connection.pending);
  connection.queue([0, 0, 0, 0]);
  assert.equal(connection.pending, null);
});

test('Stop during an asynchronous serial connection remains in effect after open', async () => {
  let finishOpen;
  let opened;
  const started = new Promise(resolve => { opened = resolve; });
  const errors = [];
  const port = {
    open: () => { opened(); return new Promise(resolve => { finishOpen = resolve; }); },
    readable: new ReadableStream(),
    close: async () => {},
  };
  const connection = new SerialConnection({ serial: { requestPort: async () => port }, onStatus: () => {}, onError: error => errors.push(error) });
  const connecting = connection.toggle();
  await started;
  connection.hold();
  finishOpen();
  await connecting;
  assert.equal(connection.suspended, true);
  await connection.disconnect();
  assert.deepEqual(errors, []);
});

test('a six-second USB stall cannot skip the shoulder from 108 to 164', async t => {
  let release;
  const f = await serialFixture({ write: (_, count) => count === 1 ? new Promise(resolve => { release = resolve; }) : undefined });
  t.after(() => f.connection.disconnect());
  const rig = createRig(), movement = new Movement(rig);
  rig.subscribe(angles => f.set(angles));
  movement.setTarget([.5, 1, .3, 0]);
  for (let frame = 0; frame < 360; frame++) {
    movement.tick(1 / 60);
    f.time(frame * 1000 / 60);
    f.connection.tick(frame * 1000 / 60);
  }
  assert.equal(Number(encodeAngles(rig.getAngles()).match(/S1:(\d+)/)[1]), 164);
  f.time(6000);
  release();
  await f.connection.writing;
  await f.tick(6050);
  assert.deepEqual(f.shoulders(), [108, 109]);
  const expectedOtherChannels = encodeAngles(rig.getAngles()).replace(/S1:\d+/, 'S1:109');
  assert.equal(f.writes.at(-1).text, expectedOtherChannels);
  await f.tick(6100);
  assert.equal(f.writes.length, 2, 'The shoulder must not burst after the stalled write.');
  await f.tick(6200);
  assert.deepEqual(f.shoulders(), [108, 109, 110]);
  f.set([.5, -1, .3, 0]);
  await f.tick(6350);
  assert.deepEqual(f.shoulders(), [108, 109, 110, 109]);
  assert.deepEqual(f.errors, []);
});

test('other joints keep updating while shoulder output waits for its next step', async t => {
  const f = await serialFixture();
  t.after(() => f.connection.disconnect());
  f.set([1, 1, 1, 0]);
  await f.tick(0);
  f.set([1.5, 1, 1.5, 0]);
  await f.tick(50);
  assert.deepEqual(f.shoulders(), [109, 109]);
  assert.notEqual(f.writes[0].text.match(/S0:\d+/)[0], f.writes[1].text.match(/S0:\d+/)[0]);
  assert.notEqual(f.writes[0].text.match(/S2:\d+/)[0], f.writes[1].text.match(/S2:\d+/)[0]);
  await f.tick(100);
  assert.equal(f.writes.length, 2);
  await f.tick(150);
  assert.deepEqual(f.shoulders(), [109, 109, 110]);
});

test('Stop discards shoulder catch-up and a resumed reversal uses the last completed command', async t => {
  let release;
  const f = await serialFixture({ write: (_, count) => count === 1 ? new Promise(resolve => { release = resolve; }) : undefined });
  t.after(() => f.connection.disconnect());
  f.set([0, 1, 0, 0]);
  f.connection.tick(0);
  f.connection.hold();
  release();
  await f.connection.writing;
  f.connection.resume();
  await f.tick(1000);
  assert.deepEqual(f.shoulders(), [109]);
  f.set([0, -1, 0, 0]);
  await f.tick(1200);
  assert.deepEqual(f.shoulders(), [109, 108]);
});

test('returning to the previous shoulder target during a write does not lose the reversal', async t => {
  let release;
  const f = await serialFixture({ write: (_, count) => count === 2 ? new Promise(resolve => { release = resolve; }) : undefined });
  t.after(() => f.connection.disconnect());
  f.set([0, 0, 0, 0]);
  await f.tick(0);
  f.set([0, 1, 0, 0]);
  f.time(150);
  f.connection.tick(150);
  f.set([0, 0, 0, 0]);
  assert.ok(f.connection.pending);
  release();
  await f.connection.writing;
  await f.tick(300);
  assert.deepEqual(f.shoulders(), [108, 109, 108]);
});

test('incoming position reports cannot overwrite an active or delayed USB movement', async t => {
  let release;
  const f = await serialFixture({ write: (_, count) => count === 1 ? new Promise(resolve => { release = resolve; }) : undefined });
  t.after(() => f.connection.disconnect());
  const reports = [];
  f.connection.onAngles = angles => reports.push(angles);
  f.connection.onOrbit = () => {};
  f.set([0, 1, 0, 0]);
  f.connection.tick(0);
  f.time(1000);
  f.incoming.enqueue(new TextEncoder().encode('P1:0\n'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(reports, []);
  release();
  await f.connection.writing;
  f.incoming.enqueue(new TextEncoder().encode('P1:0\n'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(reports, [], 'Queued catch-up must still own the movement.');
  f.connection.hold();
  f.connection.resume();
  f.incoming.enqueue(new TextEncoder().encode('P1:90\n'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reports.length, 1, 'Idle serial controls must continue working.');
  assert.deepEqual(f.errors, []);
});
