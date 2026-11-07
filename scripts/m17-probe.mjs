// M1.7-A temporary mechanical placement probe (delete before final)
/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function probe(play) {
  const readInventory = async () => {
    await play.keyboard.press('Tab');
    await play.wait(400);
    const rows = await play.page.evaluate(() => Array.from(document.querySelectorAll('.ii-row-count')).map((el) => el.textContent));
    await play.keyboard.press('Tab');
    await play.wait(300);
    return rows;
  };
  const count = async () => {
    const rows = await readInventory();
    return rows.map((text) => Number(String(text).replace(/[^0-9]/g, '')));
  };
  await play.step('start', async () => {
    console.log('START_INV=' + JSON.stringify(await count()));
    await play.screenshot('start');
  });
  await play.step('select-shaft', async () => {
    await play.keyboard.press('Digit1');
    await play.wait(250);
    await play.screenshot('shaft-selected');
  });
  await play.step('ghost-sweep', async () => {
    const points = [[0.25,0.65],[0.30,0.60],[0.35,0.55],[0.22,0.72],[0.40,0.62]];
    for (let i = 0; i < points.length; i += 1) {
      await play.mouse.move(points[i]);
      await play.wait(300);
      await play.screenshot('ghost-' + i);
    }
  });
  await play.step('place-at-0', async () => {
    await play.mouse.move([0.25, 0.65]);
    await play.wait(300);
    await play.mouse.click([0.25, 0.65]);
    await play.wait(400);
    console.log('AFTER_PLACE=' + JSON.stringify(await count()));
    await play.screenshot('placed-0');
  });
  await play.step('rotate-ghost', async () => {
    await play.keyboard.press('KeyR');
    await play.mouse.move([0.30, 0.60]);
    await play.wait(350);
    await play.screenshot('rotated-ghost');
  });
  await play.step('place-at-1', async () => {
    await play.mouse.click([0.30, 0.60]);
    await play.wait(400);
    console.log('AFTER_PLACE2=' + JSON.stringify(await count()));
    await play.screenshot('placed-1');
  });
}
