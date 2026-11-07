// M1.7-A acc-A temporary probe (delete before final acceptance script)
/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function probe(play) {
  const rows = async () => {
    await play.keyboard.press('Tab');
    await play.wait(400);
    const values = await play.page.evaluate(() => Array.from(document.querySelectorAll('.ii-row-count')).map((el) => el.textContent));
    await play.keyboard.press('Tab');
    await play.wait(300);
    return values.map((text) => Number(String(text).replace(/[^0-9]/g, '')));
  };
  await play.step('start', async () => {
    console.log('KIT=' + JSON.stringify(await rows()));
    await play.screenshot('01-start');
  });
  await play.step('place-chain', async () => {
    await play.keyboard.press('Digit1');
    await play.wait(250);
    const points = [[0.24,0.66],[0.27,0.64],[0.30,0.62],[0.33,0.60]];
    for (let i = 0; i < points.length; i += 1) {
      await play.mouse.move(points[i]);
      await play.wait(250);
      await play.screenshot('chain-ghost-' + i);
      await play.mouse.click(points[i]);
      await play.wait(350);
      await play.screenshot('chain-placed-' + i);
      console.log('COUNT' + i + '=' + JSON.stringify(await rows()));
    }
  });
  await play.step('delete-selected', async () => {
    // 点击最后一个已放置轴以选中，再 Delete 返还。
    await play.mouse.move([0.33,0.60]);
    await play.wait(300);
    await play.mouse.click([0.33,0.60]);
    await play.wait(300);
    await play.screenshot('selected');
    await play.keyboard.press('Delete');
    await play.wait(400);
    await play.screenshot('after-delete');
    console.log('DELETE_COUNT=' + JSON.stringify(await rows()));
  });
  await play.step('place-gear-source-machine', async () => {
    await play.keyboard.press('Digit2');
    await play.mouse.move([0.38,0.58]);
    await play.wait(300);
    await play.screenshot('gear-ghost');
    await play.mouse.click([0.38,0.58]);
    await play.wait(300);
    await play.keyboard.press('Digit4');
    await play.mouse.move([0.20,0.68]);
    await play.wait(300);
    await play.mouse.click([0.20,0.68]);
    await play.wait(300);
    await play.keyboard.press('Digit5');
    await play.mouse.move([0.42,0.56]);
    await play.wait(300);
    await play.mouse.click([0.42,0.56]);
    await play.wait(400);
    await play.screenshot('all-parts');
    console.log('PARTS_COUNT=' + JSON.stringify(await rows()));
  });
  await play.step('invalid-placement', async () => {
    await play.keyboard.press('Digit1');
    await play.mouse.move([0.70,0.35]);
    await play.wait(300);
    await play.screenshot('invalid-ghost');
  });
}
