// M1.7-B acceptance playthrough
/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function playthrough(play) {
  const read = async (label) => {
    const s = await play.state('mechanical');
    console.log(label + '=' + JSON.stringify({
      revision: s.revision,
      enabled: s.sources.map((x) => x.enabled),
      status: s.networks.map((n) => n.status + ':' + n.reason),
      angles: s.parts.map((p) => Math.round(p.angle * 100) / 100),
      powered: s.machines.map((m) => m.powered),
      ramY: s.machines.map((m) => Math.round(m.ramY * 1000) / 1000),
    }));
    return s;
  };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const fps = async () => {
    const text = await play.page.evaluate(() => document.body.innerText);
    const match = text.match(/FPS ([0-9.]+)/);
    return match ? Number(match[1]) : -1;
  };
  const place = async (slot, point, name) => {
    await play.keyboard.press(slot);
    await play.wait(200);
    await play.mouse.move(point);
    await play.wait(250);
    await play.mouse.click(point);
    await play.wait(300);
    await play.screenshot(name);
  };
  const hoverAndRightClick = async (point) => {
    await play.mouse.move(point);
    await play.wait(300);
    await play.page.mouse.click(point[0] * 1280, point[1] * 720, { button: 'right' });
    await play.advance(0.05);
  };
  const clickPart = async (point) => {
    await play.mouse.move(point);
    await play.wait(250);
    await play.mouse.click(point);
    await play.wait(250);
  };
  const clearHover = async () => {
    await play.mouse.move([0.05, 0.05]);
    await play.wait(350);
  };

  await play.step('01-start', async () => {
    await read('START');
    console.log('FPS_START=' + (await fps()));
    await play.screenshot('01-start');
  });

  await play.step('02-build-chain', async () => {
    await place('Digit4', [0.5, 0.3827], 'source');
    await place('Digit1', [0.527, 0.416], 'shaft');
    await place('Digit5', [0.5555, 0.4513], 'machine');
    await play.keyboard.press('Digit1');
    await clearHover();
    await play.screenshot('02-chain');
    const s = await read('CHAIN');
    assert(s.networks.length === 1 && s.networks[0].status === 'idle', 'chain should be idle before start');
    assert(s.machines.length === 1 && s.machines[0].powered === false, 'machine should be unpowered initially');
  });

  await play.step('03-start-and-run', async () => {
    await hoverAndRightClick([0.48, 0.39]);
    const started = await read('STARTED');
    assert(started.sources[0]?.enabled === true, 'right-click should enable source');
    assert(started.networks[0]?.status === 'powered', 'network should be powered');
    assert(started.machines[0]?.powered === true, 'machine should be powered');

    await play.advance(0.5);
    const bottom = await read('BOTTOM');
    await clearHover();
    await play.screenshot('03-ram-bottom');
    assert(bottom.machines[0].ramY < 0.7, 'ram should be at bottom half');

    let top = bottom;
    for (let attempt = 0; attempt < 20 && top.machines[0].ramY <= 0.85; attempt += 1) {
      await play.advance(0.25);
      top = await read('SEEK_TOP_' + attempt);
    }
    await clearHover();
    await play.screenshot('04-ram-top');
    console.log('FPS_RUNNING=' + (await fps()));
    assert(top.machines[0].ramY > 0.85, 'ram should be at top');
    assert(top.parts.find((p) => p.kind === 'shaft').angle > bottom.parts.find((p) => p.kind === 'shaft').angle,
      'shaft angle should increase while powered');
  });

  await play.step('04-stop-source', async () => {
    await hoverAndRightClick([0.48, 0.39]);
    const stopped = await read('STOPPED');
    assert(stopped.sources[0]?.enabled === false, 'right-click should stop source');
    assert(stopped.machines[0]?.powered === false, 'machine must be unpowered when source stopped');
    const angle = stopped.machines[0]?.angle;
    const ram = stopped.machines[0]?.ramY;
    await play.advance(0.5);
    const stopped2 = await read('STOPPED_FROZEN');
    assert(stopped2.machines[0]?.angle === angle, 'machine angle must freeze when source stopped');
    assert(stopped2.machines[0]?.ramY === ram, 'ram must freeze when source stopped');
    await clearHover();
    await play.screenshot('05-source-stopped');
  });

  await play.step('05-restart-source', async () => {
    await hoverAndRightClick([0.48, 0.39]);
    const restarted = await read('RESTARTED');
    assert(restarted.sources[0]?.enabled === true, 'right-click should restart source');
    const before = restarted.machines[0]?.angle;
    const beforeRam = restarted.machines[0]?.ramY;
    await play.advance(0.25);
    const resumed = await read('RESUMED');
    assert(resumed.machines[0]?.angle > before, 'machine must resume from frozen angle');
    assert(resumed.machines[0]?.ramY !== beforeRam, 'ram must move after restart');
    await clearHover();
    await play.screenshot('06-restarted');
  });

  await play.step('06-remove-middle-shaft', async () => {
    // 源保持开启；选中轴并拆除，机器应失去动力并冻结。
    await play.keyboard.press('Digit1');
    await play.wait(150);
    await clickPart([0.51, 0.40]);
    const before = await read('BEFORE_CUT');
    await play.keyboard.press('Delete');
    await play.advance(0.1);
    const cut = await read('CUT');
    assert(cut.revision > before.revision, 'removal should increment revision');
    assert(cut.machines[0]?.powered === false, 'machine must lose power after shaft removal');
    const angle = cut.machines[0]?.angle;
    const ram = cut.machines[0]?.ramY;
    await play.advance(0.5);
    const cut2 = await read('CUT_FROZEN');
    assert(cut2.machines[0]?.angle === angle, 'machine angle must freeze after disconnection');
    assert(cut2.machines[0]?.ramY === ram, 'ram must freeze after disconnection');
    await clearHover();
    await play.screenshot('07-disconnected');
  });

  await play.step('07-unconnected-machine', async () => {
    // 拆除源：机器与轴消失后留下无源机器，必须继续冻结。
    await play.keyboard.press('Digit4');
    await play.wait(150);
    await clickPart([0.48, 0.39]);
    await play.keyboard.press('Delete');
    await play.advance(0.1);
    const removed = await read('SOURCE_REMOVED');
    assert(removed.sources.length === 0, 'source should be removed');
    assert(removed.machines[0]?.powered === false, 'machine without source must not work');
    const ram = removed.machines[0]?.ramY;
    await play.advance(0.5);
    const still = await read('UNCONNECTED_FROZEN');
    assert(still.machines[0]?.ramY === ram, 'unconnected machine ram must not move');
    await clearHover();
    await play.screenshot('08-unconnected');
  });

  await play.step('08-gear-powered', async () => {
    // 重新放源，在空出的轴位放齿轮，机器仍在；M1.7-C 起齿轮正式参与传动，
    // 该组件必须通电并让冲压机真正运动（旧行为 unsupported/gear-requires-c 已由 C 取代）。
    await place('Digit4', [0.5, 0.3827], 'source-again');
    await place('Digit2', [0.527, 0.416], 'gear');
    await play.keyboard.press('Digit1');
    await clearHover();
    const s = await read('GEAR_COMPONENT');
    assert(s.networks.some((n) => n.status === 'powered'),
      'gear component must be powered after M1.7-C');
    assert(s.machines[0]?.powered === true, 'gear driven machine must run');
    const beforeAngle = s.machines[0]?.angle ?? 0;
    await play.advance(0.5);
    const moved = await read('GEAR_MOVED');
    assert(moved.machines[0].angle > beforeAngle, 'gear driven machine must keep moving');
    await clearHover();
    await play.screenshot('09-gear-powered');
    console.log('FPS_END=' + (await fps()));
  });
}