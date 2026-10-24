import test from 'node:test';
import assert from 'node:assert/strict';
import { JOINTS } from '../src/arm/rig.js';
import { encodeAngles, parseSerialLine, SerialConnection } from '../src/inputs/serial.js';

test('serial protocol preserves the existing servo mapping and clamps hardware input', () => {
  assert.equal(encodeAngles(JOINTS.map(joint => joint.min)), 'S0:0,S1:0,S2:0,S3:0\n');
  assert.equal(encodeAngles(JOINTS.map(joint => joint.max)), 'S0:180,S1:180,S2:180,S3:180\n');
  const parsed = parseSerialLine('P0:200,P1:-20,P2:90,P3:180\r', [0, 0, 0, 0]);
  assert.deepEqual(parsed.angles, [JOINTS[0].max, JOINTS[1].min, 0, JOINTS[3].max]);
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
