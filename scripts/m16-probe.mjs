// M1.6 temporary probe (delete before delivery)
/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function probe(play) {
  await play.step('probe-start', async () => {
    console.log('BODY:' + JSON.stringify(await play.page.evaluate(() => document.body.innerText)));
    console.log('DOM:' + JSON.stringify(await play.page.evaluate(() => Array.from(document.querySelectorAll('div')).map((el) => ({ cls: el.className, text: (el.textContent || '').slice(0, 80) })).filter((x) => x.cls || x.text).slice(0, 30))));
    await play.screenshot('probe-start');
  });
  await play.step('probe-zoom', async () => {
    await play.page.mouse.wheel(0, 2000);
    await play.wait(600);
    await play.screenshot('probe-zoom');
  });
  await play.step('probe-tab', async () => {
    await play.keyboard.press('Tab');
    await play.wait(300);
    console.log('TAB_BODY:' + JSON.stringify(await play.page.evaluate(() => document.body.innerText)));
    console.log('COUNTS:' + JSON.stringify(await play.page.evaluate(() => Array.from(document.querySelectorAll('.ii-row-count,.ii-detail-count,.ii-slot-count')).map((el) => el.textContent))));
    await play.screenshot('probe-tab');
    await play.keyboard.press('Tab');
    await play.wait(300);
  });
}
