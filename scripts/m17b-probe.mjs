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
    console.log(label + '=' + JSON.stringify(state));
    return state;
  };
  await play.step('start', async () => {
    await read('START');
  });
  await play.step('place-chain', async () => {
    await place('Digit4', [0.226, 0.571], 'source');
    await place('Digit1', [0.248, 0.616], 'shaft');
    await place('Digit5', [0.272, 0.665], 'machine');
    await play.mouse.move([0.05, 0.05]);
    await play.wait(350);
    await play.screenshot('chain');
    await read('CHAIN');
  });
  await play.step('right-click-start', async () => {
    await play.mouse.move([0.226, 0.571]);
    await play.wait(400);
    await play.mouse.click([0.226, 0.571], { button: 'right' });
    await play.advance(0.5);
    await read('RUN1');
    await play.screenshot('run1');
    await play.advance(0.5);
    await read('RUN2');
    await play.screenshot('run2');
  });
  await play.step('right-click-stop', async () => {
    await play.mouse.move([0.226, 0.571]);
    await play.wait(300);
    await play.mouse.click([0.226, 0.571], { button: 'right' });
    await play.advance(0.5);
    await read('STOP');
    await play.screenshot('stop');
  });
}
