import { JOINTS } from '../arm/rig.js';

export const SERVO_MIN = 150, SERVO_MAX = 600, SERVO_CENTER = 375;
export const PULSES_PER_SECOND = 30;
export const LETTER_AXES = Object.freeze([
  { channel: 0, decrease: 'a', increase: 'd', step: 20 },
  { channel: 1, decrease: 's', increase: 'w', step: 3 },
  { channel: 2, decrease: 'q', increase: 'e', step: 15 },
  { channel: 4, decrease: 'i', increase: 'u', step: 15 },
]);
const clampPulse = value => Math.max(SERVO_MIN, Math.min(SERVO_MAX, value));

// The firmware has relative commands and no telemetry. The current screen
// pose becomes the reference on connection; opening a port never moves a servo.
export class LetterProtocol {
  constructor(angles) {
    this.positions = LETTER_AXES.map(() => SERVO_CENTER);
    this.lastWrites = LETTER_AXES.map(() => -Infinity);
    this.cursor = 0;
    this.rebase(angles);
  }
  rebase(angles) {
    this.reference = [...angles];
    this.origin = [...this.positions];
    this.targets = [...this.positions];
  }
  setTarget(angles) {
    if (!Array.isArray(angles) || angles.length !== 4 || !angles.every(Number.isFinite)) return false;
    this.targets = angles.map((angle, index) => clampPulse(this.origin[index] +
      (angle - this.reference[index]) / (JOINTS[index].max - JOINTS[index].min) * (SERVO_MAX - SERVO_MIN)));
    return true;
  }
  next(now) {
    for (let offset = 0; offset < LETTER_AXES.length; offset++) {
      const index = (this.cursor + offset) % LETTER_AXES.length;
      const axis = LETTER_AXES[index];
      if (now - this.lastWrites[index] < axis.step / PULSES_PER_SECOND * 1000) continue;
      const difference = this.targets[index] - this.positions[index];
      const nextPulse = clampPulse(this.positions[index] + Math.sign(difference) * axis.step);
      // Only take a step that improves the estimate, avoiding chatter between
      // adjacent positions when a target falls between firmware-sized steps.
      if (Math.abs(this.targets[index] - nextPulse) >= Math.abs(difference) - 1e-7) continue;
      return { index, letter: difference > 0 ? axis.increase : axis.decrease, nextPulse };
    }
    return null;
  }
  sent(command, now) {
    this.positions[command.index] = command.nextPulse;
    this.lastWrites[command.index] = now;
    this.cursor = (command.index + 1) % LETTER_AXES.length;
  }
}

export class SerialConnection {
  constructor({ getAngles = () => [0, 0, 0, 0], onStatus = () => {}, onError = () => {}, serial = globalThis.navigator?.serial }) {
    Object.assign(this, { getAngles, onStatus, onError, serial });
    this.port = null;
    this.busy = false;
    this.writing = null;
    this.lastWrite = -Infinity;
    this.suspended = false;
    this.generation = 0;
    this.faulted = false;
  }
  async toggle() {
    if (this.busy) return;
    this.busy = true;
    this.onStatus(!!this.port, true);
    try {
      if (this.port) await this.disconnect();
      else {
        if (!this.serial) throw new Error('USB serial needs Chrome or Edge on localhost or HTTPS.');
        this.suspended = false;
        const port = await this.serial.requestPort();
        await port.open({ baudRate: 115200 });
        this.port = port;
        this.generation++;
        this.protocol = new LetterProtocol(this.getAngles());
        this.rebaseAfterWrite = null;
        this.faulted = false;
        this.lastWrite = -Infinity;
        if (port.readable) this.reading = this.read(port);
      }
    } catch (error) {
      if (error.name !== 'NotFoundError') this.onError(error.message || 'Could not connect to the serial port.');
    } finally { this.busy = false; this.onStatus(!!this.port, false); }
  }
  async read(port) {
    let reader;
    try {
      reader = port.readable.getReader();
      this.reader = reader;
      // Drain diagnostics, never treating them as position feedback or input.
      while (!(await reader.read()).done) { /* The supplied sketch sends no pose data. */ }
    } catch (error) {
      if (this.port === port) this.onError(`Serial connection ended: ${error.message}`);
    } finally {
      reader?.releaseLock();
      if (this.reader === reader) this.reader = null;
      if (this.port === port && !this.busy) void this.disconnect();
    }
  }
  queue(angles) { if (this.port && !this.suspended) this.protocol.setTarget(angles); }
  tick(now) {
    if (!Number.isFinite(now) || !this.port?.writable || this.writing || this.suspended || this.faulted || now - this.lastWrite < 100) return;
    const command = this.protocol.next(now);
    if (!command) return;
    const protocol = this.protocol, generation = this.generation;
    let writer;
    try { writer = this.port.writable.getWriter(); }
    catch (error) { this.faulted = true; this.hold(); this.onError(`Serial write failed: ${error.message}. Reconnect Arduino to resume.`); return; }
    this.lastWrite = now;
    // One letter per awaited write: no bursts, stale queues, newlines, or channel 3.
    this.writing = Promise.resolve().then(async () => {
      if (this.suspended || generation !== this.generation) return false;
      await writer.write(new TextEncoder().encode(command.letter));
      return true;
    })
      .then(written => {
        if (!written || generation !== this.generation) return;
        protocol.sent(command, now);
        if (this.rebaseAfterWrite) {
          protocol.rebase(this.rebaseAfterWrite);
          this.rebaseAfterWrite = null;
          if (!this.suspended) protocol.setTarget(this.getAngles());
        } else if (this.suspended) protocol.rebase(this.getAngles());
      })
      .catch(error => { if (generation === this.generation) { this.faulted = true; this.hold(); this.onError(`Serial write failed: ${error.message}. Reconnect Arduino to resume.`); } })
      .finally(() => { writer.releaseLock(); this.writing = null; });
  }
  hold() {
    this.suspended = true;
    const angles = this.getAngles();
    if (this.writing) this.rebaseAfterWrite = [...angles];
    this.protocol?.rebase(angles);
  }
  resume() {
    if (this.faulted) return;
    if (this.suspended) {
      const angles = this.getAngles();
      if (this.writing) this.rebaseAfterWrite = [...angles];
      this.protocol?.rebase(angles);
    }
    this.suspended = false;
  }
  async disconnect() {
    const port = this.port;
    this.port = null;
    this.generation++;
    this.protocol = null;
    try {
      await this.reader?.cancel();
      await this.reading;
      await this.writing;
      await port?.close();
    } catch (error) { this.onError(`Could not close serial cleanly: ${error.message}`); }
    finally { this.onStatus(false, false); }
  }
}
