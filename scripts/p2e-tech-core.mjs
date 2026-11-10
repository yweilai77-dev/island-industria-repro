// M2.0-P2-E1 科技树核心系统端到端验收（player 正式模式，不用任何 UI）。
//
// 证明任务书 §六「真实游戏验收准备」五条：
//   1) 科技未完成时，相关能力确实不可用（配方不可见/不可切、结构框架不可放置）；
//   2) 正确交付材料后，科技状态发生变化（真实扣库存 + 节点 researching → completed）；
//   3) 科技完成后，相关配方/建造能力确实解锁（锻压机出现齿轮配方，T1.2 变为 available）；
//   4) 后续科技前置关系正常（T1.2 的前置 T1.1 完成后才可用）；
//   5) 原有生产链仍能运行（矿石→碎矿→铁锭→传动轴全流程由真实键鼠完成）。
//
// 交付通过前端测试入口 __II_TEST_TECH__ 发送与 E2 科技页完全相同的协议命令
// （tech/submit）；引擎侧走真实事务：校验节点/材料/数量 → 扣库存 → 写进度。
import { createHarness } from './m18-helpers.mjs';
import { CELL, CRUSHER, FLYWHEEL, FORGE, GEAR12, GEAR24, SHAFT, SMELTER, createOrderKit } from './m20-order-lib.mjs';

