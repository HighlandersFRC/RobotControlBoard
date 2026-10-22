async page => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = new URL(page.url()).origin;
  await page.reload();
  await page.locator('#viewport[data-ready="true"]').waitFor();
  if (await page.locator('#toggle-joints').getAttribute('aria-expanded') === 'false') await page.locator('#toggle-joints').click();
  if (await page.locator('#toggle-inputs').getAttribute('aria-expanded') === 'false') await page.locator('#toggle-inputs').click();
  check(await page.getByRole('slider').count() === 4, 'All four joint sliders must be present.');

  async function angle(name, value) {
    const input = page.getByRole('spinbutton', { name: `${name} angle`, exact: true });
    await input.fill(String(value));
    await input.press('Tab');
  }
  await angle('Shoulder', -45);
  await angle('Elbow', 60);
  await angle('Turntable', 30);
  await angle('Wrist', 25);
  await page.getByRole('button', { name: 'Fit view', exact: true }).click();
  check(await page.getByRole('slider', { name: 'Shoulder position' }).inputValue() === '-45', 'Angle fields must update the rig and sliders.');
  await page.screenshot({ path: 'output/playwright/desktop.png' });

  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await angle('Shoulder', -20);
  await page.waitForTimeout(250);
  await angle('Elbow', 20);
  await page.getByRole('button', { name: 'Save recording', exact: true }).click();
  check(await page.getByRole('button', { name: 'Play', exact: true }).isEnabled(), 'A saved recording must be playable.');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('budx-anim-slots')));
  check(saved[0].keyframes[0].time === 0 && saved[0].duration > 0, 'Recording must include its initial pose and duration.');
  await page.reload();
  await page.locator('#viewport[data-ready="true"]').waitFor();
  check(await page.getByRole('button', { name: 'Play', exact: true }).isEnabled(), 'Recording must survive a reload.');
  await page.getByText('Recording options', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Loop', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('motion-state').textContent === 'Idle');
  check(await page.getByRole('slider', { name: 'Elbow position' }).inputValue() === '20', 'One-shot playback must finish on its last pose.');

  await page.getByRole('button', { name: 'Wave', exact: true }).click();
  await angle('Turntable', -15);
  await page.waitForFunction(() => document.getElementById('motion-state').textContent === 'Idle');
  check(await page.locator('#motion-state').textContent() === 'Idle', 'Manual movement must interrupt playback.');
  await page.getByRole('button', { name: 'Sweep', exact: true }).click();
  await page.locator('#stop-motion').click();
  const stopped = await page.getByRole('slider', { name: 'Turntable position' }).inputValue();
  await page.waitForTimeout(200);
  check(await page.getByRole('slider', { name: 'Turntable position' }).inputValue() === stopped, 'Stop must hold the current pose.');
  for (const view of ['Front', 'Top', 'Perspective']) {
    const button = page.getByRole('button', { name: view, exact: true });
    await button.click();
    check(await button.getAttribute('aria-pressed') === 'true', `${view} camera must become active.`);
  }
  await page.locator('#home-arm').click();
  await page.locator('#arm-canvas').focus();
  await page.keyboard.press('2');
  await page.keyboard.press('ArrowLeft');
  check(await page.getByRole('slider', { name: 'Shoulder position' }).inputValue() === '-1', 'Keyboard must select and move a joint.');
  await page.getByRole('checkbox', { name: 'Grid', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Grid', exact: true }).check();

  for (const [width, height, name] of [[768, 1024, 'tablet'], [390, 844, 'mobile']]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(100);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} must not overflow horizontally.`);
    await page.screenshot({ path: `output/playwright/${name}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // Separate pages isolate synthetic camera and failed asset loading from the
  // main workbench. No physical camera, serial device, or gamepad is requested.
  const cameraPage = await page.context().newPage();
  await cameraPage.bringToFront();
  cameraPage.on('pageerror', error => errors.push(error.message));
  await cameraPage.addInitScript(() => {
    window.testCamera = { closeCount: 0, streams: [] };
    class Hands {
      setOptions() {}
      onResults(callback) { this.callback = callback; }
      async send() { this.callback({ multiHandLandmarks: [] }); }
      async close() { window.testCamera.closeCount++; }
    }
    window.Hands = Hands;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, writable: true, value: async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 400;
      const context = canvas.getContext('2d');
      context.fillRect(0, 0, 640, 400);
      const stream = canvas.captureStream(15);
      const interval = setInterval(() => context.fillRect(0, 0, 640, 400), 60);
      stream.getTracks()[0].addEventListener('ended', () => clearInterval(interval));
      window.testCamera.streams.push(stream);
      return stream;
    } });
  });
  await cameraPage.goto(origin);
  await cameraPage.locator('#viewport[data-ready="true"]').waitFor();
  await cameraPage.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await cameraPage.getByRole('button', { name: 'Disable camera', exact: true }).waitFor();
  check(await cameraPage.getByRole('checkbox', { name: 'Move arm with hand' }).isChecked(), 'Enabling camera must activate hand control.');
  await cameraPage.getByRole('spinbutton', { name: 'Shoulder angle' }).fill('-20');
  await cameraPage.getByRole('spinbutton', { name: 'Shoulder angle' }).press('Tab');
  check(!await cameraPage.getByRole('checkbox', { name: 'Move arm with hand' }).isChecked(), 'Manual input must release hand control.');
  await cameraPage.getByRole('button', { name: 'Disable camera', exact: true }).click();
  await cameraPage.getByRole('button', { name: 'Enable camera', exact: true }).waitFor();
  check(await cameraPage.evaluate(() => window.testCamera.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), 'Stopping tracking must release every camera track.');
  await cameraPage.evaluate(() => {
    window.testCamera.createStream = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  });
  await cameraPage.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await cameraPage.waitForFunction(() => document.getElementById('activity').textContent.includes('denied'));
  check(await cameraPage.getByRole('button', { name: 'Enable camera', exact: true }).isEnabled(), 'Camera denial must allow retry.');
  check(await cameraPage.evaluate(() => window.testCamera.closeCount >= 2), 'Failed camera startup must close its tracking resources.');
  await cameraPage.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { window.testCamera.finishPermission = resolve; });
  });
  await cameraPage.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await cameraPage.waitForFunction(() => !!window.testCamera.finishPermission);
  await cameraPage.locator('#stop-motion').click();
  await cameraPage.evaluate(async () => window.testCamera.finishPermission(await window.testCamera.createStream()));
  await cameraPage.getByRole('button', { name: 'Disable camera', exact: true }).waitFor();
  check(!await cameraPage.getByRole('checkbox', { name: 'Move arm with hand' }).isChecked(), 'Late camera permission must not undo Stop.');
  await cameraPage.getByRole('button', { name: 'Disable camera', exact: true }).click();
  await cameraPage.close();

  const retryPage = await page.context().newPage();
  let fail = true;
  await retryPage.route('**/models/arm.gltf', route => fail ? route.abort() : route.continue());
  await retryPage.goto(origin);
  await retryPage.getByRole('button', { name: 'Try again', exact: true }).waitFor();
  fail = false;
  await retryPage.getByRole('button', { name: 'Try again', exact: true }).click();
  await retryPage.locator('#viewport[data-ready="true"]').waitFor();
  await retryPage.close();
  check(errors.length === 0, `Browser exceptions: ${errors.join('; ')}`);
  return 'PASS: pose controls, recording/reload, one-shot playback, manual takeover, Stop, views, keyboard, grid, tablet/mobile layout, camera lifecycle/denial, model retry.';
}
