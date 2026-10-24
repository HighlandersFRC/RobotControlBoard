async page => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    window.__serialTest = { writes: [] };
    Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort: async () => ({
      open: async options => { window.__serialTest.baudRate = options.baudRate; },
      close: async () => {},
      readable: new ReadableStream(),
      writable: new WritableStream({ write(bytes) {
        window.__serialTest.writes.push({ text: new TextDecoder().decode(bytes), time: performance.now() });
      } }),
    }) } });
  });
  const target = await context.newPage();
  const errors = [];
  target.on('pageerror', error => errors.push(error.message));
  const writes = () => target.evaluate(() => window.__serialTest.writes);
  try {
    await target.goto('http://127.0.0.1:5173/');
    await target.locator('#viewport[data-ready="true"]').waitFor();
    if (await target.locator('#toggle-inputs').getAttribute('aria-expanded') !== 'true') await target.locator('#toggle-inputs').click();
    const format = target.getByLabel('Command format', { exact: true });
    check(await format.inputValue() === 'letters', 'The unchanged repo sketch must remain the default.');
    await format.selectOption('positions');
    await target.locator('#connect-serial').click();
    await target.getByText('Waiting for Arduino startup…', { exact: true }).waitFor();
    check(!await format.isEnabled() && (await writes()).length === 0, 'Startup must lock the format and send no targets.');
    await target.getByRole('button', { name: 'Disconnect Arduino', exact: true }).waitFor();
    check(!await format.isEnabled() && (await writes()).length === 0, 'Connecting must not move the hardware or allow a format change.');
    const claw = target.getByRole('spinbutton', { name: 'Claw opening', exact: true });
    await claw.fill('60');
    await claw.press('Tab');
    await target.waitForFunction(() => window.__serialTest.writes.length >= 3);
    const positions = await writes();
    check(positions.every(write => /^S0:90,S1:90,S2:90,S4:\d+\n$/.test(write.text)), 'Claw position messages must address S4 and leave other targets unchanged.');
    positions.forEach((write, index) => {
      if (index) check(write.time - positions[index - 1].time >= 95, 'Position messages must remain paced.');
      check(Number(write.text.match(/S4:(\d+)/)[1]) === 91 + index, 'A position write may advance the servo by only one degree.');
    });
    check(/commands sent · Position targets/.test(await target.locator('#serial-output').textContent()), 'The counter must identify position messages.');
    await target.locator('#stop-motion').click();
    const stopped = (await writes()).length;
    await target.waitForTimeout(250);
    check((await writes()).length === stopped, 'Stop must cancel the pending position destination.');
    await target.locator('#connect-serial').click();
    await target.getByRole('button', { name: 'Connect Arduino', exact: true }).waitFor();
    check(await format.isEnabled(), 'Disconnecting must unlock the format.');
    await format.selectOption('letters');
    await target.locator('#connect-serial').click();
    await target.getByRole('button', { name: 'Disconnect Arduino', exact: true }).waitFor();
    check((await writes()).length === stopped, 'Reconnecting with another format must not replay a target.');
    await claw.fill('40');
    await claw.press('Tab');
    await target.waitForFunction(count => window.__serialTest.writes.length > count, stopped);
    check((await writes()).slice(stopped).every(write => write.text === 'i'), 'Switching back must send channel 4 letters only.');
    await target.locator('#stop-motion').click();
    await target.locator('#connect-serial').click();
    await target.getByRole('button', { name: 'Connect Arduino', exact: true }).waitFor();
    await format.selectOption('positions');
    await target.reload();
    await target.locator('#viewport[data-ready="true"]').waitFor();
    check(await format.inputValue() === 'positions' && (await writes()).length === 0, 'The format preference must survive reload without reconnecting or sending output.');
    if (await target.locator('#toggle-inputs').getAttribute('aria-expanded') !== 'true') await target.locator('#toggle-inputs').click();
    await target.setViewportSize({ width: 390, height: 844 });
    check(await target.evaluate(() => document.documentElement.scrollWidth === innerWidth), 'The command format must fit in the mobile sidebar.');
    check(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
    return 'PASS: both serial formats, channel 4 claw, startup and reconnect without movement, paced position writes, Stop, format locking, preference persistence, and mobile layout. USB serial was mocked.';
  } finally { await context.close(); }
}
