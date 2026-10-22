import './style.css';
import './styles/liquid-glass.css';
import { createLiquidGlass } from './liquid-glass.js';
import { createRig } from './arm/rig.js';
import { disposeObject, loadModels } from './arm/models.js';
import { createViewport } from './viewport.js';
import { MotionLibrary, PRESETS } from './motion.js';
import { SerialConnection } from './inputs/serial.js';
import { GamepadInput } from './inputs/gamepad.js';
import { HandTracking } from './inputs/hand-tracking.js';
import { createUI, element } from './ui.js';

export const rig = createRig();
let selected = 0;
let ready = false;
let loading = false;
let disposed = false;
let source = 'manual';
let controlRevision = 0;
let viewport;
const events = new AbortController();
const ui = createUI({
  onSelect: selectJoint,
  onJoint: moveJoint,
  onAction: action,
  onSlot: index => { motion.select(index); ui.motion(motion); },
  onView: name => viewport?.fit(name),
});
const reportError = message => ui.activity(message, true);
const glass = createLiquidGlass();
let storage;
try { storage = window.localStorage; }
catch { reportError('Browser storage is unavailable. Recordings will last for this session.'); }
const motion = new MotionLibrary({ getAngles: rig.getAngles, applyAngles, storage, onError: reportError });
const serial = new SerialConnection({
  getAngles: rig.getAngles,
  onAngles: applyAngles,
  onOrbit: (dx, dy) => viewport?.orbit(dx, dy, 0, 1),
  onStatus: ui.serial,
  onError: reportError,
});
const tracker = new HandTracking({
  video: element('camera-video'),
  canvas: element('camera-overlay'),
  getAngles: rig.getAngles,
  onAngles: applyAngles,
  onState: state => {
    ui.camera(state);
    if (state === 'off' && source === 'hand') setSource('manual');
  },
  onError: reportError,
});
const gamepad = new GamepadInput({
  onStatus: ui.gamepad,
  onSelect: selectJoint,
  onMove: applyAngles,
  onOrbit: (...args) => viewport?.orbit(...args),
  onAction: action,
});

function setSource(next) {
  if (next === source) return;
  source = next;
  ui.source(next);
}

function pauseHand() {
  tracker.setControl(false);
  element('hand-control').checked = false;
}

function applyAngles(angles, input = 'manual') {
  if (!ready || disposed) return;
  if (motion.mode === 'playing' && (input === 'hand' || input === 'serial')) return;
  if (input !== 'sequence' && motion.mode === 'playing') motion.stop();
  if (input === 'manual' || input === 'gamepad') controlRevision++;
  if (input !== 'hand') pauseHand();
  serial.resume();
  setSource(input);
  rig.setAngles(angles, input);
}

function moveJoint(index, value) {
  const angles = rig.getAngles();
  angles[index] = value;
  applyAngles(angles);
}

function selectJoint(index) {
  selected = index;
  ui.select(index);
  viewport?.select(index);
}

function stop() {
  controlRevision++;
  motion.stop();
  pauseHand();
  gamepad.hold();
  serial.hold();
  viewport?.cancelDrag();
  setSource('stopped');
  ui.motion(motion);
  ui.activity('Motion stopped. The arm is holding its current pose.');
}

async function action(name) {
  if (name === 'stop') { stop(); return; }
  if (name === 'retry') { await load(); return; }
  if (!ready) return;
  if (name === 'home') {
    motion.stop();
    applyAngles([0, 0, 0, 0]);
    ui.activity('Arm returned to home.');
  } else if (name === 'fit') viewport.fit();
  else if (name === 'record') {
    motion.record();
    if (source === 'sequence') setSource('manual');
    ui.activity(motion.mode === 'recording' ? 'Recording your movements. Press Save recording to keep them.' : 'Recording saved to this slot.');
  } else if (name === 'play' || PRESETS[name]) {
    controlRevision++;
    pauseHand();
    serial.resume();
    motion.play(PRESETS[name] ? name : undefined);
    setSource(motion.mode === 'playing' ? 'sequence' : 'manual');
    ui.activity(motion.mode === 'playing' ? `Playing ${PRESETS[name] ? name : `slot ${motion.activeSlot + 1}`}.` : 'Playback stopped.');
  } else if (name === 'serial') await serial.toggle();
  else if (name === 'camera') {
    const revision = controlRevision;
    await tracker.toggle();
    if (tracker.enabled && revision === controlRevision) {
      motion.stop();
      tracker.setControl(true);
      element('hand-control').checked = true;
      setSource('hand');
      if (element('face-blur').checked) await tracker.setBlur(true);
    }
  } else if (name === 'fullscreen') {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (element('app').requestFullscreen) await element('app').requestFullscreen();
      else reportError('Fullscreen is unavailable in this browser.');
    } catch { reportError('Fullscreen could not be opened.'); }
  }
  ui.motion(motion);
}

