// M2.0-P2-E3 工作包 F：阶段 3（T3.1/T3.2/T3.3 + 60 s 运行证明）+ 保存/重载验收。
import { TECH_NODES, SLOT } from './p2f-lib.mjs';

const STAGE3_SHOTS = ['30-t31', '31-t32', '32-t33-delivered', '33-proof-passed', '34-completed'];
const SAVE_BUTTON = '[data-ii-action="save-request"]';
const SAVE_STATUS = '.ii-save-status';

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export async function runLateStages(play, F, saveKey) {
  const { assert, state, countOf, log, shot, windBoth, advanceUntil, ensureDelivery, submitItem,
    submitTech, nodeOf, nodeStatus, beginProof, crusherIdOf, cellOfMachine, producedCount,
    switchForgeRecipe, forgeIdOf, kit } = F;

  /** 等游戏真正可读（reload 后不能马上 advance/断言）。 */
  const waitReadable = async (label = 'ready') => {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      try {
        const s = await play.state('mechanical');
        if (s && Array.isArray(s.tech?.nodes) && s.tech.nodes.length === 12) return s;
      } catch (error) {
        // 启动/读档中：继续等。
      }
      await play.wait(150);
    }
    throw new Error(label + ': game state not readable after reload');
  };

  await play.step('30-t31-batch-processing', async () => {
    await ensureDelivery(TECH_NODES.T31);
    await submitTech(TECH_NODES.T31);
    let s = await state();
    assert(nodeStatus(s, TECH_NODES.T31) === 'completed', 'T3.1 must be completed');
    // 批量配方真实产出多件：4 铁锭 → 2 传动轴（输出缓冲一次进 2 件）。
    const forgeId = forgeIdOf(s);
    await switchForgeRecipe(forgeId, cellOfMachine(s, forgeId), 'forge-batch-shaft');
    s = await state();
    assert(s.production.machines.some((machine) => machine.recipeId === 'forge-batch-shaft'),
      'forge must switch to the batch recipe');
    const machine = s.production.machines.find((entry) => entry.partId === forgeId);
    const before = machine.producedTotal;
    const shaftsBefore = countOf(s, 'shaft');
    await F.feedMachine(cellOfMachine(s, forgeId), forgeId, 4);
    const done = await advanceUntil('batch cycle', (now) => {
      const entry = now.production.machines.find((item) => item.partId === forgeId);
      return entry !== undefined && entry.producedTotal >= before + 2;
    }, 30);
    const entry = done.production.machines.find((item) => item.partId === forgeId);
    assert(entry.outputItem === 'shaft' && entry.outputCount === 2,
      'batch recipe must put 2 shafts into one buffer, got ' + entry.outputItem + ' x' + entry.outputCount);
    await F.collectMachine(cellOfMachine(done, forgeId), forgeId, 1);
    const after = await state();
    assert(countOf(after, 'shaft') === shaftsBefore + 2, 'both batch products must reach the inventory');
    log('30-T31', { node: nodeStatus(after, TECH_NODES.T31), output: entry.outputCount, shafts: countOf(after, 'shaft') });
    await shot(STAGE3_SHOTS[0]);
  });

  await play.step('31-t32-line-integration-and-diagnostics', async () => {
    await ensureDelivery(TECH_NODES.T32);
    await submitTech(TECH_NODES.T32);
    const s = await F.advanceUntil('diagnostics unlocked', (now) => now.diagnostics !== null, 10);
    assert(nodeStatus(s, TECH_NODES.T32) === 'completed', 'T3.2 must be completed');
    assert(s.diagnostics !== null, 'line-diagnostics must be unlocked and non-null after T3.2');
    const view = s.diagnostics;
    assert(view.machines.length === s.production.machines.length,
      'diagnostics machines must mirror the unique GameRead, got ' + view.machines.length + ' vs ' + s.production.machines.length);
    assert(view.machines.every((machine) => (machine.conditions ?? []).length === 5),
      'every machine diagnostic must record 5 conditions');
    assert(view.machines.some((machine) => typeof machine.message === 'string' && machine.message.length > 0),
      'diagnostics must carry human-readable Chinese messages');
    assert(view.links.length === s.links.length, 'diagnostics links must mirror GameRead links');
    log('31-T32', { ability: true, summary: view.summary, bottleneck: view.bottleneck, hasError: view.hasError });
    await shot(STAGE3_SHOTS[1]);
  });

  await play.step('32-t33-deliver-combined-works', async () => {
    let s = await state();
    await ensureDelivery(TECH_NODES.T33);
    s = await state();
    const node = nodeOf(s, TECH_NODES.T33);
    assert(node !== undefined, 'T3.3 node must exist');
    const inventoryBefore = new Map(s.inventory.map((entry) => [entry.itemId, entry.count]));
    // 逐项交付前两件（证明“逐项”路径），其余一键交齐（与 UI 同一事务）。
    const first = node.cost[0];
    if (first !== undefined) await submitItem(TECH_NODES.T33, first.itemId, 1);
    s = await state();
    await play.page.evaluate((id) => globalThis.__II_TEST_TECH__?.submitAll(id), TECH_NODES.T33);
    s = await F.waitForState('T3.3 delivered', (now) => nodeStatus(now, TECH_NODES.T33) === 'researching', 20);
    assert(s.project.delivery.complete === true, '16-item delivery must be complete');
    assert(s.project.delivery.totalRequired === 16 && s.project.delivery.totalDelivered === 16,
      'delivery totals must be 16/16, got ' + s.project.delivery.totalDelivered + '/' + s.project.delivery.totalRequired);
    assert(s.project.completed === false, 'project must not complete before the proof passes');
    assert(s.project.blocks.some((text) => text.includes('运行证明')), 'blocks must mention the running proof: ' + JSON.stringify(s.project.blocks));
    const consumed = [...inventoryBefore.entries()].reduce((total, [itemId, count]) => total + Math.max(0, count - countOf(s, itemId)), 0);
    assert(consumed >= 16, 'delivery must consume exactly the 16 required items, got ' + consumed);
    log('32-T33-DELIVERED', { node: nodeStatus(s, TECH_NODES.T33), delivery: s.project.delivery, consumed });
    await shot(STAGE3_SHOTS[2]);
  });

  await play.step('33-run-proof-60s', async () => {
    let s = await state();
    const crusherId = crusherIdOf(s);
    F.setWorkSpot({ gx: -6, gz: 9 });
    await beginProof();
    s = await state();
    assert(s.project.proof.state === 'running', 'proof window must start running, got ' + s.project.proof.state);
    // 真实产线跑 60 s：持续补矿 + 维护双飞轮能量；不能靠等待空转。
    let elapsed = 0;
    let feeds = 0;
    while (elapsed < 70) {
      s = await state();
      if (s.project.proof.state !== 'running') break;
      if ((elapsed % 12) === 0) await windBoth(6500);
      s = await state();
      if (countOf(s, 'iron_ore') >= 2) {
        await F.feedMachine(cellOfMachine(s, crusherId), crusherId, 2);
        feeds += 1;
      }
      await play.advance(6);
      elapsed += 6;
      s = await state();
      log('33-PROOF', { elapsed: s.project.proof.elapsedSeconds, produced: s.project.proof.produced, state: s.project.proof.state });
    }
    s = await F.waitForState('proof passed', (now) => now.project.proof.state === 'passed', 20);
    assert(s.project.proof.produced >= 12, 'proof window must observe >=12 produced items, got ' + s.project.proof.produced);
    assert(s.project.proof.conditions.every((condition) => condition.ok),
      'all proof conditions must hold: ' + JSON.stringify(s.project.proof.conditions));
    s = await F.waitForState('project completed', (now) => now.project.completed === true, 10);
    assert(nodeStatus(s, TECH_NODES.T33) === 'completed', 'T3.3 must complete after the proof passes');
    log('33-PROOF-PASSED', { proof: s.project.proof, node: nodeStatus(s, TECH_NODES.T33), project: s.project.completed, feeds, oreLeft: countOf(s, 'iron_ore') });
    await shot(STAGE3_SHOTS[3]);
  });

  await play.step('34-final-state-and-track', async () => {
    await F.trackTech(TECH_NODES.T32);
    const s = await state();
    assert(s.project.completed === true, 'combined-works must be completed');
    assert(s.tech.unlocked.includes(TECH_NODES.T33), 'T3.3 must be in the unlocked set');
    assert(s.tech.trackedId === TECH_NODES.T32, 'tracked node must be T3.2');
    assert(s.diagnostics !== null, 'diagnostics must remain readable after completion');
    log('34-FINAL', {
      unlocked: s.tech.unlocked, tracked: s.tech.trackedId, project: s.project.completed,
      inventory: s.inventory, produced: s.production.produced,
    });
    await shot(STAGE3_SHOTS[4]);
  });

  await play.step('35-save-and-reload-persistence', async () => {
    let s = await state();
    const snapshot = {
      inventory: s.inventory.map((entry) => entry.itemId + ':' + entry.count).sort(),
      parts: s.parts.length,
      unlocked: [...s.tech.unlocked].sort(),
      tracked: s.tech.trackedId,
      project: s.project.completed,
      cell: s.player.cell,
      hotbar: s.ui.hotbar.slots.map((slot) => String(slot)).join(','),
    };
    // 打开面板 → 真实点击「立即保存」→ 等存储写入完成。
    await play.keyboard.press('Tab');
    await play.advance(0.2);
    await play.wait(150);
    await play.page.evaluate((selector) => {
      const button = document.querySelector(selector);
      if (button instanceof HTMLElement) button.click();
    }, SAVE_BUTTON);
    await play.wait(150);
    let stored = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await play.wait(100);
      stored = await play.page.evaluate((key) => globalThis.localStorage.getItem(key), saveKey);
      if (typeof stored === 'string' && stored.length > 100) break;
      stored = null;
    }
    assert(stored !== null, 'save must be written into the isolated storage key ' + saveKey);
    const status = await play.page.evaluate((sel) => document.querySelector(sel)?.textContent ?? '', SAVE_STATUS);
    assert(status.includes('已保存') || status.includes('保存'), 'save UI must report success, got ' + status);
    log('35-SAVED', { key: saveKey, bytes: stored.length, status });
    await play.keyboard.press('Escape');
    await play.advance(0.2);
    // 重载页面 → 先轮询到 state 可读（不 advance），再等自动读档恢复到终局完成态。
    await play.reload();
    const readable = await waitReadable('reload');
    assert(readable.tech.mode === 'player', 'reloaded page must still be player mode');
    s = await F.waitForState('restore settled',
      (now) => now.project.completed === true && now.tech.unlocked.includes(TECH_NODES.T33), 30);
    const after = {
      inventory: s.inventory.map((entry) => entry.itemId + ':' + entry.count).sort(),
      parts: s.parts.length,
      unlocked: [...s.tech.unlocked].sort(),
      tracked: s.tech.trackedId,
      project: s.project.completed,
      cell: s.player.cell,
      hotbar: s.ui.hotbar.slots.map((slot) => String(slot)).join(','),
    };
    assert(JSON.stringify(after.inventory) === JSON.stringify(snapshot.inventory),
      'inventory must be restored exactly, before=' + snapshot.inventory + ' after=' + after.inventory);
    assert(after.parts === snapshot.parts, 'mechanical parts must be restored, ' + snapshot.parts + ' -> ' + after.parts);
    assert(JSON.stringify(after.unlocked) === JSON.stringify(snapshot.unlocked), 'tech unlocked set must be restored');
    assert(after.tracked === snapshot.tracked, 'tracked node must be restored');
    assert(after.project === true, 'project completion must be restored');
    assert(after.cell.gx === snapshot.cell.gx && after.cell.gz === snapshot.cell.gz,
      'player cell must be restored, ' + JSON.stringify(snapshot.cell) + ' -> ' + JSON.stringify(after.cell));
    assert(after.hotbar === snapshot.hotbar, 'hotbar binding must be restored');
    assert(s.diagnostics !== null, 'diagnostics must be readable after restore (capability restored)');
    // 起步包不重复发放：重载前后库存完全一致（上面已断言），再显式确认没有多出套件物品。
    assert(countOf(s, 'shaft') <= Number(snapshot.inventory.find((entry) => entry.startsWith('shaft:'))?.split(':')[1] ?? 0),
      'starter kit must not be granted twice');
    log('35-RESTORED', { inventory: after.inventory, parts: after.parts, tracked: after.tracked, project: after.project });
    await shot('35-reloaded');
  });
}
