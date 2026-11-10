// P2-E2 科技 UI 验收 · 阶段 A：启动 / 科技页结构 / 真实生产 / 订单 HUD 交接 / T1.1 交付。
import {
  CELL, CRUSHER, FLYWHEEL, FORGE, GEAR12, GEAR24, SHAFT, SMELTER,
} from './m20-order-lib.mjs';
import { NODE } from './p2e2-tech-ui-lib.mjs';

/** @param {{ play: any, h: any, kit: any, ui: any }} ctx */
export async function runTechUiPhaseA({ play, h, kit, ui }) {
  const {
    assert, state, invOf, machineByRecipe, logStep, waitProduction, rewind,
  } = kit;
  const { observedStatuses, readHud, readBook, readTech, pollHud, pollBook, pollTech, openBookOn, closeBook, clickNode, clickAction } = ui;

  await play.step('00-boot-player-mode-no-test-hooks', async () => {
    await play.page.addInitScript((key) => {
      globalThis.__II_TEST_FLAGS__ = { progression: 'player', saveStorageKey: key };
    }, 'p2e2-tech-ui/slot-1');
    await play.reload();
    await play.advance(0.5);
    await play.wait(300);
    // 启动首帧（注入 flags 之前）可能触发过一次默认 key 的自动保存；清掉，保证真实验收不污染真实存档槽。
    await play.page.evaluate(() => { try { localStorage.removeItem('island-industria/save/slot-1'); } catch { /* 存储不可用 */ } });
    const s = await state();
    assert(s.tech?.mode === 'player', 'expected player progression mode, got ' + s.tech?.mode);
    // 正式模式没有测试入口：科技页/联合工厂页必须靠真实 DOM 按钮工作。
    const hooks = await play.page.evaluate(() => ({
      tech: typeof globalThis.__II_TEST_TECH__,
      endgame: typeof globalThis.__II_TEST_ENDGAME__,
    }));
    assert(hooks.tech === 'undefined', 'player mode must not expose __II_TEST_TECH__');
    assert(hooks.endgame === 'undefined', 'player mode must not expose __II_TEST_ENDGAME__');
    // 协议 v2：状态消息同时携带 tech/project/diagnostics/save 四个字段。
    assert(s.tech !== null, 'tech snapshot must be part of the unique GameRead');
    assert('project' in s && 'diagnostics' in s, 'P2-E2/E3 read fields must exist in the unique GameRead');
    logStep('00-BOOT', { mode: s.tech.mode, nodes: s.tech.nodes.length, inventory: s.inventory });
  });

  await play.step('01-tech-page-shape', async () => {
    const book = await openBookOn('tech');
    assert(book.tabs.length === 4, 'expected 4 tabs (背包/科技/诊断/联合工厂), got ' + book.tabs.length);
    assert(book.tabs.map((tab) => tab.tab).join(',') === 'backpack,tech,diagnostics,project',
      'tab order mismatch: ' + JSON.stringify(book.tabs));
    assert(book.title === '科技', 'modal title must become 科技, got ' + book.title);
    assert(book.saveStatus.length > 0, 'save status footer must show a status text');
    for (const action of ['save-request', 'save-restore', 'save-new']) {
      assert(book.saveButtons.includes(action), 'missing save button ' + action + ' in footer');
    }
    const tech = await readTech();
    assert(tech.nodes.length === 12, 'expected 12 tech nodes, got ' + tech.nodes.length);
    assert(tech.stages.length === 3, 'expected 3 stage groups, got ' + tech.stages.length);
    for (const expect of [['1', '基础工业'], ['2', '机械化生产'], ['3', '初级自动化工业']]) {
      const group = tech.stages.find((stage) => stage.stage === expect[0]);
      assert(group !== undefined, 'missing stage ' + expect[0]);
      assert(group.label.includes(expect[1]), 'stage ' + expect[0] + ' label must include ' + expect[1] + ', got ' + group.label);
    }
    const gear = tech.nodes.find((node) => node.id === NODE.gear);
    assert(gear?.status === 'available', 'T1.1 must start available');
    assert(gear?.badge.includes('可研究'), 'T1.1 badge must say 可研究, got ' + gear?.badge);
    const chute = tech.nodes.find((node) => node.id === NODE.chute);
    assert(chute?.status === 'locked', 'T1.2 must start locked');
    assert(chute?.badge.includes('未解锁'), 'T1.2 badge must say 未解锁');
    assert((chute?.prereq ?? '').includes('齿轮制造') && (chute?.prereq ?? '').includes('✗'),
      'T1.2 card must show the unmet prerequisite: ' + chute?.prereq);
    assert((gear?.mats ?? '').includes('铁锭 0/3') && (gear?.mats ?? '').includes('余 3'),
      'T1.1 card must show delivered/remaining materials: ' + gear?.mats);
    assert((gear?.unlocks ?? '').includes('配方'), 'T1.1 card must list unlocked recipes by label');
    observedStatuses.add(gear.status);
    observedStatuses.add(chute.status);
    logStep('01-TECH-PAGE', { stages: tech.stages, statuses: tech.nodes.map((node) => node.id + ':' + node.status), save: book.saveStatus });
    await play.screenshot('01-tech-page-1280x720');
  });

  await play.step('02-produce-order-and-tech-materials', async () => {
    await closeBook();
    await h.learnMovement();
    let cal = await h.calibrate('LEVEL0');
    kit.setCal(cal);
    assert(await h.gotoCell({ gx: -6, gz: 4 }, 20000, true), 'must reach ore node A');
    for (let index = 0; index < 12; index += 1) {
      await play.keyboard.press('KeyF');
      await play.advance(3.4);
      await play.wait(70);
    }
    let s = await state();
    assert(invOf(s, 'iron_ore') >= 12, 'need 12 iron ore, got ' + invOf(s, 'iron_ore'));

    assert(await h.gotoCell({ gx: -7, gz: 6 }, 20000, true), 'must walk to the building spot');
    cal = await h.calibrate('LEVEL0-WORK');
    kit.setCal(cal);
    const layout = [
      { label: 'crusher', slot: CRUSHER, cell: CELL.crusher },
      { label: 'smelter', slot: SMELTER, cell: CELL.smelter },
      { label: 'forge', slot: FORGE, cell: CELL.forge },
      { label: 'flywheel', slot: FLYWHEEL, cell: CELL.flywheel },
      { label: 'shaft-a', slot: SHAFT, cell: CELL.shaftA },
      { label: 'gear12', slot: GEAR12, cell: CELL.gear12 },
      { label: 'shaft-b', slot: SHAFT, cell: CELL.shaftB },
      { label: 'gear24-a', slot: GEAR24, cell: CELL.gear24A },
      { label: 'shaft-c', slot: SHAFT, cell: CELL.shaftC },
      { label: 'gear24-b', slot: GEAR24, cell: CELL.gear24B },
      { label: 'shaft-d', slot: SHAFT, cell: CELL.shaftD },
    ];
    for (const item of layout) {
      const point = await h.pointForCell(cal, item.cell, { avoidHover: true });
      kit.points[item.label] = point;
      await h.placePartAtPoint(point, item.slot, 0, item.label, item.cell);
    }
    await h.clearHover();
    s = await state();
    assert(s.parts.length === 11, 'expected 11 parts, got ' + s.parts.length);

    // 启动动力（真实摇柄 + 离合）。
    // Lead 修复：放置点（avoidHover）在零件放下去之后不一定是「射线打到飞轮」的点，
    // 必须用 hoverSpecificPart 精确找到悬停点，否则右键不会切换离合（E1 p2e-tech-core 同做法）。
    await h.holdKey('KeyC', 6500);
    const sourcePart = (await state()).parts.find((part) => part.kind === 'power-source');
    assert(sourcePart !== undefined, 'flywheel source must exist');
    const flywheelPt = await h.hoverSpecificPart(cal, CELL.flywheel, sourcePart.partId);
    assert(flywheelPt !== null, 'must find a screen point that hovers the flywheel');
    kit.points.flywheel = flywheelPt;
    await h.selectSlot(SHAFT);
    await h.clickAt(flywheelPt);
    await h.rightClickAt(flywheelPt);
    await play.advance(0.6);
    s = await state();
    if (s.sources[0]?.engaged !== true) {
      // 第二动力网络/相邻零件可能抢走射线：再补一次右键（幂等，已接合时不会断开）。
      await h.rightClickAt(flywheelPt);
      await play.advance(0.6);
      s = await state();
    }
    assert(s.sources[0]?.engaged === true, 'flywheel clutch must engage, engaged=' + String(s.sources[0]?.engaged));

    const crusher = machineByRecipe(await state(), 'crush-iron-ore');
    const smelter = machineByRecipe(await state(), 'smelt-crushed-ore');
    const crusherPt = await h.hoverSpecificPart(cal, CELL.crusher, crusher.partId);
    const smelterPt = await h.hoverSpecificPart(cal, CELL.smelter, smelter.partId);
    kit.points.crusher = crusherPt;
    kit.points.smelter = smelterPt;

    const feed = async (point, times) => {
      await play.mouse.move(point);
      await play.wait(120);
      for (let index = 0; index < times; index += 1) {
        await play.keyboard.press('KeyC');
        await play.advance(0.08);
      }
    };
    const take = async (point) => {
      await play.mouse.move(point);
      await play.wait(120);
      await h.rightClickAt(point);
      await play.advance(0.3);
    };

    // 破碎 3 批 × 4：前 2 批（8 个碎矿）去熔炼，第 3 批留给 T1.2 交付。
    for (let batch = 0; batch < 3; batch += 1) {
      await rewind(3500);
      await feed(crusherPt, 4);
      await waitProduction('crush batch ' + batch,
        (st) => (st.production.produced.find((p) => p.itemId === 'crushed_ore')?.count ?? 0) >= 4 * (batch + 1),
        { timeoutMs: 70000 });
      await take(crusherPt);
    }
    // 熔炼 2 批 × 4 → 8 铁锭。
    for (let batch = 0; batch < 2; batch += 1) {
      await rewind(3500);
      await feed(smelterPt, 4);
      await waitProduction('smelt batch ' + batch,
        (st) => (st.production.produced.find((p) => p.itemId === 'iron_ingot')?.count ?? 0) >= 4 * (batch + 1),
        { timeoutMs: 90000 });
      await take(smelterPt);
    }
    // 锻压 4 铁锭 → 2 传动轴（订单第 7 步 + T1.1 的 2 根轴）。
    const forge = machineByRecipe(await state(), 'forge-shaft');
    const forgePt = await h.hoverSpecificPart(cal, CELL.forge, forge.partId);
    kit.points.forge = forgePt;
    await play.mouse.move(forgePt);
    await play.wait(150);
    for (let index = 0; index < 4; index += 1) {
      await play.keyboard.press('KeyC');
      await play.advance(0.08);
    }
    await waitProduction('forge shafts',
      (st) => (st.production.produced.find((p) => p.itemId === 'shaft')?.count ?? 0) >= 2,
      { timeoutMs: 90000, keepPowered: true });
    await play.mouse.move(forgePt);
    await play.wait(120);
    await h.rightClickAt(forgePt);
    await play.advance(0.35);
    s = await state();
    assert(invOf(s, 'iron_ingot') >= 3, 'need >= 3 ingots for T1.1, got ' + invOf(s, 'iron_ingot'));
    assert(invOf(s, 'shaft') >= 2, 'need >= 2 shafts for T1.1, got ' + invOf(s, 'shaft'));
    assert(invOf(s, 'crushed_ore') >= 3, 'need >= 3 crushed ore for T1.2, got ' + invOf(s, 'crushed_ore'));
    assert(invOf(s, 'gear_12') >= 2, 'need >= 2 gears for T1.2, got ' + invOf(s, 'gear_12'));
    logStep('02-PRODUCED', { inventory: s.inventory, produced: s.production.produced });
    await play.screenshot('02-line-produced-1280x720');
  });

  await play.step('03-order-hud-hands-off-to-tech', async () => {
    // 订单八步全部由真实生产完成 → HUD 从订单面板切到「Tab→科技」提示。
    const complete = await kit.waitUntil('order complete',
      (uiState, st) => uiState.state === 'complete' && uiState.count === '8 / 8'
        && (st.production.produced.find((p) => p.itemId === 'shaft')?.count ?? 0) >= 1,
      { timeoutMs: 90000, keepPowered: true, gameStep: 0.5 });
    assert(complete.ui.completeBannerHidden === false, 'order complete banner must stay readable in DOM');
    const hud = await pollHud('hud switch to tech hint', (view) => view.goalHidden && !view.trackerHidden);
    assert(hud.mode === 'hint', 'without a tracked node the HUD must show the Tab hint, got ' + hud.mode);
    assert(hud.hint.includes('Tab'), 'hint must tell the player to press Tab: ' + hud.hint);
    assert(hud.trackerRect && hud.trackerRect.right <= 1280 && hud.trackerRect.bottom <= 720,
      'tracker hint outside 1280x720: ' + JSON.stringify(hud.trackerRect));
    assert(hud.hotbarRect && hud.trackerRect.bottom < hud.hotbarRect.top,
      'tracker hint must not overlap the hotbar: ' + JSON.stringify([hud.trackerRect, hud.hotbarRect]));
    logStep('03-HUD-HANDOFF', { order: complete.ui.count, mode: hud.mode, hint: hud.hint, rect: hud.trackerRect });
    await play.screenshot('03-hud-tech-hint-1280x720');
  });

  await play.step('04-submit-t11-through-real-ui', async () => {
    await openBookOn('tech');
    let tech = await clickNode(NODE.gear);
    assert(tech.detailStatus.includes('可研究'), 'T1.1 detail status mismatch: ' + tech.detailStatus);
    const ironRow = tech.materials.find((row) => row.itemId === 'iron_ingot');
    const shaftRow = tech.materials.find((row) => row.itemId === 'shaft');
    assert(ironRow?.count === '已交 0/3 · 余 3', 'T1.1 iron row mismatch: ' + ironRow?.count);
    assert(shaftRow?.count === '已交 0/2 · 余 2', 'T1.1 shaft row mismatch: ' + shaftRow?.count);

    // 防重复点击：同一按钮连点两次，引擎只扣一次、只记 3 件。
    const ingotsBefore = invOf(await state(), 'iron_ingot');
    await play.page.evaluate((selector) => {
      const button = document.querySelector(selector);
      button?.click();
      button?.click();
    }, '.ii-tech-material[data-item-id="iron_ingot"] [data-ii-action="tech-submit-rest"]');
    const researching = await pollTech('T1.1 researching',
      (view) => view.nodes.find((node) => node.id === NODE.gear)?.status === 'researching');
    const ironAfter = researching.materials.find((row) => row.itemId === 'iron_ingot');
    assert(ironAfter?.count === '已交 3/3 · 余 0', 'double-click must deliver exactly 3 ingots, got ' + ironAfter?.count);
    const stateAfter = await state();
    assert(invOf(stateAfter, 'iron_ingot') === ingotsBefore - 3,
      'inventory must drop by exactly 3 ingots: ' + ingotsBefore + ' -> ' + invOf(stateAfter, 'iron_ingot'));
    observedStatuses.add('researching');
    logStep('04-RESEARCHING', { node: researching.detailStatus, iron: ironAfter });

    await clickAction('tech-submit-rest', 'shaft');
    const done = await pollTech('T1.1 completed',
      (view) => view.nodes.find((node) => node.id === NODE.gear)?.status === 'completed');
    assert(done.detailStatus.includes('已完成'), 'T1.1 detail must show 已完成, got ' + done.detailStatus);
    assert(done.unlocks.some((text) => text.includes('锻压 12 齿齿轮')),
      'T1.1 must list the unlocked gear recipe: ' + JSON.stringify(done.unlocks));
    assert(done.nodes.find((node) => node.id === NODE.chute)?.status === 'available', 'T1.2 must become available');
    observedStatuses.add('completed');

    // 引擎侧同样生效：锻压机出现齿轮配方（E1 已验收行为，这里只证明 UI 与真实状态一致）。
    const s = await state();
    const forge = s.production.machines.find((machine) => machine.recipeId === 'forge-shaft');
    assert(forge?.recipeCount === 3, 'forge must expose 3 recipes after T1.1, got ' + forge?.recipeCount);
    assert(s.tech.unlocked.includes(NODE.gear), 'tech.unlocked must contain T1.1');
    logStep('04-COMPLETED', {
      unlocked: s.tech.unlocked,
      forgeRecipes: forge.recipeCount,
      statuses: done.nodes.map((node) => node.status),
    });
    await play.screenshot('04-t11-completed-1280x720');
  });
}
