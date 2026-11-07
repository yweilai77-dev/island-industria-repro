// M1.7-B temporary probe
/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function probe(play) {
  const place = async (slot, point, name) => {
    await play.keyboard.press(slot);
    await play.wait(220);
    await play.mouse.move(point);
    await play.wait(300);
    await play.mouse.click(point);
    await play.wait(350);
    await play.screenshot(name);
  };
  const read = async (label) => {
    const state = await play.state('mechanical');
    console.log(label + ' enabled=' + state.sources[0]?.enabled + ' hovered=' + state.hoveredPartId + ' selected=' + state.selectedPartId + ' cells=' + JSON.stringify(state.cells) + ' status=' + state.networks[0]?.status + ' angle=' + state.parts.map((p) => p.angle).join(',') + ' ram=' + state.machines[0]?.ramY);
    return state;
  };
  await play.step('start', async () => {
    await read('START');
  });
  await play.step('place-chain', async () => {
    await place('Digit4', [0.48, 0.39], 'source');
    await place('Digit1', [0.527, 0.416], 'shaft');
    await place('Digit5', [0.5555, 0.4513], 'machine');
    await play.mouse.move([0.05, 0.05]);
    await play.wait(350);
    await play.screenshot('chain');
    await read('CHAIN');
  });
  await play.step('hover-sweep', async () => {
    const points = [[0.44,0.35],[0.45,0.36],[0.46,0.37],[0.47,0.38],[0.48,0.39],[0.49,0.40],[0.50,0.38],[0.51,0.40],[0.52,0.41],[0.53,0.42]];
    for (const point of points) {
      await play.mouse.move(point);
      await play.wait(250);
      const s = await play.state('mechanical');
      console.log('HOVER ' + point.join(',') + '=' + s.hoveredPartId);
    }
  });
  await play.step('right-click-start', async () => {
    // 左键选中源（悬停/选中兜底），再右键。
    await play.mouse.click([0.48, 0.39]);
    await play.wait(500);
    await read('SELECT');
    await play.mouse.move([0.48, 0.39]);
    await play.wait(400);
    await play.page.mouse.click(0.48 * 1280, 0.39 * 720, { button: 'right' });
    await play.advance(0.5);
    await read('RUN1');
    await play.screenshot('run1');
    await play.advance(0.5);
    await read('RUN2');
    await play.screenshot('run2');
  });
  await play.step('camera-view', async () => {
    await play.keyboard.press('KeyQ');
    await play.wait(1000);
    await play.screenshot('camera-q');
    await play.keyboard.press('KeyQ');
    await play.wait(1000);
    await play.screenshot('camera-q2');
  });
  await play.step('freeze-stop', async () => {
    // 相机已转走；使用“选中源兜底”右键关闭。
    await play.page.mouse.click(0.48 * 1280, 0.39 * 720, { button: 'right' });
    await play.advance(0.05);
    const a = await read('STOP1');
    await play.advance(0.5);
    const b = await read('STOP2');
    console.log('FREEZE ' + (a.machines[0]?.angle === b.machines[0]?.angle) + ' ramEqual=' + (a.machines[0]?.ramY === b.machines[0]?.ramY));
    await play.screenshot('stopped');
    // 重新启动：从冻结角度继续。
    await play.page.mouse.click(0.48 * 1280, 0.39 * 720, { button: 'right' });
    await play.advance(0.25);
    await read('RESTART');
    await play.screenshot('restart');
  });
}