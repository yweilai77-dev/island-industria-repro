// M2.0-P2-E3 存档验收 · 第一段：真实搭工厂 -> 交付科技 -> 放建筑 -> 手动保存。
// 由 scripts/p2e3-save-reload.mjs 在同一局 play 中调用（不单独运行）。
import { CELL, CRUSHER, FLYWHEEL, FORGE, GEAR12, GEAR24, SHAFT, SMELTER } from './m20-order-lib.mjs';
import { EXPECTED_PARTS, MAX_SAVE_BYTES, NODE_GEAR, SAVE_KEY } from './p2e3-save-lib.mjs';

/** @param {{ play: any, h: any, kit: any, helpers: any }} args */
export async function runPhaseA({ play, h, kit, helpers }) {
  const { assert, state, invOf, machineByRecipe, logStep, waitProduction, rewind } = kit;
  const {
    sleep, waitForSaveUi, triggerNewGame, triggerSave, waitRestored, readRawSave, parseSave, invTotals,
  } = helpers;

  let saved = null;
  let beforeReload = null;

  // ------------------------------------------------------------------
  await play.step('00-boot-player-mode', async () => {
    await play.page.addInitScript((flags) => {
      globalThis.__II_TEST_FLAGS__ = flags;
    }, { progression: 'player', techHooks: true, saveStorageKey: SAVE_KEY });
    await play.reload();
    await play.advance(0.6);
    const first = await state();
    assert(first.tech !== null, 'tech snapshot must be part of the unique mechanical GameRead');
    assert(first.tech.mode === 'player', 'expected player progression mode, got ' + first.tech.mode);
    // 清掉上一次运行留下的存档，保证本脚本从空世界开始（这也验证 save/clear 通道）。
    await waitForSaveUi();
    await triggerNewGame();
    const clearStarted = Date.now();
    while (Date.now() - clearStarted < 10000) {
      const raw = await readRawSave();
      if (raw === null || raw === '' || raw === undefined) break;
      await play.advance(0.2);
      await sleep(100);
    }
    const clearedRaw = await readRawSave();
    assert(clearedRaw === null || clearedRaw === '' || clearedRaw === undefined,
      'newGame must clear the stored save, got: ' + String(clearedRaw).slice(0, 80));
    // 前端在 save/clear 后会自行 reload（约 250 ms）；等它落定后再显式 reload 一次，
    // 确保本局世界是全新初始世界（第一次 reload 的自动恢复可能已把旧存档载入内存）。
    await sleep(800);
    await play.reload();
    await play.advance(0.8);
    const s = await waitRestored('pristine world after newGame', (st) => st.parts.length === 0 && (st.tech?.unlocked.length ?? -1) === 0, 15000);
    assert((s.buildings ?? []).length === 0, 'newGame world must have no buildings');
    logStep('00-BOOT', { mode: s.tech.mode, storageCleared: true, parts: s.parts.length });
  });

  // ------------------------------------------------------------------
  await play.step('01-harvest-ore', async () => {
    await h.learnMovement();
    const cal = await h.calibrate('LEVEL0');
    kit.setCal(cal);
    assert(await h.gotoCell({ gx: -6, gz: 4 }, 20000, true), 'must reach ore node A');
    // 状态驱动采集：长脚本里孤立短按键偶发整帧丢失，所以不盲按固定次数，
    // 而是 hold(KeyF,60) + 推进游戏时间，直到库存达到目标或尝试次数用完。
    const targetOre = 12;
    const maxAttempts = targetOre * 2;
    let attempts = 0;
    let ore = invOf(await state(), 'iron_ore');
    while (ore < targetOre && attempts < maxAttempts) {
      attempts += 1;
      await h.holdKey('KeyF', 60);
      await play.advance(0.2);
      await play.advance(3.0);
      await sleep(40);
      ore = invOf(await state(), 'iron_ore');
    }
    assert(ore >= targetOre - 3,
      'need at least ' + (targetOre - 3) + ' iron ore after ' + attempts + ' attempts, got ' + ore);
    logStep('01-ORE', { ore, attempts, target: targetOre });
  });

  // ------------------------------------------------------------------
  await play.step('02-build-line', async () => {
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
    assert(s.parts.length === EXPECTED_PARTS, 'expected ' + EXPECTED_PARTS + ' parts, got ' + s.parts.length);
    assert(s.networks.length === 1, 'expected exactly one power network');
    logStep('02-LINE', { parts: s.parts.length });
    await play.screenshot('02-line-built');
  });

  // ------------------------------------------------------------------
  await play.step('03-produce-and-deliver-tech', async () => {
    const cal = kit.getCal();
    await h.clearHover();
    await h.holdKey('KeyC', 6500);
    let s = await state();
    const flywheelPart = s.parts.find((part) => part.kind === 'power-source');
    const flywheelPt = await h.hoverSpecificPart(cal, CELL.flywheel, flywheelPart.partId);
    kit.points.flywheel = flywheelPt;
    await h.selectSlot(SHAFT);
    await h.clickAt(flywheelPt);
    await h.rightClickAt(flywheelPt);
    await play.advance(0.6);
    s = await state();
    assert(s.sources[0].engaged === true, 'flywheel clutch must engage');

    const crusher = machineByRecipe(s, 'crush-iron-ore');
    const smelter = machineByRecipe(s, 'smelt-crushed-ore');
    const forge = machineByRecipe(s, 'forge-shaft');
    assert(crusher !== undefined && smelter !== undefined && forge !== undefined, 'crusher/smelter/forge must be tracked');
    const crusherPt = await h.hoverSpecificPart(cal, CELL.crusher, crusher.partId);
    const smelterPt = await h.hoverSpecificPart(cal, CELL.smelter, smelter.partId);
    const forgePt = await h.hoverSpecificPart(cal, CELL.forge, forge.partId);
    kit.points.crusher = crusherPt;
    kit.points.smelter = smelterPt;
    kit.points.forge = forgePt;

    // 状态驱动投料：hold(KeyC,60) 防整帧丢失；用「库存实际减少量」校验每一下是否真的进了机器，
    // 没进就重试（最多 times*3 次），最终不足则带上下文失败。
    const feed = async (point, times, itemId, partId) => {
      await play.mouse.move(point);
      await sleep(140);
      let inserted = 0;
      let attempts = 0;
      const maxAttempts = times * 3;
      while (inserted < times && attempts < maxAttempts) {
        attempts += 1;
        const before = invOf(await state(), itemId);
        await h.holdKey('KeyC', 60);
        await play.advance(0.12);
        await sleep(30);
        const after = invOf(await state(), itemId);
        const delta = before - after;
        if (delta > 0) inserted += delta;
      }
      assert(inserted >= times,
        'feed ' + itemId + ' into part ' + partId + ': expected ' + times + ' inserted, got ' + inserted
          + ' after ' + attempts + ' attempts');
      return inserted;
    };
    const take = async (point) => {
      await play.mouse.move(point);
      await sleep(120);
      await h.rightClickAt(point);
      await play.advance(0.3);
    };

    // 2 批 × 4 矿石 -> 8 碎铁矿；2 批 × 4 碎铁矿 -> 8 铁锭；4 铁锭 -> 2 传动轴。
    for (let batch = 0; batch < 2; batch += 1) {
      await rewind(3500);
      await feed(crusherPt, 4, 'iron_ore', crusher.partId);
      await waitProduction('crush batch ' + batch, (st) => (st.production.produced.find((p) => p.itemId === 'crushed_ore')?.count ?? 0) >= 4 * (batch + 1), { timeoutMs: 90000 });
      await take(crusherPt);
    }
    for (let batch = 0; batch < 2; batch += 1) {
      await rewind(3500);
      await feed(smelterPt, 4, 'crushed_ore', smelter.partId);
      await waitProduction('smelt batch ' + batch, (st) => (st.production.produced.find((p) => p.itemId === 'iron_ingot')?.count ?? 0) >= 4 * (batch + 1), { timeoutMs: 120000 });
      await take(smelterPt);
    }
    await feed(forgePt, 4, 'iron_ingot', forge.partId);
    await waitProduction('forge shafts', (st) => (st.production.produced.find((p) => p.itemId === 'shaft')?.count ?? 0) >= 2, { timeoutMs: 90000, keepPowered: true });
    await take(forgePt);

    const submit = (nodeId, itemId, count) => play.page.evaluate(
      (args) => globalThis.__II_TEST_TECH__?.submit(args.nodeId, args.itemId, args.count),
      { nodeId, itemId, count },
    );
    const nodeOf = (st, id) => st.tech?.nodes.find((node) => node.id === id) ?? null;
    await submit(NODE_GEAR, 'iron_ingot', 3);
    await play.advance(0.4);
    await submit(NODE_GEAR, 'shaft', 2);
    const delivered = await waitRestored('tech node completion', (st) => nodeOf(st, NODE_GEAR)?.status === 'completed', 30000);
    assert(nodeOf(delivered, NODE_GEAR)?.status === 'completed', 'tech node must complete before saving');
    logStep('03-DELIVER', {
      unlocked: delivered.tech.unlocked,
      inventory: invTotals(delivered),
      produced: delivered.production.produced,
    });
    await play.screenshot('03-tech-delivered');
  });

  // ------------------------------------------------------------------
  await play.step('03b-place-building', async () => {
    // 普通建筑（buildings 服务）：把存档覆盖到「建筑」而不是只存机械零件。
    const cal = kit.getCal();
    await h.clearHover();
    await h.selectSlot(5); // 空槽 = 普通建造模式
    const buildingCell = { gx: -7, gz: 4 };
    const pt = await h.pointForCell(cal, buildingCell);
    await play.mouse.move(pt);
    await play.wait(220);
    const target = (await state()).ui.buildTarget;
    assert(target?.active === true && target.valid === true,
      'building placement target must be active+valid at ' + buildingCell.gx + ',' + buildingCell.gz + ': ' + JSON.stringify(target));
    await h.clickAt(pt);
    await play.advance(0.5);
    const built = await state();
    assert((built.buildings ?? []).length === 1,
      'expected exactly 1 building after placement, got ' + JSON.stringify(built.buildings));
    logStep('03B-BUILDING', { buildings: built.buildings });
    await play.screenshot('03b-building');
  });

  // ------------------------------------------------------------------
  await play.step('04-manual-save', async () => {
    // 先断开动力，让世界静止：这样「手动保存」与随后可能发生的 15 s 自动保存
    // 会写出同一份世界状态，避免脚本与前端自动保存抢写导致快照不一致。
    const beforeStop = await state();
    assert(beforeStop.sources[0]?.enabled === true, 'flywheel must still be engaged before saving');
    await h.selectSlot(SHAFT);
    await play.mouse.move(kit.points.flywheel);
    await sleep(140);
    await h.rightClickAt(kit.points.flywheel);
    await play.advance(0.4);
    const stopped = await state();
    assert(stopped.sources[0].enabled === false, 'power source must be off before the deterministic save');
    beforeReload = stopped;
    await triggerSave();
    // 保存是异步通道：轮询到存档出现且包含本次世界的关键字段。
    const started = Date.now();
    let raw = null;
    while (Date.now() - started < 20000) {
      raw = await readRawSave();
      if (typeof raw === 'string' && raw.length > 0) break;
      await play.advance(0.2);
      await sleep(120);
    }
    saved = parseSave(raw);
    const size = new TextEncoder().encode(raw).length;
    assert(size < MAX_SAVE_BYTES, 'save must stay under ' + MAX_SAVE_BYTES + ' bytes, got ' + size);
    // 写入内容必须就是当前真实世界（不是默认世界）。
    assert(saved.parts.length === EXPECTED_PARTS, 'saved parts must be ' + EXPECTED_PARTS + ', got ' + saved.parts.length);
    assert(saved.tech.unlocked.includes(NODE_GEAR), 'saved tech must include ' + NODE_GEAR);
    const liveTotals = invTotals(beforeReload);
    const savedTotals = {};
    for (const stack of saved.inventory.stacks) savedTotals[stack.itemId] = (savedTotals[stack.itemId] ?? 0) + stack.count;
    for (const [itemId, count] of Object.entries(liveTotals)) {
      assert((savedTotals[itemId] ?? 0) === count, 'saved inventory mismatch for ' + itemId + ': live=' + count + ' saved=' + (savedTotals[itemId] ?? 0));
    }
    for (const live of beforeReload.resources) {
      const record = saved.resources.find((entry) => entry.id === live.id);
      assert(record !== undefined && record.amount === live.amount, 'saved ore amount mismatch for node ' + live.id + ': live=' + live.amount + ' saved=' + record?.amount);
    }
    logStep('04-SAVED', { bytes: size, parts: saved.parts.length, tech: saved.tech.unlocked, player: saved.player });
    await play.screenshot('04-saved');
  });

  return { saved };
}
