// M1.7-A acceptance playthrough
import { enterLegacyMode, waitForLegacy } from './legacy-mode.mjs';

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function playthrough(play) {
  await enterLegacyMode(play);
  const readCounts = async () => {
    await play.keyboard.press('Tab');
    await play.wait(450);
    const rows = await play.page.evaluate(() => Array.from(document.querySelectorAll('.ii-row-count')).map((el) => el.textContent));
    await play.keyboard.press('Tab');
    await play.wait(350);
    return rows.map((text) => Number(String(text).replace(/[^0-9]/g, '')));
  };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const place = async (slot, point, name) => {
    await play.keyboard.press(slot);
    await play.wait(220);
    await play.mouse.move(point);
    await play.wait(300);
    await play.screenshot(name + '-ghost');
    await play.mouse.click(point);
    await play.wait(350);
    await play.screenshot(name + '-placed');
  };

  await play.step('01-start-kit', async () => {
    const counts = await readCounts();
    console.log('KIT=' + JSON.stringify(counts));
    // M1.8：套件从 5 种扩到 11 种零件（新增溜槽/立式传动带/飞轮源/破碎机/熔炼炉/锻压机），
    // 但 M1.7 的 5 个旧零件数量必须保持不变（本条回归的就是那 5 项与后续建造流程）。
    assert(counts.length >= 5 && counts[0] === 24 && counts[4] === 5,
      'prototype kit mismatch: ' + JSON.stringify(counts));
    await play.screenshot('01-start');
  });

  await play.step('02-build-connected-layout', async () => {
    // 屏幕点按当前默认相机投影到地面格；沿世界 X 排成一条链：
    // source(-6,7) -> shaft(-5,7) -> shaft(-4,7) -> gear12(-3,7) -> machine(-2,7)
    // 以及 gear24(-3,8) 与 gear12 啮合。
    await place('Digit4', [0.226, 0.571], 'source');
    await place('Digit1', [0.248, 0.616], 'shaft-a');
    await place('Digit1', [0.272, 0.665], 'shaft-b');
    await place('Digit2', [0.298, 0.716], 'gear12');
    await place('Digit5', [0.325, 0.772], 'machine');
    await place('Digit3', [0.255, 0.772], 'gear24');
    await play.screenshot('02-connected-layout-with-ghost');
    // 选中机械物品但把鼠标移到天空，隐藏放置幽灵，再截一张纯结构图（连接接头可见）。
    await play.keyboard.press('Digit1');
    await play.mouse.move([0.05, 0.05]);
    await play.wait(350);
    await play.screenshot('02-connected-layout');
    await play.keyboard.press('Digit1');
    await play.wait(200);
    const counts = await readCounts();
    console.log('LAYOUT=' + JSON.stringify(counts));
    assert(counts[0] === 22 && counts[1] === 5 && counts[2] === 3 && counts[3] === 1 && counts[4] === 4,
      'layout inventory mismatch: ' + JSON.stringify(counts));
  });

  await play.step('03-select-delete-refund', async () => {
    await play.keyboard.press('Digit1');
    await play.wait(200);
    // 选中 shaft(-4,7)，Delete 拆除并验证返还一次。
    await play.mouse.move([0.272, 0.665]);
    await play.wait(350);
    await play.screenshot('03-selected');
    await play.mouse.click([0.272, 0.665]);
    await play.wait(250);
    const before = await readCounts();
    await play.keyboard.press('Delete');
    await play.wait(450);
    await play.screenshot('03-after-delete');
    const counts = await readCounts();
    const beforeTotal = before.reduce((sum, value) => sum + value, 0);
    const afterTotal = counts.reduce((sum, value) => sum + value, 0);
    console.log('AFTER_DELETE=' + JSON.stringify(counts));
    assert(afterTotal === beforeTotal + 1, 'delete must refund exactly one mechanical item: ' + JSON.stringify({ before, counts }));
    // 再按一次 Delete：没有选中目标，不产生第二次返还。
    await play.keyboard.press('Delete');
    await play.wait(300);
    const again = await readCounts();
    console.log('AFTER_DOUBLE_DELETE=' + JSON.stringify(again));
    assert(again.reduce((sum, value) => sum + value, 0) === afterTotal, 'double delete must not refund twice: ' + JSON.stringify(again));
    await play.screenshot('03-after-double-delete');
  });

  await play.step('04-invalid-placement', async () => {
    const before = await readCounts();
    await play.keyboard.press('Digit1');
    await play.wait(200);
    // 瞄准楼梯占用格 (-3,3) → 红色非法幽灵；点击不得扣库存。
    await play.mouse.move([0.441, 0.5286]);
    await play.wait(350);
    await play.screenshot('04-invalid-ghost');
    await play.mouse.click([0.441, 0.5286]);
    await play.wait(300);
    await play.screenshot('04-invalid-click');
    const counts = await readCounts();
    console.log('AFTER_INVALID=' + JSON.stringify(counts));
    assert(counts.reduce((sum, value) => sum + value, 0) === before.reduce((sum, value) => sum + value, 0),
      'invalid placement must not consume inventory: ' + JSON.stringify({ before, counts }));
  });

  await play.step('05-player-blocked-by-shaft', async () => {
    // 在玩家前方 (-3,1) 放一段轴，然后向它走；正常/大步长都不能穿过去。
    const before = await readCounts();
    // 用三段轴组成 L 形阻挡墙，避免玩家沿单个 AABB 边缘滑过去。
    await place('Digit1', [0.5, 0.4513], 'blocker-shaft-a');
    await place('Digit1', [0.5286, 0.4888], 'blocker-shaft-b');
    await place('Digit1', [0.4714, 0.4888], 'blocker-shaft-c');
    const afterPlace = await readCounts();
    console.log('AFTER_BLOCKER=' + JSON.stringify(afterPlace));
    assert(afterPlace.reduce((sum, value) => sum + value, 0) === before.reduce((sum, value) => sum + value, 0) - 3,
      'blocker wall should consume three shafts: ' + JSON.stringify({ before, afterPlace }));
    // 选中机械物品、鼠标移到天空，避免放置幽灵遮挡。
    await play.keyboard.press('Digit1');
    await play.mouse.move([0.05, 0.05]);
    await play.wait(350);
    await play.screenshot('05-before-walk');
    await play.keyboard.hold('KeyW', 1500);
    await play.wait(350);
    await play.screenshot('05-blocked-1');
    await play.keyboard.hold('KeyW', 1500);
    await play.wait(350);
    await play.screenshot('05-blocked-2');
  });

  await play.step('06-normal-build-regression', async () => {
    // 普通建筑：选中空槽后放一个 1×1，再切机械模式按 X/G，确认不被机械输入误操作。
    await play.keyboard.press('Digit6');
    await play.wait(200);
    await play.mouse.move([0.185, 0.616]);
    await play.wait(300);
    await play.mouse.click([0.185, 0.616]);
    await play.wait(400);
    await play.screenshot('06-normal-building');
    // 点击建筑选中
    await play.mouse.move([0.185, 0.616]);
    await play.wait(250);
    await play.mouse.click([0.185, 0.616]);
    await play.wait(300);
    await play.screenshot('06-building-selected');
    // 切机械模式，按 X/G；build guard 应清掉选中且不拆除建筑。
    await play.keyboard.press('Digit1');
    await play.wait(300);
    await play.keyboard.press('KeyX');
    await play.wait(300);
    await play.keyboard.press('KeyG');
    await play.wait(300);
    await play.screenshot('06-building-after-mechanical-xg');
    // 切回空槽，确认普通建筑仍在。
    await play.keyboard.press('Digit6');
    await play.wait(300);
    await play.screenshot('06-building-after-switch-back');
  });

  await play.step('07-reload', async () => {
    await play.reload();
    // legacy 模式由 page.addInitScript 注入，reload 后依然生效；等「模式 + 套件」就绪再断言。
    await waitForLegacy(play);
    await play.wait(900);
    await play.screenshot('07-after-reload');
    const counts = await readCounts();
    console.log('RELOAD_KIT=' + JSON.stringify(counts));
    // M1.8：套件种类数从 5 扩到 11，但「刷新后只发一次、旧零件数量复原」这条回归不变。
    assert(counts.length >= 5 && counts[0] === 24, 'kit should reset exactly once after reload: ' + JSON.stringify(counts));
  });
}