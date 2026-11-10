// M2.0-P2-E3 工作包 F：阶段 0/1/2（教学订单 → T1.x → T2.x）+ 阶段 A→B 布局迁移。
import { TECH_NODES, LAYOUT_EARLY, LAYOUT_FINAL, FRAMES_FINAL, SLOT } from './p2f-lib.mjs';

const ORE_A = { gx: -6, gz: 4 };
const ORE_B = { gx: 3, gz: -4 };
const ORE_C = { gx: -13, gz: -7 };
const ORE_D = { gx: 12, gz: 10 };
const CHUTE_CELL = { gx: -2, gz: 8 };
const SMELTER_CELL = { gx: -2, gz: 9 };
const DOCK_CELL = { gx: -2, gz: 8 };
const PLAYER_SPOT = { gx: -7, gz: 7 };

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export async function runEarlyStages(play, F) {
  const { assert, state, countOf, h, log, calibrate, placeLayout, placeFrameAt, onPart, shot,
    waitFor, removePart, removeAllParts, aim, placeRotated, ensureHotbar, windBoth,
    runManualRounds, runAutoRounds, craft, ensureDelivery, submitTech, nodeOf, nodeStatus,
    crusherIdOf, smelterIdOf, forgeIdOf, cellOfMachine, producedCount, kit } = F;

  const waitMachines = async (count, label) => {
    const ready = await waitFor((now) => now.production.machines.length === count
      && now.production.machines.every((machine) => machine.powered === true), 15, label);
    assert(ready.ok, label + ': ' + JSON.stringify(ready.state?.production?.machines));
    return ready.state;
  };
  /** 走路带重试：卡位时后退一次再重走（避免一次卡位毁掉整条 playthrough）。 */
  const goCell = async (cell, timeout = 16000) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await h.gotoCell(cell, timeout, false)) return true;
      const s = await state();
      const back = { gx: s.player.cell.gx - cell.gx, gz: s.player.cell.gz - cell.gz };
      if (back.gx !== 0 || back.gz !== 0) await h.holdToward(back.gx, back.gz, 350);
      await play.wait(150);
    }
    return false;
  };
  const walkTo = async (waypoints, final) => {
    for (const waypoint of waypoints) {
      assert(await goCell(waypoint), 'cannot reach waypoint ' + JSON.stringify(waypoint));
    }
    assert(await goCell(final), 'cannot reach ' + JSON.stringify(final));
  };
  /** 状态驱动采集：按目标库存增量循环（CDP 短按键会丢帧，不能盲按固定次数）。 */
  const harvestAt = async (view, target, label) => {
    assert(await goCell(view), 'cannot reach ore node ' + label);
    const before = countOf(await state(), 'iron_ore');
    let attempts = 0;
    while (attempts < target * 2) {
      if (countOf(await state(), 'iron_ore') >= before + target - 2) break;
      await play.keyboard.hold('KeyF', 60);
      await play.advance(0.2);
      await play.advance(3.0);
      await play.wait(40);
      attempts += 1;
    }
    const after = countOf(await state(), 'iron_ore');
    const gained = after - before;
    assert(gained >= target - 3, label + ' harvest short: gained ' + gained + '/' + target + ' attempts=' + attempts);
    log('HARVEST', { label, gained, target, attempts });
    return after;
  };
  const removeByCell = async (cell) => {
    const s = await state();
    const part = s.parts.find((entry) => entry.placement.gx === cell.gx && entry.placement.gz === cell.gz);
    if (part === undefined) return;
    await removePart(cell, part.partId);
  };
  // ------------------------------------------------------------------
  await play.step('01-harvest-ore-stockpile', async () => {
    await calibrate('ORE-A');
    await harvestAt(ORE_A, 60, 'A');
    await walkTo([{ gx: -8, gz: 4 }, { gx: -8, gz: -4 }, { gx: 0, gz: -4 }], ORE_B);
    await harvestAt(ORE_B, 60, 'B');
    await walkTo([{ gx: 3, gz: -6 }, { gx: 9, gz: -6 }, { gx: 12, gz: -6 }, { gx: 12, gz: 0 }, { gx: 12, gz: 6 }], ORE_D);
    await harvestAt(ORE_D, 60, 'D');
    await walkTo([{ gx: 12, gz: 0 }, { gx: 9, gz: -6 }, { gx: -8, gz: -4 }], ORE_C);
    await harvestAt(ORE_C, 60, 'C');
    await walkTo([{ gx: -13, gz: -7 }, { gx: -8, gz: -7 }, { gx: -8, gz: 4 }], PLAYER_SPOT);
    const s = await state();
    assert(countOf(s, 'iron_ore') >= 228, 'must stockpile >=228 ore, got ' + countOf(s, 'iron_ore'));
    log('01-ORE', { ore: countOf(s, 'iron_ore') });
    await shot('01-ore-stockpile');
  });

  // ------------------------------------------------------------------
  await play.step('02-build-early-line-and-power', async () => {
    await calibrate('EARLY-WORK');
    await placeLayout(LAYOUT_EARLY);
    F.setWorkSpot(PLAYER_SPOT);
    await F.ensurePower(999);
    const s = await waitMachines(3, 'early-line-power');
    assert(s.parts.length === LAYOUT_EARLY.length, 'expected ' + LAYOUT_EARLY.length + ' parts, got ' + s.parts.length);
    assert(s.networks.length === 1 && s.networks[0].status === 'powered', 'single powered network expected');
    log('02-LINE', { parts: s.parts.length, machines: s.production.machines.map((m) => m.recipeId), network: s.networks[0].status });
    await shot('02-early-line');
  });

  // ------------------------------------------------------------------
  await play.step('03-tutorial-order-8-steps', async () => {
    let s = await state();
    const crusherId = crusherIdOf(s);
    const smelterId = smelterIdOf(s);
    const forgeId = forgeIdOf(s);
    const crusherCell = cellOfMachine(s, crusherId);
    const smelterCell = cellOfMachine(s, smelterId);
    const forgeCell = cellOfMachine(s, forgeId);
    const machineOf = (now, id) => now.production.machines.find((machine) => machine.partId === id);
    /** 状态驱动：直到真实产出达标；每轮若输入为空就重新投料（防 hover/丢键）。 */
    const produceUntil = async (itemId, target, feeder, label, maxGame = 120) => {
      for (let elapsed = 0; elapsed <= maxGame; elapsed += 4) {
        const now = await state();
        if (producedCount(now, itemId) >= target) return now;
        // P2-E3 兼容性：每轮先维持动力（能量耗尽会让加工冻结，表现为「产出超时」）。
        await F.ensurePower();
        await feeder(now);
        await play.advance(4);
      }
      const now = await state();
      throw new Error(label + ' timeout; machines=' + JSON.stringify(now.production.machines)
        + ' produced=' + JSON.stringify(now.production.produced));
    };
    await F.feedMachine(crusherCell, crusherId, 4);
    await produceUntil('crushed_ore', 4, async (now) => {
      if (machineOf(now, crusherId).inputCount === 0) await F.feedMachine(crusherCell, crusherId, 4);
    }, 'order crush', 100);
    await F.collectMachine(crusherCell, crusherId, 1);
    await F.feedMachine(smelterCell, smelterId, 4);
    await produceUntil('iron_ingot', 4, async (now) => {
      const smelter = machineOf(now, smelterId);
      if (smelter.inputCount === 0 && countOf(now, 'crushed_ore') > 0) await F.feedMachine(smelterCell, smelterId, 4);
    }, 'order smelt', 120);
    await F.collectMachine(smelterCell, smelterId, 1);
    await F.feedMachine(forgeCell, forgeId, 2);
    await produceUntil('shaft', 1, async (now) => {
      const forge = machineOf(now, forgeId);
      if (forge.inputCount < 2 && countOf(now, 'iron_ingot') >= 2) await F.feedMachine(forgeCell, forgeId, 2);
    }, 'order forge', 60);
    await F.collectMachine(forgeCell, forgeId, 1);
    s = await state();
    const ui = await kit.readUi();
    assert(ui !== null, 'goal panel must be readable');
    const done = ui.steps.filter((step) => step.completed).length;
    assert(ui.state === 'complete' && done === ui.steps.length,
      'tutorial order must complete, state=' + ui.state + ' completed=' + done + '/' + ui.steps.length);
    log('03-ORDER', { state: ui.state, steps: ui.steps.map((step) => step.id + ':' + (step.completed ? 'ok' : 'no')) });
    await shot('03-order-complete');
  });

  // ------------------------------------------------------------------
  await play.step('04-t11-gear-manufacture', async () => {
    await runManualRounds(3);
    await ensureDelivery(TECH_NODES.T11);
    await submitTech(TECH_NODES.T11);
    const s = await state();
    assert(nodeStatus(s, TECH_NODES.T11) === 'completed', 'T1.1 must be completed');
    assert(nodeStatus(s, TECH_NODES.T12) === 'available', 'T1.2 must become available');
    log('04-T11', { node: nodeOf(s, TECH_NODES.T11)?.status, inventory: s.inventory });
    await shot('04-t11-done');
  });

  await play.step('05-craft-gears-and-t12-chute-logistics', async () => {
    await craft('forge-gear-12', 2);
    await craft('forge-gear-24', 4);
    // T1.2 需要 3 块碎铁矿：单独破碎一批并留下（不熔炼）。
    let s = await state();
    const crusherId = crusherIdOf(s);
    const crushedBefore = producedCount(s, 'crushed_ore');
    await F.feedMachine(cellOfMachine(s, crusherId), crusherId, 4);
    const done = await F.advanceUntil('t12 crushed', (now) => producedCount(now, 'crushed_ore') >= crushedBefore + 4, 40);
    await F.collectMachine(cellOfMachine(done, crusherId), crusherId, 1);
    await ensureDelivery(TECH_NODES.T12);
    await submitTech(TECH_NODES.T12);
    s = await state();
    assert(nodeStatus(s, TECH_NODES.T12) === 'completed', 'T1.2 must be completed');
    log('05-T12', { node: nodeStatus(s, TECH_NODES.T12), inventory: s.inventory });
  });

  await play.step('06-t14-input-box-auto-feed', async () => {
    await ensureDelivery(TECH_NODES.T14);
    await submitTech(TECH_NODES.T14);
    let s = await state();
    assert(nodeStatus(s, TECH_NODES.T14) === 'completed', 'T1.4 must be completed');
    // 造基础接口盒并装到熔炼炉输入位；再把溜槽放到破碎机产物出口 → 熔炼炉输入面。
    await craft('forge-interface-box', 1);
    s = await state();
    const smelterId = smelterIdOf(s);
    await onPart(cellOfMachine(s, smelterId), smelterId, 'KeyT');
    s = await state();
    assert(s.ports.some((port) => port.partId === smelterId), 'input interface box must be installed');
    await ensureHotbar('chute');
    await placeRotated(await aim(CHUTE_CELL), SLOT.CHUTE, 270, 'early-chute', CHUTE_CELL);
    // 自动送料：只喂破碎机，熔炼炉必须自己收到并产出铁锭。
    const smeltBefore = producedCount(await state(), 'iron_ingot');
    await runAutoRounds(1);
    s = await state();
    assert(producedCount(s, 'iron_ingot') >= smeltBefore + 4,
      'auto feed chain must smelt 4 ingots, got ' + (producedCount(s, 'iron_ingot') - smeltBefore));
    log('06-T14', { ports: s.ports, produced: s.production.produced });
    await shot('06-auto-feed');
  });

  await play.step('07-t13-cross-level-drive', async () => {
    await ensureDelivery(TECH_NODES.T13);
    await submitTech(TECH_NODES.T13);
    const s = await state();
    assert(nodeStatus(s, TECH_NODES.T13) === 'completed', 'T1.3 must be completed');
    log('07-T13', { node: nodeStatus(s, TECH_NODES.T13) });
  });

  // ------------------------------------------------------------------
  await play.step('08-bulk-ingot-stockpile', async () => {
    let s = await state();
    let rounds = 0;
    while (countOf(s, 'iron_ingot') < 172 && rounds < 52) {
      await runAutoRounds(1);
      rounds += 1;
      s = await state();
      if (rounds % 4 === 0) log('08-STOCK', { rounds, ingots: countOf(s, 'iron_ingot') });
    }
    assert(countOf(s, 'iron_ingot') >= 172, 'must stockpile >=172 ingots for stage 2/3, got ' + countOf(s, 'iron_ingot'));
    assert(countOf(s, 'iron_ore') >= 10, 'must keep ore for the final proof window, got ' + countOf(s, 'iron_ore'));
    log('08-BULK', { ingots: countOf(s, 'iron_ingot'), ore: countOf(s, 'iron_ore'), rounds });
    await shot('08-ingot-stockpile');
  });

  // ------------------------------------------------------------------
  // T2.1：造输出接口盒 + 装到破碎机输出位 + 建第一条 MaterialLink（临时对接演示）。
  await play.step('09-t21-output-box-and-link', async () => {
    await ensureDelivery(TECH_NODES.T21);
    await submitTech(TECH_NODES.T21);
    let s = await state();
    assert(nodeStatus(s, TECH_NODES.T21) === 'completed', 'T2.1 must be completed');
    await craft('forge-output-box', 3);
    // 对接演示：删掉溜槽与熔炼炉，熔炼炉 90° 放到破碎机东侧正对输出端口。
    await removeByCell(CHUTE_CELL);
    await removeByCell(SMELTER_CELL);
    await ensureHotbar('smelter');
    await placeRotated(await aim(DOCK_CELL), SLOT.SMELTER, 90, 'dock-smelter', DOCK_CELL);
    s = await state();
    const smelterId = smelterIdOf(s);
    const crusherId = crusherIdOf(s);
    await onPart(cellOfMachine(s, crusherId), crusherId, 'KeyO');
    await onPart(DOCK_CELL, smelterId, 'KeyT');
    await onPart(cellOfMachine(s, crusherId), crusherId, 'KeyJ');
    await onPart(DOCK_CELL, smelterId, 'KeyJ');
    s = await state();
    assert(s.links.length === 1 && s.links[0].active === true, 'material link must be active after J/J');
    assert(s.links[0].from.entityId === crusherId && s.links[0].to.entityId === smelterId, 'link direction must be crusher→smelter');
    log('09-T21-LINK', { links: s.links });
    await shot('09-t21-link');
    // 还原成自动送料布局（输出盒/输入盒拆回背包）。
    s = await state();
    const smelterNow = smelterIdOf(s);
    await onPart(cellOfMachine(s, crusherId), crusherId, 'KeyY');
    await onPart(DOCK_CELL, smelterNow, 'KeyY');
    await removeByCell(DOCK_CELL);
    await ensureHotbar('smelter');
    await placeRotated(await aim(SMELTER_CELL), SLOT.SMELTER, 0, 'restore-smelter', SMELTER_CELL);
    s = await state();
    await onPart(SMELTER_CELL, smelterIdOf(s), 'KeyT');
    await ensureHotbar('chute');
    await placeRotated(await aim(CHUTE_CELL), SLOT.CHUTE, 270, 'restore-chute', CHUTE_CELL);
  });

  // T2.2：分流盒安装（K）+ splitter 多口建链能力。
  await play.step('10-t22-split-merge', async () => {
    await ensureDelivery(TECH_NODES.T22);
    await submitTech(TECH_NODES.T22);
    let s = await state();
    assert(nodeStatus(s, TECH_NODES.T22) === 'completed', 'T2.2 must be completed');
    await craft('forge-splitter-box', 2);
    await removeByCell(CHUTE_CELL);
    await removeByCell(SMELTER_CELL);
    await ensureHotbar('smelter');
    await placeRotated(await aim(DOCK_CELL), SLOT.SMELTER, 90, 'dock-smelter-2', DOCK_CELL);
    s = await state();
    const smelterId = smelterIdOf(s);
    const crusherId = crusherIdOf(s);
    await onPart(cellOfMachine(s, crusherId), crusherId, 'KeyK');
    await onPart(DOCK_CELL, smelterId, 'KeyT');
    s = await state();
    assert(s.ports.some((port) => port.partId === crusherId), 'splitter box must be installed with K');
    await onPart(cellOfMachine(s, crusherId), crusherId, 'KeyJ');
    await onPart(DOCK_CELL, smelterId, 'KeyJ');
    s = await state();
    assert(s.links.length === 1 && s.links[0].active === true, 'splitter link must be active');
    log('10-T22', { ports: s.ports, links: s.links });
    await shot('10-t22-splitter');
    // 还原：拆 splitter/输入盒/熔炼炉，装回输出盒+输入盒+溜槽。
    s = await state();
    const smelterNow = smelterIdOf(s);
    await onPart(cellOfMachine(s, crusherId), crusherId, 'KeyY');
    await onPart(DOCK_CELL, smelterNow, 'KeyY');
    await removeByCell(DOCK_CELL);
    await ensureHotbar('smelter');
    await placeRotated(await aim(SMELTER_CELL), SLOT.SMELTER, 0, 'restore-smelter-2', SMELTER_CELL);
    s = await state();
    await onPart(SMELTER_CELL, smelterIdOf(s), 'KeyT');
    await ensureHotbar('chute');
    await placeRotated(await aim(CHUTE_CELL), SLOT.CHUTE, 270, 'restore-chute-2', CHUTE_CELL);
  });

  await play.step('11-t23-core-replication', async () => {
    await ensureDelivery(TECH_NODES.T23);
    await submitTech(TECH_NODES.T23);
    // 真实复制第二台核心（第二台熔炼炉，阶段 3 与终局组合用）。
    await craft('forge-smelter', 1);
    const s = await state();
    assert(nodeStatus(s, TECH_NODES.T23) === 'completed', 'T2.3 must be completed');
    assert(countOf(s, 'smelter') >= 1, 'copied smelter must be a real inventory item');
    log('11-T23', { node: nodeStatus(s, TECH_NODES.T23), smelters: countOf(s, 'smelter') });
  });

  await play.step('12-t24-second-flywheel', async () => {
    await ensureDelivery(TECH_NODES.T24);
    await submitTech(TECH_NODES.T24);
    await craft('forge-flywheel', 1);
    const s = await state();
    assert(nodeStatus(s, TECH_NODES.T24) === 'completed', 'T2.4 must be completed');
    assert(countOf(s, 'flywheel_source') >= 1, 'second flywheel must be a real inventory item');
    log('12-T24', { node: nodeStatus(s, TECH_NODES.T24), flywheels: countOf(s, 'flywheel_source') });
  });

  // ------------------------------------------------------------------
  // 布局迁移：单飞轮自动送料线 → 双飞轮分区 + 两核心对接 + 组合机械。
  await play.step('13-rebuild-final-line-and-t25-assembly', async () => {
    // T2.5 必须先完成（它解锁 P 结构模式/组合能力），再搭组合与做布局迁移。
    await ensureDelivery(TECH_NODES.T25);
    await submitTech(TECH_NODES.T25);
    let pre = await state();
    assert(nodeStatus(pre, TECH_NODES.T25) === 'completed', 'T2.5 must be completed before structure mode');
    // 最终布局的放置件与接口盒先备料（布局迁移后仍要能锻造交付件）。
    await F.ensureStock('structure_frame', 6);
    await F.ensureStock('shaft', 3);
    await F.ensureStock('gear_12', 4);
    await F.ensureStock('interface_box', 2);
    await F.ensureStock('output_interface_box', 2);
    await F.ensureStock('splitter_box', 1);
    await removeAllParts();
    let s = await state();
    for (const itemId of ['flywheel_source', 'gear_12', 'shaft', 'crusher', 'smelter', 'forge']) {
      await ensureHotbar(itemId);
    }
    // 站位换到空地（(-7,7) 将成为飞轮所在格），再重新标定。
    assert(await goCell({ gx: -8, gz: 8 }), 'must step aside before rebuilding');
    await calibrate('FINAL-WORK');
    F.setWorkSpot({ gx: -8, gz: 8 });
    await placeLayout(LAYOUT_FINAL);
    for (let index = 0; index < FRAMES_FINAL.length; index += 1) {
      await placeFrameAt(FRAMES_FINAL[index], 'final-frame-' + index);
    }
    s = await state();
    const crusherId = crusherIdOf(s);
    const smelterIds = s.production.machines.filter((m) => m.recipeId === 'smelt-crushed-ore').map((m) => m.partId);
    assert(smelterIds.length === 2, 'final line needs two smelters, got ' + smelterIds.length);
    const crusherCell = cellOfMachine(s, crusherId);
    // 接口盒：破碎机输出分流盒；两台熔炼炉输入盒；两台熔炼炉输出盒。
    await onPart(crusherCell, crusherId, 'KeyK');
    for (const smelterId of smelterIds) {
      const cell = cellOfMachine(s, smelterId);
      await onPart(cell, smelterId, 'KeyT');
      await onPart(cell, smelterId, 'KeyO');
    }
    s = await state();
    assert(s.ports.length === 5, 'final line needs 5 interface boxes, got ' + s.ports.length);
    // 两条物料连接：破碎机分流盒 → 两台熔炼炉输入盒。
    await F.onPart(crusherCell, crusherId, 'KeyJ');
    await F.onPart(cellOfMachine(s, smelterIds[0]), smelterIds[0], 'KeyJ');
    s = await state();
    await F.onPart(crusherCell, crusherId, 'KeyJ');
    await F.onPart(cellOfMachine(s, smelterIds[1]), smelterIds[1], 'KeyJ');
    await windBoth(6500);
    const ready = await waitFor((now) => now.production.machines.length === 4
      && now.production.machines.every((machine) => machine.powered === true), 15, 'final-power');
    assert(ready.ok, 'final line must be fully powered: ' + JSON.stringify(ready.state?.sources));
    s = ready.state;
    assert(s.parts.length === LAYOUT_FINAL.length + FRAMES_FINAL.length, 'unexpected part count ' + s.parts.length);
    assert(s.links.length === 2 && s.links.every((link) => link.active === true), 'two active links expected, got ' + s.links.length);
    const assembly = s.assemblies.find((entry) => entry.memberIds.length >= 3);
    assert(assembly !== undefined, 'assembly with >=3 cores must be derived, got ' + JSON.stringify(s.assemblies));
    log('13-FINAL-LINE', { parts: s.parts.length, links: s.links.length, assembly: assembly.id, members: assembly.memberIds });
    await shot('13-final-line-assembly');
  });
}
