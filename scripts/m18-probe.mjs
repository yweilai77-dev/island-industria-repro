// M1.8 探针：只验证「屏幕↔格子标定 + 楼层结构放置」这条路能走通。
import { createHarness } from './m18-helpers.mjs';
import { enterLegacyMode } from './legacy-mode.mjs';

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function playthrough(play) {
  await enterLegacyMode(play);
  const h = createHarness(play);

  await play.step('01-read-initial', async () => {
    const s = await h.state();
    console.log('PLAYER=' + JSON.stringify(s.player));
    console.log('UI=' + JSON.stringify(s.ui));
    console.log('INVENTORY=' + JSON.stringify(s.inventory));
    await play.screenshot('01-initial');
  });

  let cal;
  await play.step('02-calibrate', async () => {
    cal = await h.calibrate('LEVEL0');
    const s = await h.state();
    console.log('PLAYER_LEVEL=' + s.player.level);
    const pt = await h.pointForCell(cal, { gx: -2, gz: 2 });
    console.log('POINT_MINUS2_2=' + JSON.stringify(pt));
    await play.screenshot('02-calibrated');
  });

  await play.step('03-place-pillar-and-deck', async () => {
    await h.setFloorMode(true);
    await h.selectFloorKind('pillar');
    await h.placeFloor(cal, 'pillar', { gx: -4, gz: 4 });
    await h.placeFloor(cal, 'deck', { gx: -4, gz: 4 });
    await h.placeFloor(cal, 'deck', { gx: -3, gz: 4 });
    await h.setFloorMode(false);
    await h.clearHover();
    await play.screenshot('03-pillar-deck');
  });

  await play.step('04-report', async () => {
    const s = await h.state();
    console.log('AFTER=' + JSON.stringify({
      revision: s.revision,
      player: s.player.cell,
      parts: s.parts.length,
      meshes: undefined,
    }));
    await play.screenshot('04-final');
  });
}
