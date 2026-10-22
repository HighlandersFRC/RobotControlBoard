import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Plane, Points, Raycaster, ShaderMaterial, Vector2, Vector3 } from 'three';

// World-space simulation is shared by the renderer and deterministic tests.
export function createSnowField(count = 900, random = Math.random) {
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions.set([(random() - .5) * 44, random() * 30, (random() - .5) * 44], i * 3);
    sizes[i] = .035 + random() * .07;
    phases[i] = random() * Math.PI * 2;
  }
  return {
    positions, sizes, phases,
    step(delta, time, breeze) {
      const dt = Math.min(Math.max(delta, 0), .05);
      let touched = 0;
      for (let i = 0; i < count; i++) {
        const j = i * 3;
        if (breeze?.strength > .02) {
          const dx = positions[j] - breeze.point.x;
          const dy = positions[j + 1] - breeze.point.y;
          const dz = positions[j + 2] - breeze.point.z;
          const distance = Math.hypot(dx, dy, dz);
          if (distance < 6) {
            const force = (1 - distance / 6) ** 2 * breeze.strength * dt;
            const inverse = 1 / Math.max(distance, .3);
            velocities[j] += (dx * inverse * 4 + breeze.velocity.x) * force;
            velocities[j + 1] += (dy * inverse * 3 + 2 + breeze.velocity.y) * force;
            velocities[j + 2] += (dz * inverse * 4 + breeze.velocity.z) * force;
            touched++;
          }
        }
        const damping = Math.exp(-1.5 * dt);
        velocities[j] *= damping;
        velocities[j + 1] *= damping;
        velocities[j + 2] *= damping;
        positions[j] += (Math.sin(time * .4 + phases[i]) * .22 + .1 + velocities[j]) * dt;
        positions[j + 1] += (-.5 - sizes[i] * 7 + velocities[j + 1]) * dt;
        positions[j + 2] += (Math.cos(time * .3 + phases[i]) * .15 + velocities[j + 2]) * dt;
        if (positions[j + 1] < .02 || positions[j + 1] > 34) {
          positions[j + 1] = 30;
          positions[j] = (random() - .5) * 44;
          positions[j + 2] = (random() - .5) * 44;
          velocities.fill(0, j, j + 3);
        }
        if (positions[j] > 22) positions[j] = -22;
        if (positions[j] < -22) positions[j] = 22;
        if (positions[j + 2] > 22) positions[j + 2] = -22;
        if (positions[j + 2] < -22) positions[j + 2] = 22;
      }
      return touched;
    },
  };
}

export function createSnow({ scene, camera, canvas, toggle, renderer }) {
  const host = canvas.parentElement;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const events = new AbortController();
  const field = createSnowField(matchMedia('(max-width: 700px)').matches ? 520 : 900);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(field.positions, 3).setUsage(DynamicDrawUsage));
  geometry.setAttribute('size', new BufferAttribute(field.sizes, 1));
  geometry.setAttribute('phase', new BufferAttribute(field.phases, 1));
  const material = new ShaderMaterial({
    transparent: true, depthTest: true, depthWrite: false,
    uniforms: { time: { value: 0 }, scale: { value: 1 } },
    vertexShader: `
      attribute float size;
      attribute float phase;
      uniform float scale;
      uniform float time;
      varying float rotation;
      varying float distanceFade;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * view;
        gl_PointSize = clamp(size * scale / max(1.0, -view.z), 1.0, 14.0);
        rotation = phase + time * (0.25 + size * 2.0);
        distanceFade = 1.0 - smoothstep(14.0, 65.0, -view.z);
      }`,
    fragmentShader: `
      varying float rotation;
      varying float distanceFade;
      void main() {
        vec2 point = (gl_PointCoord - 0.5) * 2.0;
        float radius = length(point);
        float angle = atan(point.y, point.x) + rotation;
        float branch = pow(abs(cos(angle * 3.0)), 12.0);
        float edge = 0.28 + branch * 0.58;
        float alpha = (1.0 - smoothstep(edge - 0.12, edge, radius)) * 0.72 * distanceFade;
        if (alpha < 0.02) discard;
        gl_FragColor = vec4(vec3(0.83, 0.88, 0.92), alpha);
      }`,
  });
  const particles = new Points(geometry, material);
  particles.name = 'World-space snow';
  particles.frustumCulled = false;
  scene.add(particles);
  const ray = new Raycaster();
  const pointer = new Vector2();
  const normal = new Vector3();
  const plane = new Plane();
  const center = new Vector3(0, 7, 0);
  const point = new Vector3();
  const previous = new Vector3();
  const breeze = { point: new Vector3(), velocity: new Vector3(), strength: 0 };
  let inside = false;
  let wanted = true;
  let time = 0;
  let reduced = motion.matches;
  let interactions = 0;
  try { wanted = localStorage.getItem('budx-snow-enabled') !== 'false'; } catch { /* Use the default. */ }
  function sync() {
    reduced = motion.matches;
    particles.visible = wanted && !reduced;
    toggle.checked = particles.visible;
    toggle.disabled = reduced;
    toggle.parentElement.title = reduced ? 'Snow is paused for Reduce Motion' : 'Move the pointer through the scene to stir the snow';
    host.dataset.snowState = reduced ? 'paused' : wanted ? 'on' : 'off';
  }
  function stir(event) {
    if (!particles.visible) return;
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    ray.setFromCamera(pointer, camera);
    camera.getWorldDirection(normal);
    plane.setFromNormalAndCoplanarPoint(normal, center);
    if (!ray.ray.intersectPlane(plane, point)) return;
    breeze.velocity.copy(point).sub(previous).multiplyScalar(5).clampLength(0, 12);
    if (!inside) breeze.velocity.set(0, 0, 0);
    previous.copy(point);
    breeze.point.copy(point);
    breeze.strength = event.type === 'pointerdown' ? 12 : 5;
    inside = true;
  }
  canvas.addEventListener('pointermove', stir, { passive: true, signal: events.signal });
  canvas.addEventListener('pointerdown', stir, { passive: true, signal: events.signal });
  canvas.addEventListener('pointerleave', () => { inside = false; }, { signal: events.signal });
  toggle.addEventListener('change', () => {
    wanted = toggle.checked;
    try { localStorage.setItem('budx-snow-enabled', String(wanted)); } catch { /* Keep session state. */ }
    sync();
  }, { signal: events.signal });
  motion.addEventListener('change', sync, { signal: events.signal });
  host.dataset.snowRenderer = 'webgl';
  host.dataset.snowParticles = String(field.sizes.length);
  host.dataset.snowInteractions = '0';
  sync();
  return {
    tick(delta) {
      if (reduced !== motion.matches) sync();
      if (!particles.visible || document.hidden) return;
      time += Math.min(delta, .05);
      const touched = field.step(delta, time, breeze);
      if (touched) { interactions += touched; host.dataset.snowInteractions = String(interactions); }
      breeze.strength *= Math.exp(-delta * 3);
      geometry.attributes.position.needsUpdate = true;
      material.uniforms.time.value = time;
      material.uniforms.scale.value = canvas.clientHeight * renderer.getPixelRatio() / (2 * Math.tan(camera.fov * Math.PI / 360));
    },
    dispose() { events.abort(); scene.remove(particles); geometry.dispose(); material.dispose(); },
  };
}
