import './style.css';
import './styles/liquid-glass.css';
import { createLiquidGlass } from './liquid-glass.js';
import { createFullscreen } from './fullscreen.js';
import { createPanels } from './panels.js';
import { createTheme } from './theme.js';
import { createRig, JOINTS } from './arm/rig.js';
import { Movement } from './movement.js';
import { disposeObject, loadModels } from './arm/models.js';
import { createViewport } from './viewport.js';
import { MotionLibrary, PRESETS } from './motion.js';
import { SerialConnection } from './inputs/serial.js';
import { GamepadInput } from './inputs/gamepad.js';
import { HandTracking } from './inputs/hand-tracking.js';
import { createUI, element } from './ui.js';

export const rig = createRig();
const movement = new Movement(rig);
let selected = 3;
let ready = false;
let loading = false;
let disposed = false;
let source = 'manual';
let viewport;
const events = new AbortController();
const ui = createUI({
  onSelect: selectJoint,
  onJoint: moveJoint,
  onAction: action,
  onSlot: index => { motion.select(index); movement.hold(); serial.hold(); ui.motion(motion); },
  onView: name => viewport?.fit(name),
});
const reportError = message => ui.activity(message, true);
const glass = createLiquidGlass();
const fullscreen = createFullscreen({ target: element('viewport'), button: element('fullscreen'), onExpand: () => ui.activity('Viewer expanded. Press Esc to return.') });
const panels = createPanels({ onChange: () => viewport?.resize() });
const theme = createTheme({ onChange: () => viewport?.setTheme() });
let storage;
try { storage = window.localStorage; }
catch { reportError('Browser storage is unavailable. Recordings will last for this session.'); }
const motion = new MotionLibrary({ getAngles: rig.getAngles, applyAngles, storage, onError: reportError });
const serial = new SerialConnection({
  getAngles: rig.getAngles,
  onStatus: ui.serial,
  onTraffic: status => {
    if (status.state === 'ready') {
      stop();
      ui.activity('Arduino ready. Move a control to start.');
    }
    ui.serialTraffic(status);
  },
  onError: message => { stop(); reportError(message); },
});
const tracker = new HandTracking({
  video: element('camera-video'),
  canvas: element('camera-overlay'),
  getAngles: rig.getAngles,
  onAngles: applyAngles,
  onState: state => {
    ui.camera(state);
    if (state === 'detecting' && source === 'hand') { movement.hold(); serial.hold(); }
  },
  onControlChange: enabled => {
    ui.handControl(enabled);
    if (!enabled && source === 'hand') { movement.hold(); serial.hold(); setSource('manual'); }
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
}

function applyAngles(angles, input = 'manual') {
  if (!ready || disposed) return;
  if (input === 'hand' && (!tracker.enabled || !tracker.control)) return;
  if (motion.mode === 'playing' && input === 'hand') return;
  if (!Array.isArray(angles) || angles.length !== 4 || !angles.every(Number.isFinite)) return;
  if (input !== 'sequence' && motion.mode === 'playing') motion.stop();
  if (input !== 'hand') pauseHand();
  serial.resume();
  setSource(input);
  movement.setTarget(angles, input);
}

function moveJoint(index, value) {
  const angles = source === 'hand' || source === 'sequence' ? rig.getAngles() : movement.getTarget();
  angles[index] = value;
  applyAngles(angles);
}

function selectJoint(index) {
  selected = index;
  ui.select(index);
  viewport?.select(index);
}

function stop() {
  motion.stop();
  movement.hold();
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
  if (name === 'fullscreen') { await fullscreen.toggle(); return; }
  if (!ready) return;
  if (name === 'home') {
    motion.stop();
    applyAngles([0, 0, 0, 0]);
    ui.activity('Moving arm home; claw half open.');
  } else if (name === 'fit') viewport.fit();
  else if (name === 'record') {
    motion.record();
    if (source === 'sequence') setSource('manual');
    ui.activity(motion.mode === 'recording' ? 'Recording your movements. Press Save recording to keep them.' : 'Recording saved to this slot.');
  } else if (name === 'play' || PRESETS[name]) {
    if (name === 'play' && motion.mode === 'playing') { stop(); return; }
    pauseHand();
    serial.resume();
    motion.play(PRESETS[name] ? name : undefined);
    setSource(motion.mode === 'playing' ? 'sequence' : 'manual');
    ui.activity(motion.mode === 'playing' ? `Playing ${PRESETS[name] ? name : `slot ${motion.activeSlot + 1}`}.` : 'Playback stopped.');
  } else if (name === 'serial') await serial.toggle();
  else if (name === 'camera') {
    await tracker.toggle();
    if (tracker.enabled && element('face-blur').checked) await tracker.setBlur(true);
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
  movement.hold();
  serial.hold();
  tracker.setControl(event.target.checked);
  setSource(tracker.control ? 'hand' : 'manual');
  ui.handControl(tracker.control);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { stop(); return; }
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName) || event.target.isContentEditable || event.ctrlKey || event.metaKey || event.altKey) return;
  if (/^[1-4]$/.test(event.key)) selectJoint(Number(event.key) - 1);
  if (event.key.toLowerCase() === 'f') viewport?.fit();
  if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    const step = selected === 3 ? (JOINTS[3].max - JOINTS[3].min) / 100 : Math.PI / 180;
    moveJoint(selected, movement.getTarget()[selected] + (event.key === 'ArrowLeft' ? -1 : 1) * step * (event.shiftKey ? 5 : 1));
  }
}, { signal: events.signal });
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
    // Use upright bounds for a stable opening scale, then show the folded pose.
    rig.setAngles([-116.6, 60, 61.4, 0].map(value => value * Math.PI / 180));
    movement.hold();
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
    movement.tick(delta);
    serial.tick(now);
    if (motion.mode === 'idle' && source === 'sequence') setSource('manual');
    ui.motion(motion);
  }
  viewport?.render(delta);
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
  fullscreen.dispose();
  panels.dispose();
  theme.dispose();
  void tracker.stop();
  void serial.disconnect();
  viewport?.dispose();
}
window.addEventListener('pagehide', event => {
  if (!event.persisted) dispose();
  else { stop(); void tracker.stop(); void serial.disconnect(); }
}, { signal: events.signal });
import.meta.hot?.dispose(dispose);

selectJoint(selected);
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
