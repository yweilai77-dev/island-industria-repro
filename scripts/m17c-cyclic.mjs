// M1.7-C 补充验收：闭环动力网络一律拒绝（真实 Runtime 投影）
// 布局：源(-6,7) → 轴(-5,7) → 轴(-4,7) → 12T(-3,7)
//   12T(-3,7) —同轴— 24T(-2,7) —啮合— 12T(-2,8) —同轴— 24T(-3,8) —啮合— 回到 12T(-3,7)
//   这是一个传动比自洽的四齿轮闭环；M1.7-C 只支持树状网络，必须整组件 unsupported/cyclic-network。
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
      parts: s.parts.length,
      networkParts: s.networks.map((n) => n.partIds.length),
      powered: s.parts.filter((p) => p.powered).length,
      withTorque: s.parts.filter((p) => p.torque > 0).length,
      machines: s.machines.length,
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
  const clearHover = async () => {
    await play.mouse.move([0.05, 0.05]);
    await play.wait(350);
  };
  const SOURCE_HOVER = [[0.224, 0.511], [0.224, 0.53], [0.226, 0.571], [0.21, 0.52]];

  await play.step('01-build-gear-loop', async () => {
    await place('Digit4', [0.226, 0.571], '01-source');
    await place('Digit1', [0.248, 0.616], '01-shaft-a');
    await place('Digit1', [0.272, 0.665], '01-shaft-b');
    await place('Digit2', [0.298, 0.716], '01-gear-12t-a');
    await place('Digit3', [0.325, 0.772], '01-gear-24t-b');
    // 先放远侧 (-3,8)，再放 (-2,8)：反过来射线会先命中已放的齿轮而进入选择模式。
    await place('Digit3', [0.255, 0.772], '01-gear-24t-d');
    await place('Digit2', [0.283, 0.830], '01-gear-12t-c');
    await play.keyboard.press('Digit1');
    await clearHover();
    const s = await read('LOOP_BUILT');
    assert(s.parts.length === 7, 'loop layout should have 7 parts, got ' + s.parts.length);
    assert(s.networks.length === 1 && s.networks[0].partIds.length === 7,
      'all 7 parts must form one network, got ' + JSON.stringify(s.networks.map((n) => n.partIds.length)));
    await play.screenshot('01-loop-layout');
  });

  await play.step('02-cyclic-network-is-unsupported', async () => {
    assert(await setSourceEnabled(SOURCE_HOVER, true), 'right-click must enable the source');
    const s = await read('CYCLIC');
    assert(s.networks[0]?.status === 'unsupported',
      'cyclic network must be unsupported, got ' + s.networks[0]?.status);
    assert(s.networks[0]?.reason === 'cyclic-network',
      'reason must be cyclic-network, got ' + s.networks[0]?.reason);
    // 不解算：没有任何零件获得 ω 或扭矩，不会输出看似有效的分配结果。
    const poweredCount = s.parts.filter((part) => part.powered).length;
    const torqueCount = s.parts.filter((part) => part.torque > 0).length;
    assert(poweredCount === 0, 'no part may be powered in a cyclic network, got ' + poweredCount);
    assert(torqueCount === 0, 'no part may report torque in a cyclic network, got ' + torqueCount);
    // 悬停一个齿轮：读数应显示 CYCLIC UNSUPPORTED 且数值为 —。
    await play.mouse.move([0.298, 0.68]);
    await play.wait(350);
    await play.screenshot('02-cyclic-readout');
    // 关掉动力源：仍应保持 unsupported/cyclic-network（不是 idle）。
    assert(await setSourceEnabled(SOURCE_HOVER, false), 'right-click must disable the source');
    const off = await read('CYCLIC_SOURCE_OFF');
    assert(off.networks[0]?.status === 'unsupported' && off.networks[0]?.reason === 'cyclic-network',
      'cyclic topology stays unsupported even with the source off');
    await clearHover();
    await play.screenshot('03-cyclic-source-off');
  });
}
