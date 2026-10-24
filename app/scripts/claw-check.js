async page => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = [];
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    window.__armTest = { writes: [], trackers: [], landmarks: null, pad: null };
    window.Hands = class {
      constructor() { window.__armTest.trackers.push(this); }
      setOptions() {}
      onResults(callback) { this.callback = callback; }
      async send() { this.callback({ multiHandLandmarks: window.__armTest.landmarks ? [window.__armTest.landmarks] : [] }); }
      async close() { this.closed = true; }
    };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 400;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(20);
      const timer = setInterval(() => { ctx.fillStyle = '#293848'; ctx.fillRect(0, 0, 640, 400); ctx.fillStyle = '#91a7ba'; ctx.fillRect(280, 120, 80, 140); }, 50);
      window.__armTest.stream = stream;
      stream.getTracks()[0].addEventListener('ended', () => clearInterval(timer));
      return stream;
    }, configurable: true });
    Object.defineProperty(navigator, 'serial', { value: { requestPort: async () => ({
      open: async options => { window.__armTest.baudRate = options.baudRate; },
      close: async () => {},
      readable: new ReadableStream({ start(controller) { window.__armTest.reader = controller; } }),
      writable: new WritableStream({ write(bytes) { window.__armTest.writes.push({ letter: new TextDecoder().decode(bytes), time: performance.now() }); } }),
    }) }, configurable: true });
    Object.defineProperty(navigator, 'getGamepads', { value: () => window.__armTest.pad ? [window.__armTest.pad] : [] });
  });
  const target = await context.newPage();
  target.on('pageerror', error => errors.push(error.message));
  const state = () => target.evaluate(async () => {
    const { rig } = await import(document.querySelector('script[type="module"][src*="/src/main.js"]').src);
    return { time: performance.now(), angles: rig.getAngles(), rotation: rig.pivots[3].rotation.toArray(), gap: rig.clawJaws[1].position.x - rig.clawJaws[0].position.x, writes: window.__armTest.writes };
  });
  const still = (a, b) => a.angles.every((angle, index) => Math.abs(angle - b.angles[index]) < 1e-8);
  try {
    await target.goto('http://127.0.0.1:5173/');
    await target.locator('#viewport[data-ready="true"]').waitFor();
    check(await target.getByRole('spinbutton', { name: 'Claw opening', exact: true }).inputValue() === '50.0', 'Fourth control must display claw opening as a percentage.');
    check(await target.getByRole('button', { name: 'Wrist', exact: true }).count() === 0, 'The fourth control must no longer be Wrist.');
    await target.locator('#toggle-inputs').click();
    const hand = target.locator('#hand-control');
    await target.locator('#toggle-camera').click();
    await target.waitForFunction(() => document.getElementById('camera-state').textContent === 'On');
    check(!await hand.isChecked(), 'Camera preview must not automatically enable motion.');
    const preview = await state();
    await target.waitForTimeout(250);
    check(still(preview, await state()), 'Camera preview alone must leave the arm still.');
    await target.locator('#connect-serial').click();
    await target.getByText('Waiting for Arduino startup…', { exact: true }).waitFor();
    check((await state()).writes.length === 0, 'No movement letters may be written while Arduino is starting.');
    await target.getByRole('slider', { name: 'Turntable position', exact: true }).press('End');
    await target.getByRole('button', { name: 'Disconnect Arduino', exact: true }).waitFor();
    check(await target.locator('#serial-output').textContent() === '0 commands sent · Move a control', 'The connection must display its command count.');
    const connected = await state();
    await target.waitForTimeout(250);
    check(still(connected, await state()) && (await state()).writes.length === 0, 'Connecting must cancel model destinations made during startup and wait for fresh input.');
    check(await target.evaluate(() => window.__armTest.baudRate) === 115200, 'The original sketch baud rate must be preserved.');
    check((await state()).writes.length === 0, 'Connecting must not move the hardware.');
    const beforeClaw = await state();
    await target.getByRole('slider', { name: 'Claw position', exact: true }).press('End');
    await target.waitForTimeout(750);
    const afterClaw = await state();
    check(afterClaw.angles[3] > beforeClaw.angles[3] && afterClaw.angles[3] - beforeClaw.angles[3] < .28, 'A slider jump must move gradually.');
    check(afterClaw.angles.slice(0, 3).every((angle, index) => angle === beforeClaw.angles[index]), 'The Claw control must leave arm joints alone.');
    check(afterClaw.gap > beforeClaw.gap && afterClaw.rotation[1] === 0, 'Claw motion must open jaws, not rotate the old wrist.');
    check(afterClaw.writes.length > 0 && afterClaw.writes.every(write => write.letter === 'u'), 'Claw opening must send only the channel 4 increase letter.');
    check(/commands sent · Claw: u/.test(await target.locator('#serial-output').textContent()), 'Serial status must show the claw command actually written.');
    await target.locator('#stop-motion').click();
    const stopped = await state();
    await target.waitForTimeout(250);
    check(still(stopped, await state()) && (await state()).writes.length === stopped.writes.length, 'Stop must drop both model and serial destinations.');
    await target.evaluate(() => {
      const points = Array.from({ length: 21 }, () => ({ x: .4, y: .5 }));
      points[0] = { x: .4, y: .8 }; points[5] = { x: .4, y: .55 }; points[6] = { x: .4, y: .4 }; points[7] = { x: .4, y: .25 }; points[9] = { x: .4, y: .35 };
      window.__armTest.landmarks = points;
    });
    await hand.check();
    const beforeHand = await state();
    await target.waitForTimeout(450);
    const afterHand = await state();
    check(!still(beforeHand, afterHand), 'Checking Move arm with hand must enable tracked motion.');
    check(afterHand.angles.every((angle, index) => Math.abs(angle - beforeHand.angles[index]) < .2), 'Hand targets must share the movement speed cap.');
    await target.evaluate(() => window.__armTest.reader.enqueue(new TextEncoder().encode('P0:90,P3:180,DX:20\n')));
    await target.waitForTimeout(100);
    check(await hand.isChecked(), 'Serial diagnostic data must not uncheck hand control.');
    await hand.uncheck();
    const disabled = await state();
    await target.waitForTimeout(250);
    check(still(disabled, await state()), 'Unchecking must immediately cancel the old hand destination.');
    await hand.check();
    await target.evaluate(() => { window.__armTest.savedLandmarks = window.__armTest.landmarks; window.__armTest.landmarks = null; });
    await target.getByText('Show your hand', { exact: true }).waitFor();
    const lost = await state();
    await target.waitForTimeout(250);
    check(still(lost, await state()) && await hand.isChecked(), 'Hand loss must hold position without silently disarming the checkbox.');
    await target.evaluate(() => { window.__armTest.landmarks = window.__armTest.savedLandmarks; });
    await target.getByText('Hand detected', { exact: true }).waitFor();
    await target.getByRole('slider', { name: 'Claw position', exact: true }).press('Home');
    check(!await hand.isChecked(), 'Manual control must explicitly release hand ownership.');
    await target.locator('#stop-motion').click();
    await target.locator('#toggle-camera').click();
    await target.waitForFunction(() => document.getElementById('camera-state').textContent === 'Off');
    check(!await hand.isChecked() && !await hand.isEnabled(), 'Camera shutdown must reset and disable hand control.');
    check(await target.evaluate(() => window.__armTest.stream.getTracks().every(track => track.readyState === 'ended')), 'Camera shutdown must release its tracks.');
    await target.locator('#toggle-camera').click();
    await target.waitForFunction(() => document.getElementById('camera-state').textContent === 'On');
    check(!await hand.isChecked(), 'A camera restart must remain preview only.');
    await target.getByRole('button', { name: 'Claw', exact: true }).click();
    await target.evaluate(() => { window.__armTest.pad = { index: 0, id: 'Test controller', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) }; });
    await target.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const controllerStart = await state();
    await target.evaluate(() => { window.__armTest.pad.axes[2] = 1; });
    await target.waitForTimeout(450);
    const controllerEnd = await state();
    check(controllerEnd.angles[3] > controllerStart.angles[3] && controllerEnd.angles[3] - controllerStart.angles[3] <= .23 * (controllerEnd.time - controllerStart.time) / 1000 + .01, 'Controller movement must be slower.');
    await target.evaluate(() => { window.__armTest.pad = null; });
    await target.locator('#stop-motion').click();
    await target.getByRole('button', { name: 'Fit view', exact: true }).click();
    await target.screenshot({ path: 'output/playwright/claw-desktop.png' });
    await target.setViewportSize({ width: 390, height: 844 });
    await target.locator('#toggle-joints').click();
    await target.screenshot({ path: 'output/playwright/claw-mobile.png' });
    check(await target.evaluate(() => document.documentElement.scrollWidth === innerWidth), 'Claw controls must fit on mobile.');
    check(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
    return 'PASS: claw percentage and jaws, slow sliders/controller/hand, letter serial output, Stop, explicit camera opt-in, serial/hand ownership, hand loss, camera shutdown/restart, and mobile layout. All devices were mocked.';
  } finally { await context.close(); }
}
