import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { JOINTS } from './arm/rig.js';
import { solveTarget, targetError } from './arm/kinematics.js';
import { disposeObject } from './arm/models.js';

export function createViewport({ canvas, rig, onSelect, onMove, onReach, onViewChange, onError }) {
  const container = canvas.parentElement;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e7ecef');
  scene.fog = new THREE.Fog('#e7ecef', 45, 110);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 180);
  camera.position.set(18, 14, 23);
  scene.add(rig.root);
  scene.add(new THREE.HemisphereLight('#f4f8ff', '#7b8e9a', 2.7));
  const key = new THREE.DirectionalLight('#fff8ed', 3.2);
  key.position.set(8, 20, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -20, right: 20, top: 24, bottom: -16, near: .1, far: 65 });
  key.shadow.bias = -.00025;
  key.shadow.normalBias = .025;
  key.shadow.blurSamples = 8;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#c7dff3', 1.9);
  fill.position.set(-12, 10, -8);
  scene.add(fill);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshStandardMaterial({ color: '#e0e7ec', roughness: .95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -.015;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(100, 100, '#a7bbc9', '#c1ced7');
  grid.position.y = .001;
  grid.material.transparent = true;
  grid.material.opacity = .46;
  scene.add(grid);
  const targetMarker = new THREE.Mesh(new THREE.RingGeometry(.16, .23, 32), new THREE.MeshBasicMaterial({ color: '#315f80', side: THREE.DoubleSide }));
  targetMarker.rotation.x = -Math.PI / 2;
  targetMarker.visible = false;
  scene.add(targetMarker);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let drag = null;
  let ready = false;
  let view = 'perspective';
  let selected = 0;
  const events = new AbortController();
  const signal = events.signal;
  const tooltip = document.getElementById('joint-tooltip');

  function cast(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }

  function pick(event) {
    cast(event);
    const hit = raycaster.intersectObject(rig.root, true)[0];
    let object = hit?.object;
    while (object && object.userData.jointIndex === undefined) object = object.parent;
    return object?.userData.jointIndex ?? null;
  }

  // Capture runs before OrbitControls handles the pointer, so a picked joint
  // never starts a camera drag at the same time.
  canvas.addEventListener('pointerdown', event => {
    if (!ready || event.button !== 0 || drag) return;
    const index = event.shiftKey ? null : pick(event);
    if (index === null && !event.shiftKey) return;
    event.preventDefault();
    controls.enabled = false;
    canvas.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, index, x: event.clientX, y: event.clientY, distance: 0, reach: event.shiftKey };
    if (index !== null) onSelect(index);
  }, { capture: true, signal });

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 6, 0);
  controls.enableDamping = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  controls.dampingFactor = .12;
  controls.minDistance = 7;
  controls.maxDistance = 85;
  controls.maxPolarAngle = Math.PI / 2 - .015;
  controls.addEventListener('start', () => { view = 'custom'; onViewChange(view); });

  canvas.addEventListener('pointermove', event => {
    if (!ready) return;
    if (drag) {
      if (event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      drag.distance += Math.abs(dx) + Math.abs(event.clientY - drag.y);
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (drag.index !== null) {
        const angles = rig.getAngles();
        angles[drag.index] += dx * .006 * (drag.index === 0 ? -1 : 1);
        onMove(angles, 'manual');
      }
    }
    const index = drag?.index ?? pick(event);
    canvas.style.cursor = index === null ? 'grab' : 'ew-resize';
    tooltip.hidden = index === null;
    if (index !== null) {
      const rect = container.getBoundingClientRect();
      tooltip.textContent = `${JOINTS[index].name} · ${THREE.MathUtils.radToDeg(rig.getAngles()[index]).toFixed(1)}°`;
      tooltip.style.left = `${Math.min(event.clientX - rect.left + 15, rect.width - 145)}px`;
      tooltip.style.top = `${Math.max(5, event.clientY - rect.top - 35)}px`;
    }
  }, { signal });

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const completed = drag;
    drag = null;
    controls.enabled = true;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (event.type === 'pointerup' && completed.reach && completed.distance < 8) {
      cast(event);
      const target = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      if (target) {
        targetMarker.position.copy(target).y = .025;
        targetMarker.visible = true;
        onMove(solveTarget(target, rig.getAngles()), 'manual');
        onReach(targetError(rig, target));
      }
    }
  }
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, endDrag, { signal });
  canvas.addEventListener('pointerleave', () => { tooltip.hidden = true; }, { signal });
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); onError('The 3D view lost its graphics connection. Reload to restore it.'); }, { signal });

  function fit(nextView = view) {
    view = nextView;
    const box = new THREE.Box3().setFromObject(rig.root);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    const distance = sphere.radius / Math.sin(Math.min(vertical, horizontal)) * 1.17;
    const direction = view === 'front' ? new THREE.Vector3(0, .025, 1) : view === 'top' ? new THREE.Vector3(0, 1, .001) : camera.position.clone().sub(controls.target);
    if (view === 'perspective') direction.set(.85, .48, 1);
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(direction.normalize(), distance);
    camera.lookAt(sphere.center);
    controls.update();
    onViewChange(view);
  }

  const observer = new ResizeObserver(() => {
    const width = container.clientWidth, height = container.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (ready) fit();
  });
  observer.observe(container);

  return {
    fit,
    setReady() { ready = true; fit('perspective'); },
    setGrid(visible) { grid.visible = visible; },
    select(index) {
      selected = index;
      rig.root.traverse(object => {
        if (!object.isMesh) return;
        let parent = object;
        while (parent && parent.userData.jointIndex === undefined) parent = parent.parent;
        const active = parent?.userData.jointIndex === selected;
        (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => {
          if (material.emissive) { material.emissive.set('#315f80'); material.emissiveIntensity = active ? .14 : 0; }
        });
      });
    },
    orbit(horizontal, vertical, zoom, delta) {
      if (!horizontal && !vertical && !zoom) return;
      const offset = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta -= horizontal * delta * 1.6;
      spherical.phi = THREE.MathUtils.clamp(spherical.phi + vertical * delta, .02, controls.maxPolarAngle);
      spherical.radius = THREE.MathUtils.clamp(spherical.radius + zoom * delta * 14, controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
      view = 'custom';
      onViewChange(view);
    },
    cancelDrag() { drag = null; controls.enabled = true; tooltip.hidden = true; },
    render() { controls.update(); renderer.render(scene, camera); },
    dispose() { events.abort(); observer.disconnect(); controls.dispose(); disposeObject(scene); grid.geometry.dispose(); grid.material.dispose(); renderer.dispose(); key.shadow.dispose(); },
  };
}
