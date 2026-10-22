import test from 'node:test';
import assert from 'node:assert/strict';
import { GamepadInput } from '../src/inputs/gamepad.js';

test('gamepad speed is independent of refresh rate and Stop requires neutral input', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const pad = { index: 0, id: 'Test pad', connected: true, axes: [0, 0, .8, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [pad] } });
  try {
    function simulate(fps) {
      let angles = [0, 0, 0, 0];
      const input = new GamepadInput({ onStatus: () => {}, onSelect: () => {}, onMove: next => { angles = next; }, onOrbit: () => {}, onAction: () => {} });
      for (let frame = 0; frame < fps; frame++) input.tick(1 / fps, angles, 0);
      return { input, angle: angles[0] };
    }
    assert.ok(Math.abs(simulate(30).angle - simulate(144).angle) < 1e-10);
    let moved = false;
    const input = new GamepadInput({ onStatus: () => {}, onSelect: () => {}, onMove: () => { moved = true; }, onOrbit: () => {}, onAction: () => {} });
    input.hold();
    input.tick(.016, [0, 0, 0, 0], 0);
    assert.equal(moved, false);
    pad.axes[2] = 0;
    input.tick(.016, [0, 0, 0, 0], 0);
    pad.axes[2] = .8;
    input.tick(.016, [0, 0, 0, 0], 0);
    assert.equal(moved, true);
  } finally { Object.defineProperty(globalThis, 'navigator', original); }
});
