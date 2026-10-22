export function createFullscreen({ target, button, onExpand = () => {} }) {
  const events = new AbortController();
  const signal = events.signal;
  const root = document.documentElement;
  const chrome = Array.from(document.querySelectorAll('.app-header, .joint-sidebar, .input-sidebar, .app-footer'));
  let inertState = null;
  let busy = false;
  let disposed = false;
  let timeout;
  const nativeElement = () => document.fullscreenElement ?? document.webkitFullscreenElement;
  const active = () => nativeElement() === target || target.classList.contains('expanded');

  function sync() {
    if (disposed) return;
    const expanded = active();
    const native = nativeElement() === target;
    if (native) target.classList.remove('expanded');
    root.classList.toggle('viewer-expanded', expanded);
    target.dataset.fullscreen = native ? 'native' : expanded ? 'expanded' : 'off';
    button.setAttribute('aria-label', expanded ? 'Exit fullscreen' : 'Enter fullscreen');
    button.setAttribute('aria-pressed', String(expanded));
    button.title = expanded ? 'Exit fullscreen (Esc)' : 'Fullscreen';
    button.querySelector('path')?.setAttribute('d', expanded ? 'M3 8h5V3m8 0v5h5M3 16h5v5m8 0v-5h5' : 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5');
    if (expanded && !inertState) {
      inertState = chrome.map(element => element.inert);
      chrome.forEach(element => { element.inert = true; });
      button.focus({ preventScroll: true });
    } else if (!expanded && inertState) {
      chrome.forEach((element, index) => { element.inert = inertState[index]; });
      inertState = null;
      button.focus({ preventScroll: true });
    }
    window.dispatchEvent(new Event('resize'));
  }

  function expand() {
    if (disposed) return;
    target.classList.add('expanded');
    sync();
    onExpand();
  }

  async function exit() {
    target.classList.remove('expanded');
    if (nativeElement() === target) {
      const leave = document.exitFullscreen ?? document.webkitExitFullscreen;
      try { await leave?.call(document); } catch { /* The host may have exited first. */ }
    }
    sync();
  }

  async function toggle() {
    if (busy || disposed) return;
    if (active()) { await exit(); return; }
    busy = true;
    const request = target.requestFullscreen ?? target.webkitRequestFullscreen;
    try {
      if (!request || document.fullscreenEnabled === false) { expand(); return; }
      // Some embedded hosts never settle the native request. The viewer must
      // still expand, with a working exit control, in that case.
      await Promise.race([
        Promise.resolve(request.call(target)),
        new Promise(resolve => { timeout = setTimeout(resolve, 600); }),
      ]);
      if (nativeElement() !== target) expand();
      else sync();
    } catch { expand(); }
    finally { clearTimeout(timeout); busy = false; }
  }

  for (const name of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(name, sync, { signal });
  document.addEventListener('keydown', event => {
    if (!active()) return;
    if (event.key === 'Escape') { void exit(); return; }
    if (event.key !== 'Tab') return;
    const controls = Array.from(target.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')).filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }, { signal });
  sync();

  return {
    toggle,
    dispose() {
      clearTimeout(timeout);
      events.abort();
      target.classList.remove('expanded');
      root.classList.remove('viewer-expanded');
      if (inertState) chrome.forEach((element, index) => { element.inert = inertState[index]; });
      if (nativeElement() === target) void (document.exitFullscreen ?? document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
      disposed = true;
    },
  };
}
