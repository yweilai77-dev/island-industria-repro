// M1.7-C 补充验收：整体动力源过载（真实 Runtime，不伪造状态）
// 布局（全部使用正式零件与正常放置/连接/启停路径）：
//   源(-6,7) → 轴(-5,7) → 轴(-4,7) → 24T(-3,7) ─┬─ 冲压机 M0(-2,7)     负载 20
//                                              ├─ 12T(-3,8) → 冲压机 M1(-2,8)  负荷折算 20×2 = 40
//                                              └─ 12T(-3,6) → 冲压机 M2(-2,6)  负荷折算 40
//   源侧总需求 = 20 + 40 + 40 = 100 N·m → 达到源容量 100，整网 stalled/source-overload。
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
      factor: s.networks.map((n) => Math.round(n.speedFactor * 1000) / 1000),
      demand: s.networks.map((n) => Math.round(n.demandTorque * 10) / 10),
      parts: s.parts.length,
      networkParts: s.networks.map((n) => n.partIds.length),
      machines: s.machines.map((m) => ({
        id: m.partId,
        powered: m.powered,
        rpm: Math.round(m.rpm * 10) / 10,
        stalled: m.stalled,
        load: m.loadTorque,
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
  const deletePart = async (candidates, expectedParts, label) => {
    for (const point of candidates) {
      await play.keyboard.press('Digit1');
      await play.wait(180);
      await clickPart(point);
      await play.keyboard.press('Delete');
      await play.advance(0.1);
      const s = await snapshot();
      if (s.parts.length === expectedParts) return s;
    }
    throw new Error('could not delete ' + label);
  };
  const SOURCE_HOVER = [[0.224, 0.511], [0.224, 0.53], [0.226, 0.571], [0.21, 0.52]];
  const MACHINE_M0_HOVER = [[0.325, 0.717], [0.325, 0.772]];

  await play.step('01-build-trunk', async () => {
    await place('Digit4', [0.226, 0.571], '01-source');
    await place('Digit1', [0.248, 0.616], '01-shaft-a');
    await place('Digit1', [0.272, 0.665], '01-shaft-b');
    await place('Digit3', [0.298, 0.716], '01-gear24');
    await place('Digit5', [0.325, 0.772], '01-machine-m0');
    await play.keyboard.press('Digit1');
    await clearHover();
    const s = await read('TRUNK');
    assert(s.parts.length === 5, 'trunk should have 5 parts, got ' + s.parts.length);
    assert(s.networks.length === 1 && s.networks[0].partIds.length === 5,
      'trunk must be one connected network, got ' + JSON.stringify(s.networks.map((n) => n.partIds.length)));
  });

  await play.step('02-add-two-gear-branches', async () => {
    // 两条 12T 分支：每条把 20 N·m 负载按 1:2 放大到 24T 侧，共 80。
    await place('Digit2', [0.255, 0.772], '02-gear-h1');
    await place('Digit5', [0.283, 0.830], '02-machine-m1');
    await place('Digit2', [0.341, 0.660], '02-gear-h2');
    await place('Digit5', [0.368, 0.716], '02-machine-m2');
    await play.keyboard.press('Digit1');
    await clearHover();
    const s = await read('BRANCHES');
    assert(s.parts.length === 9, 'layout should have 9 parts, got ' + s.parts.length);
    assert(s.machines.length === 3, 'three machines expected, got ' + s.machines.length);
    assert(s.networks.length === 1 && s.networks[0].partIds.length === 9,
      'all 9 parts must be in one network, got ' + JSON.stringify(s.networks.map((n) => n.partIds.length)));
    await play.screenshot('02-layout');
  });

  await play.step('03-source-overload-stalls-network', async () => {
    assert(await setSourceEnabled(SOURCE_HOVER, true), 'right-click must enable the source');
    const s = await read('OVERLOADED');
    assert(s.networks[0]?.status === 'stalled', 'network must be stalled, got ' + s.networks[0]?.status);
    assert(s.networks[0]?.reason === 'source-overload',
      'reason must be source-overload, got ' + s.networks[0]?.reason);
    assert(Math.abs(s.networks[0].demandTorque - 100) < 1,
      'source demand must reach 100 N·m, got ' + s.networks[0].demandTorque);
    assert(Math.abs(s.networks[0].capacityTorque - 100) < 1,
      'source capacity must be 100 N·m, got ' + s.networks[0].capacityTorque);
    assert(s.machines.every((machine) => machine.powered === false), 'all machines must stop');
    const angles = s.machines.map((machine) => machine.angle);
    const rams = s.machines.map((machine) => machine.ramY);
    await play.advance(0.5);
    const frozen = await snapshot();
    assert(frozen.machines.every((machine, index) => machine.angle === angles[index]),
      'all machine angles must freeze while the source is overloaded');
    assert(frozen.machines.every((machine, index) => machine.ramY === rams[index]),
      'all machine rams must freeze while the source is overloaded');
    // 悬停 M0 读取数：应显示 SOURCE OVERLOAD。
    let hovered = false;
    for (const point of MACHINE_M0_HOVER) {
      await play.mouse.move(point);
      await play.wait(300);
      const hoverState = await snapshot();
      if (hoverState.machines.every((machine) => machine.powered === false)) { hovered = true; break; }
    }
    void hovered;
    await play.screenshot('03-source-overload-readout');
  });

  await play.step('04-drop-load-and-recover', async () => {
    const before = await read('BEFORE_DROP');
    const frozenAngles = new Map(before.machines.map((machine) => [machine.partId, machine.angle]));
    // 第一段：拆 M1。源侧需求 100 → 60，但 24T 主干齿轮承载只有 50，
    // 60 > 50 → 公共上游齿轮过载，整网仍然停止（branch-overload）。
    const mid = await deletePart([[0.283, 0.775], [0.283, 0.79]], 8, 'machine M1');
    const midRead = await read('AFTER_FIRST_DROP');
    assert(mid.parts.length === 8 && mid.machines.length === 2,
      'first drop should leave 8 parts / 2 machines');
    assert(midRead.networks[0]?.status === 'stalled',
      'trunk gear capacity still exceeded after the first drop, got ' + midRead.networks[0]?.status);
    assert(midRead.networks[0]?.reason === 'branch-overload',
      'reason must be branch-overload at the trunk gear, got ' + midRead.networks[0]?.reason);
    // 第二段：再拆 M0。需求 40 < 主干齿轮 50，网络恢复。
    await deletePart(MACHINE_M0_HOVER, 7, 'machine M0');
    const after = await read('AFTER_SECOND_DROP');
    assert(after.parts.length === 7, 'two parts should be removed in total, got ' + after.parts.length);
    assert(after.machines.length === 1, 'one machine should remain, got ' + after.machines.length);
    assert(after.networks[0]?.status === 'powered', 'network must recover, got ' + after.networks[0]?.status);
    assert(Math.abs(after.networks[0].demandTorque - 40) < 1,
      'source demand should drop to 40 N·m, got ' + after.networks[0].demandTorque);
    assert(Math.abs(after.networks[0].speedFactor - 0.6) < 0.02,
      'speed factor should be 0.6, got ' + after.networks[0].speedFactor);
    assert(after.machines[0].powered === true, 'remaining machine must run');
    // 相位从冻结位置继续，不清零。
    const machineId = after.machines[0].partId;
    const frozen = frozenAngles.get(machineId);
    await play.advance(0.3);
    const moving = await snapshot();
    const current = moving.machines.find((machine) => machine.partId === machineId);
    assert(current.angle > (frozen ?? 0), 'recovered machine must advance from the frozen phase: '
      + JSON.stringify({ frozen, current: current.angle }));
    await play.mouse.move([0.255, 0.717]);
    await play.wait(300);
    await play.screenshot('04-recovered-readout');
  });
}
