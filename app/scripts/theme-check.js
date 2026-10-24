async page => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const origin = new URL(page.url()).origin;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  await page.locator('#viewport[data-ready="true"]').waitFor();
  if (await page.locator('html').getAttribute('data-theme') === 'light') await page.locator('#theme-toggle').click();
  for (const id of ['toggle-joints', 'toggle-inputs']) {
    if (await page.locator(`#${id}`).getAttribute('aria-expanded') === 'false') await page.locator(`#${id}`).click();
  }
  for (const [name, value] of [['Shoulder', -40], ['Elbow', 55], ['Turntable', 25], ['Claw', 30]]) {
    await page.getByRole('spinbutton', { name: `${name} angle` }).fill(String(value));
    await page.getByRole('spinbutton', { name: `${name} angle` }).press('Tab');
  }
  await page.mouse.move(1100, 40);
  const darkPalette = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return { page: style.backgroundColor, arm: style.getPropertyValue('--arm-body').trim() };
  });
  check(darkPalette.page === 'rgb(17, 21, 27)', 'Dark mode must restore the earlier deep charcoal palette.');
  await page.screenshot({ path: 'output/playwright/aluminum-dark.png' });
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await page.locator('#viewport[data-theme="light"]').waitFor();
  const lightPalette = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return { page: style.backgroundColor, arm: style.getPropertyValue('--arm-body').trim(), ground: style.getPropertyValue('--scene-ground').trim(), scheme: style.colorScheme };
  });
  check(lightPalette.page === 'rgb(35, 42, 51)', 'Light mode must use the approved brighter slate palette.');
  check(lightPalette.arm !== darkPalette.arm, 'The arm finish must change with the mode.');
  check(lightPalette.ground === lightPalette.arm, 'Light mode ground must share the arm color.');
  check(lightPalette.scheme === 'dark', 'Native controls must suit the slate surfaces in Light mode.');
  check(Number(await page.getByRole('spinbutton', { name: 'Elbow angle' }).inputValue()) === 55, 'Changing themes must preserve the arm pose.');
  check(await page.locator('#joint-sidebar').evaluate(element => element.clientWidth) === 282, 'Theme changes must preserve panel dimensions.');
  await page.screenshot({ path: 'output/playwright/aluminum-light.png' });
  await page.reload();
  await page.locator('#viewport[data-ready="true"][data-theme="light"]').waitFor();
  check(await page.getByRole('button', { name: 'Switch to dark mode' }).isVisible(), 'Light mode must survive reload.');
  await page.getByText('Recording options', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('2');
  await page.getByText('Recording options', { exact: true }).click();
  await page.getByRole('button', { name: 'Enter fullscreen' }).click();
  await page.waitForFunction(() => document.fullscreenElement?.id === 'viewport');
  check(await page.evaluate(() => getComputedStyle(document.getElementById('viewport')).backgroundColor === getComputedStyle(document.documentElement).backgroundColor), 'Fullscreen must use the active theme.');
  await page.getByRole('button', { name: 'Exit fullscreen' }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/playwright/aluminum-light-mobile.png' });
  await page.locator('#theme-toggle').focus();
  await page.keyboard.press('Enter');
  await page.locator('#viewport[data-theme="dark"]').waitFor();
  await page.screenshot({ path: 'output/playwright/aluminum-dark-mobile.png' });
  await page.reload();
  await page.locator('#viewport[data-ready="true"][data-theme="dark"]').waitFor();
  await page.setViewportSize({ width: 320, height: 844 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Dark mode must fit a narrow screen.');
  await page.locator('#theme-toggle').click();
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Light mode must fit a narrow screen.');

  const other = await page.context().newPage();
  await other.goto(origin);
  await other.locator('#viewport[data-ready="true"]').waitFor();
  await other.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.locator('#viewport[data-theme="dark"]').waitFor();
  await other.close();

  const blocked = await page.context().newPage();
  await blocked.addInitScript(() => {
    const read = Storage.prototype.getItem, write = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) { if (key === 'budx-theme') throw new DOMException('Storage blocked', 'SecurityError'); return read.call(this, key); };
    Storage.prototype.setItem = function(key, value) { if (key === 'budx-theme') throw new DOMException('Storage blocked', 'SecurityError'); return write.call(this, key, value); };
  });
  await blocked.goto(origin);
  await blocked.locator('#viewport[data-ready="true"]').waitFor();
  await blocked.getByRole('button', { name: 'Switch to light mode' }).click();
  await blocked.locator('#viewport[data-theme="light"]').waitFor();
  await blocked.close();
  await page.bringToFront();
  await page.setViewportSize({ width: 1440, height: 900 });
  check(errors.length === 0, `Browser/shader errors: ${errors.join('; ')}`);
  return 'PASS: coordinated light/dark UI and scene, pose preservation, unchanged panel dimensions, reload persistence, fullscreen, keyboard toggle, narrow screens, cross-tab sync, and blocked-storage fallback.';
}
