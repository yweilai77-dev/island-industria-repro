// 临时探针：单源 + 单破碎机，验证右键启停测试动力源与动力网络。
import { createHarness } from './m18-helpers.mjs';

export default async function playthrough(play) {
  const h = createHarness(play);
  const log = (label, value) => console.log('PROBE-' + label + '=' + JSON.stringify(value));
  await h.learnMovement();
  const cal = await h.calibrate('PROBE-CAL');
  const place = async (slot, cell, rot, label) => {
    const pt = await h.pointForCell(cal, cell, { avoidHover: true });
    // 机械模式下按 R 到目标朝向。
    let current = 0;
    const need = ((rot - current) % 360) / 90;
    await h.selectSlot(0);
    for (let index = 0; index < need; index += 1) {
      await play.mouse.move([0.02, 0.02]);
      await play.keyboard.press('KeyR');
      await play.advance(0.1);
    }
    const part = await h.placePartAtPoint(pt, slot, 0, label, cell);
    const placed = (await h.state()).parts.find((entry) => entry.partId === part.partId);
    log('placed-' + label, placed?.placement);
    return part;
  };
  await place(3, { gx: -5, gz: 8 }, 0, 'source');
  await place(9, { gx: -4, gz: 8 }, 0, 'crusher');

  let s = await h.state();
  log('before-toggle', {
    parts: s.parts.map((p) => ({ id: p.partId, kind: p.kind, gx: p.placement.gx, gz: p.placement.gz, rot: p.placement.rotation })),
    sources: s.sources,
    networks: s.networks,
    machines: s.machines,
  });

  const point = await h.hoverSpecificPart(cal, { gx: -5, gz: 8 }, s.parts[0].partId);
  log('hover-point', point);
  await play.mouse.move(point);
  await play.wait(200);
  s = await h.state();
  log('hover-state', { hovered: s.ui.hoveredPartId });
  await h.rightClickAt(point);
  await play.advance(0.6);
  s = await h.state();
  log('after-toggle', { sources: s.sources, networks: s.networks, machines: s.machines });
}
