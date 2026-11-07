// 相机缩放探针：确认 `-` / `=` 是否被相机当成缩放键（快捷栏第 11/12 格用了这两个键）。
/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function playthrough(play) {
  await play.step('01-baseline', async () => {
    await play.wait(400);
    await play.screenshot('01-baseline');
  });
  await play.step('02-press-minus', async () => {
    for (let i = 0; i < 4; i += 1) {
      await play.keyboard.press('Minus');
      await play.wait(120);
    }
    await play.wait(600);
    await play.screenshot('02-minus');
  });
  await play.step('03-press-equal', async () => {
    for (let i = 0; i < 8; i += 1) {
      await play.keyboard.press('Equal');
      await play.wait(120);
    }
    await play.wait(600);
    await play.screenshot('03-equal');
  });
  await play.step('04-many-moves', async () => {
    for (let i = 0; i < 25; i += 1) {
      await play.mouse.move([0.3 + (i % 5) * 0.08, 0.4 + (i % 4) * 0.06]);
      await play.wait(60);
    }
    for (let i = 0; i < 4; i += 1) {
      await play.mouse.click([0.45, 0.5]);
      await play.wait(120);
    }
    await play.wait(600);
    await play.screenshot('04-moves');
  });
}
