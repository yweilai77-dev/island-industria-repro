// 临时探针 3：用验收同款 ctx 助手搭场景 A、装盒、拆除，观察残留视图。
import { createHarness } from './m18-helpers.mjs';
import { createCtx, LAYOUT_A } from './p2c-links-lib.mjs';

export default async function playthrough(play) {
  const h = createHarness(play);
  const C = createCtx(play, h);
  await h.learnMovement();
  await play.step('build', async () => {
    await C.calibrate('PROBE3');
    const s = await C.state();
    void s;
    await C.placeLayout(LAYOUT_A);
    await C.enableAllSources(LAYOUT_A);
    const state = await C.state();
    const crusher = state.production.machines.find((m) => m.recipeId === 'crush-iron-ore');
    const smelter = state.production.machines.find((m) => m.recipeId === 'smelt-crushed-ore');
    await C.onPart({ gx: -4, gz: 8 }, crusher.partId, 'KeyO');
    await C.onPart({ gx: -3, gz: 8 }, smelter.partId, 'KeyT');
    console.log('PROBE-PORTS=' + JSON.stringify((await C.state()).ports));
    await play.screenshot('01-built');
  });
  await play.step('teardown', async () => {
    await C.removeAllParts();
    await play.advance(1.5);
    console.log('PROBE-AFTER=' + JSON.stringify({ parts: (await C.state()).parts, ports: (await C.state()).ports }));
    await play.screenshot('02-teardown');
  });
}
