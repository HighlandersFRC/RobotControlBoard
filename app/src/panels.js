export function createPanels({ onChange = () => {} } = {}) {
  const workspace = document.querySelector('.workspace');
  const compact = matchMedia('(max-width: 700px)');
  const narrow = matchMedia('(max-width: 1000px)');
  const events = new AbortController();
  const panels = [
    { name: 'joints', label: 'arm controls', panel: document.getElementById('joint-sidebar'), button: document.getElementById('toggle-joints'), open: !compact.matches },
    { name: 'inputs', label: 'input devices', panel: document.getElementById('input-sidebar'), button: document.getElementById('toggle-inputs'), open: false },
  ];
  function sync() {
    for (const item of panels) {
      item.panel.hidden = !item.open;
      workspace.classList.toggle(`${item.name}-closed`, !item.open);
      item.button.setAttribute('aria-expanded', String(item.open));
      item.button.title = `${item.open ? 'Hide' : 'Show'} ${item.label}`;
    }
    onChange();
  }
  for (const item of panels) {
    try {
      const saved = localStorage.getItem(`budx-panel-${item.name}`);
      if (saved !== null && !compact.matches) item.open = saved === 'true';
    } catch { /* Use the screen-size default. */ }
    item.button.addEventListener('click', () => {
      item.open = !item.open;
      if (item.open && narrow.matches) panels.filter(other => other !== item).forEach(other => { other.open = false; });
      try { localStorage.setItem(`budx-panel-${item.name}`, String(item.open)); } catch { /* Keep session state. */ }
      sync();
    }, { signal: events.signal });
  }
  compact.addEventListener('change', () => {
    if (compact.matches) panels.forEach(item => { item.open = false; });
    sync();
  }, { signal: events.signal });
  function makeRoom() {
    if (narrow.matches && panels.every(item => item.open)) panels[1].open = false;
    sync();
  }
  narrow.addEventListener('change', makeRoom, { signal: events.signal });
  makeRoom();
  return { dispose() { events.abort(); } };
}
