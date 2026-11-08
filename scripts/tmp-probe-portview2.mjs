// 临时探针：复现场景 A（6 零件）→ 装两个接口盒 → 逐个删除 → 观察残留视图。
import { createHarness } from './m18-helpers.mjs';

export default async function playthrough(play) {
  const h = createHarness(play);
  await h.learnMovement();
  const cal = await h.calibrate('PROBE-CAL');
  let ghost = 0;
  const place = async (slot, cell, rot, label) => {
    const pt = await h.pointForCell(cal, cell, { avoidHover: true });
    const need = ((((rot - ghost) % 360) + 360) % 360) / 90;
    await h.selectSlot(0);
    for (let index = 0; index < need; index += 1) {
      await play.mouse.move([0.02, 0.02]);
      await play.keyboard.press('KeyR');
      await play.advance(0.06);
    }
    ghost = (ghost + 90 * need) % 360;
    return h.placePartAtPoint(pt, slot, 0, label, cell);
  };
  const layout = [
    [3, { gx: -6, gz: 8 }, 0, 'source'],
    [0, { gx: -5, gz: 8 }, 0, 'shaft'],
    [9, { gx: -4, gz: 8 }, 0, 'crusher'],
    [10, { gx: -3, gz: 8 }, 90, 'smelter'],
    [0, { gx: -3, gz: 9 }, 90, 'shaft2'],
    [3, { gx: -3, gz: 10 }, 90, 'source2'],
  ];
  const parts = {};
  for (const [slot, cell, rot, label] of layout) parts[label] = await place(slot, cell, rot, label);
  await h.selectSlot(0);
  const crusherPoint = await h.hoverSpecificPart(cal, { gx: -4, gz: 8 }, parts.crusher.partId);
  await play.mouse.move(crusherPoint);
  await play.wait(180);
  await play.keyboard.press('KeyO');
  await play.advance(0.4);
  const smelterPoint = await h.hoverSpecificPart(cal, { gx: -3, gz: 8 }, parts.smelter.partId);
  await play.mouse.move(smelterPoint);
  await play.wait(180);
  await play.keyboard.press('KeyT');
  await play.advance(0.4);
  let s = await h.state();
  console.log('PROBE-PORTS=' + JSON.stringify(s.ports));
  await play.screenshot('01-full-scene');

  for (const part of [...(await h.state()).parts]) {
    const pt = await h.hoverSpecificPart(cal, { gx: part.placement.gx, gz: part.placement.gz }, part.partId);
    await h.selectSlot(0);
    await play.mouse.move(pt);
    await play.wait(160);
    await h.clickAt(pt);
    await play.keyboard.press('Delete');
    await play.advance(0.5);
  }
  s = await h.state();
  console.log('PROBE-TEARDOWN=' + JSON.stringify({ parts: s.parts.length, ports: s.ports }));
  await play.advance(2.0);
  await play.screenshot('02-after-teardown');
}
