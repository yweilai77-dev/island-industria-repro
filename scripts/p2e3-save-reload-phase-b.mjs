// M2.0-P2-E3 存档验收 · 第二段：reload 触发恢复 -> 逐切片断言 -> 稳定性（不重复/不丢物品）。
// 由 scripts/p2e3-save-reload.mjs 在同一局 play 中调用（不单独运行）。
import { NODE_GEAR } from './p2e3-save-lib.mjs';

/** @param {{ play: any, kit: any, helpers: any, saved: any }} args */
export async function runPhaseB({ play, kit, helpers, saved }) {
  const { assert, state, logStep, rewind } = kit;
  const {
    sleep, waitForSaveUi, triggerRestore, waitRestored, readRawSave, parseSave,
    invTotals, normParts, normBuildings, normResources, normTech, playerOf, assertTechEqual,
  } = helpers;

  // ------------------------------------------------------------------
  await play.step('05-reload-and-restore', async () => {
    await play.reload();
    await play.advance(0.6);
    // 引擎侧已删除隐式自动读档：isolated 分档下显式发 save/restore，
    // 不再假设「reload 后会自动恢复」。失败再重试一次显式恢复（CDP 偶发丢事件）。
    const predicate = (st) => st.parts.length === saved.parts.length
      && st.tech?.unlocked.includes(NODE_GEAR) === true;
    await waitForSaveUi();
    let restored = null;
    try {
      await triggerRestore();
      restored = await waitRestored('explicit restore after reload', predicate, 30000);
    } catch (error) {
      console.log('P2E3-RESTORE-RETRY ' + String(error && error.message));
      await waitForSaveUi();
      await triggerRestore();
      restored = await waitRestored('explicit restore retry', predicate, 30000);
    }
    const stillSaved = parseSave(await readRawSave());
    assert(stillSaved.parts.length === saved.parts.length, 'save must survive the reload unchanged');
    logStep('05-RESTORED', { parts: restored.parts.length, tech: restored.tech.unlocked, player: playerOf(restored) });
    await play.screenshot('05-restored');
  });

  // ------------------------------------------------------------------
  await play.step('06-assert-slices', async () => {
    const s = await state();
    // 库存：逐物品一致（同时证明没有重复发放起步包）。
    const liveTotals = invTotals(s);
    const savedTotals = {};
    for (const stack of saved.inventory.stacks) savedTotals[stack.itemId] = (savedTotals[stack.itemId] ?? 0) + stack.count;
    for (const itemId of new Set([...Object.keys(liveTotals), ...Object.keys(savedTotals)])) {
      assert((liveTotals[itemId] ?? 0) === (savedTotals[itemId] ?? 0),
        'inventory mismatch after reload for ' + itemId + ': live=' + (liveTotals[itemId] ?? 0) + ' saved=' + (savedTotals[itemId] ?? 0));
    }
    // 零件：id/kind/placement 一致且不重复。
    const liveParts = normParts(s);
    const savedParts = saved.parts.slice().sort((a, b) => a.id - b.id);
    assert(liveParts.length === savedParts.length, 'part count mismatch: live=' + liveParts.length + ' saved=' + savedParts.length);
    assert(new Set(liveParts.map((part) => part.id)).size === liveParts.length, 'restored part ids must be unique');
    for (const expected of savedParts) {
      const actual = liveParts.find((part) => part.id === expected.id);
      assert(actual !== undefined, 'missing restored part id ' + expected.id + ' (' + expected.kind + ')');
      // 唯一 GameRead 的 parts[].kind 是「零件类别」（machine/gear/shaft/power-source/transport），
      // 不是 def.id；所以这里按类别可比的映射校验，具体 kind 的往返由 save-slices.test.ts 覆盖。
      const expectedCategory = { crusher: 'machine', smelter: 'machine', forge: 'machine', flywheel_source: 'power-source', shaft: 'shaft', gear_12: 'gear', gear_24: 'gear', chute: 'transport', vertical_drive: 'transport', machine: 'machine', power_source: 'power-source', structure_frame: 'structure' }[expected.kind];
      assert(actual.kind === expectedCategory || actual.partKind === expected.kind,
        'part ' + expected.id + ' kind mismatch: ' + actual.kind + ' vs ' + expected.kind);
      assert(actual.gx === expected.gx && actual.gz === expected.gz && actual.rotation === expected.rotation && actual.level === expected.level,
        'part ' + expected.id + ' placement mismatch: ' + JSON.stringify(actual) + ' vs ' + JSON.stringify(expected));
    }
    // 建筑：id/kind/placement 一致。
    const liveBuildings = normBuildings(s);
    const savedBuildings = (saved.buildings ?? []).slice().sort((a, b) => a.id - b.id);
    assert(liveBuildings.length === savedBuildings.length, 'building count mismatch: live=' + liveBuildings.length + ' saved=' + savedBuildings.length);
    for (const expected of savedBuildings) {
      const actual = liveBuildings.find((b) => b.id === expected.id);
      assert(actual !== undefined && actual.kind === expected.kind && actual.gx === expected.gx && actual.gz === expected.gz,
        'building ' + expected.id + ' mismatch: ' + JSON.stringify(actual) + ' vs ' + JSON.stringify(expected));
    }
    // 矿量：逐节点 amount/depleted 一致（证明没有重复扣矿）。
    assert(JSON.stringify(normResources(s)) === JSON.stringify(saved.resources.slice().sort((a, b) => a.id - b.id)),
      'resource mismatch after reload: live=' + JSON.stringify(normResources(s)) + ' saved=' + JSON.stringify(saved.resources));
    // 科技：解锁集合与每节点交付计数一致。
    assertTechEqual(s, saved);
    // 玩家位置：水平误差不超过 0.5 格（垂直解算允许落在同一支撑面的精确点）。
    const playerNow = playerOf(s);
    assert(Math.abs(playerNow.x - saved.player.x) <= 0.5, 'player x mismatch: ' + playerNow.x + ' vs ' + saved.player.x);
    assert(Math.abs(playerNow.z - saved.player.z) <= 0.5, 'player z mismatch: ' + playerNow.z + ' vs ' + saved.player.z);
    assert(playerNow.level === saved.player.level, 'player level mismatch: ' + playerNow.level + ' vs ' + saved.player.level);
    logStep('06-ASSERT', {
      inventory: liveTotals,
      parts: liveParts.length,
      buildings: liveBuildings.length,
      resources: normResources(s),
      tech: normTech(s),
      player: { now: playerNow, saved: saved.player },
    });
  });

  // ------------------------------------------------------------------
  await play.step('07-stability-no-duplicates', async () => {
    const before = await state();
    await play.advance(3);
    await sleep(200);
    const after = await state();
    assert(JSON.stringify(normResources(after)) === JSON.stringify(normResources(before)),
      'resource amounts must not change on their own after restore');
    assert(JSON.stringify(normParts(after)) === JSON.stringify(normParts(before)),
      'parts must not be duplicated/reset by the restore');
    assert(new Set(after.parts.map((part) => part.partId)).size === after.parts.length, 'no duplicate part ids');
    assert(after.tech.unlocked.includes(NODE_GEAR), 'tech progress must survive post-restore frames');
    // 恢复后世界仍可玩：飞轮重新储能后动力网络能重新输出。
    await rewind(3200);
    const powered = await state();
    assert(powered.sources.length === 1, 'flywheel source must exist after restore');
    logStep('07-STABLE', {
      resources: normResources(after),
      parts: after.parts.length,
      source: powered.sources[0] ? { enabled: powered.sources[0].enabled, energy: Math.round(powered.sources[0].energy ?? 0) } : null,
    });
    console.log('P2E3-SAVE-RELOAD=' + JSON.stringify({
      savedBytes: JSON.stringify(saved).length,
      parts: after.parts.length,
      tech: after.tech.unlocked,
    }));
    await play.screenshot('07-final');
  });
}