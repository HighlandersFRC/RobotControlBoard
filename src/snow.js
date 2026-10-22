export function createSnow({ canvas, toggle }) {
  const context = canvas.getContext('2d');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const events = new AbortController();
  let wanted = true;
  let width = 0, height = 0;
  let flakes = [];
  let elapsed = 0;
  let reduced = motion.matches;
  try { wanted = localStorage.getItem('budx-snow-enabled') !== 'false'; } catch { /* Keep the default for this session. */ }
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 32;
  const brush = sprite.getContext('2d');
  const glow = brush.createRadialGradient(16, 16, 0, 16, 16, 16);
  glow.addColorStop(0, '#fff');
  glow.addColorStop(.25, '#f1f7ffff');
  glow.addColorStop(.6, '#d5e8ff54');
  glow.addColorStop(1, '#d5e8ff00');
  brush.fillStyle = glow;
  brush.fillRect(0, 0, 32, 32);

  function updateState() {
    reduced = motion.matches;
    const enabled = wanted && !reduced;
    toggle.checked = enabled;
    toggle.disabled = motion.matches;
    toggle.parentElement.title = motion.matches ? 'Snow is paused for Reduce Motion' : 'Show falling snow';
    canvas.dataset.state = motion.matches ? 'paused' : wanted ? 'on' : 'off';
    if (!enabled) context.clearRect(0, 0, width, height);
  }

  const observer = new ResizeObserver(() => {
    width = canvas.parentElement.clientWidth;
    height = canvas.parentElement.clientHeight;
    const ratio = Math.min(devicePixelRatio, 1.5);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const count = Math.min(170, Math.max(35, Math.round(width * height / 8500)));
    flakes = Array.from({ length: count }, () => {
      const depth = .3 + Math.random() * .7;
      return { x: Math.random() * width, y: Math.random() * height, size: 2 + depth * 5, speed: 14 + depth * 34, drift: Math.random() * 6, depth, phase: Math.random() * Math.PI * 2 };
    });
    canvas.dataset.particles = String(count);
  });
  observer.observe(canvas.parentElement);
  toggle.addEventListener('change', () => {
    wanted = toggle.checked;
    try { localStorage.setItem('budx-snow-enabled', String(wanted)); } catch { /* Keep the preference in memory. */ }
    updateState();
  }, { signal: events.signal });
  motion.addEventListener('change', updateState, { signal: events.signal });
  updateState();

  return {
    tick(delta) {
      // Reconcile after fullscreen or navigation even if the browser coalesced
      // the media-query change event while the drawing surface was inactive.
      if (reduced !== motion.matches) updateState();
      if (!wanted || motion.matches || document.hidden || !width) return;
      elapsed += delta;
      context.clearRect(0, 0, width, height);
      for (const flake of flakes) {
        flake.y += flake.speed * delta;
        flake.x += (flake.drift + Math.sin(elapsed * .35 + flake.phase) * 7) * delta;
        if (flake.y > height + 8) { flake.y = -8; flake.x = Math.random() * width; }
        if (flake.x > width + 8) flake.x = -8;
        if (flake.x < -8) flake.x = width + 8;
        context.globalAlpha = .25 + flake.depth * .5;
        context.drawImage(sprite, flake.x, flake.y, flake.size, flake.size);
      }
      context.globalAlpha = 1;
    },
    dispose() { events.abort(); observer.disconnect(); context.clearRect(0, 0, width, height); flakes = []; },
  };
}
