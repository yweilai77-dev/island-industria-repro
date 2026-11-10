// 采集诊断探针 v2：捕获页面 console，逐次记录库存变化。
import { createHarness } from './m18-helpers.mjs';
export default async function playthrough(play) {
  const h = createHarness(play);
  const pageLog = [];
  play.page.on('console', (message) => {
    const text = message.text();
    if (text.startsWith('HARV-')) pageLog.push(text);
  });
  await play.step('probe-harvest', async () => {
    await h.learnMovement();
    await h.calibrate('LEVEL0-PROBE');
    const ok = await h.gotoCell({ gx: -6, gz: 4 }, 20000, true);
    console.log('REACHED=' + ok);
    const inv = async () => (await play.state('mechanical')).inventory.find((e) => e.itemId === 'iron_ore')?.count ?? 0;
    for (let i = 0; i < 12; i += 1) {
      const before = await inv();
      const mark = pageLog.length;
      await play.keyboard.press('KeyF');
      await play.advance(3.4);
      await play.wait(50);
      const after = await inv();
      console.log('PROBE-STEP=' + JSON.stringify({ i, before, after, gained: after - before, events: pageLog.slice(mark) }));
    }
    await play.screenshot('probe-harvest2');
  });
}
