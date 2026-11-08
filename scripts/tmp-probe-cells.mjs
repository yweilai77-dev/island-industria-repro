// 临时探针：跑完场景 A（含拆除）后，检查建造目标格是否被"神秘对象"占用。
import { createHarness } from './m18-helpers.mjs';
import { createCtx } from './p2c-links-lib.mjs';
import { runSceneA } from './p2c-links-scene-a.mjs';

export default async function playthrough(play) {
  const h = createHarness(play);
  const C = createCtx(play, h);
  await runSceneA(play, h, C);

  await play.step('probe-cells', async () => {
    const s = await h.state();
    console.log('PROBE-STATE=' + JSON.stringify({ parts: s.parts, ports: s.ports, links: s.links }));
    const cal = await h.calibrate('PROBE-AFTER-TEARDOWN');
    for (const cell of [{ gx: -7, gz: 7 }, { gx: -4, gz: 5 }, { gx: -7, gz: 8 }, { gx: -8, gz: 7 }, { gx: -3, gz: 8 }]) {
      const pt = await h.pointForCell(cal, cell, { avoidHover: true });
      await play.mouse.move(pt);
      await play.wait(120);
      const now = await h.state();
      console.log('PROBE-CELL ' + JSON.stringify(cell) + ' target=' + JSON.stringify(now.ui?.buildTarget)
        + ' hover=' + JSON.stringify(now.ui?.hoveredPartId));
    }
    await play.screenshot('01-after-scene-a');
  });
}
