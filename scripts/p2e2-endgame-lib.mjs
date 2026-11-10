// M2.0-P2-E3 终局联合工厂验收共享上下文（真实键鼠 + 唯一 GameRead mechanical）。
//
// 复用 P2-C/P2-D 上下文（放置/标定/供能/物流/结构模式助手），补终局专用操作：
// - 批量生产铁锭（破碎 → 熔炼，全部真实加工，不注入物品）；
// - 锻压机按配方批量制造零件（逐批核对真实产出）；
// - 通过 __II_TEST_TECH__ 发送与正式 UI 相同的 tech/submit-all 命令交付科技；
// - 运行证明：真实开始 60 s 窗口，窗口内真实供能 + 投料，断言组合成员 producedTotal 增量；
// - 完成结算：16 件成套交付后 endgame 自动调用 completeProjectNode。
//
// 所有断言读唯一 GameRead mechanical（tech/project/assemblies/links/ports/production）。
import { createP2dCtx } from './p2d-assembly-lib.mjs';

export const SHAFT = 0;
export const GEAR12 = 1;
export const GEAR24 = 2;
export const CHUTE = 6;
export const VDRIVE = 7;
export const FLY = 8;
export const CRUSHER = 9;
export const SMELTER = 10;
export const FORGE = 11;

/** 与 p2e-tech-core.mjs 一致的一条已验证动力网络（1 飞轮驱动 3 台核心）。 */
export const PRODUCTION_LAYOUT = [
  { cell: { gx: -8, gz: 7 }, slot: FLY, rot: 0, label: 'P-flywheel' },
  { cell: { gx: -7, gz: 7 }, slot: SHAFT, rot: 0, label: 'P-shaft-a' },
  { cell: { gx: -6, gz: 7 }, slot: GEAR12, rot: 0, label: 'P-gear12' },
  { cell: { gx: -5, gz: 7 }, slot: SHAFT, rot: 0, label: 'P-shaft-b' },
  { cell: { gx: -4, gz: 7 }, slot: CRUSHER, rot: 0, label: 'P-crusher' },
  { cell: { gx: -6, gz: 8 }, slot: GEAR24, rot: 0, label: 'P-gear24-a' },
  { cell: { gx: -5, gz: 8 }, slot: SHAFT, rot: 0, label: 'P-shaft-c' },
  { cell: { gx: -4, gz: 8 }, slot: SMELTER, rot: 0, label: 'P-smelter' },
  { cell: { gx: -6, gz: 9 }, slot: GEAR24, rot: 0, label: 'P-gear24-b' },
  { cell: { gx: -5, gz: 9 }, slot: SHAFT, rot: 0, label: 'P-shaft-d' },
  { cell: { gx: -4, gz: 9 }, slot: FORGE, rot: 0, label: 'P-forge' },
];
export const PRODUCTION_CELLS = {
  flywheel: { gx: -8, gz: 7 },
  crusher: { gx: -4, gz: 7 },
  smelter: { gx: -4, gz: 8 },
  forge: { gx: -4, gz: 9 },
  buildSpot: { gx: -7, gz: 6 },
  ore: { gx: -6, gz: 4 },
};

/** 锻压配方单周期消耗的铁锭（全部单输入，运行时限制）。 */
export const FORGE_INPUTS = {
  'forge-shaft': 2,
  'forge-vertical-drive': 3,
  'forge-chute': 2,
  'forge-interface-box': 2,
  'forge-output-box': 2,
  'forge-splitter-box': 3,
  'forge-merger-box': 3,
  'forge-structure-frame': 3,
  'forge-crusher': 6,
  'forge-smelter': 7,
  'forge-processing-core': 8,
  'forge-gear-12': 1,
  'forge-gear-24': 1,
  'forge-flywheel': 12,
};

/**
 * 终局工厂布局（拆掉生产线后原地重建）：
 *   flywheel1(-4,6) 270 → shaft(-4,7) 270 → 破碎机(-4,8) 270    （P2-C LAYOUT_C 已验证）
 *   flywheel2(-6,9)   0 → shaft(-5,9)   0 → 熔炼炉(-4,9)    0    （同上）
 *   破碎机 输出 px → 熔炼炉 输入 nz（端口对接）；熔炼炉 输出 px → 锻压机(-3,9) 90 输入 nz。
 * 三个结构框架 (-3,8)/(-4,10)/(-3,10) 把三台核心连成一个组合机械。
 */
