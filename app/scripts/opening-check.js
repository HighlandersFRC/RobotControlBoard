async page => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  const errors = [];
  const expected = [-116.6, 60, 61.4, 50];
  const settle = target => target.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const pose = target => target.locator('.angle-field input').evaluateAll(inputs => inputs.map(input => Number(input.value)));
  const matches = values => values.every((value, index) => Math.abs(value - expected[index]) < .01);
  for (const mobile of [false, true]) {
    const context = await page.context().browser().newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1480, height: 814 },
      isMobile: mobile, hasTouch: mobile,
    });
    try {
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      await target.goto(origin);
      await target.locator('#viewport[data-ready="true"]').waitFor();
      await settle(target);
      check(matches(await pose(target)), 'The first view must show the reference pose.');
      check(await target.locator('#theme-toggle').getAttribute('aria-pressed') === 'false', 'A fresh browser starts in Dark mode.');
      check(await target.locator('#tool-handles').getAttribute('aria-pressed') === 'false', 'The opening view keeps arrows hidden.');
      check(await target.locator('.joint-select').nth(3).getAttribute('aria-pressed') === 'true', 'Claw starts selected.');
      check(await target.locator('#toggle-joints').getAttribute('aria-expanded') === String(!mobile), 'Controls use the correct device default.');
      check(await target.locator('#toggle-inputs').getAttribute('aria-expanded') === 'false', 'Devices start collapsed.');
      await target.screenshot({ path: `output/playwright/opening-${mobile ? 'mobile' : 'desktop'}.png` });
      await target.locator('#tool-handles').click();
      check(await target.locator('#wrist-handle').isVisible(), 'Wrist manipulation remains available.');
      const handle = await target.locator('#wrist-handle').boundingBox();
      check(handle.x >= 8 && handle.x + handle.width <= target.viewportSize().width - 8, 'The opening wrist must remain inside the screen.');
      await target.getByRole('button', { name: 'Fit view', exact: true }).click();
      check(matches(await pose(target)), 'Fitting the camera must preserve the pose.');
      await target.locator('#home-arm').click();
      await target.waitForFunction(() => [...document.querySelectorAll('.joint-control input[type="range"]')].every((input, index) => Math.abs(Number(input.value) - [0, 0, 0, 50][index]) < .15));
      check((await pose(target)).every((value, index) => Math.abs(value - [0, 0, 0, 50][index]) < .15), 'Home must return arm joints to zero and the claw to half open.');
      await target.locator('#theme-toggle').click();
      await target.reload();
      await target.locator('#viewport[data-ready="true"]').waitFor();
      check(matches(await pose(target)), 'Reload must restore the opening pose.');
      check(await target.locator('#theme-toggle').getAttribute('aria-pressed') === 'true', 'Saved Light mode must survive.');
      await target.setViewportSize({ width: mobile ? 320 : 1280, height: mobile ? 740 : 900 });
      await settle(target);
      check(matches(await pose(target)), 'Resizing must preserve the pose.');
      check(await target.evaluate(() => document.documentElement.scrollWidth === innerWidth), 'The opening view must fit the screen.');
    } finally { await context.close(); }
  }
  check(errors.length === 0, errors.join('; '));
  return 'PASS: reference opening pose on desktop and touch mobile, wrist disclosure, independent Home and Fit, saved theme, reload, and narrow resizing.';
}
