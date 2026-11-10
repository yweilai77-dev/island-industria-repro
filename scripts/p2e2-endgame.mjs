// M2.0-P2-E3 终局联合工厂端到端验收（player 正式模式，真实键鼠）。
//
// 断言任务书 §五 C1/C2/C3：
//   1) C1 成套交付：16 件物品全部由真实生产链制造（矿石 → 碎矿 → 铁锭 → 锻压）；
//   2) C2 运行证明：真实搭出 >=3 台核心的组合机械、>=2 台装输出盒、>=2 条 active 连接、
//      >=2 台 powered，并在 60 s 窗口内由真实加工累积 >=12 件产出后 passed；
//   3) C3 项目门控：16 件材料交齐后节点仍 researching（submit 不能完成项目）；
//      证明通过后 endgame 通过 completeProjectNode 自动完成一次；重复提交被拒、不重复扣料。
//
// 所有交互都是真实键/鼠（放置、投料、取货、装接口盒、建链、结构框架、摇柄）；
// 科技交付通过 __II_TEST_TECH__ 发送与正式 UI 相同的 tech/submit-all 命令（不绕过校验）。
import { createHarness } from './m18-helpers.mjs';
import { createOrderKit } from './m20-order-lib.mjs';
import { createHarvest } from './p2e2-endgame-harvest.mjs';
import {
  FACTORY_CELLS,
  FACTORY_FRAMES,
  FACTORY_LAYOUT,
  FORGE,
  CRUSHER,
  FLY,
  PRODUCTION_CELLS,
  PRODUCTION_LAYOUT,
  SHAFT,
  SMELTER,
  createEndgameCtx,
} from './p2e2-endgame-lib.mjs';

const T1_1 = 'tech:gear-manufacture';
const T1_2 = 'tech:chute-logistics';
const T1_3 = 'tech:cross-level-drive';
const T1_4 = 'tech:input-interface';
const T2_1 = 'tech:output-interface';
const T2_2 = 'tech:split-merge';
const T2_3 = 'tech:core-replication';
const T2_4 = 'tech:flywheel-production';
const T2_5 = 'tech:structure-assembly';
const T3_1 = 'tech:batch-processing';
const T3_2 = 'tech:line-integration';
const T3_3 = 'tech:combined-works';

const INGOT_TARGET = 156;
/** 生产 156 铁锭 + 4 块碎矿 = 160 矿石；再留 ~15 给运行证明窗口喂料（见 harvest 模块）。 */
const ORE_REQUIRED = 175;