export const FACTORY_LAYOUT = [
  { cell: { gx: -4, gz: 6 }, slot: FLY, rot: 270, label: 'F-flywheel-1' },
  { cell: { gx: -4, gz: 7 }, slot: SHAFT, rot: 270, label: 'F-shaft-1' },
  { cell: { gx: -6, gz: 9 }, slot: FLY, rot: 0, label: 'F-flywheel-2' },
  { cell: { gx: -5, gz: 9 }, slot: SHAFT, rot: 0, label: 'F-shaft-2' },
  { cell: { gx: -4, gz: 8 }, slot: CRUSHER, rot: 270, label: 'F-crusher' },
  { cell: { gx: -4, gz: 9 }, slot: SMELTER, rot: 0, label: 'F-smelter' },
  { cell: { gx: -3, gz: 9 }, slot: FORGE, rot: 90, label: 'F-forge' },
];
export const FACTORY_FRAMES = [{ gx: -3, gz: 8 }, { gx: -4, gz: 10 }, { gx: -3, gz: 10 }];
export const FACTORY_CELLS = {
  flywheel1: { gx: -4, gz: 6 },
  flywheel2: { gx: -6, gz: 9 },
  crusher: { gx: -4, gz: 8 },
  smelter: { gx: -4, gz: 9 },
  forge: { gx: -3, gz: 9 },
  /** 站位：分别距两台飞轮 1.41 m（< range 2.2），都在空地上。 */
  windSpot1: { gx: -5, gz: 7 },
  windSpot2: { gx: -5, gz: 8 },
};

