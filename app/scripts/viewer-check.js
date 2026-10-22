async page => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  const errors = [];
  let stage = 'startup';
  try {
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(origin);
    await page.locator('#viewport[data-ready="true"]').waitFor();
    await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
    stage = 'native fullscreen entry';
    await page.waitForFunction(() => document.querySelector('#viewport').dataset.fullscreen === 'native');
    check(await page.evaluate(() => document.fullscreenElement?.id === 'viewport'), 'Native fullscreen must target the model viewer.');
    const fillsScreen = () => page.evaluate(() => {
      const box = document.getElementById('viewport').getBoundingClientRect();
      return box.x === 0 && box.y === 0 && Math.abs(box.width - innerWidth) < 2 && Math.abs(box.height - innerHeight) < 2;
    });
    check(await fillsScreen(), 'Fullscreen must fill the available display.');
    await page.getByRole('button', { name: 'Top', exact: true }).click();
    check(await page.getByRole('button', { name: 'Top', exact: true }).getAttribute('aria-pressed') === 'true', 'Camera controls must remain usable in fullscreen.');
    await page.locator('#show-grid').focus();
    await page.keyboard.press('Tab');
    check(await page.evaluate(() => document.getElementById('viewport').contains(document.activeElement)), 'Keyboard focus must stay in the expanded viewer.');
    await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
    stage = 'native fullscreen exit';
    await page.waitForFunction(() => document.querySelector('#viewport').dataset.fullscreen === 'off');
    check(await page.getByRole('spinbutton', { name: 'Shoulder angle' }).isEnabled(), 'Joint controls must work after exiting fullscreen.');

    stage = 'snow activation';
    await page.waitForFunction(() => document.getElementById('viewport').dataset.snowState === 'on');
    check(await page.locator('#viewport').getAttribute('data-snow-renderer') === 'webgl', 'Snow must render in the arm scene.');
    const first = await page.locator('#arm-canvas').screenshot();
    await page.waitForTimeout(200);
    const second = await page.locator('#arm-canvas').screenshot();
    check(!first.equals(second), 'Snow particles must animate.');
    const particleCount = Number(await page.locator('#viewport').getAttribute('data-snow-particles'));
    check(particleCount === 5200, 'Desktop snow must be denser while staying within its particle budget.');
    check(await page.locator('#viewport').getAttribute('data-snow-avoidance') === 'arm', 'Snow should leave the arm area clearer.');
    await page.mouse.move(800, 420);
    await page.mouse.move(900, 480, { steps: 12 });
    await page.waitForFunction(() => Number(document.getElementById('viewport').dataset.snowInteractions) > 0);
    await page.getByRole('checkbox', { name: 'Snow', exact: true }).uncheck();
    check(await page.locator('#viewport').getAttribute('data-snow-state') === 'off', 'Snow can be disabled.');
    await page.reload();
    await page.locator('#viewport[data-ready="true"]').waitFor();
    check(!await page.getByRole('checkbox', { name: 'Snow', exact: true }).isChecked(), 'Snow preference must persist.');
    await page.getByRole('checkbox', { name: 'Snow', exact: true }).check();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    stage = 'Reduce Motion';
    await page.waitForFunction(() => document.getElementById('viewport').dataset.snowState === 'paused');
    check(await page.getByRole('checkbox', { name: 'Snow', exact: true }).isDisabled(), 'Reduce Motion must pause snow.');
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    const blocked = await page.context().newPage();
    await blocked.addInitScript(() => {
      Element.prototype.requestFullscreen = async () => { throw new DOMException('Embedded browser policy', 'NotAllowedError'); };
    });
    await blocked.goto(origin);
    await blocked.locator('#viewport[data-ready="true"]').waitFor();
    await blocked.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
    stage = 'blocked fullscreen fallback';
    await blocked.waitForFunction(() => document.querySelector('#viewport').dataset.fullscreen === 'expanded');
    check(await blocked.evaluate(() => {
      const box = document.getElementById('viewport').getBoundingClientRect();
      return box.x === 0 && box.y === 0 && Math.abs(box.width - innerWidth) < 2 && Math.abs(box.height - innerHeight) < 2;
    }), 'Blocked native fullscreen must still expand the viewer.');
    await blocked.keyboard.press('Escape');
    stage = 'Escape from fallback';
    await blocked.waitForFunction(() => document.querySelector('#viewport').dataset.fullscreen === 'off');
    check(await blocked.evaluate(() => !document.querySelector('.joint-sidebar').inert), 'Escape must restore controls after fallback fullscreen.');
    await blocked.close();

    const hanging = await page.context().newPage();
    await hanging.addInitScript(() => { Element.prototype.requestFullscreen = () => new Promise(() => {}); });
    await hanging.goto(origin);
    await hanging.locator('#viewport[data-ready="true"]').waitFor();
    await hanging.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
    stage = 'stalled fullscreen fallback';
    await hanging.waitForFunction(() => document.querySelector('#viewport').dataset.fullscreen === 'expanded');
    await hanging.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
    await hanging.waitForFunction(() => document.querySelector('#viewport').dataset.fullscreen === 'off');
    await hanging.close();
    check(errors.length === 0, `Browser exceptions: ${errors.join('; ')}`);
    return 'PASS: native viewer fullscreen, exit controls, focus containment, blocked/hanging host fallbacks, animated snow, particle budget, persistent toggle, and Reduce Motion.';
  } catch (error) { throw new Error(`${stage}: ${error.message}`); }
}
