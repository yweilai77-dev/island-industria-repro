// temporary build-aim probe at SE corner (delete before delivery)
/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function probe(play) {
  let yawIndex = 1;
  const face = async (targetIndex) => {
    let delta = ((targetIndex - yawIndex) % 8 + 8) % 8;
    if (delta > 4) delta -= 8;
    const key = delta >= 0 ? 'KeyE' : 'KeyQ';
    for (let i = 0; i < Math.abs(delta); i += 1) await play.keyboard.press(key);
    yawIndex = ((yawIndex + delta) % 8 + 8) % 8;
    await play.wait(900);
  };
  const walk = async (meters) => { await play.keyboard.hold('KeyW', Math.round(meters * 250)); await play.wait(100); };
  await play.step('to-se-corner', async () => {
    await face(6);
    await walk(17.0);
    await face(4);
    await walk(13.0);
    await play.screenshot('corner');
    console.log('FPS=' + (await play.page.evaluate(() => document.body.innerText)).match(/FPS ([0-9.]+)/)?.[1]);
  });
  const points = [[0.50,0.62],[0.50,0.55],[0.48,0.58],[0.52,0.66],[0.46,0.66],[0.54,0.58]];
  await play.step('1x1-sweep', async () => {
    for (let i = 0; i < points.length; i += 1) {
      await play.mouse.move(points[i]);
      await play.wait(250);
      await play.screenshot('1x1-p' + i + '-' + points[i].join('_'));
    }
  });
  await play.step('2x2-sweep', async () => {
    await play.keyboard.press('BracketRight');
    await play.wait(250);
    for (let i = 0; i < points.length; i += 1) {
      await play.mouse.move(points[i]);
      await play.wait(250);
      await play.screenshot('2x2-p' + i + '-' + points[i].join('_'));
    }
  });
  await play.step('zoom', async () => {
    await play.page.mouse.move(640, 360);
    await play.page.mouse.wheel(0, 3000);
    await play.wait(800);
    await play.screenshot('zoomed');
  });
}
