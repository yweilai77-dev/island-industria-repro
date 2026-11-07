// M1.7-C 补充验收：局部支路过载（A/B 同一场景、同一时刻）
// 布局：源(-6,7) → 轴(-5,7) → 轴(-4,7) → 12T(-3,7)
//   A 支路（向上/近侧）：24T(-3,6) ─ 冲压机 MA(-2,6)；24T 再啮合 12T(-3,5) ─ 冲压机 MI(-2,5)
//       A 支路 24T 承载 = 20 + 20×2 = 60 > 齿轮承载 50 → 只停 A。
//   B 支路（向下/远侧）：24T(-3,8) ─ 冲压机 MB(-2,8)，负载折算 10，正常运行。
//   公共上游 12T 承载 = 60×0.5 + 20×0.5 = 40 ≤ 50，源侧需求 40 < 100 → 不停。
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
      stalled: s.networks.map((n) => n.stalledPartIds),
      parts: s.parts.length,
      machines: s.machines.map((m) => ({
        id: m.partId,
        powered: m.powered,
        stalled: m.stalled,
        rpm: Math.round(m.rpm * 10) / 10,
        angle: Math.round(m.angle * 1000) / 1000,
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

  await play.step('01-build-trunk-and-branch-b', async () => {
    await place('Digit4', [0.226, 0.571], '01-source');
    await place('Digit1', [0.248, 0.616], '01-shaft-a');
    await place('Digit1', [0.272, 0.665], '01-shaft-b');
    await place('Digit2', [0.298, 0.716], '01-gear-driver');
    await place('Digit3', [0.255, 0.772], '01-branch-b-gear');
    await place('Digit5', [0.283, 0.830], '01-branch-b-machine');
    await play.keyboard.press('Digit1');
    await clearHover();
    const s = await read('TRUNK_B');
    assert(s.parts.length === 6, 'trunk + branch B should have 6 parts, got ' + s.parts.length);
    assert(s.networks.length === 1 && s.networks[0].partIds.length === 6,
      'all 6 parts must be connected, got ' + JSON.stringify(s.networks.map((n) => n.partIds.length)));
  });

  await play.step('02-add-overloaded-branch-a', async () => {
    await place('Digit3', [0.341, 0.660], '02-branch-a-gear-24t');
    await place('Digit5', [0.368, 0.716], '02-branch-a-machine-direct');
    await place('Digit2', [0.384, 0.604], '02-branch-a-gear-12t');
    await place('Digit5', [0.411, 0.660], '02-branch-a-machine-meshed');
    await play.keyboard.press('Digit1');
    await clearHover();
    const s = await read('LAYOUT');
    assert(s.parts.length === 10, 'layout should have 10 parts, got ' + s.parts.length);
    assert(s.machines.length === 3, 'three machines expected, got ' + s.machines.length);
    assert(s.networks.length === 1 && s.networks[0].partIds.length === 10,
      'all 10 parts must be in one network, got ' + JSON.stringify(s.networks.map((n) => n.partIds.length)));
    await play.screenshot('02-layout');
  });

  await play.step('03-branch-a-overloads-branch-b-keeps-running', async () => {
    assert(await setSourceEnabled(SOURCE_HOVER, true), 'right-click must enable the source');
    const s = await read('BRANCH_OVERLOAD');
    assert(s.networks[0]?.status === 'powered', 'network must stay powered, got ' + s.networks[0]?.status);
    const byId = new Map(s.machines.map((machine) => [machine.partId, machine]));
    // A 支路：直驱机器与啮合机器都被停掉。
    assert(byId.get(6)?.stalled === true && byId.get(6)?.powered === false,
      'branch A direct machine must stall: ' + JSON.stringify(byId.get(6)));
    assert(byId.get(8)?.stalled === true && byId.get(8)?.powered === false,
      'branch A meshed machine must stall: ' + JSON.stringify(byId.get(8)));
    // B 支路继续运行。
    assert(byId.get(10)?.powered === true, 'branch B machine must keep running');
    // 公共上游没有被停：源开启、网络 powered、上游齿轮不在 stalledPartIds。
    assert(s.networks[0].stalledPartIds.includes(5), 'branch A 24T gear must be stalled');
    assert(!s.networks[0].stalledPartIds.includes(4), 'common upstream 12T gear must not stall');
    assert(Math.abs(s.networks[0].demandTorque - 10) < 1,
      'after branch A stalls the source only carries branch B (10 N·m), got ' + s.networks[0].demandTorque);
    const angleA = byId.get(6).angle;
    const angleB = byId.get(10).angle;
    await play.advance(0.5);
    const moved = await snapshot();
    const a2 = moved.machines.find((machine) => machine.partId === 6);
    const b2 = moved.machines.find((machine) => machine.partId === 10);
    assert(a2.angle === angleA, 'branch A machine angle must freeze');
    assert(b2.angle !== angleB, 'branch B machine must keep moving');
    await play.mouse.move([0.283, 0.775]);
    await play.wait(300);
    await play.screenshot('03-branch-overload-run');
    // 悬停 A 支路机器，读数应显示 BRANCH OVERLOAD。
    await play.mouse.move([0.368, 0.66]);
    await play.wait(300);
    await play.screenshot('03-branch-overload-readout');
  });

  await play.step('04-drop-branch-a-load-and-recover', async () => {
    const before = await read('BEFORE_RECOVER');
    const angleB = before.machines.find((machine) => machine.partId === 10).angle;
    // 拆掉 A 支路直驱机器：A 的 24T 负载 60 → 40 ≤ 50，恢复。
    await deletePart([[0.368, 0.66], [0.368, 0.716]], 9, 'branch A direct machine');
    const after = await read('AFTER_RECOVER');
    assert(after.parts.length === 9, 'one part should be removed, got ' + after.parts.length);
    assert(after.machines.length === 2, 'two machines should remain, got ' + after.machines.length);
    assert(after.networks[0]?.status === 'powered', 'network must stay powered, got ' + after.networks[0]?.status);
    assert(after.networks[0]?.stalledPartIds.length === 0,
      'no part should stay stalled, got ' + JSON.stringify(after.networks[0]?.stalledPartIds));
    assert(after.machines.every((machine) => machine.powered === true), 'all remaining machines must run');
    assert(Math.abs(after.networks[0].demandTorque - 40) < 1,
      'source demand should return to 40 N·m, got ' + after.networks[0].demandTorque);
    const angleA = after.machines.find((machine) => machine.partId === 8).angle;
    await play.advance(0.4);
    const moving = await snapshot();
    assert(moving.machines.find((machine) => machine.partId === 8).angle > angleA,
      'branch A machine must resume after the load drops');
    assert(moving.machines.find((machine) => machine.partId === 10).angle > angleB,
      'branch B machine must never freeze across the whole sequence');
    await play.mouse.move([0.283, 0.775]);
    await play.wait(300);
    await play.screenshot('04-branch-recovered');
  });
}
