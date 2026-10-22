const SVG_NS = 'http://www.w3.org/2000/svg';
const STORAGE_KEY = 'budx-reduced-transparency';

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function edgeMap(width, height, radius) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  const halfWidth = width / 2, halfHeight = height / 2;
  const rim = Math.min(12, radius);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x - halfWidth, py = y - halfHeight;
      const qx = Math.abs(px) - halfWidth + radius;
      const qy = Math.abs(py) - halfHeight + radius;
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const length = Math.hypot(ox, oy);
      const distance = length + Math.min(Math.max(qx, qy), 0) - radius;
      const weight = Math.max(0, 1 - Math.abs(distance) / rim) ** 2;
      const nx = length ? ox / length : qx > qy ? 1 : 0;
      const ny = length ? oy / length : qy >= qx ? 1 : 0;
      const offset = (y * width + x) * 4;
      image.data[offset] = 128 + Math.sign(px) * nx * weight * 90;
      image.data[offset + 1] = 128 + Math.sign(py) * ny * weight * 90;
      image.data[offset + 2] = 128;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

export function createLiquidGlass() {
  const root = document.documentElement;
  const toggle = document.getElementById('glass-toggle');
  const picker = document.querySelector('.view-picker');
  const indicator = document.createElement('span');
  indicator.className = 'view-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  picker.prepend(indicator);
  const events = new AbortController();
  const signal = events.signal;
  const transparency = matchMedia('(prefers-reduced-transparency: reduce)');
  const contrast = matchMedia('(prefers-contrast: more)');
  const colors = matchMedia('(forced-colors: active)');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = matchMedia('(max-width: 580px)');
  let reduced = false;
  try { reduced = localStorage.getItem(STORAGE_KEY) === 'true'; } catch { /* The system preference still applies without storage. */ }
  const svg = svgElement('svg', { width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' });
  svg.style.position = 'absolute';
  svg.style.pointerEvents = 'none';
  const defs = svgElement('defs');
  svg.append(defs);
  document.body.append(svg);
  const surfaces = Array.from(document.querySelectorAll('[data-glass="premium"]')).map((surface, index) => {
    const id = `budx-glass-edge-${index}`;
    const filter = svgElement('filter', { id, x: '0%', y: '0%', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' });
    const image = svgElement('feImage', { result: 'edge', preserveAspectRatio: 'none' });
    filter.append(image, svgElement('feDisplacementMap', { in: 'SourceGraphic', in2: 'edge', scale: '10', xChannelSelector: 'R', yChannelSelector: 'G' }));
    defs.append(filter);
    surface.style.setProperty('--glass-refraction', `url("#${id}")`);
    surface.addEventListener('pointermove', event => {
      if (motion.matches || root.dataset.glassQuality === 'minimal') return;
      const bounds = surface.getBoundingClientRect();
      surface.style.setProperty('--shine-x', `${Math.round((event.clientX - bounds.left) / bounds.width * 100)}%`);
    }, { passive: true, signal });
    return { surface, image, size: '' };
  });
  let frame = 0;

  function update() {
    frame = 0;
    const systemReduced = transparency.matches || contrast.matches || colors.matches;
    const minimal = reduced || systemReduced;
    root.dataset.glassQuality = minimal ? 'minimal' : 'standard';
    root.dataset.glassMotion = motion.matches ? 'reduced' : 'full';
    root.dataset.glassRefraction = minimal || motion.matches || mobile.matches ? 'off' : 'on';
    toggle.setAttribute('aria-pressed', String(minimal));
    toggle.disabled = systemReduced;
    const label = systemReduced ? 'Transparency reduced by system settings' : minimal ? 'Enable liquid glass' : 'Reduce transparency';
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    const active = picker.querySelector('[aria-pressed="true"]');
    if (active) {
      indicator.style.width = `${active.offsetWidth}px`;
      indicator.style.transform = `translateX(${active.offsetLeft}px)`;
    }
    if (minimal || motion.matches || mobile.matches) return;
    surfaces.forEach(entry => {
      const width = Math.ceil(entry.surface.clientWidth), height = Math.ceil(entry.surface.clientHeight);
      if (!width || !height) return;
      const key = `${width}:${height}`;
      if (entry.size === key) return;
      entry.size = key;
      const radius = Math.min(parseFloat(getComputedStyle(entry.surface).borderRadius), width / 2, height / 2);
      entry.image.setAttribute('href', edgeMap(width, height, radius));
    });
  }

  function schedule() { if (!frame) frame = requestAnimationFrame(update); }
  const resize = new ResizeObserver(schedule);
  surfaces.forEach(({ surface }) => resize.observe(surface));
  const selection = new MutationObserver(schedule);
  selection.observe(picker, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
  for (const query of [transparency, contrast, colors, motion, mobile]) query.addEventListener('change', schedule, { signal });
  toggle.addEventListener('click', () => {
    reduced = !reduced;
    try { localStorage.setItem(STORAGE_KEY, String(reduced)); } catch { /* This session can still change appearance. */ }
    update();
  }, { signal });
  update();

  return {
    dispose() {
      events.abort();
      cancelAnimationFrame(frame);
      resize.disconnect();
      selection.disconnect();
      surfaces.forEach(({ surface }) => surface.style.removeProperty('--glass-refraction'));
      svg.remove();
      indicator.remove();
    },
  };
}
