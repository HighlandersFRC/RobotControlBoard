import { MathUtils } from 'three';
import { JOINTS } from './arm/rig.js';

export const element = id => document.getElementById(id);
const duration = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export function createUI({ onSelect, onJoint, onAction, onSlot, onView }) {
  const events = new AbortController();
  const signal = events.signal;
  const listen = (id, type, listener) => element(id).addEventListener(type, listener, { signal });
  const fields = JOINTS.map((joint, index) => {
    const min = Math.round(MathUtils.radToDeg(joint.min)), max = Math.round(MathUtils.radToDeg(joint.max));
    const wrapper = document.createElement('div');
    wrapper.className = 'joint-control';
    wrapper.innerHTML = `<div class="joint-heading"><button class="joint-select" aria-pressed="false"><span>${index + 1}</span>${joint.name}</button><label class="angle-field"><input type="number" min="${min}" max="${max}" step="0.1" value="0" aria-label="${joint.name} angle" /><span>°</span></label></div><input type="range" min="${min}" max="${max}" step="0.1" value="0" aria-label="${joint.name} position" /><div class="joint-limits"><span>${min}°</span><span>${max}°</span></div>`;
    element('joint-controls').append(wrapper);
    const button = wrapper.querySelector('button');
    const number = wrapper.querySelector('[type="number"]');
    const slider = wrapper.querySelector('[type="range"]');
    button.addEventListener('click', () => onSelect(index), { signal });
    slider.addEventListener('input', () => { onSelect(index); onJoint(index, MathUtils.degToRad(slider.valueAsNumber)); }, { signal });
    number.addEventListener('change', () => {
      if (Number.isFinite(number.valueAsNumber)) { onSelect(index); onJoint(index, MathUtils.degToRad(number.valueAsNumber)); }
      number.value = slider.value;
    }, { signal });
    return { wrapper, button, number, slider, min, max };
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
        const degrees = MathUtils.radToDeg(angles[index]);
        field.slider.value = degrees.toFixed(1);
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
      const sources = { manual: ['Manual control', 'Sliders, keyboard, and model dragging.'], sequence: ['Motion playback', 'Manual movement takes over from playback.'], gamepad: ['Gamepad control', 'Right stick moves the selected joint.'], serial: ['Arduino control', 'Joint positions received over USB.'], hand: ['Hand control', 'Your hand is driving the arm.'], stopped: ['Motion stopped', 'Move a joint to resume. Serial input is paused.'] };
      const [title, note] = sources[name] ?? sources.manual;
      element('input-source').textContent = title;
      element('input-note').textContent = note;
    },
    gamepad(id) { connection('gamepad', !!id); element('gamepad-status').textContent = id ?? 'Plug in a controller and press a button.'; },
    serial(connected, busy) {
      connection('serial', connected);
      element('serial-status').textContent = connected ? 'Connected · 115200 baud' : 'USB serial · 115200 baud';
      element('connect-serial').textContent = busy ? 'Connecting…' : connected ? 'Disconnect Arduino' : 'Connect Arduino';
      element('connect-serial').disabled = busy;
    },
    camera(state) {
      if (cameraState === state) return;
      cameraState = state;
      const enabled = state === 'tracking' || state === 'detecting';
      connection('camera', enabled);
      element('camera-placeholder').hidden = enabled;
      element('camera-state').textContent = enabled ? 'On' : state === 'loading' ? 'Loading' : 'Off';
      element('tracking-status').textContent = { off: 'Camera off', loading: 'Loading tracker…', detecting: 'Show your hand', tracking: 'Hand detected' }[state];
      element('toggle-camera').textContent = enabled ? 'Disable camera' : state === 'loading' ? 'Loading…' : 'Enable camera';
      element('toggle-camera').disabled = state === 'loading';
      element('hand-control').disabled = !enabled;
      if (!enabled) element('hand-control').checked = false;
    },
    loading(count) { element('load-detail').textContent = `${count} of 4 model parts loaded`; },
    ready() { element('load-message').hidden = true; element('model-status').textContent = 'Model ready'; element('model-status').className = 'status-pill ready'; element('viewport').dataset.ready = 'true'; },
    loadError(message) { element('load-message').hidden = false; element('load-message').classList.add('error'); element('load-message').querySelector('strong').textContent = 'The arm could not be loaded'; element('load-detail').textContent = message; element('retry-load').hidden = false; element('model-status').textContent = 'Model unavailable'; element('model-status').className = 'status-pill error'; },
    retry() { element('load-message').classList.remove('error'); element('retry-load').hidden = true; element('load-message').querySelector('strong').textContent = 'Loading arm'; },
    dispose() { events.abort(); },
  };
}
