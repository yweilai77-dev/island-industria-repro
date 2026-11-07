// M1.7-C acceptance playthrough：齿轮传动比 + 负载减速 + 负载下降恢复
/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function playthrough(play) {
  const read = async (label) => {
    const s = await play.state('mechanical');
    console.log(label + '=' + JSON.stringify({
      revision: s.revision,
      enabled: s.sources.map((x) => x.enabled),
      status: s.networks.map((n) => n.status + ':' + n.reason),
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
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const place = async (slot, point, name) => {
    await play.keyboard.press(slot);
    await play.wait(220);
    await play.mouse.move(point);
    await play.wait(280);
    await play.mouse.click(point);
    await play.wait(320);
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

  // 复用 m17a 已验证的地面格坐标：源(-6,7) 轴(-5,7) 轴(-4,7) 12T(-3,7)
  // 冲压机 A(-2,7) 由 12T 同轴直驱；24T(-3,8) 与 12T 啮合；冲压机 B(-2,8) 由 24T 直驱。
  await play.step('01-build-gear-ratio-layout', async () => {
    await place('Digit4', [0.226, 0.571], '01-source');
    await place('Digit1', [0.248, 0.616], '01-shaft-a');
    await place('Digit1', [0.272, 0.665], '01-shaft-b');
    await place('Digit2', [0.298, 0.716], '01-gear12');
    await place('Digit5', [0.325, 0.772], '01-machine-direct');
    await place('Digit3', [0.255, 0.772], '01-gear24');
    await place('Digit5', [0.283, 0.830], '01-machine-geared');
    await play.keyboard.press('Digit1');
    await clearHover();
    const s = await read('LAYOUT');
    assert(s.parts.length === 7, 'layout should place 7 parts, got ' + s.parts.length);
    assert(s.networks.length === 1, 'all placed parts must form one network');
    assert(s.machines.length === 2, 'two machines expected, got ' + s.machines.length);
    await play.screenshot('01-layout');
  });

  await play.step('02-start-gear-ratio', async () => {
    await hoverAndRightClick([0.226, 0.571]);
    const s = await read('STARTED');
    assert(s.sources[0]?.enabled === true, 'right-click must enable the source');
    assert(s.networks[0]?.status === 'powered', 'network must be powered');
    const direct = s.machines[0];
    const geared = s.machines[1];
    assert(direct?.powered === true, 'machine on 12T must run');
    assert(geared?.powered === true, 'machine on 24T must run');
    assert(Math.abs(direct.rpm) > 1, 'direct machine must rotate');
    const ratio = Math.abs(geared.rpm) / Math.abs(direct.rpm);
    // 12T 驱动 24T：输出转速减半。
    assert(Math.abs(ratio - 0.5) < 0.05, '12T->24T must halve speed, got ' + ratio);
    // 负载 = 20（直驱）+ 20×0.5（减速后折算）= 30 → 速度因子 0.7。
    assert(Math.abs(s.networks[0].speedFactor - 0.7) < 0.02,
      'speed factor should be 0.7 under 30 torque load, got ' + s.networks[0].speedFactor);
    assert(Math.abs(s.networks[0].demandTorque - 30) < 0.5,
      'source demand should be 30, got ' + s.networks[0].demandTorque);
    // 悬停直驱机器：截图里应出现 3D 转速读数牌。
    await play.mouse.move([0.325, 0.772]);
    await play.wait(350);
    await play.screenshot('02-gear-ratio-with-readout');
  });

  await play.step('03-drop-load-and-recover-speed', async () => {
    const before = await read('BEFORE_DROP');
    const beforeRpm = Math.abs(before.machines[0]?.rpm ?? 0);
    // 选中并拆掉 24T 上的机器：负载 30 → 20，整网转速应回升。
    await play.keyboard.press('Digit1');
    await play.wait(200);
    await clickPart([0.283, 0.830]);
    await play.keyboard.press('Delete');
    await play.advance(0.1);
    const after = await read('AFTER_DROP');
    assert(after.machines.length === 1, 'one machine should remain');
    assert(after.networks[0]?.status === 'powered', 'network must keep running');
    assert(Math.abs(after.networks[0].speedFactor - 0.8) < 0.02,
      'speed factor should rise to 0.8 after load drops, got ' + after.networks[0].speedFactor);
    assert(Math.abs(after.networks[0].demandTorque - 20) < 0.5,
      'source demand should drop to 20, got ' + after.networks[0].demandTorque);
    const afterRpm = Math.abs(after.machines[0]?.rpm ?? 0);
    assert(afterRpm > beforeRpm + 1, 'remaining machine must speed up: ' + beforeRpm + ' -> ' + afterRpm);
    await play.mouse.move([0.325, 0.772]);
    await play.wait(350);
    await play.screenshot('03-after-load-drop');
  });

  await play.step('04-stop-and-restart', async () => {
    await hoverAndRightClick([0.226, 0.571]);
    const stopped = await read('STOPPED');
    assert(stopped.machines[0]?.powered === false, 'machine must stop when source is off');
    const angle = stopped.machines[0]?.angle;
    await play.advance(0.4);
    const frozen = await read('FROZEN');
    assert(frozen.machines[0]?.angle === angle, 'machine angle must freeze while stopped');
    await hoverAndRightClick([0.226, 0.571]);
    const restarted = await read('RESTARTED');
    assert(restarted.machines[0]?.powered === true, 'machine must resume after restart');
    await play.advance(0.3);
    const resumed = await read('RESUMED');
    assert(resumed.machines[0].angle > angle, 'machine must keep moving after restart');
    await clearHover();
    await play.screenshot('04-restarted');
  });
}
