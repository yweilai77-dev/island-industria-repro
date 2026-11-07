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
    await place('Digit4', [0.20, 0.57], 'source');
    await place('Digit1', [0.248, 0.616], 'shaft');
    await place('Digit5', [0.272, 0.665], 'machine');
    await play.mouse.move([0.05, 0.05]);
    await play.wait(350);
    await play.screenshot('chain');
    await read('CHAIN');
  });
  await play.step('hover-sweep', async () => {
    const points = [[0.18,0.55],[0.20,0.57],[0.21,0.56],[0.22,0.58],[0.23,0.55],[0.24,0.60],[0.25,0.62],[0.27,0.66]];
    for (const point of points) {
      await play.mouse.move(point);
      await play.wait(250);
      const s = await play.state('mechanical');
      console.log('HOVER ' + point.join(',') + '=' + s.hoveredPartId);
    }
  });
  await play.step('right-click-start', async () => {
    // 左键选中源（悬停/选中兜底），再右键。
    await play.mouse.click([0.20, 0.57]);
    await play.wait(500);
    await read('SELECT');
    await play.mouse.move([0.20, 0.57]);
    await play.wait(400);
    await play.page.mouse.click(0.20 * 1280, 0.57 * 720, { button: 'right' });
    await play.advance(0.5);
    await read('RUN1');
    await play.screenshot('run1');
    await play.advance(0.5);
    await read('RUN2');
    await play.screenshot('run2');
  });
  await play.step('right-click-stop', async () => {
    await play.mouse.move([0.20, 0.57]);
    await play.wait(300);
    await play.page.mouse.click(0.20 * 1280, 0.57 * 720, { button: 'right' });
    await play.advance(0.5);
    await read('STOP');
    await play.screenshot('stop');
  });
}