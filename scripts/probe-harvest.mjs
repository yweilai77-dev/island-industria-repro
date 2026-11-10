// 采集规模探针：60 次按键，统计丢失并按需记录页面事件。
import { createHarness } from './m18-helpers.mjs';
export default async function playthrough(play) {
  const h = createHarness(play);
  const pageLog = [];
  play.page.on('console', (message) => {
    const text = message.text();
    if (text.startsWith('HARV-')) pageLog.push(text);
  });
  await play.step('probe-harvest-scale', async () => {
    await h.learnMovement();
    await h.calibrate('LEVEL0-PROBE');
    await h.gotoCell({ gx: -6, gz: 4 }, 20000, true);
    const inv = async () => (await play.state('mechanical')).inventory.find((e) => e.itemId === 'iron_ore')?.count ?? 0;
    const zero = [];
    for (let i = 0; i < 60; i += 1) {
      const before = await inv();
      const mark = pageLog.length;
      await play.keyboard.press('KeyF');
      await play.advance(3.4);
      await play.wait(40);
      const after = await inv();
      if (after - before !== 1) zero.push({ i, gained: after - before, events: pageLog.slice(mark) });
    }
    const total = await inv();
    console.log('SCALE-PROBE=' + JSON.stringify({ total, misses: zero.length, zero: zero.slice(0, 5) }));
    await play.screenshot('probe-scale');
  });
}
