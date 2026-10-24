async page => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(page.url());
  await page.locator('#viewport[data-ready="true"]').waitFor();
  if (await page.locator('#toggle-joints').getAttribute('aria-expanded') === 'false') await page.locator('#toggle-joints').click();
  if (await page.locator('#toggle-inputs').getAttribute('aria-expanded') === 'false') await page.locator('#toggle-inputs').click();
  const toggle = page.locator('#glass-toggle');
  if (await toggle.getAttribute('aria-pressed') === 'true') await toggle.click();
  await page.waitForFunction(() => document.documentElement.dataset.glassRefraction === 'on');
  check(await page.locator('.glass-surface .glass-surface').count() === 0, 'Refractive glass must never be nested.');
  check(await page.locator('filter feImage[href^="data:image/png"]').count() === 4, 'Navigation and control surfaces need their edge maps.');
  check(await page.evaluate(() => getComputedStyle(document.querySelector('.joint-sidebar'), '::before').backdropFilter.includes('blur')), 'Control platters need a single frosted backdrop.');

  await toggle.click();
  check(await page.evaluate(() => document.documentElement.dataset.glassQuality === 'minimal'), 'Transparency toggle must enable the opaque fallback.');
  check(await page.evaluate(() => getComputedStyle(document.querySelector('.joint-sidebar'), '::before').backdropFilter === 'none'), 'Reduced transparency must disable backdrop filters.');
  await page.reload();
  await page.locator('#viewport[data-ready="true"]').waitFor();
  check(await toggle.getAttribute('aria-pressed') === 'true', 'The transparency preference must survive a reload.');
  await toggle.click();
  for (const view of ['Front', 'Top', 'Perspective']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    await page.waitForFunction(() => {
      const picker = document.querySelector('.view-picker');
      const active = picker.querySelector('[aria-pressed="true"]');
      const indicator = picker.querySelector('.view-indicator');
      return Math.abs(indicator.getBoundingClientRect().left - active.getBoundingClientRect().left) < 1;
    });
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.documentElement.dataset.glassRefraction === 'off');
  check(await page.evaluate(() => getComputedStyle(document.querySelector('.view-indicator')).transitionDuration === '0s'), 'Reduce Motion must disable the sliding transition.');
  await page.emulateMedia({ reducedMotion: 'no-preference', contrast: 'more' });
  await page.waitForFunction(() => document.documentElement.dataset.glassQuality === 'minimal');
  check(await toggle.isDisabled(), 'The system contrast preference must take priority over the appearance toggle.');
  await page.emulateMedia({ contrast: 'no-preference', forcedColors: 'active' });
  check(await page.evaluate(() => getComputedStyle(document.querySelector('.joint-sidebar'), '::before').display === 'none'), 'Forced colors must remove decorative optical layers.');
  await page.emulateMedia({ forcedColors: 'none' });
  await page.waitForFunction(() => document.documentElement.dataset.glassQuality === 'standard');

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  await page.waitForFunction(() => document.documentElement.dataset.glassQuality === 'minimal');
  check(await toggle.isDisabled(), 'System Reduce Transparency must force the readable fallback.');
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  await cdp.detach();

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(100);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Layout must fit at ${width}px.`);
    if (width <= 580) check(await page.evaluate(() => document.documentElement.dataset.glassRefraction === 'off'), 'Small screens must use the lighter glass tier.');
    if (width === 390) await page.screenshot({ path: 'output/playwright/liquid-glass-mobile.png', fullPage: true });
  }
  if (await page.locator('#toggle-joints').getAttribute('aria-expanded') === 'false') await page.locator('#toggle-joints').click();
  for (const [name, value] of [['Shoulder', -40], ['Elbow', 55], ['Turntable', 25], ['Claw', 30]]) {
    const input = page.getByRole('spinbutton', { name: `${name} angle`, exact: true });
    await input.fill(String(value));
    await input.press('Tab');
  }
  await page.getByRole('button', { name: 'Perspective', exact: true }).click();
  await page.mouse.move(900, 45);
  await page.screenshot({ path: 'output/playwright/liquid-glass-finished.png' });
  check(errors.length === 0, `Browser exceptions: ${errors.join('; ')}`);
  return 'PASS: single optical layers, edge refraction maps, preference persistence, sliding selector, Reduce Motion, contrast, forced colors, Reduce Transparency, and responsive layout at 320–1440px.';
}