/** 终局成套交付（与节点成本一致；交付后库存精确减少这些数量）。 */
const DELIVERY_ITEMS = [
  ['shaft', 6],
  ['interface_box', 3],
  ['output_interface_box', 1],
  ['splitter_box', 1],
  ['merger_box', 1],
  ['structure_frame', 3],
  ['vertical_drive', 1],
];

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function playthrough(play) {
  const h = createHarness(play);
  const kit = createOrderKit(play, h);
  const E = createEndgameCtx(play, h);
  const { assert, state, invOf, techNode, projectOf, machineAt, logStep, waitState, summarize } = E;
  const harvest = createHarvest({ play, h, state, invOf, logStep, assert });
  const cells = { ...FACTORY_CELLS };
  let proofGuard = null; // { fw1Id, fw2Id }：工厂飞轮的真实 partId

  /** 走到目标格；失败时按 waypoints 重试（路口被机器挡住时绕行）。 */
  const moveTo = async (cell, waypoints = []) => {
    if (await h.gotoCell(cell, 14000, true)) return;
    for (const waypoint of waypoints) await h.gotoCell(waypoint, 14000, false);
    assert(await h.gotoCell(cell, 14000, true), 'must reach cell ' + JSON.stringify(cell));
  };


  const flywheelParts = (s) => s.parts.filter((part) => part.kind === 'power-source');
  const flywheelAt = (s, cell) => flywheelParts(s).find((part) => part.placement.gx === cell.gx
    && part.placement.gz === cell.gz);

  await play.step('00-boot-player-mode', async () => {
    await play.page.addInitScript(() => {
      globalThis.__II_TEST_FLAGS__ = { progression: 'player', techHooks: true };
    });
    await play.reload();
    await play.advance(0.6);
    const s = await state();
    assert(s.tech?.mode === 'player', 'must boot in player progression mode, got ' + s.tech?.mode);
    assert(s.project !== null, 'project snapshot must be part of the unique mechanical GameRead');
    assert(s.project.completed === false, 'a new session must not start completed');
    const hooks = await play.page.evaluate(() => ({
      tech: typeof globalThis.__II_TEST_TECH__,
      endgame: typeof globalThis.__II_TEST_ENDGAME__,
    }));
    assert(hooks.tech === 'object', 'techHooks must expose __II_TEST_TECH__');
    assert(hooks.endgame === 'object', 'techHooks must expose __II_TEST_ENDGAME__');
    logStep('BOOT', { mode: s.tech.mode, project: s.project, hooks });
  });

  await play.step('01-harvest-ore', async () => {
    await h.learnMovement();
    // 跨矿点采集 A→B→C（P2-E3 平衡后每点储量 60，单点挖空即 depleted）。
    const ore = await harvest.harvestAll(PRODUCTION_CELLS.buildSpot);
    assert(ore >= ORE_REQUIRED, 'harvest must stockpile >= ' + ORE_REQUIRED + ' ore, got ' + ore);
    logStep('ORE', { ore });
  });

  await play.step('02-build-production-line', async () => {
    await E.calibrate('E3-WORK');
    await E.placeLayout(PRODUCTION_LAYOUT);
    // 起步包只有手摇飞轮：真实摇柄 + 离合，不是调试动力源。
    await E.ensureProductionPowered(await state());
    const ready = await E.waitState('production line powered', (s) => s.production.machines.length === 3
      && s.production.machines.every((machine) => machine.powered === true),
    { timeoutMs: 30000, keepPowered: true });
    assert(ready.sources.length === 1, 'production line must run on one flywheel network');
    logStep('LINE', {
      parts: ready.parts.length,
      machines: ready.production.machines.map((m) => ({ id: m.partId, recipe: m.recipeId })),
    });
    await E.screenshot('02-production-line');
  });

  await play.step('03-produce-ingots', async () => {
    await E.produceIngots(INGOT_TARGET);
    const s = await state();
    const crusher = machineAt(s, PRODUCTION_CELLS.crusher);
    await E.feedAt(PRODUCTION_CELLS.crusher, crusher.partId, 4);
    await E.waitState('extra crush', (now) => (now.production.machines
      .find((m) => m.partId === crusher.partId)?.outputCount ?? 0) >= 4, { timeoutMs: 60000, keepPowered: true });
    await E.collectAt(PRODUCTION_CELLS.crusher, crusher.partId);
    const done = await state();
    assert(invOf(done, 'crushed_ore') >= 3, 'need >= 3 crushed ore, got ' + invOf(done, 'crushed_ore'));
    assert(invOf(done, 'iron_ingot') >= INGOT_TARGET, 'need >= ' + INGOT_TARGET + ' ingots, got '
      + invOf(done, 'iron_ingot'));
    logStep('INGOTS-DONE', { inventory: done.inventory });
    await E.screenshot('03-ingots');
  });

  await play.step('04-tech-chain-part-1', async () => {
    await E.deliverNode(T1_1);
    await E.forgeItem('forge-gear-24', 2);
    await E.forgeItem('forge-shaft', 2);
    await E.deliverNode(T1_3);
    await E.deliverNode(T1_2);
    await E.deliverNode(T1_4);
    await E.forgeItem('forge-interface-box', 2);
    await E.deliverNode(T2_1);
    await E.forgeItem('forge-output-box', 1);
    await E.forgeItem('forge-interface-box', 1);
    await E.deliverNode(T2_2);
    await E.forgeItem('forge-shaft', 1);
    await E.forgeItem('forge-gear-12', 1);
    await E.deliverNode(T2_3);
    logStep('TECH-1', { nodes: (await state()).tech.nodes.map((n) => n.id + ':' + n.status) });
    await E.screenshot('04-tech-part-1');
  });

  await play.step('05-tech-chain-part-2', async () => {
    await E.forgeItem('forge-gear-24', 2);
    await E.forgeItem('forge-shaft', 2);
    await E.deliverNode(T2_4);
    await E.forgeItem('forge-output-box', 1);
    await E.forgeItem('forge-merger-box', 1);
    await E.forgeItem('forge-shaft', 2);
    await E.deliverNode(T2_5);
    await E.forgeItem('forge-shaft', 2);
    await E.forgeItem('forge-gear-24', 2);
    await E.deliverNode(T3_1);
    // T3.2：交付三台真实机器（破碎机 / 熔炼炉 / 锻压机）
    await E.forgeItem('forge-crusher', 1);
    await E.forgeItem('forge-smelter', 1);
    await E.forgeItem('forge-processing-core', 1);
    await E.deliverNode(T3_2);
    const s = await state();
    assert(techNode(s, T3_3)?.status === 'available', 'T3.3 must become available after T3.2, got '
      + techNode(s, T3_3)?.status);
    logStep('TECH-2', { nodes: s.tech.nodes.map((n) => n.id + ':' + n.status) });
    await E.screenshot('05-tech-part-2');
  });

  await play.step('06-forge-factory-and-delivery-kit', async () => {
    // 工厂自用：2 输出盒 + 2 基础盒 + 3 结构框架 + 1 飞轮
    await E.forgeItem('forge-output-box', 2);
    await E.forgeItem('forge-interface-box', 2);
    await E.forgeItem('forge-structure-frame', 3);
    await E.forgeItem('forge-flywheel', 1);
    // 交付用：6 传动轴 + 3 基础盒 + 1 输出盒 + 1 分流盒 + 1 合流盒 + 3 结构框架（立式带用起步件）
    await E.forgeItem('forge-shaft', 6);
    await E.forgeItem('forge-interface-box', 3);
    await E.forgeItem('forge-output-box', 1);
    await E.forgeItem('forge-splitter-box', 1);
    await E.forgeItem('forge-merger-box', 1);
    await E.forgeItem('forge-structure-frame', 3);
    const s = await state();
    for (const [itemId, count] of DELIVERY_ITEMS) {
      assert(invOf(s, itemId) >= count, 'delivery kit needs ' + count + ' ' + itemId
        + ', have ' + invOf(s, itemId) + ' snapshot=' + summarize(s));
    }
    logStep('KIT', { inventory: s.inventory });
    await E.screenshot('06-delivery-kit');
  });

  await play.step('07-deliver-combined-works', async () => {
    const before = await state();
    assert(techNode(before, T3_3)?.status === 'available', 'T3.3 must be available before delivery');
    await E.submitAll(T3_3);
    await play.advance(0.6);
    const after = await waitState('deliver T3.3', (s) => projectOf(s)?.delivery?.complete === true,
      { timeoutMs: 30000, step: 0.5 });
    const node = techNode(after, T3_3);
    // C3：材料交齐但节点仍是 researching —— 直接 submit 永远不能完成项目节点。
    assert(node?.status === 'researching', 'T3.3 must stay researching after full delivery, got ' + node?.status);
    assert(projectOf(after)?.completed === false, 'project must not be completed by delivery alone');
    for (const [itemId, count] of DELIVERY_ITEMS) {
      const delta = invOf(before, itemId) - invOf(after, itemId);
      assert(delta === count, 'delivery must consume exactly ' + count + ' ' + itemId + ', got ' + delta);
    }
    const blocks = projectOf(after)?.blocks ?? [];
    assert(blocks.some((line) => line.includes('运行证明')), 'blocks must mention missing run proof, got '
      + JSON.stringify(blocks));
    logStep('DELIVERED', {
      node: node.status,
      delivery: projectOf(after)?.delivery,
      blocks,
      inventory: after.inventory,
    });
    await E.screenshot('07-delivered-not-completed');
  });

  await play.step('08-rebuild-as-combined-factory', async () => {
    await E.removeAllParts();
    // 起步机器/飞轮/传动轴拆回背包后快捷栏绑定已被运行时解除：用真实背包 UI 重新绑定。
    await kit.bindHotbarFromBackpack('shaft', SHAFT);
    await kit.bindHotbarFromBackpack('flywheel_source', FLY);
    await kit.bindHotbarFromBackpack('crusher', CRUSHER);
    await kit.bindHotbarFromBackpack('smelter', SMELTER);
    await kit.bindHotbarFromBackpack('forge', FORGE);
    await E.calibrate('E3-FACTORY');
    await E.placeLayout(FACTORY_LAYOUT);
    await E.buildFrames();
    await E.installPorts();
    await E.linkFactory();
    const built = await state();
    const fw1 = flywheelAt(built, cells.flywheel1);
    const fw2 = flywheelAt(built, cells.flywheel2);
    assert(fw1 && fw2, 'factory needs two real flywheel sources; snapshot=' + summarize(built));
    proofGuard = { fw1Id: fw1.partId, fw2Id: fw2.partId };
    // 真实摇柄供能（两台各自成网，各自在 range 2.2 内的站位）。
    await moveTo(cells.windSpot1, [{ gx: -6, gz: 6 }]);
    await E.windFlywheel(cells.flywheel1, fw1.partId);
    await moveTo(cells.windSpot2, [{ gx: -6, gz: 7 }]);
    await E.windFlywheel(cells.flywheel2, fw2.partId);
    // 结构条件必须在窗口开始前就成立（产出条件单独由窗口累积）。
    const project = projectOf(await state());
    const structural = (project?.proof?.conditions ?? []).filter((entry) => entry.id !== 'produced');
    assert(structural.length === 4 && structural.every((entry) => entry.ok),
      '4 structural proof conditions must hold before the window: ' + JSON.stringify(structural));
    logStep('FACTORY', {
      assembly: built.assemblies.find((entry) => entry.memberIds.length >= 3),
      conditions: project.proof.conditions,
      ports: built.ports,
      links: built.links,
    });
    await E.screenshot('08-factory-built');
  });

  await play.step('09-run-proof', async () => {
    const before = await state();
    const project = await E.beginProof();
    assert(project.proof.state === 'running', 'proof window must be running, got ' + project.proof.state);
    assert(project.completed === false, 'beginProof must not complete the project');
    logStep('PROOF-START', { duration: project.proof.durationSeconds, target: project.proof.target });
    // 窗口内真实供能 + 真实投料：每轮给两台飞轮补能，再喂破碎机 3 块矿石。
    const deadline = Date.now() + 240000;
    let rounds = 0;
    while (Date.now() < deadline) {
      const now = await state();
      const proof = projectOf(now)?.proof;
      if (!proof || proof.state !== 'running') break;
      await moveTo(cells.windSpot1, [{ gx: -6, gz: 6 }]);
      await E.windFlywheel(cells.flywheel1, proofGuard.fw1Id);
      await moveTo(cells.windSpot2, [{ gx: -6, gz: 7 }]);
      await E.windFlywheel(cells.flywheel2, proofGuard.fw2Id);
      const crusher = machineAt(now, cells.crusher);
      assert(crusher, 'factory crusher must be tracked during the window');
      await E.feedAt(cells.crusher, crusher.partId, 3);
      await play.advance(0.5);
      rounds += 1;
      if (rounds > 12) throw new Error('proof window did not finish in 12 rounds');
    }
    const passed = await E.waitProofState('proof', 'passed', 60000);
    assert(passed.proof.produced >= passed.proof.target, 'proof must observe >= ' + passed.proof.target
      + ' produced, got ' + passed.proof.produced);
    assert(passed.proof.conditions.every((entry) => entry.ok), 'all proof conditions must be true, got '
      + JSON.stringify(passed.proof.conditions));
    // 运行证明不扣成套材料（窗口只消耗我们主动喂给产线的矿石）。
    const after = await state();
    for (const [itemId] of DELIVERY_ITEMS) {
      assert(invOf(after, itemId) === invOf(before, itemId),
        'proof must not consume ' + itemId + ', ' + invOf(before, itemId) + ' -> ' + invOf(after, itemId));
    }
    logStep('PROOF-PASSED', { proof: passed.proof, rounds });
    await E.screenshot('09-proof-passed');
  });

  await play.step('10-auto-completed', async () => {
    // endgame 在 passed 且交付已齐时调用 completeProjectNode，因此项目应自动完成一次。
    const started = Date.now();
    let done = await E.projectOf(await state());
    while (Date.now() - started < 30000 && done?.completed !== true) {
      await play.advance(1);
      await play.wait(60);
      done = await E.projectOf(await state());
    }
    assert(done?.completed === true, 'endgame must complete the project after proof passed; project='
      + JSON.stringify(done));
    assert(done.blocks.length === 0, 'no blocks may remain after completion, got ' + JSON.stringify(done.blocks));
    const s = await state();
    assert(techNode(s, T3_3)?.status === 'completed', 'T3.3 tech node must be completed');
    assert(s.tech.unlocked.includes(T3_3), 'unlocked must contain T3.3');
    logStep('COMPLETED', {
      project: { completed: done.completed, proof: done.proof.state, delivery: done.delivery, blocks: done.blocks },
      tech: techNode(s, T3_3)?.status,
    });
    await E.screenshot('10-endgame-completed');
  });

  await play.step('11-idempotent-and-final-state', async () => {
    const before = await state();
    // 重复提交：节点已完成 → tech 拒绝（completed），库存不变。
    await E.submitAll(T3_3);
    await play.advance(0.6);
    const after = await state();
    assert(techNode(after, T3_3)?.status === 'completed', 'T3.3 must remain completed after duplicate submit');
    for (const [itemId] of DELIVERY_ITEMS) {
      assert(invOf(after, itemId) === invOf(before, itemId),
        'duplicate submission must not consume ' + itemId);
    }
    assert(after.tech.unlocked.filter((id) => id === T3_3).length === 1, 'T3.3 must not be unlocked twice');
    assert(projectOf(after)?.completed === true, 'project must stay completed');
    assert(after.project.proof.state === 'passed', 'proof must stay passed');
    // 重复点运行证明：终态不可重开。
    await play.page.evaluate(() => globalThis.__II_TEST_ENDGAME__?.beginProof());
    await play.advance(0.5);
    const again = await state();
    assert(again.project.proof.state === 'passed', 'passed proof must not reopen, got '
      + again.project.proof.state);
    logStep('FINAL', {
      completed: again.project.completed,
      proof: again.project.proof.state,
      produced: again.project.proof.produced,
      delivery: again.project.delivery,
      inventory: again.inventory,
      assemblies: again.assemblies.map((entry) => ({ id: entry.id, members: entry.memberIds })),
      links: again.links.map((link) => ({ active: link.active, moved: link.moved })),
    });
    await E.screenshot('11-final');
  });
}
