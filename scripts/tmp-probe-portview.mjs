// 临时探针：装接口盒 → 删机器 → 观察接口盒视图是否被回收。
import { createHarness } from './m18-helpers.mjs';

export default async function playthrough(play) {
  const h = createHarness(play);
  await h.learnMovement();
  const cal = await h.calibrate('PROBE-CAL');
  const place = async (slot, cell, rot, label) => {
    const pt = await h.pointForCell(cal, cell, { avoidHover: true });
    await h.selectSlot(0);
    for (let index = 0; index < Math.round(rot / 90); index += 1) {
      await play.mouse.move([0.02, 0.02]);
      await play.keyboard.press('KeyR');
      await play.advance(0.1);
    }
    return h.placePartAtPoint(pt, slot, 0, label, cell);
  };
  const source = await place(3, { gx: -6, gz: 8 }, 0, 'source');
  const shaft = await place(0, { gx: -5, gz: 8 }, 0, 'shaft');
  const crusher = await place(9, { gx: -4, gz: 8 }, 0, 'crusher');

  // 在破碎机输出位装输出接口盒。
  await h.selectSlot(0);
  const point = await h.hoverSpecificPart(cal, { gx: -4, gz: 8 }, crusher.partId);
  await play.mouse.move(point);
  await play.wait(180);
  await play.keyboard.press('KeyO');
  await play.advance(0.5);
  console.log('PROBE-PORTS=' + JSON.stringify((await h.state()).ports));
  await play.screenshot('01-with-box');

  // 删掉破碎机。
  await play.mouse.move(point);
  await play.wait(180);
  await h.clickAt(point);
  await play.keyboard.press('Delete');
  await play.advance(1.0);
  const s = await h.state();
  console.log('PROBE-AFTER-DELETE=' + JSON.stringify({
    parts: s.parts.length,
    ports: s.ports,
    inventory: s.inventory.filter((entry) => entry.itemId.includes('box')),
  }));
  await play.screenshot('02-after-delete');
  await play.advance(2.0);
  await play.screenshot('03-after-delete-later');
  void source;
  void shaft;
}
