// M1.7-C acceptance playthrough：齿轮传动比 + 负载减速 + 负载下降恢复
/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function playthrough(play) {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const snapshot = async () => play.state('mechanical');
  const read = async (label) => {
    const s = await snapshot();
    console.log(label + '=' + JSON.stringify({
      revision: s.revision,
      enabled: s.sources.map((x) => x.enabled),
      status: s.networks.map((n) => n.status + ':' + n.reason),
      parts: s.parts.length,
      networkParts: s.networks.map((n) => n.partIds.length),
      factor: s.networks.map((n) => Math.round(n.speedFactor * 1000) / 1000),
      demand: s.networks.map((n) => Math.round(n.demandTorque * 100) / 100),
      machines: s.machines.map((m) => ({
        id: m.partId,
        powered: m.powered,
        rpm: Math.round(m.rpm * 10) / 10,
        stalled: m.stalled,
      })),
    }));
    return s;
  };
  const place = async (slot, point, name) => {
    await play.keyboard.press(slot);
    await play.wait(220);
    await play.mouse.move(point);
    await play.wait(280);
    await play.mouse.click(point);
    await play.wait(320);
    await play.screenshot(name);
  };
  const rightClick = async (point) => {
    await play.mouse.move(point);
    await play.wait(280);
    await play.page.mouse.click(point[0] * 1280, point[1] * 720, { button: 'right' });
    await play.advance(0.05);
  };
  /** 右键点在零件本体上（地面格心的射线会擦过 1m 高的 AABB），逐个候选点重试到目标状态。 */
  const setSourceEnabled = async (candidates, desired) => {
    for (const point of candidates) {
      await rightClick(point);
      const s = await snapshot();
      if ((s.sources[0]?.enabled === true) === desired) return true;
    }
    return false;
  };
  const clickPart = async (point) => {
    await play.mouse.move(point);
    await play.wait(260);
    await play.mouse.click(point);
    await play.wait(260);
  };
  const clearHover = async () => {
    await play.mouse.move([0.05, 0.05]);
    await play.wait(350);
  };
  const SOURCE_HOVER = [[0.224, 0.511], [0.224, 0.53], [0.226, 0.571], [0.21, 0.52]];

  // 复用 m17a 已验证的地面格坐标：源(-6,7) 轴(-5,7) 轴(-4,7) 12T(-3,7) 冲压机 A(-2,7)
  // 24T(-3,8) 与 12T 啮合；冲压机 B(-2,8) 由 24T 直驱。
  await play.step('01-build-gear-ratio-layout', async () => {
    await place('Digit4', [0.226, 0.571], '01-source');
    await place('Digit1', [0.248, 0.616], '01-shaft-a');
    await place('Digit1', [0.272, 0.665], '01-shaft-b');
    await place('Digit2', [0.298, 0.716], '01-gear12');
    await place('Digit5', [0.325, 0.772], '01-machine-direct');
    await play.keyboard.press('Digit1');
    await clearHover();
    const s = await read('LAYOUT');
    assert(s.parts.length === 5, 'layout should place 5 parts, got ' + s.parts.length);
    assert(s.networks.length === 1, 'chain must form one network');
    assert(s.networks[0].partIds.length === 5, 'all 5 parts must be in the network, got ' + s.networks[0].partIds.length);
    await play.screenshot('01-layout');
  });

  await play.step('02-start-and-measure-droop', async () => {
    const enabled = await setSourceEnabled(SOURCE_HOVER, true);
    assert(enabled, 'right-click must enable the source');
    const s = await read('STARTED');
    assert(s.networks[0]?.status === 'powered', 'network must be powered');
    assert(s.machines.length === 1 && s.machines[0].powered === true, 'machine must run');
    // 单台机器负载 20 / 源容量 100 → 速度因子 0.8（60 RPM → 48 RPM）。
    assert(Math.abs(s.networks[0].speedFactor - 0.8) < 0.02,
      'speed factor should be 0.8 under one machine load, got ' + s.networks[0].speedFactor);
    assert(Math.abs(Math.abs(s.machines[0].rpm) - 48) < 1.5,
      'machine rpm should be ~48, got ' + s.machines[0].rpm);
    await play.mouse.move([0.325, 0.717]);
    await play.wait(350);
    await play.screenshot('02-machine-reading');
  });

  await play.step('03-add-mesh-gear-and-geared-machine', async () => {
    // 24T 与 12T 外啮合；冲压机 B 挂在 24T 上。新增负载经 1:2 减速折算后只有 10。
    await place('Digit3', [0.255, 0.772], '03-gear24');
    await place('Digit5', [0.283, 0.830], '03-machine-geared');
    await play.keyboard.press('Digit1');
    await clearHover();
    const s = await read('GEARED');
    assert(s.parts.length === 7, 'two more parts expected, got ' + s.parts.length);
    assert(s.machines.length === 2, 'two machines expected, got ' + s.machines.length);
    assert(s.networks.length === 1 && s.networks[0].partIds.length === 7,
      'all 7 parts must be in one network, got ' + JSON.stringify(s.networks.map((n) => n.partIds.length)));
    const direct = s.machines[0];
    const geared = s.machines[1];
    assert(direct.powered && geared.powered, 'both machines must run: ' + JSON.stringify([direct.powered, geared.powered]));
    const ratio = Math.abs(geared.rpm) / Math.abs(direct.rpm);
    // 12T 驱动 24T：输出转速减半。
    assert(Math.abs(ratio - 0.5) < 0.05, '12T->24T must halve speed, got ' + ratio);
    // 负载 20 + 20×0.5 = 30 → 速度因子 0.7（两台机器一起减速）。
    assert(Math.abs(s.networks[0].speedFactor - 0.7) < 0.02,
      'speed factor should drop to 0.7, got ' + s.networks[0].speedFactor);
    assert(Math.abs(s.networks[0].demandTorque - 30) < 0.6,
      'source demand should be 30, got ' + s.networks[0].demandTorque);
    await play.mouse.move([0.325, 0.717]);
    await play.wait(350);
    await play.screenshot('03-gear-ratio-and-readout');
  });

  await play.step('04-drop-load-and-recover', async () => {
    const before = await read('BEFORE_DROP');
    const beforeRpm = Math.abs(before.machines[0].rpm);
    // 选中并拆掉 24T 上的机器（候选点瞄准本体，逐点重试；拆错零件会立即报错）。
    const candidates = [[0.283, 0.775], [0.283, 0.79], [0.29, 0.76], [0.277, 0.80]];
    let dropped = false;
    for (const point of candidates) {
      await play.keyboard.press('Digit1');
      await play.wait(180);
      await clickPart(point);
      await play.keyboard.press('Delete');
      await play.advance(0.1);
      const probe = await snapshot();
      if (probe.machines.length === 1) { dropped = true; break; }
      if (probe.parts.length === 6) throw new Error('deleted a non-machine part at ' + point);
    }
    assert(dropped, 'could not select the geared machine for removal');
    const after = await read('AFTER_DROP');
    assert(after.parts.length === 6, 'one part should be removed, got ' + after.parts.length);
    assert(after.machines.length === 1 && after.machines[0].powered === true, 'remaining machine must run');
    assert(Math.abs(after.networks[0].speedFactor - 0.8) < 0.02,
      'speed factor should recover to 0.8, got ' + after.networks[0].speedFactor);
    assert(Math.abs(after.networks[0].demandTorque - 20) < 0.6,
      'source demand should drop to 20, got ' + after.networks[0].demandTorque);
    const afterRpm = Math.abs(after.machines[0].rpm);
    assert(afterRpm > beforeRpm + 1, 'remaining machine must speed up: ' + beforeRpm + ' -> ' + afterRpm);
    await play.mouse.move([0.325, 0.717]);
    await play.wait(350);
    await play.screenshot('04-after-load-drop');
  });

  await play.step('05-stop-and-restart', async () => {
    assert(await setSourceEnabled(SOURCE_HOVER, false), 'right-click must stop the source');
    const stopped = await read('STOPPED');
    assert(stopped.machines[0]?.powered === false, 'machine must stop when source is off');
    const angle = stopped.machines[0]?.angle;
    await play.advance(0.4);
    const frozen = await read('FROZEN');
    assert(frozen.machines[0]?.angle === angle, 'machine angle must freeze while stopped');
    assert(await setSourceEnabled(SOURCE_HOVER, true), 'right-click must restart the source');
    const restarted = await read('RESTARTED');
    assert(restarted.machines[0]?.powered === true, 'machine must resume after restart');
    await play.advance(0.3);
    const resumed = await read('RESUMED');
    assert(resumed.machines[0].angle > angle, 'machine must keep moving after restart');
    await clearHover();
    await play.screenshot('05-restarted');
  });
}