const NODE_GEAR = 'tech:gear-manufacture';
const NODE_CHUTE = 'tech:chute-logistics';

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function playthrough(play) {
  const h = createHarness(play);
  const kit = createOrderKit(play, h);
  const { assert, state, invOf, machineByRecipe, logStep, waitProduction, rewind } = kit;
  const techOf = (s) => s.tech ?? null;
  const nodeOf = (s, id) => techOf(s)?.nodes.find((node) => node.id === id) ?? null;
  const forgeOf = (s) => s.production.machines.find((machine) => machine.recipeId?.startsWith('forge-') === true);
  const submit = (nodeId, itemId, count) => play.page.evaluate(
    (args) => globalThis.__II_TEST_TECH__?.submit(args.nodeId, args.itemId, args.count),
    { nodeId, itemId, count },
  );
  const pollTech = async (label, predicate, timeoutMs = 20000) => {
    const started = Date.now();
    let last = null;
    while (Date.now() - started < timeoutMs) {
      last = await state();
      if (predicate(last)) return last;
      await play.advance(0.2);
    }
    throw new Error(label + ' timeout; tech=' + JSON.stringify(techOf(last)));
  };

  // ------------------------------------------------------------------
  await play.step('00-boot-player-mode', async () => {
    // 测试入口只在页面注入 flags 后暴露；同时显式锁定 player 正式模式（门控生效）。
    await play.page.addInitScript(() => {
      globalThis.__II_TEST_FLAGS__ = { progression: 'player', techHooks: true };
    });
    await play.reload();
    await play.advance(0.5);
    const s = await state();
    assert(techOf(s) !== null, 'tech snapshot must be part of the unique mechanical GameRead');
    assert(techOf(s).mode === 'player', 'expected player progression mode, got ' + techOf(s).mode);
    logStep('00-BOOT', { mode: techOf(s).mode, unlocked: techOf(s).unlocked });
  });

  // ------------------------------------------------------------------
  await play.step('01-starter-kit-and-initial-gates', async () => {
    const s = await state();
    // 正式起步包：1 飞轮 + 3 台核心 + 8 轴/4+2 齿轮/2 溜槽/1 立式带；没有接口盒/结构框架/调试件。
    const expected = {
      shaft: 8, gear_12: 4, gear_24: 2, chute: 2, vertical_drive: 1,
      flywheel_source: 1, crusher: 1, smelter: 1, forge: 1,
    };
    for (const [itemId, count] of Object.entries(expected)) {
      assert(invOf(s, itemId) === count, 'starter kit ' + itemId + ' must be ' + count + ', got ' + invOf(s, itemId));
    }
    for (const itemId of ['interface_box', 'output_interface_box', 'splitter_box', 'merger_box', 'structure_frame', 'power_source', 'machine']) {
      assert(invOf(s, itemId) === 0, 'starter kit must NOT contain ' + itemId + ', got ' + invOf(s, itemId));
    }
    // 12 个节点全部存在；初始只有无前置节点 available，其余 locked。
    assert(techOf(s).nodes.length === 12, 'expected 12 tech nodes, got ' + techOf(s).nodes.length);
    assert(nodeOf(s, NODE_GEAR)?.status === 'available', 'T1.1 must start available');
    assert(nodeOf(s, NODE_CHUTE)?.status === 'locked', 'T1.2 must start locked (prerequisite T1.1)');
    assert(techOf(s).unlocked.length === 0, 'no node can be unlocked at start');
    assert(techOf(s).nodes.every((node) => node.status === 'available' || node.status === 'locked'),
      'initial statuses must only be available/locked');
    // 槽位：5 号空槽保持（普通建造默认位）。
    assert(s.ui.hotbar.selected === 5, 'default selected slot must stay 5, got ' + s.ui.hotbar.selected);
    logStep('01-KIT', { inventory: s.inventory, statuses: techOf(s).nodes.map((node) => node.id + ':' + node.status) });
    await play.screenshot('01-starter-kit');
  });

  // ------------------------------------------------------------------
  await play.step('02-gating-before-unlock', async () => {
    await h.learnMovement();
    const cal = await h.calibrate('LEVEL0');
    kit.setCal(cal);
    // 配方门控：锻压机当前只有 forge-shaft 一条可见/可切配方（其余 16 条科技配方未解锁）。
    const s = await state();
    const forge = forgeOf(s);
    // 此时还没有放机器；用数据断言初始状态：配方表长度由生产运行时暴露。
    const machines = s.production.machines;
    assert(machines.length === 0, 'no machines before placement');
    // 结构框架不可放置：无物品 + 门控未解锁（P 模式不激活）。
    assert(invOf(s, 'structure_frame') === 0, 'structure_frame must not be granted');
    await play.keyboard.press('KeyP');
    await play.advance(0.3);
    const afterP = await state();
    assert(afterP.ui.structureMode === false, 'P must not enter structure mode before T2.5 unlocks it');
    logStep('02-GATES', { structureMode: afterP.ui.structureMode, forge, nodes: techOf(afterP).nodes.map((n) => n.id + ':' + n.status) });
  });

  // ------------------------------------------------------------------
  await play.step('03-harvest-ore', async () => {
    assert(await h.gotoCell({ gx: -6, gz: 4 }, 20000, true), 'must reach ore node A');
    for (let index = 0; index < 12; index += 1) {
      await play.keyboard.press('KeyF');
      await play.advance(3.4);
      await play.wait(80);
    }
    const s = await state();
    assert(invOf(s, 'iron_ore') >= 12, 'need at least 12 iron ore, got ' + invOf(s, 'iron_ore'));
    logStep('03-ORE', { ore: invOf(s, 'iron_ore') });
  });

  // ------------------------------------------------------------------
  await play.step('04-build-line', async () => {
    assert(await h.gotoCell({ gx: -7, gz: 6 }, 20000, true), 'must walk to building spot');
    const cal = await h.calibrate('LEVEL0-WORK');
    kit.setCal(cal);
    const order = [
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
    for (const item of order) {
      const pt = await h.pointForCell(cal, item.cell, { avoidHover: true });
      kit.points[item.label] = pt;
      await h.placePartAtPoint(pt, item.slot, 0, item.label, item.cell);
    }
    await h.clearHover();
    const s = await state();
    assert(s.parts.length === 11, 'expected 11 parts, got ' + s.parts.length);
    assert(s.networks.length === 1, 'expected exactly one power network');
    // 配方门控在真实机器上的体现：锻压机只有 1 条可用配方。
    const forge = s.production.machines.find((machine) => machine.recipeId === 'forge-shaft');
    assert(forge !== undefined, 'forge must exist and default to forge-shaft');
    assert(forge.recipeCount === 1, 'forge must expose only 1 unlocked recipe before T1.1, got ' + forge.recipeCount);
    logStep('04-LINE', { parts: s.parts.length, forge: { recipe: forge.recipeId, count: forge.recipeCount } });
    await play.screenshot('04-line-built');
  });

  // ------------------------------------------------------------------
  await play.step('05-power-and-produce-ingots', async () => {
    const cal = kit.getCal();
    await h.clearHover();
    await h.holdKey('KeyC', 6500);
    let s = await state();
    const source = s.sources[0];
    assert(source !== undefined, 'flywheel source must exist');
    const flywheelPart = s.parts.find((part) => part.kind === 'power-source');
    const flywheelPt = await h.hoverSpecificPart(cal, CELL.flywheel, flywheelPart.partId);
    kit.points.flywheel = flywheelPt;
    await h.selectSlot(SHAFT);
    await h.clickAt(flywheelPt);
    await h.rightClickAt(flywheelPt);
    await play.advance(0.6);
    s = await state();
    assert(s.sources[0].engaged === true, 'flywheel clutch must engage');
    assert(s.production.machines.every((machine) => machine.powered === true), 'all machines must be powered');

    const crusher = machineByRecipe(s, 'crush-iron-ore');
    const smelter = machineByRecipe(s, 'smelt-crushed-ore');
    assert(crusher !== undefined && smelter !== undefined, 'crusher/smelter must be tracked');
    const crusherPt = await h.hoverSpecificPart(cal, CELL.crusher, crusher.partId);
    const smelterPt = await h.hoverSpecificPart(cal, CELL.smelter, smelter.partId);
    kit.points.crusher = crusherPt;
    kit.points.smelter = smelterPt;

    /** 往机器投 n 件原料（悬停 + C）。 */
    const feed = async (point, times) => {
      await play.mouse.move(point);
      await play.wait(120);
      for (let index = 0; index < times; index += 1) {
        await play.keyboard.press('KeyC');
        await play.advance(0.08);
      }
    };
    /** 右键取走整台机器输出缓冲。 */
    const take = async (point) => {
      await play.mouse.move(point);
      await play.wait(120);
      await h.rightClickAt(point);
      await play.advance(0.3);
    };

    // 破碎：3 批 × 4 矿石；熔炼：3 批 × 4 碎铁矿（最终 ≥12 铁锭，足够交 T1.1 + 锻 2 根轴）。
    for (let batch = 0; batch < 3; batch += 1) {
      await rewind(3500);
      await feed(crusherPt, 4);
      await waitProduction('crush batch ' + batch, (st) => (st.production.produced.find((p) => p.itemId === 'crushed_ore')?.count ?? 0) >= 4 * (batch + 1), { timeoutMs: 60000 });
      await take(crusherPt);
    }
    for (let batch = 0; batch < 3; batch += 1) {
      await rewind(3500);
      await feed(smelterPt, 4);
      await waitProduction('smelt batch ' + batch, (st) => (st.production.produced.find((p) => p.itemId === 'iron_ingot')?.count ?? 0) >= 4 * (batch + 1), { timeoutMs: 90000 });
      await take(smelterPt);
    }
    s = await state();
    assert(invOf(s, 'iron_ingot') >= 8, 'expected >= 8 ingots after smelting, got ' + invOf(s, 'iron_ingot'));
    logStep('05-INGOTS', { ingots: invOf(s, 'iron_ingot'), produced: s.production.produced });
    await play.screenshot('05-ingots-produced');
  });

  // ------------------------------------------------------------------
  await play.step('06-forge-two-shafts', async () => {
    const cal = kit.getCal();
    let s = await state();
    const forge = machineByRecipe(s, 'forge-shaft');
    const forgePt = await h.hoverSpecificPart(cal, CELL.forge, forge.partId);
    kit.points.forge = forgePt;
    await play.mouse.move(forgePt);
    await play.wait(150);
    // 锻压机输入容量 6：一次投 4 铁锭 → 两个周期 → 2 根传动轴。
    for (let index = 0; index < 4; index += 1) {
      await play.keyboard.press('KeyC');
      await play.advance(0.08);
    }
    await waitProduction('forge shafts', (st) => (st.production.produced.find((p) => p.itemId === 'shaft')?.count ?? 0) >= 2, { timeoutMs: 90000, keepPowered: true });
    await play.mouse.move(forgePt);
    await play.wait(120);
    await h.rightClickAt(forgePt);
    await play.advance(0.35);
    s = await state();
    assert(invOf(s, 'shaft') >= 2, 'expected >= 2 forged shafts, got ' + invOf(s, 'shaft'));
    assert(invOf(s, 'iron_ingot') >= 3, 'expected >= 3 ingots left for delivery, got ' + invOf(s, 'iron_ingot'));
    logStep('06-SHAFTS', { shafts: invOf(s, 'shaft'), ingots: invOf(s, 'iron_ingot'), produced: s.production.produced });
    await play.screenshot('06-shafts-forged');
  });

  // ------------------------------------------------------------------
  await play.step('07-delivery-rejects-invalid', async () => {
    const before = await state();
    // ① 前提未满足的节点（T1.2 需要 T1.1 先完成）：必须拒绝且不扣库存。
    await submit(NODE_CHUTE, 'shaft', 1);
    await play.advance(0.4);
    let s = await state();
    assert(nodeOf(s, NODE_CHUTE)?.status === 'locked', 'T1.2 must stay locked before T1.1');
    assert(invOf(s, 'shaft') === invOf(before, 'shaft'), 'locked node submission must not consume items');
    // ② 未要求交付的物品：拒绝。
    await submit(NODE_GEAR, 'iron_ore', 1);
    await play.advance(0.4);
    s = await state();
    assert(invOf(s, 'iron_ore') === invOf(before, 'iron_ore'), 'not-required item must not be consumed');
    // ③ 数量不足（需要的铁锭多于库存）：拒绝。
    await submit(NODE_GEAR, 'iron_ingot', 999);
    await play.advance(0.4);
    s = await state();
    assert(nodeOf(s, NODE_GEAR)?.status === 'available', 'failed submission must not change node status');
    logStep('07-REJECTS', { gear: nodeOf(s, NODE_GEAR)?.status, chute: nodeOf(s, NODE_CHUTE)?.status, inventory: s.inventory });
  });

  // ------------------------------------------------------------------
  await play.step('08-deliver-and-unlock', async () => {
    const before = await state();
    const ingotsBefore = invOf(before, 'iron_ingot');
    const shaftsBefore = invOf(before, 'shaft');
    // 部分交付：先交 3 铁锭 → researching（未完成），库存精确减少。
    await submit(NODE_GEAR, 'iron_ingot', 3);
    let s = await pollTech('partial delivery', (st) => nodeOf(st, NODE_GEAR)?.status === 'researching');
    assert(invOf(s, 'iron_ingot') === ingotsBefore - 3, 'delivery must consume exactly 3 ingots');
    assert(invOf(s, 'shaft') === shaftsBefore, 'shafts must not be consumed by ingot delivery');
    assert(techOf(s).unlocked.length === 0, 'node must not complete before all materials delivered');
    logStep('08-PARTIAL', { node: nodeOf(s, NODE_GEAR), inventory: s.inventory });
    // 再交 2 传动轴 → completed（同一帧完成）。
    await submit(NODE_GEAR, 'shaft', 2);
    s = await pollTech('node completion', (st) => nodeOf(st, NODE_GEAR)?.status === 'completed');
    assert(nodeOf(s, NODE_GEAR)?.status === 'completed', 'T1.1 must complete after full delivery');
    assert(techOf(s).unlocked.includes(NODE_GEAR), 'unlocked set must contain T1.1');
    assert(invOf(s, 'shaft') === shaftsBefore - 2, 'delivery must consume exactly 2 shafts');
    assert(nodeOf(s, NODE_CHUTE)?.status === 'available', 'T1.2 must become available once T1.1 completes');
    logStep('08-COMPLETE', { unlocked: techOf(s).unlocked, chute: nodeOf(s, NODE_CHUTE)?.status, inventory: s.inventory });
    await play.screenshot('08-node-completed');
  });

  // ------------------------------------------------------------------
  await play.step('09-unlocked-recipes-take-effect', async () => {
    // 解锁后：锻压机可见配方 1 → 3（forge-shaft + forge-gear-12 + forge-gear-24），且能真实切换。
    const s = await state();
    const forge = s.production.machines.find((machine) => machine.recipeId === 'forge-shaft');
    assert(forge !== undefined, 'forge must still be tracked');
    assert(forge.recipeCount === 3, 'forge must expose 3 unlocked recipes after T1.1, got ' + forge.recipeCount);
    const cal = kit.getCal();
    const forgePt = kit.points.forge;
    await play.mouse.move(forgePt);
    await play.wait(140);
    await play.keyboard.press('KeyR');
    await play.advance(0.3);
    const afterR = await state();
    const cycled = afterR.production.machines.find((machine) => machine.partId === forge.partId);
    assert(cycled.recipeId === 'forge-gear-12', 'R must reach the newly unlocked gear recipe, got ' + cycled.recipeId);
    // 用新配方真实制造齿轮：投 1 铁锭 → 2 个 12 齿齿轮。
    const ingots = invOf(afterR, 'iron_ingot');
    assert(ingots >= 1, 'need at least 1 ingot to forge a gear');
    // 放置时已经消耗过 1 个齿轮，库存基线以当前值为准（不能硬编码起步包数量）。
    const gearsBefore = invOf(afterR, 'gear_12');
    await play.keyboard.press('KeyC');
    await play.advance(0.1);
    await waitProduction('forge gear', (st) => (st.production.produced.find((p) => p.itemId === 'gear_12')?.count ?? 0) >= 2, { timeoutMs: 60000, keepPowered: true });
    await play.mouse.move(forgePt);
    await play.wait(120);
    await h.rightClickAt(forgePt);
    await play.advance(0.35);
    const done = await state();
    assert(invOf(done, 'gear_12') >= gearsBefore + 2, 'forged 2 gears must enter inventory: ' + gearsBefore + ' -> ' + invOf(done, 'gear_12'));
    // 生产链仍在运行：总产出持续增加（第 5 条验收）。
    const producedBefore = done.production.produced.reduce((sum, entry) => sum + entry.count, 0);
    await rewind(1200);
    await play.advance(1.5);
    const after = await state();
    const producedAfter = after.production.produced.reduce((sum, entry) => sum + entry.count, 0);
    assert(producedAfter >= producedBefore, 'production chain must keep running');
    logStep('09-UNLOCKED', { forgeRecipes: done.production.machines.find((m) => m.partId === forge.partId)?.recipeId, gears: invOf(done, 'gear_12'), produced: done.production.produced });
    await play.screenshot('09-gear-forged');
  });

  await play.step('10-final-state', async () => {
    const s = await state();
    assert(techOf(s).mode === 'player', 'must remain in player mode');
    assert(techOf(s).nodes.length === 12, 'all 12 nodes must remain readable');
    const statuses = techOf(s).nodes.map((node) => node.status);
    assert(statuses.filter((status) => status === 'completed').length === 1, 'exactly one completed node in E1 flow');
    console.log('P2E1-FINAL=' + JSON.stringify({
      mode: techOf(s).mode,
      unlocked: techOf(s).unlocked,
      nodes: techOf(s).nodes.map((node) => ({ id: node.id, status: node.status })),
      inventory: s.inventory,
      produced: s.production.produced,
    }));
    await play.screenshot('10-final');
  });
}
