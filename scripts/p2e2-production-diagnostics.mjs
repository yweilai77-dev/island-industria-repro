// P2-E2/B 真实游戏验收：段1 player 能力未解锁 diagnostics=null；段2 legacy 真实三级产线
// 制造缺料/缺动力/下游满载三种真实阻塞，断言诊断与唯一 GameRead 一致 + 批量配方产 2 件。
import { createHarness } from './m18-helpers.mjs';
import { enterLegacyMode } from './legacy-mode.mjs';
import { createCtx, LAYOUT_F } from './p2c-links-lib.mjs';
import { FORGE } from './m20-order-lib.mjs';

const LEGACY_SAVE_KEY = 'p2e2/legacy-diag/' + Date.now();
const PLAYER_FORGE_CELL = { gx: -4, gz: 9 };
const WORK_CELL = { gx: -6, gz: 6 };
const ORE_VIEW = { gx: -6, gz: 4 };
const ORE_COUNT = 24;
const BUILD_SPOT = { gx: -6, gz: 7 };
const CRUSHER_CELL = { gx: -4, gz: 8 };
const SMELTER_CELL = { gx: -3, gz: 8 };
const FORGE_CELL = { gx: -3, gz: 7 };

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function playthrough(play) {
  const h = createHarness(play);
  const C = createCtx(play, h);
  const { assert, state, countOf, producedOf, machineOf, machineById, portsOf } = C;
  const { calibrate, placeLayout, enableAllSources, onPart, setSource, feedMachine,
    collectMachine, cycleRecipeAt, waitFor, shot } = C;
  const log = (label, payload) => console.log('P2E2B-' + label + '=' + JSON.stringify(payload));
  const diag = (s) => s.diagnostics ?? null;
  const cellOfPart = (s, partId) => {
    const part = s.parts.find((entry) => entry.partId === partId);
    return part ? { gx: part.placement.gx, gz: part.placement.gz } : undefined;
  };
  const setAllSources = async (enabled) => {
    const s = await state();
    for (const source of s.sources) {
      const cell = cellOfPart(s, source.partId);
      if (cell) await setSource(cell, source.partId, enabled);
    }
  };

  /** 诊断投影必须与同一帧的唯一 GameRead 完全一致（blocks/running/缓冲/连接/summary）。 */
  const assertDiagnosticsMirror = (s, label) => {
    const d = diag(s);
    assert(d !== null, label + ': diagnostics must be unlocked');
    assert(d.machines.length === s.production.machines.length,
      label + ': diagnostics machines count must equal production machines');
    for (const machine of s.production.machines) {
      const view = d.machines.find((entry) => entry.partId === machine.partId);
      assert(view !== undefined, label + ': missing machine ' + machine.partId);
      const detail = label + '/' + machine.partId;
      assert(view.block === machine.block, detail + ': block ' + view.block + ' vs ' + machine.block);
      assert(view.running === machine.running, detail + ': running mismatch');
      assert(view.recipeId === machine.recipeId, detail + ': recipe mismatch');
      assert(view.inputCount === machine.inputCount && view.outputCount === machine.outputCount, detail + ': buffer mismatch');
      assert(Math.abs(view.progress - machine.progress) < 1e-9, detail + ': progress mismatch');
      assert(view.powered === (s.parts.find((entry) => entry.partId === machine.partId)?.powered === true),
        detail + ': powered must mirror mechanical observation');
      assert((view.conditions ?? []).length === 5, detail + ': must record 5 conditions');
    }
    assert(d.links.length === s.links.length, label + ': diagnostics links count must equal GameRead links');
    for (const link of s.links) {
      const view = d.links.find((entry) => entry.id === link.id);
      assert(view !== undefined, label + ': diagnostics missing link ' + link.id);
      assert(view.state === link.status && view.transferred === link.moved, label + ': link mismatch ' + link.id);
    }
    assert(d.summary.total === d.machines.length, label + ': summary.total');
    assert(d.summary.running === d.machines.filter((m) => m.running).length, label + ': summary.running');
    assert(d.summary.powered === d.machines.filter((m) => m.powered).length, label + ': summary.powered');
    assert(d.summary.blocked === d.machines.filter((m) => m.severity === 'error').length, label + ': summary.blocked');
    return d;
  };

  // =========================================================================
  // 段 1：player 正式模式 —— 能力未解锁时诊断必须为 null
  // =========================================================================
  await play.step('00-player-diagnostics-locked', async () => {
    // 不注册 init script：默认就是 player 正式模式。
    // 先用真实 UI 的「清空存档并重开」清掉默认存档槽（避免自动读档把旧世界带进本次验收），
    // 再 reload 得到全新开局。
    await play.reload();
    await play.advance(0.8);
    await play.keyboard.press('Tab');
    await play.advance(0.2);
    await play.wait(250);
    const cleared = await play.page.evaluate(() => {
      const button = document.querySelector('[data-ii-action="save-new"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    });
    if (cleared) {
      await play.wait(500);
      await play.keyboard.press('Escape');
      await play.advance(0.2);
      await play.reload();
      await play.advance(0.8);
    }
    let s = await state();
    assert(s.tech?.mode === 'player', 'expected player progression mode');
    assert(s.diagnostics === null, 'diagnostics must be null while line-diagnostics is locked (not an empty array)');
    const node = (id) => s.tech.nodes.find((entry) => entry.id === id);
    assert(node('tech:batch-processing')?.status === 'locked', 'T3.1 must be locked in player mode');
    assert(node('tech:line-integration')?.status === 'locked', 'T3.2 must be locked in player mode');
    assert(node('tech:gear-manufacture')?.status === 'available', 'T1.1 must start available');
    log('00-PLAYER-LOCKED', { mode: s.tech.mode, diagnostics: s.diagnostics });

    // 锻压机可见配方数：player 模式下只有开局基础配方。
    await h.learnMovement();
    await h.gotoCell(WORK_CELL, 20000, true);
    const cal = await calibrate('PLAYER-WORK');
    const pt = await h.pointForCell(cal, PLAYER_FORGE_CELL, { avoidHover: true });
    await h.placePartAtPoint(pt, FORGE, 0, 'player-forge', PLAYER_FORGE_CELL);
    s = await state();
    const forge = s.production.machines.find((entry) => entry.recipeId === 'forge-shaft');
    assert(forge !== undefined, 'player forge missing');
    assert(forge.recipeCount === 1, 'player forge must expose 1 recipe, got ' + forge.recipeCount);
    assert(s.diagnostics === null, 'diagnostics must stay null with machines present but capability locked');
    log('00-PLAYER-RECIPES', { recipes: forge.recipeCount, recipeId: forge.recipeId });
    await shot('00-player-diagnostics-locked');
  });

  // =========================================================================
  // 段 2：legacy 兼容模式 —— 真实产线 + 真实阻塞 + 批量多件产出
  // =========================================================================
  await play.step('01-legacy-diagnostics-unlocked', async () => {
    // 复用仓库内已被 19 个旧脚本验证过的 helper：它只注册一个 init script（legacy flags+reload+
    // 轮询 tech.mode 与 16 项套件精确相等）。我们额外传隔离 saveStorageKey，避免跨 run 自动读档污染。
    const s = await enterLegacyMode(play, { saveStorageKey: LEGACY_SAVE_KEY });
    assert(s.tech?.mode === 'legacy', 'legacy mode must be active');
    assert(s.diagnostics !== null, 'legacy mode unlocks line-diagnostics, so diagnostics must be non-null');
    assert(diag(s).machines.length === 0 && diag(s).links.length === 0, 'fresh legacy world has no machines/links yet');
    assert(diag(s).bottleneck === null && diag(s).hasError === false, 'fresh world must have no bottleneck/error');
    assert(countOf(s, 'interface_box') > 0 && countOf(s, 'output_interface_box') > 0,
      'legacy kit must include interface boxes (real install path in this scenario)');
  });

  await play.step('02-harvest-ore', async () => {
    await calibrate('LEGACY-ORE');
    assert(await h.gotoCell(ORE_VIEW, 16000, true), 'must reach iron ore node A');
    const before = countOf(await state(), 'iron_ore');
    for (let index = 0; index < ORE_COUNT; index += 1) {
      await play.keyboard.press('KeyF');
      await play.advance(3.4);
      await play.wait(60);
    }
    const s = await state();
    assert(countOf(s, 'iron_ore') >= before + ORE_COUNT - 2, 'harvest short');
  });

  await play.step('03-build-three-stage-line', async () => {
    assert(await h.gotoCell(BUILD_SPOT, 20000, true), 'must walk to the build spot');
    await calibrate('LEGACY-SCENE-F');
    await placeLayout(LAYOUT_F);
    await enableAllSources(LAYOUT_F);
    const ready = await waitFor((now) => now.production.machines.length === 3
      && now.production.machines.every((machine) => machine.powered === true), 12, 'line-power');
    const s = ready.state;
    assert(ready.ok, 'all three machines must be powered by the legacy sources');
    assert(s.parts.length === LAYOUT_F.length, 'expected ' + LAYOUT_F.length + ' parts, got ' + s.parts.length);
    assertDiagnosticsMirror(s, 'line-built');
    assert(diag(s).summary.total === 3, 'diagnostics must track the three machines');
    await shot('03-three-stage-line');
  });

  await play.step('04-manual-ingots', async () => {
    let s = await state();
    const crusherId = machineOf(s, 'crush-iron-ore').partId;
    const smelterId = machineOf(s, 'smelt-crushed-ore').partId;
    // 两轮「4 矿 → 4 碎矿 → 4 铁锭」：为批量配方准备 8 铁锭。
    for (let round = 0; round < 2; round += 1) {
      await feedMachine(CRUSHER_CELL, crusherId, 4);
      const crushed = await waitFor((now) => producedOf(now, 'crushed_ore') >= 4 * (round + 1), 60, 'crush-' + round);
      assert(crushed.ok, 'crusher must crush 4 ore');
      await collectMachine(CRUSHER_CELL, crusherId, 1);
      await feedMachine(SMELTER_CELL, smelterId, 4);
      const smelted = await waitFor((now) => producedOf(now, 'iron_ingot') >= 4 * (round + 1), 90, 'smelt-' + round);
      assert(smelted.ok, 'smelter must produce 4 ingots');
      await collectMachine(SMELTER_CELL, smelterId, 1);
    }
    s = await state();
    assert(countOf(s, 'iron_ingot') >= 8, 'expected at least 8 ingots for the batch recipe, got ' + countOf(s, 'iron_ingot'));
    log('04-INGOTS', { ingots: countOf(s, 'iron_ingot') });
  });

  await play.step('05-batch-recipe-multi-output', async () => {
    let s = await state();
    const forgeId = machineOf(s, 'forge-shaft').partId;
    // R 切到 T3.1 批量配方：4 铁锭→2 轴。
    for (let guard = 0; guard < 20; guard += 1) {
      s = await state();
      if (machineById(s, forgeId).recipeId === 'forge-batch-shaft') break;
      await cycleRecipeAt(FORGE_CELL, forgeId);
    }
    s = await state();
    const batch = machineById(s, forgeId);
    assert(batch.recipeId === 'forge-batch-shaft', 'R must cycle the forge to forge-batch-shaft, got ' + batch.recipeId);
    const producedBefore = batch.producedTotal;
    await feedMachine(FORGE_CELL, forgeId, 4);
    const done = await waitFor((now) => machineById(now, forgeId).producedTotal >= producedBefore + 2, 30, 'batch-cycle');
    assert(done.ok, 'batch recipe must complete one cycle');
    s = done.state;
    const after = machineById(s, forgeId);
    assert(after.outputItem === 'shaft' && after.outputCount === 2,
      'batch recipe must put 2 shafts into one output buffer, got ' + after.outputItem + ' x' + after.outputCount);
    assert(after.producedTotal === producedBefore + 2, 'producedTotal must count both pieces');
    const shaftsBefore = countOf(s, 'shaft');
    await collectMachine(FORGE_CELL, forgeId, 1);
    s = await state();
    assert(countOf(s, 'shaft') === shaftsBefore + 2, 'both batched shafts must reach the inventory');
    assertDiagnosticsMirror(s, 'batch');
    await shot('05-batch-multi-output');
  });

  await play.step('06-install-ports-and-links', async () => {
    let s = await state();
    const crusherId = machineOf(s, 'crush-iron-ore').partId;
    const smelterId = machineOf(s, 'smelt-crushed-ore').partId;
    const forgeId = s.production.machines.find((entry) => entry.recipeId?.startsWith('forge-')).partId;
    // 输出盒/输入盒：破碎机→熔炼炉→锻压机
    await onPart(CRUSHER_CELL, crusherId, 'KeyO');
    await onPart(SMELTER_CELL, smelterId, 'KeyT');
    await onPart(SMELTER_CELL, smelterId, 'KeyO');
    await onPart(FORGE_CELL, forgeId, 'KeyT');
    await onPart(CRUSHER_CELL, crusherId, 'KeyJ');
    await onPart(SMELTER_CELL, smelterId, 'KeyJ');
    await onPart(SMELTER_CELL, smelterId, 'KeyJ');
    await onPart(FORGE_CELL, forgeId, 'KeyJ');
    s = await state();
    assert(s.links.length === 2 && s.links.every((link) => link.active === true), 'two active material links expected');
    assert(portsOf(s, crusherId).length === 1 && portsOf(s, smelterId).length === 2 && portsOf(s, forgeId).length === 1,
      'each machine must have its interface boxes installed');
    // 切回单件 forge-shaft。
    for (let guard = 0; guard < 20 && machineById(await state(), forgeId).recipeId !== 'forge-shaft'; guard += 1) {
      await cycleRecipeAt(FORGE_CELL, forgeId);
    }
    s = await state();
    assert(machineById(s, forgeId).recipeId === 'forge-shaft', 'forge must be back on forge-shaft');
    // 2 矿走完三级链路（接口盒 + MaterialLink 真实传递）。
    const forgeBefore = machineById(s, forgeId).producedTotal;
    await feedMachine(CRUSHER_CELL, crusherId, 2);
    const chain = await waitFor((now) => machineById(now, forgeId).producedTotal > forgeBefore, 60, 'chain');
    assert(chain.ok, 'the linked line must complete the full chain');
    s = chain.state;
    const d = assertDiagnosticsMirror(s, 'chain');
    assert(d.links.every((link) => link.severity === 'ok'), 'both links must report ok while delivering material');
    assert(d.machines.some((machine) => machine.severity === 'ok'), 'at least one machine must be reported as healthy');
    log('06-LINKED', { moved: s.links.map((l) => l.moved), ok: d.links.map((l) => l.severity) });
    await shot('06-linked-diagnostics-empty');
  });

  await play.step('07-real-blockage-no-input', async () => {
    let s = await state();
    const crusherId = machineOf(s, 'crush-iron-ore').partId;
    // 让链路把料吃完：破碎机没有输入 → 缺料。
    const starved = await waitFor((now) => now.production.machines.every((m) => m.block === 'no-input'), 90, 'starve');
    assert(starved.ok, 'all machines must run dry after the chain consumed its input');
    s = starved.state;
    const d = assertDiagnosticsMirror(s, 'no-input');
    const starving = d.machines.filter((machine) => machine.block === 'no-input');
    assert(starving.length === d.machines.length, 'every machine must report no-input');
    assert(d.hasError === true, 'no-input is an error-level diagnostic');
    assert(d.bottleneck?.kind === 'supply', 'bottleneck must be supply when everything lacks material, got ' + JSON.stringify(d.bottleneck));
    assert(d.bottleneck?.partId === crusherId, 'the most upstream machine must be the bottleneck');
    assert(starving[0].message.includes('缺原料'), 'Chinese message must explain the missing input: ' + starving[0].message);
    await shot('07-diagnostics-no-input');
  });

  await play.step('08-real-blockage-no-power', async () => {
    await setAllSources(false);
    await play.advance(0.6);
    const s = await state();
    const d = assertDiagnosticsMirror(s, 'no-power');
    assert(s.production.machines.every((m) => m.powered === false), 'all machines must be unpowered');
    assert(d.machines.every((m) => m.powered === false), 'diagnostics powered=false for every machine');
    assert(d.machines.every((m) => m.block === 'no-power'), 'every machine must report no-power');
    assert(d.summary.powered === 0, 'summary.powered must be 0');
    assert(d.bottleneck?.kind === 'power', 'bottleneck must be power, got ' + JSON.stringify(d.bottleneck));
    assert(d.machines.every((m) => (m.conditions ?? []).find((c) => c.id === 'power')?.ok === false), 'power condition must be false');
    log('08-NO-POWER', { bottleneck: d.bottleneck, summary: d.summary });
    await shot('08-diagnostics-no-power');
    await setAllSources(true);
    await play.advance(0.6);
  });

  await play.step('09-real-blockage-downstream-full', async () => {
    // 只停锻压机动力：上游继续生产 → 输入盒/上游输出盒填满 → 连接阻塞 + 输出满载。
    let s = await state();
    const forgeId = machineById(s, machineOf(s, 'forge-shaft').partId).partId;
    const forgeSourceId = s.sources.find((source) => {
      const part = s.parts.find((entry) => entry.partId === source.partId);
      return part !== undefined && part.placement.gx === -1 && part.placement.gz === 7;
    })?.partId;
    assert(forgeSourceId !== undefined, 'forge must have its own power source in LAYOUT_F');
    await setSource({ gx: -1, gz: 7 }, forgeSourceId, false);

    const crusherId = machineOf(s, 'crush-iron-ore').partId;
    let blocked = null;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      s = await state();
      const crusher = machineById(s, crusherId);
      if (crusher.inputCount === 0) await feedMachine(CRUSHER_CELL, crusherId, 4);
      await play.advance(4.0);
      s = await state();
      const d = diag(s);
      const hasFull = s.production.machines.some((machine) => machine.block === 'output-full');
      const hasBlockedLink = d !== null && d.links.some((link) => link.blocked === true);
      if (hasFull && hasBlockedLink) { blocked = s; break; }
    }
    assert(blocked !== null, 'downstream saturation must produce a real output-full + blocked link');
    const d = assertDiagnosticsMirror(blocked, 'downstream-full');
    const forgeView = d.machines.find((machine) => machine.partId === forgeId);
    assert(forgeView?.powered === false && forgeView?.block === 'no-power', 'the forge must be the stopped machine');
    const fullBox = d.machines.find((machine) => machine.outputPortFull === true || machine.inputPortFull === true);
    assert(fullBox !== undefined, 'at least one interface box must report full');
    const blockedLink = d.links.find((link) => link.blocked === true);
    assert(blockedLink !== undefined && blockedLink.severity === 'error', 'a material link must report a blockage');
    assert(d.hasError === true, 'downstream saturation is an error-level state');
    assert(d.bottleneck !== null && ['output', 'logistics'].includes(d.bottleneck.kind),
      'bottleneck must describe the downstream blockage, got ' + JSON.stringify(d.bottleneck));
    log('09-DOWNSTREAM-FULL', { bottleneck: d.bottleneck.kind, fullBox: fullBox.partId, summary: d.summary });
    await shot('09-diagnostics-downstream-full');

    // 恢复动力并取走产物 → 阻塞必须自行解除（不丢料）。
    await setSource({ gx: -1, gz: 7 }, forgeSourceId, true);
    let recovered = null;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await play.advance(3.0);
      s = await state();
      const forge = machineById(s, forgeId);
      if (forge.outputCount > 0) await collectMachine(FORGE_CELL, forgeId, 1);
      const now = diag(s);
      const hasFull = s.production.machines.some((machine) => machine.block === 'output-full');
      const hasBlockedLink = now !== null && now.links.some((link) => link.blocked === true);
      if (!hasFull && !hasBlockedLink) { recovered = s; break; }
    }
    assert(recovered !== null, 'the line must recover after power is restored and products are collected');
    const after = assertDiagnosticsMirror(recovered, 'recovered');
    assert(after.bottleneck === null || after.bottleneck.kind === 'supply',
      'after recovery the only remaining bottleneck may be supply, got ' + JSON.stringify(after.bottleneck));
    log('09-RECOVERED', { bottleneck: after.bottleneck, summary: after.summary });
    await shot('09-diagnostics-recovered');
  });

  await play.step('10-final', async () => {
    const s = await state();
    const d = assertDiagnosticsMirror(s, 'final');
    assert(d.unlocked === true, 'diagnostics snapshot must declare unlocked=true once visible');
    log('10-FINAL', { hasError: d.hasError, summary: d.summary, blocks: d.machines.map((m) => m.block), links: d.links.length });
    await shot('10-final');
  });
}
