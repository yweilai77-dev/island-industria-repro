// M1.7-C 补充验收：断轴后停止、重新放置传动轴后从冻结相位恢复
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
      machine: s.machines[0] ? {
        powered: s.machines[0].powered,
        angle: Math.round(s.machines[0].angle * 1000) / 1000,
        ramY: Math.round(s.machines[0].ramY * 1000) / 1000,
      } : null,
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
  const SOURCE_HOVER = [[0.48, 0.39], [0.5, 0.3827]];

  await play.step('01-build-and-run', async () => {
    await place('Digit4', [0.5, 0.3827], '01-source');
    await place('Digit1', [0.527, 0.416], '01-shaft');
    await place('Digit5', [0.5555, 0.4513], '01-machine');
    await play.keyboard.press('Digit1');
    await clearHover();
    const built = await read('BUILT');
    assert(built.parts.length === 3, 'chain should have 3 parts, got ' + built.parts.length);
    let enabled = false;
    for (const point of SOURCE_HOVER) {
      await rightClick(point);
      const probe = await snapshot();
      if (probe.sources[0]?.enabled === true) { enabled = true; break; }
    }
    assert(enabled, 'right-click must enable the source');
    await play.advance(0.6);
    const running = await read('RUNNING');
    assert(running.networks[0]?.status === 'powered', 'network must run');
    assert(Math.abs(running.machines[0].angle) > 0.1, 'machine must have a non-zero phase while running');
    await play.mouse.move([0.5555, 0.42]);
    await play.wait(300);
    await play.screenshot('02-running-readout');
  });

  await play.step('02-remove-shaft-freezes-machine', async () => {
    const before = await read('BEFORE_CUT');
    await play.keyboard.press('Digit1');
    await play.wait(200);
    await clickPart([0.51, 0.40]);
    await play.keyboard.press('Delete');
    await play.advance(0.1);
    const cut = await read('CUT');
    assert(cut.parts.length === 2, 'shaft should be removed, got ' + cut.parts.length);
    assert(cut.revision > before.revision, 'removal must bump the revision');
    assert(cut.machines[0]?.powered === false, 'machine must lose power after the shaft is removed');
    const frozenAngle = cut.machines[0].angle;
    const frozenRam = cut.machines[0].ramY;
    await play.advance(0.5);
    const frozen = await read('FROZEN');
    assert(Math.abs(frozen.machines[0].angle - frozenAngle) < 1e-6,
      'machine angle must freeze after disconnection');
    assert(Math.abs(frozen.machines[0].ramY - frozenRam) < 1e-6,
      'machine ram must freeze after disconnection');
    await clearHover();
    await play.screenshot('03-disconnected');
  });

  await play.step('03-replace-shaft-resumes-from-frozen-phase', async () => {
    const before = await read('BEFORE_RECONNECT');
    const frozenAngle = before.machines[0].angle;
    await play.keyboard.press('Digit1');
    await play.wait(200);
    await place('Digit1', [0.527, 0.416], '04-reconnected-shaft');
    await play.keyboard.press('Digit1');
    await clearHover();
    const after = await read('RECONNECTED');
    assert(after.parts.length === 3, 'shaft should be back, got ' + after.parts.length);
    assert(after.networks.length === 1 && after.networks[0].partIds.length === 3,
      'network must reconnect all 3 parts, got ' + JSON.stringify(after.networks.map((n) => n.partIds.length)));
    assert(after.networks[0].status === 'powered', 'network must be powered again');
    assert(after.machines[0].powered === true, 'machine must resume');
    // 相位从冻结位置继续（不为 0、且随后继续变化），没有重置。
    assert(Math.abs(frozenAngle) > 0.1, 'frozen phase should be non-zero for the continuity check');
    await play.advance(0.3);
    const moving = await read('RESUMED');
    const resumed = moving.machines[0];
    assert(resumed.angle > frozenAngle,
      'machine phase must continue forward from the frozen angle: '
      + JSON.stringify({ frozenAngle, resumed: resumed.angle }));
    await play.mouse.move([0.5555, 0.42]);
    await play.wait(300);
    await play.screenshot('05-resumed-readout');
  });
}
