async page => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = new URL(page.url()).origin;
  await page.mouse.up();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page.locator('#viewport[data-ready="true"]').waitFor();

  async function pose(targetPage) {
    if (await targetPage.locator('#toggle-joints').getAttribute('aria-expanded') === 'false') await targetPage.locator('#toggle-joints').click();
    for (const [name, value] of [['Turntable', 25], ['Shoulder', -40], ['Elbow', 55], ['Claw', 75]]) {
      const input = targetPage.getByRole('spinbutton', { name: name === 'Claw' ? 'Claw opening' : `${name} angle`, exact: true });
      await input.fill(String(value));
      await input.press('Tab');
    }
    await targetPage.waitForFunction(() => [...document.querySelectorAll('.joint-control input[type="range"]')].every((input, index) => Math.abs(Number(input.value) - [25, -40, 55, 75][index]) < .15));
    if (targetPage.viewportSize().width <= 700) await targetPage.locator('#toggle-joints').click();
    await targetPage.getByRole('button', { name: 'Perspective', exact: true }).click();
    await targetPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }

  // Run against Vite's dev server: use the live scene to locate real WebGL
  // handles, then exercise them through browser pointer input, not synthetic callbacks.
  async function state(targetPage, axis = 'Y', joint = null) {
    return targetPage.evaluate(async ({ axis, joint }) => {
      const { rig } = await import(document.querySelector('script[type="module"][src*="/src/main.js"]').src);
      const helper = rig.root.parent.children.find(object => object.isTransformControlsRoot);
      helper.updateMatrixWorld(true);
      const camera = helper.controls.camera;
      const rect = document.getElementById('arm-canvas').getBoundingClientRect();
      const screen = point => {
        point.project(camera);
        return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
      };
      const mesh = helper.children[0].gizmo.translate.children.find(object => object.name === axis && object.isMesh && object.visible);
      if (mesh) mesh.geometry.computeBoundingBox();
      let part = null;
      if (joint !== null) {
        const ray = new (helper.controls.getRaycaster().constructor)();
        const meshes = [];
        (joint === 3 ? rig.pivots[3] : rig.mounts[2]).traverse(object => { if (object.isMesh) meshes.push(object); });
        for (const object of meshes) {
          const vertices = object.geometry.getAttribute('position');
          for (let index = 0; index < vertices.count; index += Math.max(1, Math.floor(vertices.count / 80))) {
            const world = rig.toolPosition().fromBufferAttribute(vertices, index).applyMatrix4(object.matrixWorld);
            const point = screen(world);
            if (document.elementFromPoint(point.x, point.y)?.id !== 'arm-canvas') continue;
            ray.setFromCamera({ x: (point.x - rect.left) / rect.width * 2 - 1, y: 1 - (point.y - rect.top) / rect.height * 2 }, camera);
            let hit = ray.intersectObject(rig.root, true)[0]?.object;
            while (hit && hit.userData.jointIndex === undefined) hit = hit.parent;
            if (hit?.userData.jointIndex === joint) { part = point; break; }
          }
          if (part) break;
        }
      }
      return {
        part,
        handle: mesh ? screen(mesh.geometry.boundingBox.getCenter(rig.toolPosition()).applyMatrix4(mesh.matrixWorld)) : null,
        tip: screen(rig.toolPosition()), angles: rig.getAngles(), axis: helper.controls.axis,
        camera: [...camera.position.toArray(), ...camera.quaternion.toArray()],
      };
    }, { axis, joint });
  }

  await page.locator('#tool-handles').click();
  await pose(page);
  check(await page.locator('#viewport').getAttribute('data-snow-particles') === '5200', 'Desktop snow must use the doubled particle count.');
  const center = page.getByRole('button', { name: 'Move entire arm', exact: true });
  const centerBox = await center.boundingBox();
  const centerBefore = await state(page);
  await page.mouse.move(centerBox.x + centerBox.width / 2, centerBox.y + centerBox.height / 2);
  await page.mouse.down();
  check(await page.locator('#viewport').getAttribute('data-tool-dragging') === 'true', 'The visible center control must start a free-plane wrist drag.');
  await page.mouse.move(centerBox.x + centerBox.width / 2 + 35, centerBox.y + centerBox.height / 2 + 30, { steps: 12 });
  await page.mouse.up();
  const centerAfter = await state(page);
  check(centerAfter.angles.some((angle, index) => index < 3 && Math.abs(angle - centerBefore.angles[index]) > .01), 'The center control must move the arm.');
  check(centerAfter.angles[3] === centerBefore.angles[3], 'The center control must preserve wrist roll.');
  check(centerAfter.camera.every((value, index) => Math.abs(value - centerBefore.camera[index]) < .000001), 'Dragging the center control must keep the camera still.');
  for (const axis of ['Y', 'X', 'Z']) {
    await pose(page);
    const before = await state(page, axis);
    await page.mouse.move(before.handle.x, before.handle.y);
    await page.mouse.down();
    check(await page.locator('#viewport').getAttribute('data-tool-dragging') === 'true', `${axis} arrow must capture a tool drag: ${JSON.stringify({ before, after: await state(page, axis) })}`);
    await page.mouse.move(before.handle.x + (axis === 'Y' ? 0 : 35), before.handle.y + (axis === 'Y' ? 45 : 5), { steps: 12 });
    await page.mouse.up();
    const after = await state(page, axis);
    check(after.angles.some((angle, index) => index < 3 && Math.abs(angle - before.angles[index]) > .01), `${axis} arrow must move the arm's joints.`);
    check(after.angles[3] === before.angles[3], 'Tool positioning must preserve wrist roll.');
    check(after.camera.every((value, index) => Math.abs(value - before.camera[index]) < .000001), 'Tool dragging must not orbit the camera.');
    check(await page.locator('#viewport').getAttribute('data-tool-dragging') === 'false', 'Releasing a handle must end the drag.');
  }

  await pose(page);
  const start = await state(page);
  await page.mouse.move(start.handle.x, start.handle.y);
  await page.mouse.down();
  await page.mouse.move(start.handle.x, start.handle.y + 20, { steps: 5 });
  await page.keyboard.press('Escape');
  const held = await state(page);
  await page.mouse.move(start.handle.x + 80, start.handle.y + 80, { steps: 8 });
  await page.mouse.up();
  check((await state(page)).angles.every((angle, index) => angle === held.angles[index]), 'Escape must hold the arm during the rest of a pointer gesture.');

  const button = page.getByRole('button', { name: 'Move arm handles', exact: true });
  await button.click();
  check(await page.locator('#viewport').getAttribute('data-tool-handles') === 'hidden', 'Wrist arrows can be hidden.');
  for (const joint of [1, 3]) {
    await pose(page);
    const before = await state(page, 'Y', joint);
    check(before.part, `Joint ${joint} must have a visible mesh to drag.`);
    await page.mouse.move(before.part.x, before.part.y);
    await page.mouse.down();
    await page.mouse.move(before.part.x + 35, before.part.y + 20, { steps: 10 });
    await page.mouse.up();
    const after = await state(page);
    check(after.angles.some((angle, index) => index < 3 && Math.abs(angle - before.angles[index]) > .01), 'Dragging the model must move its joints.');
    if (joint === 3) check(after.angles[3] === before.angles[3], 'Grabbing the wrist must move its position while preserving roll.');
    else check(after.angles.every((angle, index) => index === joint || angle === before.angles[index]), 'Other model parts must retain individual joint control.');
    check(after.camera.every((value, index) => Math.abs(value - before.camera[index]) < .000001), 'Model dragging must not orbit the camera.');
  }
  await button.press('Enter');
  check(await page.locator('#viewport').getAttribute('data-tool-handles') === 'visible', 'Wrist arrows can be restored from the keyboard.');
  const keyboardBefore = await state(page);
  await button.press('Control+ArrowDown');
  check((await state(page)).angles.every((angle, index) => angle === keyboardBefore.angles[index]), 'Browser keyboard shortcuts must not move the arm.');
  await button.press('ArrowDown');
  check((await state(page)).angles.some((angle, index) => Math.abs(angle - keyboardBefore.angles[index]) > .001), 'Focused tool controls must support keyboard movement.');

  await page.getByRole('button', { name: 'Wave', exact: true }).click();
  await button.press('ArrowDown');
  check(await page.locator('#motion-state').textContent() === 'Idle', 'Tool movement must take over from playback.');

  const touchContext = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const touch = await touchContext.newPage();
    touch.on('pageerror', error => errors.push(error.message));
    await touch.goto(origin);
    await touch.locator('#viewport[data-ready="true"]').waitFor();
    await touch.locator('#tool-handles').click();
    await pose(touch);
    await touch.getByRole('button', { name: 'Perspective', exact: true }).click();
    const before = await state(touch);
    const cdp = await touchContext.newCDPSession(touch);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: before.handle.x, y: before.handle.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: before.handle.x, y: before.handle.y + 45 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const after = await state(touch);
    check(after.angles.some((angle, index) => Math.abs(angle - before.angles[index]) > .01), 'Touch dragging must move the arm.');
    check(after.camera.every((value, index) => Math.abs(value - before.camera[index]) < .000001), 'Touch tool dragging must not orbit the camera.');
    check(await touch.locator('#viewport').getAttribute('data-snow-particles') === '3000', 'Mobile snowfall must use its doubled budget.');
    const touchCenter = await touch.getByRole('button', { name: 'Move entire arm', exact: true }).boundingBox();
    check(touchCenter.width >= 44 && touchCenter.height >= 44, 'The center grab control must have a finger-sized touch target.');
    const centerBefore = await state(touch);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchCenter.x + touchCenter.width / 2, y: touchCenter.y + touchCenter.height / 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchCenter.x + touchCenter.width / 2 + 35, y: touchCenter.y + touchCenter.height / 2 + 30 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const centerAfter = await state(touch);
    check(centerAfter.angles.some((angle, index) => Math.abs(angle - centerBefore.angles[index]) > .01), 'The center grab control must work with touch.');
    check(centerAfter.camera.every((value, index) => Math.abs(value - centerBefore.camera[index]) < .000001), 'Touching the center control must not orbit the camera.');
    const next = await state(touch);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: next.handle.x, y: next.handle.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    check(await touch.locator('#viewport').getAttribute('data-tool-dragging') === 'false', 'A cancelled touch must release the arm handles.');
    await cdp.detach();
  } finally { await touchContext.close(); }
  check(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
  return 'PASS: three wrist arrows, direct wrist grabbing, individual joint dragging, camera isolation, wrist roll, Escape, keyboard controls, playback takeover, touch dragging, and doubled snowfall.';
}
