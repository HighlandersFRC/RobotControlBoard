const SUN = 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5';
const MOON = 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z';

export function createTheme({ onChange = () => {} } = {}) {
  const root = document.documentElement;
  const button = document.getElementById('theme-toggle');
  const events = new AbortController();
  function apply(value) {
    const light = value === 'light';
    root.dataset.theme = light ? 'light' : 'dark';
    button.setAttribute('aria-pressed', String(light));
    button.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
    button.title = light ? 'Switch to dark mode' : 'Switch to light mode';
    button.querySelector('path').setAttribute('d', light ? MOON : SUN);
    document.querySelector('meta[name="theme-color"]').content = getComputedStyle(root).backgroundColor;
    onChange();
  }
  button.addEventListener('click', () => {
    const value = root.dataset.theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('budx-theme', value); } catch { /* The current session can still switch themes. */ }
    apply(value);
  }, { signal: events.signal });
  window.addEventListener('storage', event => {
    if (event.key === 'budx-theme') apply(event.newValue);
  }, { signal: events.signal });
  apply(root.dataset.theme);
  return { dispose() { events.abort(); } };
}
