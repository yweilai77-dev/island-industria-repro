// 采集诊断探针：逐次记录库存变化，配合 harvest.pack 临时日志定位丢采集的原因。
import { createHarness } from './m18-helpers.mjs';
export default async function playthrough(play) {
  const h = createHarness(play);
  await play.step('probe-harvest', async () => {
    await h.learnMovement();
    const cal = await h.calibrate('LEVEL0-PROBE');
    const ok = await h.gotoCell({ gx: -6, gz: 4 }, 20000, true);
    console.log('REACHED=' + ok);
    const inv = async () => (await play.state('mechanical')).inventory.find((e) => e.itemId === 'iron_ore')?.count ?? 0;
    for (let i = 0; i < 10; i += 1) {
      const before = await inv();
      await play.keyboard.press('KeyF');
      await play.advance(3.4);
      await play.wait(50);
      const after = await inv();
      console.log('PROBE-STEP=' + JSON.stringify({ i, before, after, gained: after - before }));
    }
    await play.screenshot('probe-harvest');
  });
}
