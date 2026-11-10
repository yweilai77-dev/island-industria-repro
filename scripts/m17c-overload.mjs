// M1.7-C 补充验收：整体动力源过载（真实 Runtime，不伪造状态）
// 布局（全部使用正式零件与正常放置/连接/启停路径）：
//   源(-6,7) → 轴(-5,7) → 轴(-4,7) → 24T(-3,7) ─┬─ 冲压机 M0(-2,7)     负载 20
//                                              ├─ 12T(-3,8) → 冲压机 M1(-2,8)  负荷折算 20×2 = 40
//                                              └─ 12T(-3,6) → 冲压机 M2(-2,6)  负荷折算 40
//   源侧总需求 = 20 + 40 + 40 = 100 N·m → 达到源容量 100，整网 stalled/source-overload。
//   流程：先让主干运行（记录非零相位）→ 加负载过载 → 逐步卸载恢复 → 相位从冻结处继续。
import { enterLegacyMode } from './legacy-mode.mjs';

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function playthrough(play) {
  await enterLegacyMode(play);
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
        stalled: m.stalled,
        rpm: Math.round(m.rpm * 10) / 10,
        angle: Math.round(m.angle * 1000) / 1000,
        ramY: Math.round(m.ramY * 1000) / 1000,
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
  const M0_HOVER = [[0.325, 0.717], [0.325, 0.772]];
  /** 过载冻结时的相位，用于证明恢复不会回零。 */
  let overloadFrozenAngle = 0;

  await play.step('01-run-trunk-and-record-phase', async () => {
    await place('Digit4', [0.226, 0.571], '01-source');
    await place('Digit1', [0.248, 0.616], '01-shaft-a');
    await place('Digit1', [0.272, 0.665], '01-shaft-b');
    await place('Digit3', [0.298, 0.716], '01-gear24');
    await place('Digit5', [0.325, 0.772], '01-machine-m0');
    await play.keyboard.press('Digit1');
    await clearHover();
    const built = await read('TRUNK');
    assert(built.parts.length === 5, 'trunk should have 5 parts, got ' + built.parts.length);
    assert(await setSourceEnabled(SOURCE_HOVER, true), 'right-click must enable the source');
    await play.advance(0.6);
    const running = await read('RUNNING');
    assert(running.networks[0]?.status === 'powered', 'trunk must run before the overload');
    assert(Math.abs(running.networks[0].speedFactor - 0.8) < 0.02,
      'single machine load should give 0.8 speed factor, got ' + running.networks[0].speedFactor);
    assert(Math.abs(running.machines[0].angle) > 0.1, 'machine must have a non-zero phase before overload');
    await play.mouse.move([0.325, 0.717]);
    await play.wait(300);
    await play.screenshot('01-running-readout');
  });

  await play.step('02-add-load-until-source-overload', async () => {
    const before = await read('BEFORE_BRANCHES');
    assert(Math.abs(before.machines[0].angle) > 0.1,
      'trunk machine must already be rotating before the overload is added');
    // 加两条 12T 分支：每条把 20 N·m 负载放大到 40，总需求 100。
    await place('Digit2', [0.255, 0.772], '02-gear-h1');
    await place('Digit5', [0.283, 0.830], '02-machine-m1');
    await place('Digit2', [0.341, 0.660], '02-gear-h2');
    await place('Digit5', [0.368, 0.716], '02-machine-m2');
    await play.keyboard.press('Digit1');
    await clearHover();
    const s = await read('OVERLOADED');
    assert(s.parts.length === 9, 'layout should have 9 parts, got ' + s.parts.length);
    assert(s.machines.length === 3, 'three machines expected, got ' + s.machines.length);
    assert(s.networks.length === 1 && s.networks[0].partIds.length === 9,
      'all 9 parts must be in one network, got ' + JSON.stringify(s.networks.map((n) => n.partIds.length)));
    assert(s.networks[0]?.status === 'stalled', 'network must be stalled, got ' + s.networks[0]?.status);
    assert(s.networks[0]?.reason === 'source-overload',
      'reason must be source-overload, got ' + s.networks[0]?.reason);
    assert(Math.abs(s.networks[0].demandTorque - 100) < 1,
      'source demand must reach 100 N·m, got ' + s.networks[0].demandTorque);
    assert(Math.abs(s.networks[0].capacityTorque - 100) < 1,
      'source capacity must be 100 N·m, got ' + s.networks[0].capacityTorque);
    assert(s.machines.every((machine) => machine.powered === false), 'all machines must stop');
    // 过载发生时机器已经转过非零相位；冻结必须停在该相位，不回零。
    const m0 = s.machines.find((machine) => machine.partId === 5);
    assert(Math.abs(m0.angle) > 0.1, 'overload must freeze a non-zero phase');
    const frozenAngle = m0.angle;
    overloadFrozenAngle = frozenAngle;
    const frozenRam = m0.ramY;
    await play.advance(0.5);
    const frozen = await snapshot();
    const m0f = frozen.machines.find((machine) => machine.partId === 5);
    assert(Math.abs(m0f.angle - frozenAngle) < 1e-3, 'machine phase must stay frozen during overload');
    assert(Math.abs(m0f.ramY - frozenRam) < 1e-3, 'machine ram must stay frozen during overload');
    await play.mouse.move([0.325, 0.717]);
    await play.wait(300);
    await play.screenshot('02-source-overload-readout');
  });

  await play.step('03-drop-load-and-recover', async () => {
    const before = await read('BEFORE_DROP');
    const machineId = before.machines[0].partId;
    // 整个停滞期间相位不变：仍等于过载瞬间的冻结相位。
    const frozenAngle = before.machines.find((machine) => machine.partId === machineId).angle;
    assert(Math.abs(frozenAngle - overloadFrozenAngle) < 1e-3,
      'phase must stay frozen for the whole stalled period: '
      + JSON.stringify({ overloadFrozenAngle, frozenAngle }));
    // 第一段：拆 M1。需求 100 → 60，但 24T 主干齿轮承载 50，仍停（公共上游过载）。
    await deletePart([[0.283, 0.775], [0.283, 0.79]], 8, 'machine M1');
    const mid = await read('AFTER_FIRST_DROP');
    assert(mid.parts.length === 8 && mid.machines.length === 2, 'first drop should leave 8 parts / 2 machines');
    assert(mid.networks[0]?.status === 'stalled',
      'trunk gear capacity still exceeded after the first drop, got ' + mid.networks[0]?.status);
    assert(mid.networks[0]?.reason === 'branch-overload',
      'reason must be branch-overload at the trunk gear, got ' + mid.networks[0]?.reason);
    // 第二段：拆 M2。需求 20 < 主干齿轮 50，网络恢复。
    await deletePart([[0.368, 0.66], [0.368, 0.716]], 7, 'machine M2');
    const after = await read('AFTER_SECOND_DROP');
    assert(after.parts.length === 7, 'two parts should be removed in total, got ' + after.parts.length);
    assert(after.machines.length === 1, 'one machine should remain, got ' + after.machines.length);
    assert(after.networks[0]?.status === 'powered', 'network must recover, got ' + after.networks[0]?.status);
    assert(Math.abs(after.networks[0].demandTorque - 20) < 1,
      'source demand should drop to 20 N·m, got ' + after.networks[0].demandTorque);
    assert(Math.abs(after.networks[0].speedFactor - 0.8) < 0.02,
      'speed factor should be 0.8, got ' + after.networks[0].speedFactor);
    const resumed = after.machines[0];
    assert(resumed.powered === true, 'remaining machine must run');
    // 恢复时相位从冻结值继续向前，且绝不回零重置。
    assert(resumed.angle > frozenAngle - 1e-3,
      'recovery must continue forward from the frozen phase: '
      + JSON.stringify({ frozenAngle, angle: resumed.angle }));
    assert(Math.abs(resumed.angle) > 0.1, 'recovery must not reset the phase to zero');
    await play.advance(0.3);
    const moving = await snapshot();
    const current = moving.machines.find((machine) => machine.partId === machineId);
    assert(current.angle > resumed.angle + 1e-3,
      'recovered machine must keep advancing: ' + JSON.stringify({ resumed: resumed.angle, current: current.angle }));
    await play.mouse.move([0.325, 0.717]);
    await play.wait(300);
    await play.screenshot('03-recovered-readout');
  });
}
