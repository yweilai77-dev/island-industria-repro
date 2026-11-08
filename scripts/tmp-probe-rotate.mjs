// 临时探针：确认 R 键旋转放置幽灵在「空槽选中」与「机械槽选中」下的行为差异。
import { createHarness } from './m18-helpers.mjs';

export default async function playthrough(play) {
  const h = createHarness(play);
  const log = (label, value) => console.log('PROBE-' + label + '=' + JSON.stringify(value));

  await h.learnMovement();
  const cal = await h.calibrate('PROBE-CAL');
  await h.selectSlot(0);
  const pt = await h.pointForCell(cal, { gx: -4, gz: 8 }, { avoidHover: true });

  // A：机械模式下按 R，再放。
  await h.selectSlot(9);
  await play.mouse.move([0.02, 0.02]);
  await play.wait(120);
  await play.keyboard.press('KeyR');
  await play.advance(0.2);
  let before = (await h.state()).parts.length;
  let part = await h.placePartAtPoint(pt, 9, 0, 'probe-a', { gx: -4, gz: 8 });
  let placed = (await h.state()).parts.find((entry) => entry.partId === part.partId);
  log('A-mech-mode-R', { before, rotation: placed?.placement.rotation });

  // 清掉。
  await h.selectSlot(9);
  let point = await h.hoverSpecificPart(cal, { gx: -4, gz: 8 }, part.partId);
  await play.mouse.move(point);
  await play.wait(140);
  await h.clickAt(point);
  await play.keyboard.press('Delete');
  await play.advance(0.4);

  // B：空槽选中（park）→ 按 R → 再选机械槽 → 放。
  await h.selectSlot(5);
  await play.mouse.move([0.02, 0.02]);
  await play.wait(120);
  await play.keyboard.press('KeyR');
  await play.advance(0.2);
  await h.selectSlot(9);
  part = await h.placePartAtPoint(pt, 9, 0, 'probe-b', { gx: -4, gz: 8 });
  placed = (await h.state()).parts.find((entry) => entry.partId === part.partId);
  log('B-empty-mode-R', { rotation: placed?.placement.rotation });

  log('state', { parts: (await h.state()).parts.length });
}
