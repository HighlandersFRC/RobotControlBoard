import { MathUtils } from 'three';
import { JOINTS } from './arm/rig.js';

export const element = id => document.getElementById(id);
const duration = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export function createUI({ onSelect, onJoint, onAction, onSlot, onView }) {
  const events = new AbortController();
  const signal = events.signal;
  const listen = (id, type, listener) => element(id).addEventListener(type, listener, { signal });
  const fields = JOINTS.map((joint, index) => {
    const claw = joint.unit === '%';
    const min = claw ? 0 : Math.round(MathUtils.radToDeg(joint.min)), max = claw ? 100 : Math.round(MathUtils.radToDeg(joint.max));
    const fromDisplay = value => claw ? joint.min + value / 100 * (joint.max - joint.min) : MathUtils.degToRad(value);
    const toDisplay = value => claw ? (value - joint.min) / (joint.max - joint.min) * 100 : MathUtils.radToDeg(value);
    const label = claw ? 'Claw opening' : `${joint.name} angle`;
    const wrapper = document.createElement('div');
    wrapper.className = 'joint-control';
    wrapper.innerHTML = `<div class="joint-heading"><button class="joint-select" aria-pressed="false" title="Select ${joint.name} (${index + 1})">${joint.name}</button><label class="angle-field"><input type="number" min="${min}" max="${max}" step="0.1" value="0" aria-label="${label}" /><span>${claw ? '%' : '°'}</span></label></div><input type="range" min="${min}" max="${max}" step="0.1" value="0" title="${claw ? 'Closed to open' : `${min}° to ${max}°`}" aria-label="${joint.name} position" />`;
    element('joint-controls').append(wrapper);
    const button = wrapper.querySelector('button');
    const number = wrapper.querySelector('[type="number"]');
    const slider = wrapper.querySelector('[type="range"]');
    button.addEventListener('click', () => onSelect(index), { signal });
    slider.addEventListener('input', () => { onSelect(index); onJoint(index, fromDisplay(slider.valueAsNumber)); }, { signal });
    number.addEventListener('change', () => {
      if (Number.isFinite(number.valueAsNumber)) { onSelect(index); onJoint(index, fromDisplay(number.valueAsNumber)); }
      number.value = slider.value;
    }, { signal });
    return { wrapper, button, number, slider, min, max, toDisplay, claw };
  });
  const slots = Array.from(document.querySelectorAll('[data-slot]'));
  slots.forEach(button => button.addEventListener('click', () => onSlot(Number(button.dataset.slot)), { signal }));
  document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => onAction(button.dataset.preset), { signal }));
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => onView(button.dataset.view), { signal }));
  for (const [id, action] of Object.entries({ 'home-arm': 'home', 'stop-motion': 'stop', record: 'record', play: 'play', 'fit-view': 'fit', fullscreen: 'fullscreen', 'connect-serial': 'serial', 'toggle-camera': 'camera', 'retry-load': 'retry' })) listen(id, 'click', () => onAction(action));
  const devices = { gamepad: false, serial: false, camera: false };
  let cameraState = '';
  let lastMotion = '';

  function connection(type, connected) {
    devices[type] = connected;
    const dot = element(`${type}-dot`);
    dot?.classList.toggle('connected', connected);
    element('connection-count').textContent = `${Object.values(devices).filter(Boolean).length} active`;
  }

  return {
    listen,
    select(index) {
      fields.forEach((field, current) => { field.wrapper.classList.toggle('selected', current === index); field.button.setAttribute('aria-pressed', String(current === index)); });
      element('selected-joint').textContent = `${JOINTS[index].name} selected`;
    },
    angles(angles, tool) {
      fields.forEach((field, index) => {
        const degrees = field.toDisplay(angles[index]);
        field.slider.value = degrees.toFixed(1);
        if (field.claw) field.slider.setAttribute('aria-valuetext', `${degrees.toFixed(0)}% open`);
        field.slider.style.setProperty('--fill', `${(degrees - field.min) / (field.max - field.min) * 100}%`);
        if (document.activeElement !== field.number) field.number.value = degrees.toFixed(1);
      });
      // One scene unit is 20 mm at the model's display scale of 50.
      element('tool-position').textContent = `Tool  X ${(tool.x * 20).toFixed(0)}  Y ${(tool.y * 20).toFixed(0)}  Z ${(tool.z * 20).toFixed(0)} mm`;
    },
    motion(motion) {
      const signature = JSON.stringify([motion.mode, motion.activeSlot, motion.slots.map(slot => slot?.duration), Math.floor(motion.elapsed * 10)]);
      if (signature === lastMotion) return;
      lastMotion = signature;
      slots.forEach((button, index) => {
        button.setAttribute('aria-pressed', String(index === motion.activeSlot));
        button.querySelector('span').textContent = motion.slots[index] ? duration(motion.slots[index].duration) : 'Empty';
      });
      element('record').classList.toggle('recording', motion.mode === 'recording');
      element('record-label').textContent = motion.mode === 'recording' ? 'Save recording' : 'Record';
      element('play').textContent = motion.mode === 'playing' ? 'Stop' : 'Play';
      element('play').disabled = motion.mode !== 'playing' && !motion.slots[motion.activeSlot];
      element('motion-state').textContent = { idle: 'Idle', playing: 'Playing', recording: 'Recording' }[motion.mode];
      element('motion-time').textContent = duration(motion.elapsed);
      element('motion-progress').value = motion.mode === 'recording' ? motion.elapsed / 60 : motion.playing ? motion.elapsed / motion.playing.duration : 0;
    },
    view(name) { document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === name))); },
    activity(message, error = false) { element('activity').textContent = message; element('activity').classList.toggle('error', error); },
    source(name) {
      const sources = { manual: ['Manual control', 'Sliders, keyboard, and model dragging.'], sequence: ['Motion playback', 'Manual movement takes over from playback.'], gamepad: ['Gamepad control', 'Right stick moves the selected joint or claw.'], hand: ['Hand control', 'Your hand is driving the arm. Curl your index finger to close the claw.'], stopped: ['Motion stopped', 'Move a control to resume. Serial output is paused.'] };
      const [title, note] = sources[name] ?? sources.manual;
      element('input-source').textContent = title;
      element('input-note').textContent = note;
    },
    gamepad(id) { connection('gamepad', !!id); element('gamepad-status').textContent = id ?? 'No controller connected'; },
    serial(connected, busy) {
      connection('serial', connected);
      element('serial-status').textContent = connected ? 'Connected · 115200 baud' : 'USB serial · 115200 baud';
      element('connect-serial').textContent = busy ? 'Connecting…' : connected ? 'Disconnect Arduino' : 'Connect Arduino';
      element('connect-serial').disabled = busy;
      element('serial-format').disabled = connected || busy;
    },
    serialTraffic({ state, count, joint, letter, message }) {
      const output = element('serial-output');
      output.hidden = state === 'disconnected';
      output.textContent = state === 'starting' ? 'Waiting for Arduino startup…' : state === 'ready' ? '0 commands sent · Move a control' : `${count} commands sent · ${message ? 'Position targets' : `${joint}: ${letter}`}`;
      output.title = `Counts browser writes, not confirmed hardware movement.${message ? ` Last sent: ${message}` : ' Small changes wait until they reach a servo step.'}`;
    },
    serialFormat(format) {
      element('serial-format').value = format;
      element('serial-format-note').textContent = format === 'positions' ? 'Position firmware · Claw uses S4' : 'Repo sketch · Channels 0, 1, 2, 4';
    },
    camera(state) {
      if (cameraState === state) return;
      cameraState = state;
      const enabled = state === 'tracking' || state === 'detecting';
      const busy = state === 'loading' || state === 'stopping';
      element('camera-preview').hidden = !enabled;
      element('hand-options').hidden = !enabled;
      connection('camera', enabled);
      element('camera-placeholder').hidden = enabled;
      element('camera-state').textContent = enabled ? 'On' : state === 'stopping' ? 'Stopping' : state === 'loading' ? 'Loading' : 'Off';
      element('tracking-status').textContent = { off: 'Camera off', stopping: 'Stopping camera…', loading: 'Loading tracker…', detecting: 'Show your hand', tracking: 'Hand detected' }[state];
      element('toggle-camera').textContent = enabled ? 'Disable camera' : state === 'stopping' ? 'Stopping…' : state === 'loading' ? 'Loading…' : 'Enable camera';
      element('toggle-camera').disabled = busy;
      element('hand-control').disabled = !enabled;
      if (!enabled) element('hand-control').checked = false;
    },
    handControl(enabled) { element('hand-control').checked = enabled; },
    loading(count) { element('load-detail').textContent = `${count} of 4 model parts loaded`; },
    ready() { element('load-message').hidden = true; element('model-status').textContent = 'Model ready'; element('model-status').className = 'status-pill ready'; element('viewport').dataset.ready = 'true'; },
    loadError(message) { element('load-message').hidden = false; element('load-message').classList.add('error'); element('load-message').querySelector('strong').textContent = 'The arm could not be loaded'; element('load-detail').textContent = message; element('retry-load').hidden = false; element('model-status').textContent = 'Model unavailable'; element('model-status').className = 'status-pill error'; },
    retry() { element('load-message').classList.remove('error'); element('retry-load').hidden = true; element('load-message').querySelector('strong').textContent = 'Loading arm'; },
    dispose() { events.abort(); },
  };
}
