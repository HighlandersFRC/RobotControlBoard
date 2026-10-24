import test from 'node:test';
import assert from 'node:assert/strict';
import { JOINTS } from '../src/arm/rig.js';
import { LetterProtocol, LETTER_AXES, PULSES_PER_SECOND, SerialConnection } from '../src/inputs/serial.js';

async function fixture({ write } = {}) {
  const writes = [], errors = [];
  let angles = [0, 0, 0, 0], locked = false;
  const port = {
    open: async () => {}, close: async () => {},
    writable: { getWriter() {
      assert.equal(locked, false);
      locked = true;
      return {
        write(bytes) { const text = new TextDecoder().decode(bytes); writes.push(text); return write?.(text); },
        releaseLock() { locked = false; },
      };
    } },
  };
  const connection = new SerialConnection({ serial: { requestPort: async () => port }, getAngles: () => [...angles], onError: error => errors.push(error) });
  await connection.toggle();
  return { connection, writes, errors, port, set(next) { angles = [...next]; connection.queue(next); }, async tick(now) { connection.tick(now); await connection.writing; } };
}

test('letter mapping matches the unchanged sketch, with the fourth control routed to channel 4', () => {
  assert.deepEqual(LETTER_AXES, [
    { channel: 0, decrease: 'a', increase: 'd', step: 20 },
    { channel: 1, decrease: 's', increase: 'w', step: 3 },
    { channel: 2, decrease: 'q', increase: 'e', step: 15 },
    { channel: 4, decrease: 'i', increase: 'u', step: 15 },
  ]);
  for (let index = 0; index < 4; index++) {
    const protocol = new LetterProtocol([0, 0, 0, 0]);
    const angles = [0, 0, 0, 0];
    angles[index] = JOINTS[index].max;
    protocol.setTarget(angles);
    const up = protocol.next(0);
    assert.equal(up.letter, LETTER_AXES[index].increase);
    protocol.sent(up, 0);
    angles[index] = JOINTS[index].min;
    protocol.setTarget(angles);
    assert.equal(protocol.next(2000).letter, LETTER_AXES[index].decrease);
  }
});

test('connecting is motionless and claw writes contain only paced u/i letters', async () => {
  const f = await fixture();
  await f.tick(0);
  assert.deepEqual(f.writes, []);
  f.set([0, 0, 0, 1]);
  for (let time = 0; time <= 6000; time += 50) await f.tick(time);
  assert.ok(f.writes.length > 0);
  assert.ok(f.writes.every(letter => letter === 'u'));
  f.set([0, 0, 0, -1]);
  for (let time = 6500; time <= 18000; time += 50) await f.tick(time);
  assert.ok(f.writes.includes('i'));
  assert.match(f.writes.join(''), /^[ui]+$/);
  assert.ok(f.connection.protocol.positions.every(value => value >= 150 && value <= 600));
  assert.deepEqual(f.errors, []);
});

test('serial pacing is fair across axes and bounds each axis by its real firmware step size', async () => {
  const f = await fixture();
  f.set(JOINTS.map(joint => joint.max));
  const last = new Map();
  for (let time = 0; time <= 2000; time += 10) {
    const length = f.writes.length;
    await f.tick(time);
    if (length === f.writes.length) continue;
    const letter = f.writes.at(-1), axis = LETTER_AXES.find(axis => axis.increase === letter);
    if (last.has(letter)) assert.ok(time - last.get(letter) >= axis.step / PULSES_PER_SECOND * 1000 - 1e-8);
    last.set(letter, time);
  }
  assert.equal(last.size, 4);
  assert.ok(f.writes.length <= 21);
  assert.match(f.writes.join(''), /^[adwsqeui]+$/);
});

test('quantization does not oscillate, endpoints stay bounded, and invalid targets are ignored', () => {
  const protocol = new LetterProtocol([0, 0, 0, 0]);
  protocol.setTarget([Math.PI * 2 * 10 / 450, 0, 0, 0]);
  assert.equal(protocol.next(0), null);
  protocol.setTarget([Math.PI * 2 * 10.1 / 450, 0, 0, 0]);
  protocol.sent(protocol.next(0), 0);
  assert.equal(protocol.next(10000), null);
  const target = [...protocol.targets];
  for (const invalid of [[NaN, 0, 0, 0], [], [0, Infinity, 0, 0]]) assert.equal(protocol.setTarget(invalid), false);
  assert.deepEqual(protocol.targets, target);
  for (const direction of [1000, -1000]) {
    protocol.setTarget([direction, direction, direction, direction]);
    for (let time = 10000; time < 300000; time += 1000) {
      const command = protocol.next(time);
      if (command) protocol.sent(command, time);
    }
    assert.ok(protocol.positions.every(value => value === (direction > 0 ? 600 : 150)));
  }
});

test('Stop cancels a scheduled write and discards targets after an in-flight write completes', async () => {
  let finishWrite;
  const f = await fixture({ write: () => new Promise(resolve => { finishWrite = resolve; }) });
  f.set([1, 0, 0, 0]);
  f.connection.tick(0);
  f.connection.hold();
  await f.connection.writing;
  assert.deepEqual(f.writes, []);
  f.connection.resume();
  f.set([2, 0, 0, 0]);
  f.connection.tick(1000);
  await Promise.resolve();
  assert.deepEqual(f.writes, ['d']);
  f.set([3, 0, 0, 0]);
  f.connection.tick(2000);
  assert.equal(f.writes.length, 1);
  f.connection.hold();
  finishWrite();
  await f.connection.writing;
  await f.tick(4000);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.connection.protocol.targets, f.connection.protocol.positions);
});

test('failed writes require reconnection rather than silently retrying an unknown hardware position', async () => {
  const f = await fixture({ write: () => Promise.reject(new Error('Disconnected')) });
  f.set([1, 0, 0, 0]);
  await f.tick(0);
  assert.equal(f.connection.suspended, true);
  f.connection.resume();
  f.set([2, 0, 0, 0]);
  await f.tick(1000);
  assert.equal(f.writes.length, 1);
  assert.equal(f.errors.length, 1);
});

test('resuming during an in-flight step rebases to the completed step without losing a new movement', async () => {
  let finishWrite;
  const f = await fixture({ write: () => new Promise(resolve => { finishWrite = resolve; }) });
  f.set([1, 0, 0, 0]);
  f.connection.tick(0);
  await Promise.resolve();
  f.connection.hold();
  f.connection.resume();
  f.set([1.2, 0, 0, 0]);
  finishWrite();
  await f.connection.writing;
  assert.equal(f.connection.protocol.positions[0], 395);
  assert.equal(f.connection.protocol.reference[0], 1);
  assert.ok(f.connection.protocol.targets[0] > 395);
  assert.equal(f.connection.protocol.next(2000).letter, 'd');
});

test('Stop during asynchronous port opening stays in effect and connection does not flush an old target', async () => {
  let finishOpen, opened;
  const started = new Promise(resolve => { opened = resolve; });
  const port = { open: () => { opened(); return new Promise(resolve => { finishOpen = resolve; }); }, close: async () => {}, readable: new ReadableStream() };
  const connection = new SerialConnection({ serial: { requestPort: async () => port } });
  const connecting = connection.toggle();
  await started;
  connection.hold();
  finishOpen();
  await connecting;
  assert.equal(connection.suspended, true);
  assert.deepEqual(connection.protocol.targets, [375, 375, 375, 375]);
  await connection.disconnect();
});