ui.listen('loop', 'change', event => { motion.loop = event.target.checked; });
ui.listen('speed', 'change', event => { motion.speed = Number(event.target.value); });
ui.listen('show-grid', 'change', event => viewport?.setGrid(event.target.checked));
ui.listen('smoothing', 'change', event => { tracker.smoothing = event.target.checked; });
ui.listen('face-blur', 'change', async event => { await tracker.setBlur(event.target.checked); event.target.checked = tracker.blur; });
ui.listen('hand-control', 'change', event => {
  motion.stop();
  tracker.setControl(event.target.checked);
  serial.resume();
  setSource(tracker.control ? 'hand' : 'manual');
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { stop(); return; }
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName) || event.target.isContentEditable || event.ctrlKey || event.metaKey || event.altKey) return;
  if (/^[1-4]$/.test(event.key)) selectJoint(Number(event.key) - 1);
  if (event.key.toLowerCase() === 'f') viewport?.fit();
  if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    moveJoint(selected, rig.getAngles()[selected] + (event.key === 'ArrowLeft' ? -1 : 1) * Math.PI / 180 * (event.shiftKey ? 5 : 1));
  }
}, { signal: events.signal });
document.addEventListener('fullscreenchange', () => { element('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'); }, { signal: events.signal });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stop();
    void tracker.stop();
  }
}, { signal: events.signal });

rig.subscribe((angles, input) => {
  ui.angles(angles, rig.toolPosition());
  if (input !== 'serial') serial.queue(angles);
});

async function load() {
  if (loading || ready || !viewport) return;
  loading = true;
  ui.retry();
  try {
    await loadModels(rig, ui.loading);
    if (disposed) { disposeObject(rig.root); return; }
    ready = true;
    viewport.setReady();
    selectJoint(selected);
    ui.ready();
    ui.angles(rig.getAngles(), rig.toolPosition());
    ui.activity('Ready. Select a joint to start moving.');
  } catch (error) { ui.loadError(error.message); reportError(error.message); }
  finally { loading = false; }
}

let frame = 0;
let previous = performance.now();
function tick(now) {
  if (disposed) return;
  const delta = Math.min((now - previous) / 1000, .1);
  previous = now;
  if (!document.hidden && ready) {
    gamepad.tick(delta, rig.getAngles(), selected);
    motion.tick(delta);
    serial.tick(now);
    if (motion.mode === 'idle' && source === 'sequence') setSource('manual');
    ui.motion(motion);
  }
  viewport?.render();
  frame = requestAnimationFrame(tick);
}

function dispose() {
  if (disposed) return;
  stop();
  disposed = true;
  cancelAnimationFrame(frame);
  events.abort();
  ui.dispose();
  glass.dispose();
  void tracker.stop();
  void serial.disconnect();
  viewport?.dispose();
}
window.addEventListener('pagehide', event => {
  if (!event.persisted) dispose();
  else { stop(); void tracker.stop(); void serial.disconnect(); }
}, { signal: events.signal });
import.meta.hot?.dispose(dispose);

selectJoint(0);
ui.angles(rig.getAngles(), rig.toolPosition());
ui.motion(motion);
try {
  viewport = createViewport({
    canvas: element('arm-canvas'),
    rig,
    onSelect: selectJoint,
    onMove: applyAngles,
    onViewChange: ui.view,
    onError: message => { stop(); reportError(message); },
    onReach: error => ui.activity(error < .1 ? 'Tool moved to target.' : 'Closest reachable pose. This target is outside the joint limits.'),
  });
  frame = requestAnimationFrame(tick);
  void load();
} catch (error) {
  ui.loadError('The 3D view needs WebGL. Enable hardware acceleration in your browser, then reload.');
  reportError(error.message);
}
