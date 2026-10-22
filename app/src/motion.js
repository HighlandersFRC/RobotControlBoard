import { clampAngle } from './arm/rig.js';

const STORAGE_KEY = 'budx-anim-slots';
const MAX_DURATION = 60;
const SAMPLE_INTERVAL = .05;
export const PRESETS = {
  Wave: [[0, [0, 0, 0, 0]], [1, [0, -.45, .5, -.5]], [1.6, [0, -.45, .5, .5]], [2.2, [0, -.45, .5, -.5]], [2.8, [0, -.45, .5, .5]], [3.8, [0, 0, 0, 0]]],
  Sweep: [[0, [0, -.35, .25, 0]], [2, [1.5, -.35, .25, 0]], [4, [-1.5, -.35, .25, 0]], [6, [0, -.35, .25, 0]]],
  Salute: [[0, [0, 0, 0, 0]], [.9, [0, -.8, 1.15, .5]], [1.8, [0, -.8, 1.15, .5]], [2.7, [0, 0, 0, 0]]],
};

export function validateRecording(slot) {
  if (!slot || !Array.isArray(slot.keyframes) || slot.keyframes.length < 2 || slot.keyframes.length > 1300) return null;
  let previous = -1;
  const keyframes = [];
  for (const frame of slot.keyframes) {
    if (!frame || !Number.isFinite(frame.time) || frame.time < 0 || frame.time > MAX_DURATION || frame.time <= previous) return null;
    if (!Array.isArray(frame.angles) || frame.angles.length !== 4 || !frame.angles.every(Number.isFinite)) return null;
    keyframes.push({ time: frame.time, angles: frame.angles.map(clampAngle) });
    previous = frame.time;
  }
  // Older recordings didn't capture an initial frame at zero.
  const start = keyframes[0].time;
  keyframes.forEach(frame => { frame.time -= start; });
  const duration = keyframes.at(-1).time;
  return duration > 0 ? { keyframes, duration } : null;
}

export function interpolate(keyframes, time) {
  if (time <= keyframes[0].time) return [...keyframes[0].angles];
  const upper = keyframes.findIndex(frame => frame.time >= time);
  if (upper < 0) return [...keyframes.at(-1).angles];
  const a = keyframes[upper - 1], b = keyframes[upper];
  const amount = (time - a.time) / (b.time - a.time);
  return a.angles.map((value, index) => value + (b.angles[index] - value) * amount);
}

export class MotionLibrary {
  constructor({ getAngles, applyAngles, storage, onError = () => {} }) {
    Object.assign(this, { getAngles, applyAngles, storage, onError });
    this.slots = [null, null, null];
    this.activeSlot = 0;
    this.mode = 'idle';
    this.elapsed = 0;
    this.speed = 1;
    this.loop = true;
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
      if (Array.isArray(saved)) this.slots = this.slots.map((_, index) => validateRecording(saved[index]));
    } catch { onError('Saved recordings could not be read. You can still record this session.'); }
  }

  select(index) {
    if (!Number.isInteger(index) || index < 0 || index > 2) return;
    this.stop();
    this.activeSlot = index;
    this.elapsed = 0;
  }

  record() {
    if (this.mode === 'recording') { this.stop(); return; }
    this.stop();
    this.mode = 'recording';
    this.elapsed = 0;
    this.frames = [{ time: 0, angles: [...this.getAngles()] }];
  }

  play(preset) {
    if (!preset && this.mode === 'playing') { this.stop(); return; }
    this.stop();
    const slot = preset ? validateRecording({ keyframes: PRESETS[preset]?.map(([time, angles]) => ({ time, angles })) }) : this.slots[this.activeSlot];
    if (!slot) return;
    this.playing = slot;
    this.elapsed = 0;
    this.mode = 'playing';
    this.applyAngles(slot.keyframes[0].angles, 'sequence');
  }

  stop() {
    if (this.mode === 'recording') {
      this.capture();
      const slot = validateRecording({ keyframes: this.frames });
      if (slot) {
        this.slots[this.activeSlot] = slot;
        try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.slots)); }
        catch { this.onError('Recording is available this session, but browser storage is full or unavailable.'); }
      }
    }
    this.mode = 'idle';
  }

  capture() {
    if (this.elapsed > this.frames.at(-1).time) this.frames.push({ time: this.elapsed, angles: [...this.getAngles()] });
  }

  tick(delta) {
    if (this.mode === 'recording') {
      this.elapsed = Math.min(MAX_DURATION, this.elapsed + delta);
      if (this.elapsed - this.frames.at(-1).time >= SAMPLE_INTERVAL) this.capture();
      if (this.elapsed >= MAX_DURATION) this.stop();
    } else if (this.mode === 'playing') {
      this.elapsed += delta * this.speed;
      if (!this.loop && this.elapsed >= this.playing.duration) {
        this.elapsed = this.playing.duration;
        this.applyAngles(this.playing.keyframes.at(-1).angles, 'sequence');
        this.stop();
        return;
      }
      this.elapsed %= this.playing.duration;
      this.applyAngles(interpolate(this.playing.keyframes, this.elapsed), 'sequence');
    }
  }
}
