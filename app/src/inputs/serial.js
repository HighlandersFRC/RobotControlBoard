import { JOINTS, clampAngle } from '../arm/rig.js';

export function parseSerialLine(line, angles) {
  if (typeof line !== 'string' || line.length > 256) return null;
  const next = [...angles];
  let changed = false;
  let dx = 0, dy = 0;
  for (const field of line.trim().split(',')) {
    const match = /^(P[0-3]|DX|DY):(-?\d+(?:\.\d+)?)$/.exec(field.trim());
    if (!match) continue;
    const [, key, raw] = match;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    if (key.startsWith('P')) {
      const index = Number(key[1]);
      const joint = JOINTS[index];
      next[index] = clampAngle(joint.min + Math.min(180, Math.max(0, value)) / 180 * (joint.max - joint.min), index);
      changed = true;
    } else if (key === 'DX') dx = Math.max(-1000, Math.min(1000, value)) * .001;
    else dy = Math.max(-1000, Math.min(1000, value)) * .001;
  }
  return changed || dx || dy ? { angles: changed ? next : null, dx, dy } : null;
}

export function encodeAngles(angles) {
  return JOINTS.map((joint, index) => {
    const angle = clampAngle(angles[index], index);
    if (angle === null) throw new TypeError('Serial angles must be finite.');
    return `S${index}:${Math.round((angle - joint.min) / (joint.max - joint.min) * 180)}`;
  }).join(',') + '\n';
}

export class SerialConnection {
  constructor({ getAngles, onAngles, onOrbit, onStatus, onError, serial = navigator.serial }) {
    Object.assign(this, { getAngles, onAngles, onOrbit, onStatus, onError, serial });
    this.port = null;
    this.busy = false;
    this.pending = null;
    this.writing = null;
    this.lastWrite = -Infinity;
    this.lastMessage = '';
    this.suspended = false;
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
        try { await port.open({ baudRate: 115200 }); }
        catch (error) { this.port = null; throw error; }
        this.port = port;
        this.lastMessage = '';
        this.reading = this.read(port);
      }
    } catch (error) {
      if (error.name !== 'NotFoundError') this.onError(error.message || 'Could not connect to the serial port.');
    } finally {
      this.busy = false;
      this.onStatus(!!this.port, false);
    }
  }

  async read(port) {
    let reader;
    const decoder = new TextDecoder();
    let buffer = '';
    let failed = false;
    try {
      reader = port.readable.getReader();
      this.reader = reader;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        if (buffer.length > 1024) buffer = '';
        for (const line of lines) {
          if (this.suspended) continue;
          const message = parseSerialLine(line, this.getAngles());
          if (!message) continue;
          if (message.angles && performance.now() - this.lastWrite > 500) this.onAngles(message.angles, 'serial');
          if (message.dx || message.dy) this.onOrbit(message.dx, message.dy);
        }
      }
    } catch (error) {
      failed = true;
      this.onError(`Serial connection ended: ${error.message}`);
    } finally {
      reader?.releaseLock();
      this.reader = null;
      // Do not await disconnect here: it waits for this read task to finish.
      if ((failed || this.port === port) && !this.busy) void this.disconnect();
    }
  }

  queue(angles) {
    if (!this.port || this.suspended) return;
    const message = encodeAngles(angles);
    this.pending = message === this.lastMessage ? null : message;
  }

  tick(now) {
    if (!this.port?.writable || !this.pending || this.writing || this.suspended || now - this.lastWrite < 50) return;
    const message = this.pending;
    this.pending = null;
    const writer = this.port.writable.getWriter();
    this.lastWrite = now;
    this.writing = writer.write(new TextEncoder().encode(message))
      .then(() => { this.lastMessage = message; })
      .catch(error => { this.onError(`Serial write failed: ${error.message}`); this.suspended = true; this.pending = null; })
      .finally(() => { writer.releaseLock(); this.writing = null; });
  }

  hold() { this.suspended = true; this.pending = null; }
  resume() { this.suspended = false; }

  async disconnect() {
    const port = this.port;
    this.port = null;
    this.pending = null;
    try {
      await this.reader?.cancel();
      await this.reading;
      await this.writing;
      await port?.close();
    } catch (error) { this.onError(`Could not close serial cleanly: ${error.message}`); }
    finally { this.onStatus(false, false); }
  }
}
