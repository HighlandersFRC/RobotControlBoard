import { Object3D, Plane, Raycaster, Vector3 } from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { solveTarget, targetError } from './kinematics.js';

export function createToolManipulator({ scene, camera, canvas, rig, button, onMove, onSelect, onReach, onDrag }) {
  const target = new Object3D();
  target.name = 'Wrist position target';
  scene.add(target);
  const handles = new TransformControls(camera, canvas);
  handles.setMode('translate');
  handles.setSpace('world');
  handles.setSize(matchMedia('(pointer: coarse)').matches ? .85 : .65);
  handles.showXY = handles.showXZ = handles.showYZ = false;
  handles.minY = .05;
  handles.enabled = false;
  const helper = handles.getHelper();
  scene.add(helper);
  const events = new AbortController();
  const center = document.getElementById('wrist-handle');
  const ray = new Raycaster();
  let visible = true;
  let ready = false;
  let centerDrag = null;

  const sync = () => { if (!handles.dragging && !centerDrag) target.position.copy(rig.toolPosition()); };
  const unsubscribe = rig.subscribe(sync);
  function moveTo(position) {
    const next = position.clone();
    next.y = Math.max(.05, next.y);
    onMove(solveTarget(next, rig.getAngles(), { continuous: true }), 'manual');
    return next;
  }
  handles.addEventListener('dragging-changed', event => {
    canvas.parentElement.dataset.toolDragging = String(event.value);
    onDrag(event.value);
    if (event.value) onSelect(3);
    else sync();
  });
  handles.addEventListener('objectChange', () => moveTo(target.position));
  handles.addEventListener('mouseUp', () => onReach(targetError(rig, target.position)));
  function endCenter() {
    if (!centerDrag) return;
    const { id } = centerDrag;
    centerDrag = null;
    canvas.parentElement.dataset.toolDragging = 'false';
    onDrag(false);
    sync();
    if (center.hasPointerCapture(id)) center.releasePointerCapture(id);
  }
  function cancel() {
    endCenter();
    handles.pointerUp(null);
    sync();
  }
  function cast(event) {
    const rect = canvas.getBoundingClientRect();
    ray.setFromCamera({ x: (event.clientX - rect.left) / rect.width * 2 - 1, y: 1 - (event.clientY - rect.top) / rect.height * 2 }, camera);
  }
  center.addEventListener('pointerdown', event => {
    if (event.button !== 0 || centerDrag || handles.dragging || !ready) return;
    event.preventDefault();
    const position = rig.toolPosition();
    const plane = new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()), position);
    cast(event);
    const point = ray.ray.intersectPlane(plane, new Vector3());
    if (!point) return;
    centerDrag = { id: event.pointerId, plane, offset: position.sub(point) };
    center.setPointerCapture(event.pointerId);
    center.focus({ preventScroll: true });
    canvas.parentElement.dataset.toolDragging = 'true';
    onDrag(true);
    onSelect(3);
  }, { signal: events.signal });
  center.addEventListener('pointermove', event => {
    if (!centerDrag || centerDrag.id !== event.pointerId) return;
    cast(event);
    const position = ray.ray.intersectPlane(centerDrag.plane, new Vector3());
    if (position) target.position.copy(moveTo(position.add(centerDrag.offset)));
  }, { signal: events.signal });
  center.addEventListener('pointerup', event => {
    if (centerDrag?.id !== event.pointerId) return;
    onReach(targetError(rig, target.position));
    endCenter();
  }, { signal: events.signal });
  for (const name of ['pointercancel', 'lostpointercapture']) center.addEventListener(name, endCenter, { signal: events.signal });
  for (const name of ['pointercancel', 'lostpointercapture']) canvas.addEventListener(name, () => {
    if (handles.dragging) cancel();
  }, { signal: events.signal });
  function update() {
    handles.enabled = ready && visible;
    if (handles.enabled) { sync(); handles.attach(target); }
    else handles.detach();
    button.setAttribute('aria-pressed', String(visible));
    center.hidden = !handles.enabled;
    canvas.parentElement.dataset.toolHandles = handles.enabled ? 'visible' : 'hidden';
  }
  button.addEventListener('click', () => { cancel(); visible = !visible; update(); }, { signal: events.signal });
  function keyMove(event) {
    if (!ready || event.ctrlKey || event.metaKey || event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const step = .15 * (event.shiftKey ? 5 : 1);
    const offset = event.key.startsWith('Arrow') ? new Vector3(
      event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
      event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0,
      0,
    ) : new Vector3(0, 0, event.key === 'PageUp' ? -step : step);
    offset.applyQuaternion(camera.quaternion);
    onSelect(3);
    const next = moveTo(rig.toolPosition().add(offset));
    onReach(targetError(rig, next));
  }
  for (const control of [button, center]) control.addEventListener('keydown', keyMove, { signal: events.signal });
  return {
    moveTo,
    cancel,
    get active() { return handles.enabled && (centerDrag !== null || handles.dragging || handles.axis !== null); },
    setReady() { ready = true; button.disabled = center.disabled = false; update(); },
    updateScreen() {
      if (!handles.enabled) return;
      camera.updateMatrixWorld();
      const point = target.position.clone().project(camera);
      center.hidden = point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
      center.style.left = `${(point.x + 1) * canvas.clientWidth / 2}px`;
      center.style.top = `${(1 - point.y) * canvas.clientHeight / 2}px`;
      center.style.transform = 'translate(-50%, -50%)';
    },
    setTheme(light) { handles.setColors(light ? '#ffc2b9' : '#e2a29a', light ? '#c1e1ce' : '#a3c9b5', light ? '#c2def4' : '#a3c6e3', '#ffffff'); },
    dispose() { events.abort(); unsubscribe(); helper.removeFromParent(); target.removeFromParent(); handles.dispose(); },
  };
}