export function createEndgameCtx(play, h) {
  const C = createP2dCtx(play, h);
  const { assert, state, countOf, machineById, partOf, calRef } = C;

  const invOf = (s, itemId) => countOf(s, itemId);
  const techOf = (s) => s.tech ?? null;
  const techNode = (s, id) => techOf(s)?.nodes.find((node) => node.id === id) ?? null;
  const projectOf = (s) => s.project ?? null;
  const partAt = (s, cell) => s.parts.find((part) => part.placement.gx === cell.gx
    && part.placement.gz === cell.gz);
  const machineAt = (s, cell) => {
    const part = partAt(s, cell);
    return part ? s.production.machines.find((machine) => machine.partId === part.partId) : undefined;
  };
  const sourceOf = (s, partId) => s.sources.find((source) => source.partId === partId);

  const summarize = (s) => JSON.stringify({
    parts: s.parts.length,
    machines: s.production.machines.map((m) => ({
      id: m.partId, recipe: m.recipeId, powered: m.powered, block: m.block,
      input: m.inputCount, output: m.outputCount, produced: m.producedTotal,
    })),
    production: s.production.produced,
    inventory: s.inventory,
    sources: s.sources.map((x) => ({ id: x.partId, enabled: x.enabled, energy: Math.round(x.energy ?? 0) })),
    tech: techOf(s)?.nodes.map((n) => n.id + ':' + n.status),
    project: projectOf(s),
  });
  const logStep = (label, payload) => console.log('E3-EVIDENCE ' + label + '=' + JSON.stringify(payload));

  const waitState = async (label, predicate, options = {}) => {
    const timeoutMs = options.timeoutMs ?? 60000;
    const step = options.step ?? 2;
    const started = Date.now();
    let last = null;
    while (Date.now() - started < timeoutMs) {
      await play.advance(step);
      await play.wait(40);
      last = await state();
      if (predicate(last)) return last;
      if (options.keepPowered) await ensureProductionPowered(last);
    }
    throw new Error(label + ' timeout; snapshot=' + summarize(last));
  };

  // ---------------- 供能 ----------------
  /** 生产线按需补能：飞轮能量低或机器断电时，在建造点按住 C 摇柄（先移开鼠标避免误投料）。 */
  const ensureProductionPowered = async (current) => {
    const s = current ?? await state();
    const source = s.sources[0];
    const lowEnergy = !source || (source.energy ?? 0) < 120;
    const stalled = s.production.machines.length > 0
      && s.production.machines.some((machine) => machine.powered !== true);
    if (!lowEnergy && !stalled) return s;
    await h.clearHover();
    await h.holdKey('KeyC', 4200);
    await play.advance(0.2);
    let after = await state();
    if (after.sources[0]?.enabled !== true) {
      const flywheelPart = after.parts.find((part) => part.placement.gx === PRODUCTION_CELLS.flywheel.gx
        && part.placement.gz === PRODUCTION_CELLS.flywheel.gz);
      assert(flywheelPart, 'production flywheel must exist at ' + JSON.stringify(PRODUCTION_CELLS.flywheel));
      const point = await h.hoverSpecificPart(calRef.value, PRODUCTION_CELLS.flywheel, flywheelPart.partId);
      assert(point !== null, 'must aim at production flywheel');
      await h.selectSlot(SHAFT);
      await play.mouse.move(point);
      await play.wait(120);
      await h.rightClickAt(point);
      await play.advance(0.4);
      after = await state();
    }
    assert(after.sources[0]?.enabled === true, 'production flywheel must be engaged; snapshot=' + summarize(after));
    return after;
  };

  // ---------------- 投料 / 取货 ----------------
  const machinePoint = async (cell, partId) => {
    const point = await h.hoverSpecificPart(calRef.value, cell, partId);
    assert(point !== null, 'must aim at machine ' + partId + ' at ' + JSON.stringify(cell));
    return point;
  };

  const feedAt = async (cell, partId, times) => {
    const point = await machinePoint(cell, partId);
    await play.mouse.move(point);
    await play.wait(110);
    for (let index = 0; index < times; index += 1) {
      await play.keyboard.press('KeyC');
      await play.advance(0.08);
    }
  };

  const collectAt = async (cell, partId) => {
    const point = await machinePoint(cell, partId);
    await play.mouse.move(point);
    await play.wait(110);
    await h.rightClickAt(point);
    await play.advance(0.35);
  };

  // ---------------- 生产 ----------------
  /** 批量生产铁锭：4 矿石 → 4 碎矿 → 4 铁锭（真实加工，逐批核对库存）。 */
  const produceIngots = async (targetIngots) => {
    let produced = 0;
    while (produced < targetIngots) {
      let s = await ensureProductionPowered();
      const crusher = machineAt(s, PRODUCTION_CELLS.crusher);
      const smelter = machineAt(s, PRODUCTION_CELLS.smelter);
      assert(crusher && smelter, 'production crusher/smelter must be tracked; snapshot=' + summarize(s));
      assert(invOf(s, 'iron_ore') >= 4, 'need >= 4 iron ore, have ' + invOf(s, 'iron_ore'));
      const crushedBefore = invOf(s, 'crushed_ore');
      await feedAt(PRODUCTION_CELLS.crusher, crusher.partId, 4);
      await waitState('crush batch', (now) => (machineById(now, crusher.partId)?.outputCount ?? 0) >= 4,
        { timeoutMs: 60000, keepPowered: true });
      await collectAt(PRODUCTION_CELLS.crusher, crusher.partId);
      s = await state();
      assert(invOf(s, 'crushed_ore') >= crushedBefore + 4,
        'crush batch must add >= 4 crushed ore, got ' + (invOf(s, 'crushed_ore') - crushedBefore)
        + ' snapshot=' + summarize(s));
      const ingotBefore = invOf(s, 'iron_ingot');
      await feedAt(PRODUCTION_CELLS.smelter, smelter.partId, 4);
      await waitState('smelt batch', (now) => (machineById(now, smelter.partId)?.outputCount ?? 0) >= 4,
        { timeoutMs: 90000, keepPowered: true });
      await collectAt(PRODUCTION_CELLS.smelter, smelter.partId);
      s = await state();
      const added = invOf(s, 'iron_ingot') - ingotBefore;
      assert(added >= 4, 'smelt batch must add >= 4 ingots, got ' + added + ' snapshot=' + summarize(s));
      produced += added;
      logStep('INGOTS', { produced, target: targetIngots });
    }
    return produced;
  };

  /** 锻压机切换配方（悬停 + R；只切到已解锁配方，最多 30 次）。 */
  const setForgeRecipe = async (recipeId) => {
    const s = await state();
    const forge = machineAt(s, PRODUCTION_CELLS.forge);
    assert(forge, 'production forge must be tracked; snapshot=' + summarize(s));
    const point = await machinePoint(PRODUCTION_CELLS.forge, forge.partId);
    await h.selectSlot(SHAFT);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const now = await state();
      const machine = machineById(now, forge.partId);
      if (machine?.recipeId === recipeId) {
        await h.clearHover();
        return;
      }
      assert(machine?.progress === 0 && (machine?.inputCount ?? 0) === 0 && (machine?.outputCount ?? 0) === 0,
        'forge must be idle and empty before cycling recipe; snapshot=' + summarize(now));
      await play.mouse.move(point);
      await play.wait(100);
      await play.keyboard.press('KeyR');
      await play.advance(0.2);
    }
    throw new Error('cannot select forge recipe ' + recipeId + '; last=' + JSON.stringify(
      (await state()).production.machines.map((m) => m.recipeId)));
  };

  /** 批量锻压：切配方 → 投满一炉 → 等产物 → 收走；重复直到 cycles 完成。 */
  const forgeItem = async (recipeId, cycles) => {
    const inputPer = FORGE_INPUTS[recipeId];
    assert(inputPer !== undefined, 'unknown forge recipe ' + recipeId);
    await ensureProductionPowered();
    await setForgeRecipe(recipeId);
    let done = 0;
    while (done < cycles) {
      const s = await state();
      const forge = machineAt(s, PRODUCTION_CELLS.forge);
      assert(forge, 'production forge must be tracked');
      // 一炉最多投满输入缓冲（12），且产物缓冲只有 4 格：一次最多做 min(4, floor(12/消耗)) 个周期。
      const wantCycles = Math.min(cycles - done, 4, Math.floor(12 / inputPer));
      const wantIngots = wantCycles * inputPer;
      assert(invOf(s, 'iron_ingot') >= wantIngots,
        'need ' + wantIngots + ' ingots for ' + recipeId + ', have ' + invOf(s, 'iron_ingot'));
      await feedAt(PRODUCTION_CELLS.forge, forge.partId, wantIngots);
      await waitState('forge ' + recipeId, (now) => (machineById(now, forge.partId)?.outputCount ?? 0) >= 1
        && (machineById(now, forge.partId)?.block === 'output-full'
          || (machineById(now, forge.partId)?.outputCount ?? 0) >= wantCycles),
      { timeoutMs: 150000, keepPowered: true });
      await collectAt(PRODUCTION_CELLS.forge, forge.partId);
      done += wantCycles;
      logStep('FORGE', { recipeId, done, cycles });
    }
  };

  // ---------------- 科技交付（真实事务） ----------------
  const submitAll = (nodeId) => play.page.evaluate(
    (id) => globalThis.__II_TEST_TECH__?.submitAll(id),
    nodeId,
  );

  const deliverNode = async (nodeId) => {
    const before = await state();
    const nodeBefore = techNode(before, nodeId);
    assert(nodeBefore, 'tech node must exist: ' + nodeId);
    assert(nodeBefore.status !== 'locked', 'tech node must not be locked: ' + nodeId + ' status=' + nodeBefore.status);
    if (nodeBefore.status === 'completed') return before;
    await submitAll(nodeId);
    await play.advance(0.5);
    const after = await waitState('deliver ' + nodeId, (now) => techNode(now, nodeId)?.status === 'completed',
      { timeoutMs: 30000, step: 0.5 });
    logStep('TECH', { nodeId, status: techNode(after, nodeId)?.status, inventory: after.inventory });
    return after;
  };

  // ---------------- 工厂组装 ----------------
  const buildFrames = async () => {
    for (const cell of FACTORY_FRAMES) await C.placeFrameAt(cell, 'frame-' + cell.gx + '-' + cell.gz);
    await C.exitStructureMode();
    const s = await state();
    const assembly = s.assemblies.find((entry) => entry.memberIds.length >= 3);
    assert(assembly, 'assembly must contain >= 3 member cores, got '
      + JSON.stringify(s.assemblies.map((entry) => entry.memberIds)));
    logStep('FACTORY-ASSEMBLY', { id: assembly.id, members: assembly.memberIds, modules: assembly.moduleIds });
    return { state: s, assembly };
  };

  const installPorts = async () => {
    let s = await state();
    const crusher = machineAt(s, FACTORY_CELLS.crusher);
    const smelter = machineAt(s, FACTORY_CELLS.smelter);
    const forge = machineAt(s, FACTORY_CELLS.forge);
    assert(crusher && smelter && forge, 'factory cores must be tracked; snapshot=' + summarize(s));
    await C.onPart(FACTORY_CELLS.crusher, crusher.partId, 'KeyO');
    await C.onPart(FACTORY_CELLS.smelter, smelter.partId, 'KeyT');
    await C.onPart(FACTORY_CELLS.smelter, smelter.partId, 'KeyO');
    await C.onPart(FACTORY_CELLS.forge, forge.partId, 'KeyT');
    s = await state();
    logStep('FACTORY-PORTS', s.ports);
    const outputBoxes = s.ports.filter((port) => port.slotId.endsWith('.out.px'));
    assert(outputBoxes.length >= 2, '>= 2 member cores must carry an output interface box, got '
      + outputBoxes.length + ' ports=' + JSON.stringify(s.ports));
    return { state: s, crusher, smelter, forge };
  };

  const linkFactory = async () => {
    const s = await state();
    const crusher = machineAt(s, FACTORY_CELLS.crusher);
    const smelter = machineAt(s, FACTORY_CELLS.smelter);
    const forge = machineAt(s, FACTORY_CELLS.forge);
    assert(crusher && smelter && forge, 'factory cores must be tracked before linking');
    await C.onPart(FACTORY_CELLS.crusher, crusher.partId, 'KeyJ');
    await C.onPart(FACTORY_CELLS.smelter, smelter.partId, 'KeyJ');
    await play.advance(0.4);
    await C.onPart(FACTORY_CELLS.smelter, smelter.partId, 'KeyJ');
    await C.onPart(FACTORY_CELLS.forge, forge.partId, 'KeyJ');
    await play.advance(0.4);
    const after = await state();
    const members = new Set(after.assemblies[0]?.memberIds ?? []);
    const internal = after.links.filter((link) => members.has(link.from.entityId) && members.has(link.to.entityId));
    logStep('FACTORY-LINKS', { links: after.links.length, internal: internal.length });
    assert(internal.filter((link) => link.active).length >= 2,
      'factory needs >= 2 active internal links, got ' + internal.length + ' snapshot=' + summarize(after));
    return after;
  };

  /** 摇柄供能 + 真实右键启用离合；断言储能与 enabled。 */
  const windFlywheel = async (cell, partId) => {
    await h.clearHover();
    await h.holdKey('KeyC', 5200);
    await play.advance(0.2);
    let s = await state();
    if (sourceOf(s, partId)?.enabled !== true) {
      const point = await h.hoverSpecificPart(calRef.value, cell, partId);
      assert(point !== null, 'must aim at flywheel ' + partId);
      await h.selectSlot(SHAFT);
      await play.mouse.move(point);
      await play.wait(110);
      await h.rightClickAt(point);
      await play.advance(0.4);
      s = await state();
    }
    assert(sourceOf(s, partId)?.enabled === true, 'flywheel ' + partId + ' must be engaged');
    assert((sourceOf(s, partId)?.energy ?? 0) > 100, 'flywheel ' + partId + ' must store energy');
    return s;
  };

  // ---------------- 运行证明 ----------------
  const projectSnapshot = async () => projectOf(await state());

  const beginProof = async () => {
    await play.page.evaluate(() => globalThis.__II_TEST_ENDGAME__?.beginProof());
    await play.advance(0.6);
    const project = await projectSnapshot();
    assert(project !== null, 'project snapshot must be part of the unique mechanical GameRead');
    return project;
  };

  const waitProofState = async (label, expected, timeoutMs = 120000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await play.advance(1);
      await play.wait(60);
      const project = await projectSnapshot();
      if (project?.proof?.state === expected) return project;
      if (expected === 'passed' && project?.proof?.state === 'failed') {
        throw new Error(label + ': proof failed; reason=' + project.proof.failureReason
          + ' conditions=' + JSON.stringify(project.proof.conditions));
      }
    }
    throw new Error(label + ': proof did not reach ' + expected + '; snapshot='
      + JSON.stringify((await projectSnapshot())?.proof));
  };

  const screenshot = async (name) => {
    await play.keyboard.press('Escape');
    await h.clearHover();
    await play.advance(0.3);
    await play.screenshot(name);
  };

  return {
    ...C,
    invOf, techOf, techNode, projectOf, machineAt, partAt, sourceOf,
    waitState, summarize, logStep,
    ensureProductionPowered, feedAt, collectAt, produceIngots, setForgeRecipe, forgeItem,
    submitAll, deliverNode, buildFrames, installPorts, linkFactory, windFlywheel,
    beginProof, waitProofState, screenshot,
  };
}
